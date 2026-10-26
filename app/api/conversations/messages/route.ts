import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { fetchContactMessages, type SuriMessage } from "@/lib/suri";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
const STEP_DAYS = 7;
const FIRST_LIMIT = 300;
const MAX_LIMIT = 4000;

// Proxy para GET {CHATBOT-URL}/api/contacts/{userId}/messages — histórico da conversa
// exibido na tela temporária /conversas, recortado por período:
//   ?userId=  contato (ex.: "wp123:5511999999999")
//   ?days=    janela em dias a partir de agora (mínimo e passo de 7)
//   ?after=   quantas mensagens a tela já tem: a janela cresce de 7 em 7 dias até trazer
//             mais que isso (ao rolar pro topo sempre aparece algo novo, e na primeira
//             carga uma conversa parada há semanas não abre vazia)
// A API da Suri não filtra por data e só aceita `limit`, então o limit vai dobrando até
// cobrir a janela pedida.
export async function GET(req: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const settings = await getSettings();
    if (!settings.chatbotUrl || !settings.bearerToken) {
      return NextResponse.json({ error: "Configure a URL do chatbot e o token primeiro." }, { status: 400 });
    }
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "userId é obrigatório" }, { status: 400 });
    let days = Math.max(STEP_DAYS, Math.ceil((Number(req.nextUrl.searchParams.get("days")) || STEP_DAYS) / STEP_DAYS) * STEP_DAYS);
    const after = Math.max(0, Number(req.nextUrl.searchParams.get("after")) || 0);

    let limit = FIRST_LIMIT;
    let all: SuriMessage[] = [];
    let complete = false;
    const load = async () => {
      const raw = await fetchContactMessages(settings.chatbotUrl!, settings.bearerToken!, userId, limit);
      // Quando o limit passa do total da conversa, a API recomeça a lista e repete as mesmas
      // mensagens até completar o limit — por isso o corte por id. Se houve repetição, a conversa veio inteira.
      const seen = new Set<string>();
      all = raw.filter((m) => !seen.has(m.id) && seen.add(m.id));
      complete = all.length < limit || limit >= MAX_LIMIT;
    };
    await load();

    const now = Date.now();
    const time = (m: SuriMessage) => new Date(m.createdDate).getTime();
    for (;;) {
      const cutoff = now - days * DAY_MS;
      const oldest = all.reduce((min, m) => Math.min(min, time(m)), Infinity);
      if (!complete && oldest >= cutoff) {
        limit = Math.min(limit * 2, MAX_LIMIT);
        await load();
        continue;
      }
      const inWindow = all.filter((m) => time(m) >= cutoff);
      const older = all.filter((m) => time(m) < cutoff);
      const hasMore = older.length > 0 || !complete;
      if (inWindow.length > after || !hasMore) {
        return NextResponse.json({ messages: inWindow, days, hasMore });
      }
      // janela sem nada novo: pula direto pra semana da mensagem mais recente fora dela
      const newestOlder = older.reduce((max, m) => Math.max(max, time(m)), -Infinity);
      days = Number.isFinite(newestOlder)
        ? Math.ceil((now - newestOlder) / DAY_MS / STEP_DAYS) * STEP_DAYS
        : days + STEP_DAYS;
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
