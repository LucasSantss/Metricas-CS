import { NextRequest, NextResponse } from "next/server";
import { BotError } from "@/lib/softcsBot";
import { isWeekStart, weekStartOf } from "@/lib/ticketReport";
import { generateResolved, getResolvedWeek } from "@/lib/resolvedReport";
import { segmentOptions } from "@/lib/resolved";
import { errorJson } from "@/lib/security";
import { limitAiGeneration } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// busca no bot (~2-6s) + resumos e visão geral no Gemini — 300s é o máximo do Hobby com Fluid compute
export const maxDuration = 300;

// folga pra gravar e responder antes do limite da função
const BUDGET_MS = 270_000;

function weekOf(v: unknown): string | NextResponse {
  const week = typeof v === "string" && v ? v : weekStartOf(new Date());
  if (!isWeekStart(week)) return NextResponse.json({ error: "Semana inválida: use a data da segunda-feira (AAAA-MM-DD)." }, { status: 400 });
  if (week > weekStartOf(new Date())) return NextResponse.json({ error: "Essa semana ainda não começou." }, { status: 400 });
  return week;
}

const fail = (err: any) => errorJson(err, err instanceof BotError ? err.status : 500);

/** GET ?week=YYYY-MM-DD (padrão: semana atual): tickets resolvidos na semana, ao vivo, com os textos da IA já salvos. Nunca chama a IA. */
export async function GET(req: NextRequest) {
  try {
    const week = weekOf(req.nextUrl.searchParams.get("week"));
    if (week instanceof NextResponse) return week;
    return NextResponse.json(await getResolvedWeek(week), { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return fail(err);
  }
}

/**
 * POST { week?, segment? }: resume os tickets do recorte que ainda não têm resumo (ou que
 * mudaram) e gera a visão geral do recorte. O que não mudou é reaproveitado, sem nova consulta à IA.
 */
export async function POST(req: NextRequest) {
  const deadline = Date.now() + BUDGET_MS;
  try {
    const body = await req.json().catch(() => ({}));
    const week = weekOf(body?.week);
    if (week instanceof NextResponse) return week;
    const segment = typeof body?.segment === "string" && body.segment ? body.segment : "all";
    if (segment !== "all" && segment !== "ka" && !/^g:[\w-]+$/.test(segment))
      return NextResponse.json({ error: "Recorte inválido." }, { status: 400 });
    const limited = await limitAiGeneration();
    if (limited) return limited;
    const out = await generateResolved([week], { segments: [segment], deadline });
    const r = out[week];
    if (segment.startsWith("g:") && !segmentOptions(r.rows).includes(segment))
      return NextResponse.json({ ...r, generation: { ...r.generation!, overview: "sem tickets" } });
    return NextResponse.json(r);
  } catch (err: any) {
    return fail(err);
  }
}
