import { NextRequest, NextResponse } from "next/server";
import { addDays, weekStartOf } from "@/lib/ticketReport";
import { generateResolved, loadResolvedContext } from "@/lib/resolvedReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// agendamento próprio (vercel.json): tem os seus 300s, separado dos relatórios semanais
export const maxDuration = 300;

// A semana anterior só tem trabalho de verdade na segunda (fecha a semana); guarda tempo pra atual.
const PREV_WEEK_BUDGET_MS = 110_000;
const TOTAL_BUDGET_MS = 270_000;

/**
 * Tickets resolvidos na semana (/resolvidos), uma vez por dia:
 * 1. semana anterior: resume o que faltou e refaz a visão geral se a semana fechou desde a última geração;
 * 2. semana atual (parcial): resume os tickets resolvidos desde a última execução e atualiza a visão geral.
 * Gera Todos, KA e cada grupo. O que não mudou é reaproveitado sem nova consulta à IA.
 * Fica sob /api/ticket-reports/cron, que o middleware libera do login; a proteção é o CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  const startedAt = Date.now();
  const curWeek = weekStartOf(new Date());
  const prevWeek = addDays(curWeek, -7);
  const result: Record<string, unknown> = {};
  let failed = false;
  try {
    const ctx = await loadResolvedContext();
    for (const [week, deadline] of [
      [prevWeek, startedAt + PREV_WEEK_BUDGET_MS],
      [curWeek, startedAt + TOTAL_BUDGET_MS],
    ] as const) {
      try {
        const r = (await generateResolved([week], { segments: "every", deadline }, ctx))[week];
        result[week] = { resolved: r.rows.length, ...r.generation };
        if (r.generation?.errors.length) failed = true;
      } catch (err: any) {
        failed = true;
        console.error(`Falha nos resolvidos da semana ${week}:`, err);
        result[week] = { error: err.message };
      }
    }
  } catch (err: any) {
    console.error("Falha ao buscar tickets para os resolvidos:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
  return NextResponse.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 });
}
