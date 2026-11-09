import { NextRequest, NextResponse } from "next/server";
import { getTicketReport, type ReportSegment } from "./db";
import { REPORT_VERSION, generateTicketReport, lastCompleteWeek, weekStartOf, type ReportData } from "./ticketReport";

// A função tem 300s no total. A semana anterior (só tem IA de verdade na segunda) não pode
// gastar tudo: guarda tempo pra semana atual, e os dois limites deixam folga pra gravar.
const PREV_WEEK_BUDGET_MS = 140_000;
const TOTAL_BUDGET_MS = 270_000;

/**
 * Agendado no vercel.json uma vez por dia, por recorte (base inteira e KA):
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
export async function runTicketReportCron(req: NextRequest, segment: ReportSegment) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const startedAt = Date.now();
  const result: Record<string, unknown> = {};
  let failed = false;

  // 1. semana anterior completa
  const prevWeek = lastCompleteWeek();
  try {
    const existing = await getTicketReport(prevWeek, segment);
    const data = existing?.data as ReportData | null;
    if (existing?.ai && data?.v === REPORT_VERSION && !data.partial) {
      result[prevWeek] = { skipped: "relatório completo já existe" };
    } else {
      const r = await generateTicketReport(prevWeek, { segment, deadline: startedAt + PREV_WEEK_BUDGET_MS });
      result[prevWeek] = { ai: r.ai != null, aiReused: r.aiReused, aiError: r.aiError };
    }
  } catch (err: any) {
    failed = true;
    console.error(`Falha ao fechar o relatório (${segment}) da semana ${prevWeek}:`, err);
    result[prevWeek] = { error: err.message };
  }

  // 2. semana atual (parcial até agora) — roda mesmo se a anterior falhou
  const curWeek = weekStartOf(new Date());
  try {
    const r = await generateTicketReport(curWeek, { segment, deadline: startedAt + TOTAL_BUDGET_MS });
    result[curWeek] = { partial: true, ai: r.ai != null, aiReused: r.aiReused, aiError: r.aiError };
  } catch (err: any) {
    failed = true;
    console.error(`Falha ao atualizar o relatório (${segment}) da semana ${curWeek}:`, err);
    result[curWeek] = { error: err.message };
  }

  return NextResponse.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 });
}
