import { NextRequest, NextResponse } from "next/server";
import { getTicketReport } from "@/lib/db";
import { REPORT_VERSION, generateTicketReport, lastCompleteWeek, type ReportData } from "@/lib/ticketReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// busca no bot (~2s) + Gemini (até 240s) — 300s é o máximo do plano Hobby com Fluid compute
export const maxDuration = 300;

/**
 * Agendado no vercel.json (segunda de manhã): gera o relatório da semana que
 * acabou de terminar. A Vercel manda `Authorization: Bearer <CRON_SECRET>`
 * quando a env var CRON_SECRET existe — sem ela configurada, a rota recusa,
 * pra ninguém disparar o Gemini de fora. Se a semana já tem relatório completo
 * (não parcial) com texto, não gera de novo.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  try {
    const week = lastCompleteWeek();
    const existing = await getTicketReport(week);
    const data = existing?.data as ReportData | null;
    if (existing?.ai && data?.v === REPORT_VERSION && !data.partial) {
      return NextResponse.json({ ok: true, week, skipped: "relatório completo já existe" });
    }
    const r = await generateTicketReport(week);
    return NextResponse.json({ ok: true, week, ai: r.ai != null, aiReused: r.aiReused, aiError: r.aiError });
  } catch (err: any) {
    console.error("Falha ao gerar o relatório semanal de tickets:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
