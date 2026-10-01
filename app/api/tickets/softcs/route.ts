import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A exportação do SoftCS Bot leva ~6s (conta inteira na SoftCS); folga pra não estourar o limite da function.
export const maxDuration = 60;

/**
 * `?refresh=1` pede ao bot pra puxar da SoftCS o que mudou antes de responder
 * (botão "Atualizar agora"); sem ele, o bot responde direto da cópia que o
 * polling dele mantém atualizada a cada ~2 min.
 *
 * Proxy servidor-a-servidor pra exportação de tickets do SoftCS Bot
 * (GET {SOFTCS_BOT_URL}/api/export-tickets). A chave fica só na env var
 * SOFTCS_BOT_EXPORT_KEY — nunca vai pro navegador. O bot é quem tem a
 * conexão OAuth com a SoftCS e os nomes (colunas, agentes, clientes) que a
 * API pública não devolve.
 */
export async function GET(req: NextRequest) {
  const baseUrl = process.env.SOFTCS_BOT_URL?.replace(/\/+$/, "");
  const key = process.env.SOFTCS_BOT_EXPORT_KEY;
  if (!baseUrl || !key) {
    return NextResponse.json(
      { error: "Integração com o SoftCS Bot não configurada: defina SOFTCS_BOT_URL e SOFTCS_BOT_EXPORT_KEY." },
      { status: 500 }
    );
  }

  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const res = await fetch(`${baseUrl}/api/export-tickets${refresh ? "?refresh=1" : ""}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.error ?? `HTTP ${res.status}`;
      const msg =
        res.status === 401
          ? "O SoftCS Bot recusou a chave: confira se SOFTCS_BOT_EXPORT_KEY é igual ao EXPORT_API_KEY do bot."
          : `Falha ao buscar tickets no SoftCS Bot: ${detail}`;
      return NextResponse.json({ error: msg }, { status: res.status === 429 ? 429 : 502 });
    }
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ error: `SoftCS Bot inacessível: ${err.message}` }, { status: 502 });
  }
}
