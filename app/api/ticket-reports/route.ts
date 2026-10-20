import { NextRequest, NextResponse } from "next/server";
import { getTicketReport, listTicketReports } from "@/lib/db";
import { REPORT_VERSION, generateTicketReport, isWeekStart, lastCompleteWeek, weekStartOf, type ReportData } from "@/lib/ticketReport";
import { BotError } from "@/lib/softcsBot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// busca no bot (~2s) + Gemini (até 240s) — 300s é o máximo do plano Hobby com Fluid compute
export const maxDuration = 300;

// Um relatório com texto de IA gerado há menos disso é devolvido como está, sem chamar a IA de novo.
const REUSE_WINDOW_MS = 15 * 60 * 1000;

/** GET: lista as semanas com relatório; com ?week=YYYY-MM-DD, devolve o relatório salvo daquela semana (nunca chama a IA). */
export async function GET(req: NextRequest) {
  try {
    const week = req.nextUrl.searchParams.get("week");
    if (!week) return NextResponse.json({ reports: await listTicketReports(), lastCompleteWeek: lastCompleteWeek(), currentWeek: weekStartOf(new Date()) });
    if (!isWeekStart(week)) return NextResponse.json({ error: "Semana inválida: use a data da segunda-feira (AAAA-MM-DD)." }, { status: 400 });
    const report = await getTicketReport(week);
    if (!report) return NextResponse.json({ error: "Relatório ainda não gerado para esta semana." }, { status: 404 });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST { week? }: gera (ou gera de novo) o relatório da semana; sem week, a última semana
 * completa. A semana atual sai parcial (até agora). Pra poupar a IA: se o relatório da semana
 * já tem texto e foi gerado há menos de 15 min, devolve o salvo; e mesmo depois disso, se os
 * tickets da semana não mudaram, os números são recalculados mas o texto salvo é reaproveitado.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const week = typeof body?.week === "string" && body.week ? body.week : lastCompleteWeek();
    if (!isWeekStart(week)) return NextResponse.json({ error: "Semana inválida: use a data da segunda-feira (AAAA-MM-DD)." }, { status: 400 });
    // A semana atual pode ser gerada (parcial, até agora); semanas futuras, não.
    if (week > weekStartOf(new Date()))
      return NextResponse.json({ error: "Não dá para gerar o relatório de uma semana que ainda não começou." }, { status: 400 });

    const existing = await getTicketReport(week);
    const ageMs = existing ? Date.now() - +new Date(existing.generatedAt) : Infinity;
    if (existing?.ai && (existing.data as ReportData | null)?.v === REPORT_VERSION && ageMs < REUSE_WINDOW_MS) {
      const min = Math.ceil((REUSE_WINDOW_MS - ageMs) / 60000);
      return NextResponse.json({
        ...existing,
        aiReused: true,
        notice: `Este relatório foi gerado há menos de 15 minutos e foi mantido como está, sem nova consulta à IA. Dá para gerar de novo em ${min} min.`,
      });
    }

    return NextResponse.json(await generateTicketReport(week));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err instanceof BotError ? err.status : 500 });
  }
}
