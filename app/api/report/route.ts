import { NextRequest, NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { fetchAttendances, extractChatbotId } from "@/lib/suri";
import { monthRange, previousMonthRange, previousWeek, weekRangeForMonday } from "@/lib/weeks";
import { buildReport, cleanRecordsForWindow, recordsForDepartment, buildTopRecurrentClients, buildTopReasons, buildPeriodAttendants } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const mode = req.nextUrl.searchParams.get("mode") === "month" ? "month" : "week";
    const mondayDate = req.nextUrl.searchParams.get("weekStart");
    const yearParam = Number(req.nextUrl.searchParams.get("year"));
    const monthParam = Number(req.nextUrl.searchParams.get("month"));
    const departmentIdsParam = req.nextUrl.searchParams.get("departmentIds"); // opcional, csv
    const attendantIdsParam = req.nextUrl.searchParams.get("attendantIds"); // opcional, csv — filtro pessoal (não salvo no banco)
    const personalAttendantIds = attendantIdsParam ? attendantIdsParam.split(",").filter(Boolean) : null;

    if (mode === "week" && !mondayDate) {
      return NextResponse.json({ error: "weekStart (YYYY-MM-DD, uma segunda-feira) é obrigatório" }, { status: 400 });
    }
    if (mode === "month" && (!yearParam || !monthParam || monthParam < 1 || monthParam > 12)) {
      return NextResponse.json({ error: "year e month (1-12) são obrigatórios no modo mensal" }, { status: 400 });
    }

    const settings = await getSettings();
    if (!settings.chatbotUrl || !settings.bearerToken) {
      return NextResponse.json({ error: "Configure a URL do chatbot e o token na sessão de ajustes primeiro." }, { status: 400 });
    }

    let departments = await listDepartments();
    departments = departments.filter((d) => d.active);
    if (departmentIdsParam) {
      const wanted = new Set(departmentIdsParam.split(",").filter(Boolean));
      departments = departments.filter((d) => wanted.has(d.departmentId));
    }
    if (departments.length === 0) {
      return NextResponse.json({ error: "Nenhum setor ativo configurado. Adicione setores na sessão de ajustes." }, { status: 400 });
    }

    const currentWeek = mode === "month" ? monthRange(yearParam, monthParam) : weekRangeForMonday(mondayDate!);
    const prevWeek = mode === "month" ? previousMonthRange(yearParam, monthParam) : previousWeek(mondayDate!);

    // Só no modo semanal: mais 2 semanas pra trás de "prevWeek", usadas
    // exclusivamente pra detectar streaks de 3+ semanas fora da meta. O
    // comparativo principal do relatório continua sendo só atual x anterior.
    const historyWeeksOldToNew =
      mode === "week"
        ? (() => {
            const back2 = previousWeek(prevWeek.mondayDate);
            const back3 = previousWeek(back2.mondayDate);
            return [back3, back2];
          })()
        : [];

    // Busca por setor (filtro departmentId direto na API), uma chamada por
    // setor ativo, para as semanas envolvidas em paralelo.
    const perDepartment = await Promise.all(
      departments.map(async (dept) => {
        // Filtro pessoal de atendentes (query string, nunca salvo no banco) tem
        // prioridade; cada pessoa pode escolher os seus sem afetar os demais.
        // Sem filtro pessoal, cai no filtro de atendentes configurado no setor (se houver).
        const effectiveAttendantIds = personalAttendantIds ?? dept.attendantIds;
        const attendantId =
          effectiveAttendantIds.length === 0 ? undefined : effectiveAttendantIds.length === 1 ? effectiveAttendantIds[0] : effectiveAttendantIds;
        const fetchFor = (w: { mondayDate: string; saturdayDate: string }) =>
          fetchAttendances(settings.chatbotUrl!, settings.bearerToken!, {
            dateFrom: w.mondayDate,
            dateTo: w.saturdayDate,
            departmentId: dept.departmentId,
            attendantId,
            getCurrent: settings.getCurrent,
            useBusinessHours: settings.useBusinessHours,
          });
        const [current, previous, ...history] = await Promise.all([
          fetchFor(currentWeek),
          fetchFor(prevWeek),
          ...historyWeeksOldToNew.map(fetchFor),
        ]);
        return { current, previous, history };
      })
    );

    const currentRecords = perDepartment.flatMap((p) => p.current);
    const previousRecords = perDepartment.flatMap((p) => p.previous);
    const extraHistoryWeeksOldToNew = historyWeeksOldToNew.map((week, i) => ({
      week,
      records: perDepartment.flatMap((p) => p.history[i] ?? []),
    }));

    const report = buildReport(departments, currentRecords, previousRecords, currentWeek, prevWeek, extraHistoryWeeksOldToNew);

    // Rankings de recorrência e motivos, calculados separadamente por setor.
    // Busca top 15 — a UI mostra só os 5 primeiros e expande sob demanda até 15.
    const RANKING_LIMIT = 15;
    const cleanedByDept = departments.map((dept, i) => recordsForDepartment(cleanRecordsForWindow(perDepartment[i].current, currentWeek), dept));
    const departmentRankings = departments.map((dept, i) => ({
      departmentId: dept.departmentId,
      name: dept.name,
      topRecurrentClients: buildTopRecurrentClients(cleanedByDept[i], RANKING_LIMIT),
      topReasons: buildTopReasons(cleanedByDept[i], RANKING_LIMIT),
    }));

    // Compilado dos setores selecionados (soma de todos os departmentRankings).
    const allCleaned = cleanedByDept.flat();
    const overallRanking = {
      topRecurrentClients: buildTopRecurrentClients(allCleaned, RANKING_LIMIT),
      topReasons: buildTopReasons(allCleaned, RANKING_LIMIT),
    };

    // Lista de atendentes pra montar o filtro "Atendente" da UI: precisa refletir
    // quem de fato atendeu no período/setores buscados, sem ficar restrita ao
    // filtro pessoal de atendente já aplicado (senão o usuário nunca conseguiria
    // voltar a ver/adicionar atendentes que já tirou da seleção). Quando não há
    // filtro pessoal ativo, os registros já buscados servem sem custo extra;
    // quando há, refaz a busca por setor ignorando só o filtro pessoal.
    const attendantSourceByDept = personalAttendantIds
      ? await Promise.all(
          departments.map(async (dept) => {
            const deptOnlyAttendantId =
              dept.attendantIds.length === 0 ? undefined : dept.attendantIds.length === 1 ? dept.attendantIds[0] : dept.attendantIds;
            const raw = await fetchAttendances(settings.chatbotUrl!, settings.bearerToken!, {
              dateFrom: currentWeek.mondayDate,
              dateTo: currentWeek.saturdayDate,
              departmentId: dept.departmentId,
              attendantId: deptOnlyAttendantId,
              getCurrent: settings.getCurrent,
              useBusinessHours: settings.useBusinessHours,
            });
            return recordsForDepartment(cleanRecordsForWindow(raw, currentWeek), dept);
          })
        )
      : cleanedByDept;
    const periodAttendants = buildPeriodAttendants(departments.map((dept, i) => ({ deptName: dept.name, records: attendantSourceByDept[i] })));

    return NextResponse.json({
      ...report,
      chatbotId: extractChatbotId(settings.chatbotUrl),
      departmentRankings,
      overallRanking,
      periodAttendants,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
