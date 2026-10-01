/**
 * Painel de tickets — leitura dos tickets (do .xlsx exportado da ferramenta
 * de tickets, ou ao vivo pela exportação do SoftCS Bot — ver
 * parseTicketsApi) e cálculo de volume, resolução, SLA e tempo sem
 * atualização. O cálculo roda no navegador; o .xlsx nunca sai dele.
 */

export type Pri = "P0" | "P1" | "P2" | "P3" | "—";

export type Week = { key: string; w: number; mon: Date; sat: Date };

export type Ticket = {
  id: string;
  titulo: string;
  desc: string;
  etapa: string;
  /** N1–N4: nível de atendimento. Não interfere na meta de SLA. */
  nivel: string;
  /** P0–P3: prioridade. É ela que define a meta de SLA (ver SlaMetas, editáveis em Ajustes > Tickets). */
  pri: Pri;
  status: string;
  agente: string;
  cliente: string;
  sla: string;
  cp: string;
  c: Date;
  u: Date;
  mc: string;
  mu: string;
  dc: string;
  du: string;
  wc: Week;
  wu: Week;
  search: string;
  /** "Atualizado em" no mesmo minuto que BULK_MIN+ tickets: atualização em lote. */
  bulk: boolean;
};

export type Derived = {
  t: Ticket;
  res: boolean;
  rt: number | null;
  meta: number | null;
  useSla: boolean;
  inSla: boolean | null;
  idle: number;
  late: boolean;
  /**
   * De onde veio a situação de SLA de um ticket em aberto:
   * "export" = coluna SLA da planilha ("SLA estourado" / "X restantes");
   * "meta" = a planilha não trouxe o SLA, então foi calculado pela meta da prioridade;
   * null = resolvido, ou sem prioridade (sem meta).
   */
  slaSrc: "export" | "meta" | null;
};

export type Period = "day" | "week" | "month";

export type TicketFilters = {
  base: "c" | "u";
  year: number;
  month: number;
  period: Period;
  week: string;
  day: string;
  pri: Set<Pri>;
  status: "" | "res" | "open";
  etapa: string;
  nivel: Set<string>;
  agente: string;
  cliente: string;
  q: string;
  bulk: boolean;
};

export const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MES_LONGO = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const PRI: Record<Pri, { l: string; c: string }> = {
  P0: { l: "Crítica", c: "var(--tk-p0)" },
  P1: { l: "Alta", c: "var(--tk-p1)" },
  P2: { l: "Média", c: "var(--tk-p2)" },
  P3: { l: "Baixa", c: "var(--tk-p3)" },
  "—": { l: "Sem prioridade", c: "var(--tk-pnone)" },
};
export const PRI_KEYS: Pri[] = ["P0", "P1", "P2", "P3", "—"];
export const priLabel = (p: Pri) => (p === "—" ? "Sem prioridade" : `${p} - ${PRI[p].l}`);
export const SEM_NIVEL = "Sem nível";

export const BUCKETS: [number, string][] = [
  [24, "até 1 dia"],
  [72, "1 a 3 dias"],
  [168, "3 a 7 dias"],
  [360, "7 a 15 dias"],
  [720, "15 a 30 dias"],
  [Infinity, "mais de 30 dias"],
];
export const PAGE_SIZE = 50;
export const TICKET_URL = "https://admin.softcs.com.br/pt-br/tickets/";

/** Metas de SLA de resolução por prioridade, em horas. Vêm de Ajustes > Tickets (salvo no banco). */
export type SlaMetas = { P0: number; P1: number; P2: number; P3: number };
export const DEFAULT_META: SlaMetas = { P0: 12, P1: 24, P2: 48, P3: 168 };
export const metaOf = (p: Pri, metas: SlaMetas): number | null => (p === "—" ? null : metas[p]);
/** "meta 12h" / "meta 7d" / "sem meta" — meta de SLA da prioridade. */
export const metaLabel = (p: Pri, metas: SlaMetas) => {
  const m = metaOf(p, metas);
  return m != null ? `meta ${fmtHours(m)}` : "sem meta";
};
// mesmo minuto de atualização em 15+ tickets = atualização em lote. Agrupa por minuto
// (e não pelo instante exato) porque a planilha não tem segundos e a API tem: uma
// operação em massa leva alguns segundos (ex.: 53 tickets entre 21:00:53 e 21:00:56),
// então pelo instante exato a API deixaria de detectar o lote que a planilha detecta.
const BULK_MIN = 15;
const minuteOf = (d: Date) => Math.floor(+d / 6e4);

