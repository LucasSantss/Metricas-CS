import { NextRequest, NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { extractChatbotId, fetchAttendants, fetchContacts, fetchDepartments } from "@/lib/suri";
import { startOfTodayBrasilia, toConversationDto } from "@/lib/conversations";
import type { ConversationContactDto } from "@/lib/types";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Tela temporária /conversas:
// - Esperando (agent.status 1) e Atendimentos (2): só dos setores salvos e ativos nos Ajustes.
//   ?departmentIds=a,b restringe a alguns deles; sem o parâmetro, vêm todos os setores salvos.
//   A API não filtra por status nem aceita vários setores numa chamada: um fetch por setor, em paralelo.
// - Automático (0): sem filtro de setor, todos os contatos que entraram hoje (horário de Brasília).
//   A lista sem filtro vem do contato criado mais recentemente pro mais antigo, então pagina até
//   passar da meia-noite. A busca por contatos de outros dias fica em /api/conversations/search.
export async function GET(req: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const settings = await getSettings();
    if (!settings.chatbotUrl || !settings.bearerToken) {
      return NextResponse.json({ error: "Configure a URL do chatbot e o token primeiro." }, { status: 400 });
    }
    const saved = (await listDepartments()).filter((d) => d.active);
    const requested = req.nextUrl.searchParams.get("departmentIds")?.split(",").filter(Boolean);
    const depts = requested ? saved.filter((d) => requested.includes(d.departmentId)) : saved;
    const todayStart = startOfTodayBrasilia();

    const [perDept, automatic, attendants, suriDepartments] = await Promise.all([
      Promise.all(
        depts.map((d) =>
          fetchContacts(settings.chatbotUrl!, settings.bearerToken!, { departmentId: d.departmentId, maxPages: 25 }).then((r) => ({ dept: d, ...r }))
        )
      ),
      fetchContacts(settings.chatbotUrl, settings.bearerToken, { pageSize: 500, maxPages: 20, createdSince: todayStart }),
      fetchAttendants(settings.chatbotUrl, settings.bearerToken).catch(() => []),
      // Automático traz setores que não estão salvos: nomes vêm da Suri
      fetchDepartments(settings.chatbotUrl, settings.bearerToken).catch(() => []),
    ]);
    const names = {
      attendants: new Map(attendants.map((a) => [a.id, a.name])),
      departments: new Map([...suriDepartments.map((d) => [d.id, d.name] as const), ...saved.map((d) => [d.departmentId, d.name] as const)]),
    };

    const byId = new Map<string, ConversationContactDto>();
    for (const { dept, contacts } of perDept) {
      for (const c of contacts) {
        if ((c.agent?.status === 1 || c.agent?.status === 2) && !byId.has(c.id)) byId.set(c.id, toConversationDto(c, names, dept.departmentId));
      }
    }
    let automaticToday = 0;
    for (const c of automatic.contacts) {
      if ((c.agent?.status ?? 0) !== 0 || c.dateCreate < todayStart || byId.has(c.id)) continue;
      byId.set(c.id, toConversationDto(c, names));
      automaticToday++;
    }

    return NextResponse.json({
      contacts: [...byId.values()],
      truncated: perDept.some((p) => p.truncated),
      // dia com mais contatos novos do que as 20 páginas cobrem
      automaticTruncated: automatic.truncated,
      automaticToday,
      chatbotId: extractChatbotId(settings.chatbotUrl),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
