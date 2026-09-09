import { NextRequest, NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { fetchAttendances, extractChatbotId, type SuriAttendance } from "@/lib/suri";
import { monthRange, previousMonthRange, previousWeek, weekRangeForMonday } from "@/lib/weeks";
import {
  buildReport,
  cleanRecordsForWindow,
  recordsForDepartment,
  recordsForAttendants,
  buildTopRecurrentClients,
  buildTopReasons,
  buildPeriodAttendants,
} from "@/lib/metrics";

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

    // Busca sem filtro de setor/atendente na própria API — uma chamada por
    // semana envolvida, em paralelo. O filtro por departmentId/attendantId no
    // lado da API Suri é muito mais lento (~10-20x) do que buscar tudo e
    // filtrar aqui em memória com recordsForDepartment/recordsForAttendants.
    const fetchWeek = (w: { mondayDate: string; saturdayDate: string }) =>
      fetchAttendances(settings.chatbotUrl!, settings.bearerToken!, {
        dateFrom: w.mondayDate,
        dateTo: w.saturdayDate,
        getCurrent: settings.getCurrent,
        useBusinessHours: settings.useBusinessHours,
      });

    const [currentRecordsRaw, previousRecordsRaw, ...historyRecordsRaw] = await Promise.all([
      fetchWeek(currentWeek),
      fetchWeek(prevWeek),
      ...historyWeeksOldToNew.map(fetchWeek),
    ]);

    // Filtro pessoal de atendentes (query string, nunca salvo no banco) tem
    // prioridade; cada pessoa pode escolher os seus sem afetar os demais.
    // Sem filtro pessoal, cai no filtro de atendentes configurado no setor (se houver).
    const forDeptAndAttendants = (records: SuriAttendance[], dept: (typeof departments)[number]) =>
      recordsForAttendants(recordsForDepartment(records, dept), personalAttendantIds ?? dept.attendantIds);

    const currentRecords = departments.flatMap((dept) => forDeptAndAttendants(currentRecordsRaw, dept));
    const previousRecords = departments.flatMap((dept) => forDeptAndAttendants(previousRecordsRaw, dept));
    const extraHistoryWeeksOldToNew = historyWeeksOldToNew.map((week, i) => ({
      week,
      records: departments.flatMap((dept) => forDeptAndAttendants(historyRecordsRaw[i] ?? [], dept)),
    }));

    const report = buildReport(departments, currentRecords, previousRecords, currentWeek, prevWeek, extraHistoryWeeksOldToNew);

    // Rankings de recorrência e motivos, calculados separadamente por setor.
    // Busca top 15 — a UI mostra só os 5 primeiros e expande sob demanda até 15.
    const RANKING_LIMIT = 15;
    const currentCleanedRaw = cleanRecordsForWindow(currentRecordsRaw, currentWeek);
    const cleanedByDept = departments.map((dept) =>
      recordsForAttendants(recordsForDepartment(currentCleanedRaw, dept), personalAttendantIds ?? dept.attendantIds)
    );
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
    // voltar a ver/adicionar atendentes que já tirou da seleção). Como já temos
    // currentCleanedRaw (sem filtro de atendente pessoal), basta filtrar só por
    // setor — sem precisar refazer nenhuma busca à API.
    const attendantSourceByDept = departments.map((dept) => recordsForAttendants(recordsForDepartment(currentCleanedRaw, dept), dept.attendantIds));
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