export type SortKey = "id" | "titulo" | "cliente" | "pri" | "nivel" | "etapa" | "status" | "agente" | "c" | "u" | "idle" | "rt";
export type Sort = { k: SortKey; dir: 1 | -1 };

export type KpiKey = "all" | "res" | "inat" | "sla" | "prazo" | "ok" | "fora" | "open" | "late" | "idle";
// Recortes dos indicadores: o que cada clique mostra na lista de tickets
export const KPI_FILTERS: Record<KpiKey, { label: string; test: (x: Derived) => boolean; sort: Sort }> = {
  all: { label: "Todos os tickets do período", test: () => true, sort: { k: "c", dir: -1 } },
  res: { label: "Resolvidos", test: (x) => x.res, sort: { k: "u", dir: -1 } },
  inat: { label: "Resolvidos por inatividade", test: (x) => x.res && isInat(x.t), sort: { k: "u", dir: -1 } },
  sla: { label: "Base do SLA médio (resolvidos considerados)", test: (x) => x.res && x.useSla, sort: { k: "rt", dir: -1 } },
  prazo: { label: 'Base do "no prazo" (resolvidos com meta)', test: (x) => x.inSla !== null, sort: { k: "rt", dir: -1 } },
  ok: { label: "Resolvidos dentro da meta", test: (x) => x.inSla === true, sort: { k: "rt", dir: -1 } },
  fora: { label: "Resolvidos fora da meta", test: (x) => x.inSla === false, sort: { k: "rt", dir: -1 } },
  open: { label: "Em aberto", test: (x) => !x.res, sort: { k: "idle", dir: -1 } },
  late: { label: "Em aberto com SLA estourado", test: (x) => !x.res && x.late, sort: { k: "idle", dir: -1 } },
  idle: { label: "Em aberto, do mais antigo sem atualização", test: (x) => !x.res, sort: { k: "idle", dir: -1 } },
};

/* ---------- utilidades ---------- */
export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
export const pad = (n: number) => String(n).padStart(2, "0");
export const fmtDate = (d: Date | null) =>
  d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "—";
const fmtDay = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
export const mkey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const mlabel = (k: string, long?: boolean) => {
  const [y, m] = k.split("-");
  return long ? `${MES_LONGO[+m - 1]} ${y}` : `${MES[+m - 1]}/${y.slice(2)}`;
};
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");
export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const max = (a: number[]) => (a.length ? Math.max(...a) : null);
export const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDMY = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

/** Duração em horas -> "35 min" / "5h 20min" / "3d 4h". */
export function fmtHours(h: number | null): string {
  if (h == null || !isFinite(h)) return "—";
  if (h < 0) h = 0;
  if (h < 1) return Math.round(h * 60) + " min";
  if (h < 24) {
    let H = Math.floor(h);
    let M = Math.round((h - H) * 60);
    if (M === 60) {
      H++;
      M = 0;
    }
    return M ? `${H}h ${pad(M)}min` : `${H}h`;
  }
  let d = Math.floor(h / 24);
  let r = Math.round(h - d * 24);
  if (r === 24) {
    d++;
    r = 0;
  }
  return r ? `${d}d ${r}h` : `${d}d`;
}

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(+v) ? null : v;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return new Date(d.getTime() + d.getTimezoneOffset() * 6e4);
  }
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(String(v));
  return isNaN(+d) ? null : d;
}

