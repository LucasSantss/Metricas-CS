import { NextRequest, NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { fetchAttendances, extractChatbotId } from "@/lib/suri";
import { monthRange, weekRangeForMonday } from "@/lib/weeks";
import { cleanRecordsForWindow, recordsForDepartment, buildPeriodAttendants } from "@/lib/metrics";
import { computePercentileStats, buildP90Entries } from "@/lib/percentiles";
import type { SuriAttendance } from "@/lib/suri";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const mode = req.nextUrl.searchParams.get("mode") === "month" ? "month" : "week";
    const mondayDate = req.nextUrl.searchParams.get("weekStart");
    const yearParam = Number(req.nextUrl.searchParams.get("year"));
    const monthParam = Number(req.nextUrl.searchParams.get("month"));
    const departmentIdsParam = req.nextUrl.searchParams.get("departmentIds");
    const attendantIdsParam = req.nextUrl.searchParams.get("attendantIds");
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

    const period = mode === "month" ? monthRange(yearParam, monthParam) : weekRangeForMonday(mondayDate!);

    const recordsByDept: SuriAttendance[][] = [];

    const results = await Promise.all(
      departments.map(async (dept, deptIndex) => {
        const effectiveAttendantIds = personalAttendantIds ?? dept.attendantIds;
        const attendantId =
          effectiveAttendantIds.length === 0 ? undefined : effectiveAttendantIds.length === 1 ? effectiveAttendantIds[0] : effectiveAttendantIds;
        const recordsRaw = await fetchAttendances(settings.chatbotUrl!, settings.bearerToken!, {
          dateFrom: period.mondayDate,
          dateTo: period.saturdayDate,
          departmentId: dept.departmentId,
          attendantId,
          getCurrent: settings.getCurrent,
          useBusinessHours: settings.useBusinessHours,
        });
        const records = recordsForDepartment(cleanRecordsForWindow(recordsRaw, period), dept);
        recordsByDept[deptIndex] = records;

        const tmeOf = (r: (typeof records)[number]) => (r.waitingTime ?? 0) * 60;
        const tmaOf = (r: (typeof records)[number]) => (r.attendanceTime ?? 0) * 60;
        const tmrOf = (r: (typeof records)[number]) => (r.avgResponseTime ?? 0) * 60;

        const tme = computePercentileStats(records.map(tmeOf));
        const tma = computePercentileStats(records.map(tmaOf));
        const tmr = computePercentileStats(records.map(tmrOf));

        const goals = {
          tme: { p50: dept.goalTmeP50Seconds, p75: dept.goalTmeP75Seconds, p90: dept.goalTmeP90Seconds },
          tma: { p50: dept.goalTmaP50Seconds, p75: dept.goalTmaP75Seconds, p90: dept.goalTmaP90Seconds },
          tmr: { p50: dept.goalTmrP50Seconds, p75: dept.goalTmrP75Seconds, p90: dept.goalTmrP90Seconds },
        };

        // Por definição, 10% dos atendimentos ficam acima do P90 real. Aqui medimos
        // quantos % ficam acima da META de P90 — se o setor cumprisse a meta à risca,
        // esse número seria ~10%; bem acima disso evidencia o desvio de meta.
        const pctAboveGoalP90 = (values: number[], goalP90: number) =>
          values.length === 0 ? null : (values.filter((v) => v > goalP90).length / values.length) * 100;

        return {
          departmentId: dept.departmentId,
          name: dept.name,
          tme,
          tma,
          tmr,
          tmeP90: buildP90Entries(records, tmeOf, tme.p90),
          tmaP90: buildP90Entries(records, tmaOf, tma.p90),
          tmrP90: buildP90Entries(records, tmrOf, tmr.p90),
          goals,
          pctAboveGoalP90: {
            tme: pctAboveGoalP90(records.map(tmeOf), goals.tme.p90),
            tma: pctAboveGoalP90(records.map(tmaOf), goals.tma.p90),
            tmr: pctAboveGoalP90(records.map(tmrOf), goals.tmr.p90),
          },
        };
      })
    );

    // Lista de atendentes pra montar o filtro "Atendente" da UI — reflete quem
    // de fato atendeu no período/setores buscados, ignorando o filtro pessoal
    // de atendente já aplicado (senão o usuário nunca conseguiria voltar a
    // ver/adicionar atendentes que já tirou da seleção).
    const attendantSourceByDept = personalAttendantIds
      ? await Promise.all(
          departments.map(async (dept) => {
            const deptOnlyAttendantId =
              dept.attendantIds.length === 0 ? undefined : dept.attendantIds.length === 1 ? dept.attendantIds[0] : dept.attendantIds;
            const raw = await fetchAttendances(settings.chatbotUrl!, settings.bearerToken!, {
              dateFrom: period.mondayDate,
              dateTo: period.saturdayDate,
              departmentId: dept.departmentId,
              attendantId: deptOnlyAttendantId,
              getCurrent: settings.getCurrent,
              useBusinessHours: settings.useBusinessHours,
            });
            return recordsForDepartment(cleanRecordsForWindow(raw, period), dept);
          })
        )
      : recordsByDept;
    const periodAttendants = buildPeriodAttendants(departments.map((dept, i) => ({ deptName: dept.name, records: attendantSourceByDept[i] })));

    return NextResponse.json({
      period: { label: period.label, mondayDate: period.mondayDate, saturdayDate: period.saturdayDate },
      chatbotId: extractChatbotId(settings.chatbotUrl),
      departments: results,
      periodAttendants,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
