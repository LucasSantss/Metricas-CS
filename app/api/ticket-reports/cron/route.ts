import { NextRequest, NextResponse } from "next/server";
import { getTicketReport } from "@/lib/db";
import { REPORT_VERSION, generateTicketReport, lastCompleteWeek, weekStartOf, type ReportData } from "@/lib/ticketReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// até 2 relatórios (semana anterior + atual), cada um com busca no bot + Gemini — 300s é o máximo do Hobby com Fluid compute
export const maxDuration = 300;

/**
 * Agendado no vercel.json todo dia às 12:00 UTC (09:00 de Brasília):
 * 1. fecha a semana anterior, se ela ainda não tem relatório completo com texto
 *    (na prática, só na segunda — nos outros dias isso é pulado);
 * 2. atualiza o relatório da semana atual, parcial até a hora da execução.
 * Se os tickets da semana não mudaram desde a última geração, o texto da IA é
 * reaproveitado sem nova consulta (ver generateTicketReport).
 *
 * A Vercel manda `Authorization: Bearer <CRON_SECRET>` quando a env var
 * CRON_SECRET existe — sem ela configurada, a rota recusa, pra ninguém
 * disparar o Gemini de fora.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const result: Record<string, unknown> = {};
  let failed = false;

  // 1. semana anterior completa
  const prevWeek = lastCompleteWeek();
  try {
    const existing = await getTicketReport(prevWeek);
    const data = existing?.data as ReportData | null;
    if (existing?.ai && data?.v === REPORT_VERSION && !data.partial) {
      result[prevWeek] = { skipped: "relatório completo já existe" };
    } else {
      const r = await generateTicketReport(prevWeek);
      result[prevWeek] = { ai: r.ai != null, aiReused: r.aiReused, aiError: r.aiError };
    }
  } catch (err: any) {
    failed = true;
    console.error(`Falha ao fechar o relatório da semana ${prevWeek}:`, err);
    result[prevWeek] = { error: err.message };
  }

  // 2. semana atual (parcial até agora) — roda mesmo se a anterior falhou
  const curWeek = weekStartOf(new Date());
  try {
    const r = await generateTicketReport(curWeek);
    result[curWeek] = { partial: true, ai: r.ai != null, aiReused: r.aiReused, aiError: r.aiError };
  } catch (err: any) {
    failed = true;
    console.error(`Falha ao atualizar o relatório da semana ${curWeek}:`, err);
    result[curWeek] = { error: err.message };
  }

  return NextResponse.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 });
}