/** Semana seg–sáb com número ISO. */
export function isoWeek(d: Date): Week {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;
  const mon = new Date(t);
  mon.setDate(t.getDate() - day);
  const sat = new Date(mon);
  sat.setDate(mon.getDate() + 5);
  const th = new Date(mon);
  th.setDate(mon.getDate() + 3);
  const y = th.getFullYear();
  const jan4 = new Date(y, 0, 4);
  const w = 1 + Math.round(((+th - +jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return { key: ymd(mon), w, mon, sat };
}
export const weekLabel = (wk: Week) => `Semana ${wk.w} · ${fmtDMY(wk.mon)} a ${fmtDMY(wk.sat)}`;
export const weekShort = (wk: Week) => `Sem ${wk.w} (${fmtDay(wk.mon)} a ${fmtDay(wk.sat)})`;

/* ---------- leitura do arquivo ---------- */
type ColKey = "id" | "titulo" | "desc" | "etapa" | "nivel" | "pri" | "status" | "agente" | "cliente" | "sla" | "c" | "cp" | "u";
const COLS: Record<ColKey, string[]> = {
  id: ["id do ticket", "id"],
  titulo: ["titulo"],
  desc: ["descricao"],
  etapa: ["etapa"],
  nivel: ["nivel"],
  pri: ["prioridade"],
  status: ["status"],
  agente: ["agente responsavel", "agente"],
  cliente: ["cliente(s)", "cliente", "clientes"],
  sla: ["sla"],
  c: ["criado em", "data de criacao"],
  cp: ["criado por"],
  u: ["atualizado em", "ultima atualizacao"],
};
function mapHeaders(headers: string[]) {
  const hn = headers.map(norm);
  const out: Partial<Record<ColKey, string>> = {};
  for (const [k, names] of Object.entries(COLS) as [ColKey, string[]][]) {
    for (const n of names) {
      const i = hn.indexOf(n);
      if (i >= 0) {
        out[k] = headers[i];
        break;
      }
    }
  }
  return out;
}

export type ParsedFile = { tickets: Ticket[]; exportDate: Date | null; bulkNote: string };

/** Lê a primeira aba do .xlsx. Lança Error com mensagem pronta pra exibir. */
export async function parseTicketsFile(file: File): Promise<ParsedFile> {
  if (!/\.xls[xm]?$/i.test(file.name)) throw new Error("Escolha um arquivo .xlsx exportado da ferramenta de tickets.");
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  let rows: Record<string, unknown>[];
  try {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  } catch (e) {
    throw new Error("Não foi possível ler o arquivo: " + (e as Error).message);
  }
  if (!rows.length) throw new Error("A primeira aba da planilha está vazia.");

  const map = mapHeaders(Object.keys(rows[0]));
  const labels: Record<string, string> = { c: '"Criado em"', u: '"Atualizado em"', status: '"Status"' };
  const missing = (["c", "u", "status"] as ColKey[]).filter((k) => !map[k]).map((k) => labels[k]);
  if (missing.length) throw new Error("Coluna não encontrada: " + missing.join(", ") + ". Use a exportação padrão de tickets.");

  const tickets: Ticket[] = [];
  for (const r of rows) {
    const g = (k: ColKey) => (map[k] ? r[map[k]!] : "");
    const s = (k: ColKey) => String(g(k) ?? "").trim();
    const c = parseDate(g("c"));
    if (!c) continue;
    tickets.push(
      makeTicket({
        id: s("id"),
        titulo: s("titulo"),
        desc: s("desc"),
        etapa: s("etapa"),
        nivel: s("nivel"),
        pri: String(g("pri")),
        status: s("status"),
        agente: s("agente"),
        cliente: s("cliente"),
        sla: s("sla"),
        cp: s("cp"),
        c,
        u: parseDate(g("u")) || c,
      })
    );
  }
  if (!tickets.length) throw new Error("Nenhuma linha com data de criação válida foi encontrada.");

  const bulkNote = markBulk(tickets);

  const m = file.name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  const exportDate = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;

  return { tickets, exportDate, bulkNote };
}

type TicketFields = {
  id: string;
  titulo: string;
  desc: string;
  etapa: string;
  nivel: string;
  /** Texto livre com a prioridade ("P1", "P1 - Alta"…); vira "—" se não achar P0–P3. */
  pri: string;
  status: string;
  agente: string;
  cliente: string;
  sla: string;
  cp: string;
  c: Date;
  u: Date;
};

/** Monta um Ticket (com as chaves de mês/semana/dia já calculadas) a partir dos campos crus — compartilhado pelo .xlsx e pela API. */
function makeTicket(x: TicketFields): Ticket {
  const pm = x.pri.match(/P\s*([0-3])/i);
  return {
    id: x.id,
    titulo: x.titulo,
    desc: x.desc,
    etapa: x.etapa || "—",
    nivel: x.nivel || SEM_NIVEL,
    pri: pm ? (("P" + pm[1]) as Pri) : "—",
    status: x.status,
    agente: x.agente || "Sem responsável",
    cliente: x.cliente || "—",
    sla: x.sla,
    cp: x.cp,
    c: x.c,
    u: x.u,
    mc: mkey(x.c),
    mu: mkey(x.u),
    dc: ymd(x.c),
    du: ymd(x.u),
    wc: isoWeek(x.c),
    wu: isoWeek(x.u),
    search: "",
    bulk: false,
  };
}

/** Preenche `search` e marca atualização em lote (mesmo minuto em BULK_MIN+ tickets). Devolve a nota pra exibir. */
function markBulk(tickets: Ticket[]): string {
  const counts = new Map<number, number>();
  for (const t of tickets) {
    t.search = norm([t.id, t.titulo, t.desc, t.cliente].join(" "));
    counts.set(minuteOf(t.u), (counts.get(minuteOf(t.u)) || 0) + 1);
  }
  let bulkN = 0;
  let top: { min: number; n: number } | null = null;
  for (const t of tickets) {
    t.bulk = (counts.get(minuteOf(t.u)) ?? 0) >= BULK_MIN;
    if (t.bulk) bulkN++;
  }
  for (const [min, n] of counts) if (n >= BULK_MIN && (!top || n > top.n)) top = { min, n };
  return bulkN && top
    ? `${bulkN} tickets compartilham o minuto de atualização (o maior: ${top.n} em ${fmtDate(new Date(top.min * 6e4))}), sinal de atualização em lote e não de resolução real.`
    : "Nenhuma atualização em lote detectada nestes tickets.";
}

/* ---------- leitura ao vivo (SoftCS Bot) ---------- */

/** Formato de cada ticket em GET {SOFTCS_BOT_URL}/api/export-tickets (ver api/export-tickets.js no SoftCS Bot). */
export type ApiTicket = {
  id: string;
  publicId: string | null;
  title: string;
  description: string;
  stage: { id: string; name: string; isClosedStage: boolean };
  status: "OPEN" | "CLOSED" | "CANCELLED" | null;
  resolved: boolean;
  priority: string | null;
  escalationTier: string | null;
  slaHours: number | null;
  agent: { id: string; name: string | null } | null;
  createdBy: { id: string; name: string | null } | null;
  client: { id: string; name: string | null } | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
};
export type ApiExport = {
  generatedAt: string;
  /** Quando a cópia do bot foi atualizada da SoftCS pela última vez (polling a cada ~2 min, no expediente). */
  snapshotAt?: string | null;
  count: number;
  missingClientNames: number;
  tickets: ApiTicket[];
};

/** Intervalo da atualização automática do painel — mesmo ritmo do polling do bot. */
export const AUTO_REFRESH_MS = 2 * 60 * 1000;

/**
 * Expediente do suporte (horário de Brasília): seg–sex 9h–18h, sáb 9h–14h —
 * o mesmo em que o polling do SoftCS Bot roda. Fora dele os dados não mudam,
 * então o painel não fica buscando (e não acorda o banco do bot à toa).
 */
export function isBusinessHours(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", hour12: false }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")!.value;
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")!.value, 10) % 24;
  if (weekday === "Sun") return false;
  if (weekday === "Sat") return hour >= 9 && hour < 14;
  return hour >= 9 && hour < 18;
}

/**
 * Converte a exportação do SoftCS Bot pro mesmo Ticket do .xlsx, então todo o
 * cálculo (volume, SLA, resolução, tempo sem atualização) segue igual.
 * - id = publicId: é o que abre o ticket em TICKET_URL.
 * - status "Resolvido" quando o bot diz resolved (coluna de encerramento ou
 *   status fechado na SoftCS) — isRes() reconhece; "Resolvido por
 *   Inatividade" também é pego pelo nome da etapa (isInat).
 * - sla vazio: a API não tem o texto "SLA estourado / X restantes" da
 *   planilha, então derive() usa a meta da prioridade (slaSrc = "meta").
 */
export function parseTicketsApi(data: ApiExport): ParsedFile {
  const tickets: Ticket[] = [];
  for (const t of data.tickets) {
    const c = t.createdAt ? new Date(t.createdAt) : null;
    if (!c || isNaN(+c)) continue;
    const u = t.updatedAt ? new Date(t.updatedAt) : c;
    tickets.push(
      makeTicket({
        id: t.publicId ?? t.id,
        titulo: t.title,
        desc: t.description,
        etapa: t.stage?.name ?? "",
        nivel: t.escalationTier ?? "",
        pri: t.priority ?? "",
        status: t.resolved ? (t.status === "CANCELLED" ? "Cancelado" : "Resolvido") : "Em aberto",
        agente: t.agent?.name ?? "",
        cliente: t.client?.name ?? "",
        sla: "",
        cp: t.createdBy?.name ?? "",
        c,
        u: isNaN(+u) ? c : u,
      })
    );
  }
  if (!tickets.length) throw new Error("A SoftCS não devolveu nenhum ticket com data de criação.");
  return { tickets, exportDate: new Date(data.snapshotAt ?? data.generatedAt), bulkNote: markBulk(tickets) };
}

/* ---------- filtros ---------- */
export const isInat = (t: Ticket) => norm(t.etapa).includes("inatividade");
// "cancelado" só vem da leitura ao vivo (parseTicketsApi): encerrado na SoftCS, então não conta como em aberto
export const isRes = (t: Ticket) => ["resolvido", "cancelado"].includes(norm(t.status)) || isInat(t);

export const baseDate = (t: Ticket, f: TicketFilters) => (f.base === "u" ? t.u : t.c);
export const baseMonth = (t: Ticket, f: TicketFilters) => (f.base === "u" ? t.mu : t.mc);
export const baseWeek = (t: Ticket, f: TicketFilters) => (f.base === "u" ? t.wu : t.wc);
const baseDay = (t: Ticket, f: TicketFilters) => (f.base === "u" ? t.du : t.dc);

export function uniq(tickets: Ticket[], key: "etapa" | "nivel" | "agente" | "cliente") {
  return [...new Set(tickets.map((t) => t[key]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Semanas (seg–sáb) que tocam o mês escolhido. */
export function monthWeeks(year: number, month: number): Week[] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const weeks: Week[] = [];
  let wk = isoWeek(first);
  while (wk.mon <= last) {
    weeks.push(wk);
    const n = new Date(wk.mon);
    n.setDate(n.getDate() + 7);
    wk = isoWeek(n);
  }
  return weeks;
}

/** Ajusta semana/dia pra caberem no ano/mês escolhidos. */
export function normalizeDates(f: TicketFilters): TicketFilters {
  const weeks = monthWeeks(f.year, f.month);
  let week = f.week;
  if (!weeks.some((w) => w.key === week)) {
    const today = new Date();
    week = (weeks.find((w) => today >= w.mon && today < new Date(w.mon.getTime() + 7 * 864e5)) || weeks[0]).key;
  }
  const dmin = ymd(new Date(f.year, f.month - 1, 1));
  const dmax = ymd(new Date(f.year, f.month, 0));
  const day = !f.day || f.day < dmin || f.day > dmax ? dmin : f.day;
  return { ...f, week, day };
}

export function defaultFilters(tickets: Ticket[], base: "c" | "u" = "c", bulk = true): TicketFilters {
  const f: TicketFilters = {
    base,
    year: 0,
    month: 1,
    period: "month",
    week: "",
    day: "",
    pri: new Set(),
    status: "",
    etapa: "",
    nivel: new Set(),
    agente: "",
    cliente: "",
    q: "",
    bulk,
  };
  const last = tickets.map((t) => baseDate(t, f)).reduce((m, d) => (d > m ? d : m));
  f.year = last.getFullYear();
  f.month = last.getMonth() + 1;
  f.week = isoWeek(last).key;
  f.day = ymd(last);
  return normalizeDates(f);
}

export function periodLabel(f: TicketFilters) {
  if (f.period === "day") {
    const [y, m, d] = f.day.split("-");
    return `${d}/${m}/${y}`;
  }
  if (f.period === "week") {
    const [y, m, d] = f.week.split("-").map(Number);
    return weekLabel(isoWeek(new Date(y, m - 1, d)));
  }
  return `${MES_LONGO[f.month - 1]} ${f.year}`;
}

function passesDate(t: Ticket, f: TicketFilters) {
  if (f.period === "day") return baseDay(t, f) === f.day;
  if (f.period === "week") return baseWeek(t, f).key === f.week;
  return baseMonth(t, f) === `${f.year}-${pad(f.month)}`;
}

export function passes(t: Ticket, f: TicketFilters, skipDate = false) {
  if (!skipDate && !passesDate(t, f)) return false;
  if (f.pri.size && !f.pri.has(t.pri)) return false;
  if (f.status === "res" && !isRes(t)) return false;
  if (f.status === "open" && isRes(t)) return false;
  if (f.etapa && t.etapa !== f.etapa) return false;
  if (f.nivel.size && !f.nivel.has(t.nivel)) return false;
  if (f.agente && t.agente !== f.agente) return false;
  if (f.cliente && !norm(t.cliente).includes(norm(f.cliente))) return false;
  if (f.q && !t.search.includes(norm(f.q))) return false;
  return true;
}

export function derive(t: Ticket, ref: Date, ignoreBulk: boolean, metas: SlaMetas): Derived {
  const res = isRes(t);
  const rt = res ? (+t.u - +t.c) / 36e5 : null;
  const meta = metaOf(t.pri, metas);
  const useSla = res && !(ignoreBulk && t.bulk);

  // Em aberto: vale o SLA que a planilha traz. Quando a coluna SLA vem vazia,
  // aplica a regra da meta da prioridade: estourou se já passou da meta desde a criação.
  let late = false;
  let slaSrc: Derived["slaSrc"] = null;
  if (!res) {
    if (t.sla) {
      late = /estourad/i.test(t.sla);
      slaSrc = "export";
    } else if (meta != null) {
      late = (+ref - +t.c) / 36e5 > meta;
      slaSrc = "meta";
    }
  }
  return {
    t,
    res,
    rt,
    meta,
    useSla,
    inSla: useSla && meta != null && rt != null ? rt <= meta : null,
    idle: (+ref - +t.u) / 36e5,
    late,
    slaSrc,
  };
}

export const bucketOf = (h: number) => BUCKETS.findIndex(([m]) => h < m);

export const prazo = (items: Derived[]) => {
  const v = items.filter((x) => x.inSla !== null);
  return { ok: v.filter((x) => x.inSla).length, n: v.length };
};

export function sortVal(x: Derived, k: SortKey): number | string {
  switch (k) {
    case "idle":
      return x.idle;
    case "rt":
      return x.rt ?? -1;
    case "c":
      return +x.t.c;
    case "u":
      return +x.t.u;
    case "status":
      return x.res ? 1 : 0;
    case "pri":
      return x.t.pri === "—" ? 9 : +x.t.pri[1];
    default:
      return norm(x.t[k]);
  }
}

export function exportCSV(rows: Derived[]) {
  const head = ["ID", "Título", "Cliente", "Prioridade", "Nível", "Etapa", "Situação", "Status original", "SLA", "Agente", "Criado em", "Atualizado em", "Sem atualização (h)", "Tempo de resolução (h)", "Meta SLA (h)", "No prazo", "Atualização em lote"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = (v: number | null) => (v == null ? "" : v.toFixed(1).replace(".", ","));
  const lines = [head.map(q).join(";")].concat(
    rows.map((x) => {
      const t = x.t;
      return [
        t.id,
        t.titulo,
        t.cliente,
        t.pri === "—" ? "" : priLabel(t.pri),
        t.nivel === SEM_NIVEL ? "" : t.nivel,
        t.etapa,
        x.res ? (isInat(t) ? "Resolvido por inatividade" : "Resolvido") : "Em aberto",
        t.status,
        t.sla,
        t.agente,
        fmtDate(t.c),
        fmtDate(t.u),
        num(x.idle),
        num(x.rt),
        x.meta ?? "",
        x.inSla === null ? "" : x.inSla ? "Sim" : "Não",
        t.bulk ? "Sim" : "Não",
      ]
        .map(q)
        .join(";");
    })
  );
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tickets_filtrados_${toLocalInput(new Date()).replace(/[-:T]/g, "")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
