import type { ApiExport } from "./tickets";

/** Erro da busca no SoftCS Bot, já com a mensagem pronta pra exibir e o status HTTP pra devolver. */
export class BotError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Busca a exportação de tickets do SoftCS Bot (GET {SOFTCS_BOT_URL}/api/export-tickets),
 * servidor-a-servidor. A chave fica só na env var SOFTCS_BOT_EXPORT_KEY — nunca vai pro
 * navegador. `refresh` pede ao bot pra puxar da SoftCS o que mudou antes de responder;
 * sem ele, o bot responde direto da cópia que o polling dele mantém (~2 min).
 * Usada pela rota do Painel de tickets e pela geração do Relatório de tickets.
 */
export async function fetchBotExport({ refresh = false } = {}): Promise<ApiExport> {
  const baseUrl = process.env.SOFTCS_BOT_URL?.replace(/\/+$/, "");
  const key = process.env.SOFTCS_BOT_EXPORT_KEY;
  if (!baseUrl || !key) {
    throw new BotError("Integração com o SoftCS Bot não configurada: defina SOFTCS_BOT_URL e SOFTCS_BOT_EXPORT_KEY.", 500);
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/export-tickets${refresh ? "?refresh=1" : ""}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
  } catch (err: any) {
    throw new BotError(`SoftCS Bot inacessível: ${err.message}`, 502);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.error ?? `HTTP ${res.status}`;
    const msg =
      res.status === 401
        ? "O SoftCS Bot recusou a chave: confira se SOFTCS_BOT_EXPORT_KEY é igual ao EXPORT_API_KEY do bot."
        : `Falha ao buscar tickets no SoftCS Bot: ${detail}`;
    throw new BotError(msg, res.status === 429 ? 429 : 502);
  }
  return body as ApiExport;
}
