import { NextRequest, NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { fetchAttendances, extractChatbotId } from "@/lib/suri";
import { monthRange, previousMonthRange, previousWeek, weekRangeForMonday } from "@/lib/weeks";
import { buildReport, cleanRecordsForWindow, recordsForDepartment, buildTopRecurrentClients, buildTopReasons } from "@/lib/metrics";

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

    // Rankings de recorrência e motivos, calculados separadamente por setor (top 5 cada).
    const cleanedByDept = departments.map((dept, i) => recordsForDepartment(cleanRecordsForWindow(perDepartment[i].current, currentWeek), dept));
    const departmentRankings = departments.map((dept, i) => ({
      departmentId: dept.departmentId,
      name: dept.name,
      topRecurrentClients: buildTopRecurrentClients(cleanedByDept[i], 5),
      topReasons: buildTopReasons(cleanedByDept[i], 5),
    }));

    // Compilado dos setores selecionados (soma de todos os departmentRankings), sempre top 5.
    const allCleaned = cleanedByDept.flat();
    const overallRanking = {
      topRecurrentClients: buildTopRecurrentClients(allCleaned, 5),
      topReasons: buildTopReasons(allCleaned, 5),
    };

    return NextResponse.json({
      ...report,
      chatbotId: extractChatbotId(settings.chatbotUrl),
      departmentRankings,
      overallRanking,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
