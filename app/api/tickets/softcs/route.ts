import { NextRequest, NextResponse } from "next/server";
import { BotError, fetchBotExport } from "@/lib/softcsBot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A exportação do SoftCS Bot leva ~6s (conta inteira na SoftCS); folga pra não estourar o limite da function.
export const maxDuration = 60;

/**
 * `?refresh=1` pede ao bot pra puxar da SoftCS o que mudou antes de responder
 * (botão "Atualizar agora"); sem ele, o bot responde direto da cópia que o
 * polling dele mantém atualizada a cada ~2 min.
 *
 * Proxy servidor-a-servidor pra exportação de tickets do SoftCS Bot (ver
 * lib/softcsBot.ts). O bot é quem tem a conexão OAuth com a SoftCS e os nomes
 * (colunas, agentes, clientes) que a API pública não devolve.
 */
export async function GET(req: NextRequest) {
  try {
    const body = await fetchBotExport({ refresh: req.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const status = err instanceof BotError ? err.status : 502;
    return NextResponse.json({ error: err.message }, { status });
  }
}
