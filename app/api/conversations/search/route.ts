import { NextRequest, NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { fetchAttendants, fetchChannels, fetchContact, fetchContacts, fetchDepartments, type SuriContact } from "@/lib/suri";
import { toConversationDto } from "@/lib/conversations";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCAN_PAGES = 40; // 40 × 500 = 20 mil contatos mais recentes (~10 s)
const MAX_RESULTS = 100;

/** Variações do número digitado: com/sem 55 e com/sem o 9 do celular. */
function phoneVariants(digits: string): string[] {
  const out = new Set<string>();
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length < 10) return [];
  out.add(`55${local}`);
  if (local.length === 11 && local[2] === "9") out.add(`55${local.slice(0, 2)}${local.slice(3)}`);
  if (local.length === 10) out.add(`55${local.slice(0, 2)}9${local.slice(2)}`);
  return [...out];
}

// Busca da aba Automático na base inteira (sem filtro de setor nem de data):
// ?q= nome, telefone, e-mail ou identificação (CNPJ/CPF).
// A API da Suri não tem busca, então:
// - telefone completo (10+ dígitos): consulta direta "{canal}:{número}" em cada canal — acha em qualquer data;
// - qualquer texto: varre os contatos mais recentes (SCAN_PAGES páginas) comparando os campos.
export async function GET(req: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const settings = await getSettings();
    if (!settings.chatbotUrl || !settings.bearerToken) {
      return NextResponse.json({ error: "Configure a URL do chatbot e o token primeiro." }, { status: 400 });
    }
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 3) return NextResponse.json({ error: "Digite pelo menos 3 caracteres." }, { status: 400 });
    const digits = q.replace(/\D/g, "");
    const onlyDigits = digits.length > 0 && /^[\d\s()+\-.]+$/.test(q);
    const url = settings.chatbotUrl;
    const token = settings.bearerToken;

    const matches = (c: SuriContact) =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.identificationDocument ?? "").toLowerCase().replace(/[.\-/\s]/g, "").includes(q.replace(/[.\-/\s]/g, "")) ||
      (digits.length >= 4 && onlyDigits && (c.phone ?? "").includes(digits));

    const found = new Map<string, SuriContact>();
    let scannedUntil: string | null = null;

    const byPhone = async () => {
      const variants = onlyDigits ? phoneVariants(digits) : [];
      if (!variants.length) return;
      const channels = await fetchChannels(url, token);
      const ids = channels.flatMap((ch) => variants.map((v) => `${ch.id}:${v}`));
      const hits = await Promise.all(ids.map((id) => fetchContact(url, token, id).catch(() => null)));
      hits.forEach((c) => c && found.set(c.id, c));
    };
    const byScan = () =>
      fetchContacts(url, token, {
        pageSize: 500,
        maxPages: SCAN_PAGES,
        onPage: (items) => {
          for (const c of items) if (matches(c)) found.set(c.id, c);
          if (items.length) scannedUntil = items[items.length - 1].dateCreate;
        },
      });

    const namesP = Promise.all([fetchAttendants(url, token).catch(() => []), fetchDepartments(url, token).catch(() => []), listDepartments()]);
    // telefone completo achado direto no canal: não precisa varrer a base
    await byPhone();
    const scan = found.size ? { truncated: false } : await byScan();
    const [attendants, suriDepartments, saved] = await namesP;
    const names = {
      attendants: new Map(attendants.map((a) => [a.id, a.name])),
      departments: new Map([...suriDepartments.map((d) => [d.id, d.name] as const), ...saved.map((d) => [d.departmentId, d.name] as const)]),
    };

    const contacts = [...found.values()]
      .map((c) => toConversationDto(c, names))
      .sort((a, b) => (b.lastActivity ?? b.dateCreate ?? "").localeCompare(a.lastActivity ?? a.dateCreate ?? ""));

    return NextResponse.json({
      contacts: contacts.slice(0, MAX_RESULTS),
      total: contacts.length,
      // até onde a varredura por nome chegou (data de criação do contato mais antigo visto)
      scannedUntil: scan.truncated ? scannedUntil : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
