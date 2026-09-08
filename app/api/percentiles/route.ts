import { NextRequest, NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { fetchAttendances, extractChatbotId } from "@/lib/suri";
import { monthRange, weekRangeForMonday } from "@/lib/weeks";
import { cleanRecordsForWindow, recordsForDepartment } from "@/lib/metrics";
import { computePercentileStats, buildP90Entries } from "@/lib/percentiles";

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

    const results = await Promise.all(
      departments.map(async (dept) => {
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

        const tmeOf = (r: (typeof records)[number]) => (r.waitingTime ?? 0) * 60;
        const tmaOf = (r: (typeof records)[number]) => (r.attendanceTime ?? 0) * 60;
        const tmrOf = (r: (typeof records)[number]) => (r.avgResponseTime ?? 0) * 60;

        const tme = computePercentileStats(records.map(tmeOf));
        const tma = computePercentileStats(records.map(tmaOf));
        const tmr = computePercentileStats(records.map(tmrOf));

        return {
          departmentId: dept.departmentId,
          name: dept.name,
          tme,
          tma,
          tmr,
          tmeP90: buildP90Entries(records, tmeOf, tme.p90),
          tmaP90: buildP90Entries(records, tmaOf, tma.p90),
          tmrP90: buildP90Entries(records, tmrOf, tmr.p90),
        };
      })
    );

    return NextResponse.json({
      period: { label: period.label, mondayDate: period.mondayDate, saturdayDate: period.saturdayDate },
      chatbotId: extractChatbotId(settings.chatbotUrl),
      departments: results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
