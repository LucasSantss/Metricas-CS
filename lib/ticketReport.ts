/**
 * Relatório semanal de tickets: os números saem daqui (código, sempre exatos)
 * e o Gemini só escreve o texto (resumo, temas dos criados e dos movimentados, riscos, recomendações) em cima
 * deles. A IA nunca calcula número — recebe os números prontos e a lista de
 * tickets da semana, com os nomes de cliente trocados por CLIENTE_N e e-mails
 * e telefones removidos; os nomes voltam só na hora de exibir.
 *
 * O relatório olha SÓ o que aconteceu dentro da semana:
 * - criados na semana ("Criado em" na semana) — base dos números principais,
 *   iguais aos do Painel de tickets filtrado pela mesma semana;
 * - movimentados na semana: criados antes e com "Atualizado em" na semana,
 *   sem contar atualização em lote (que não é movimentação de verdade).
 * Tickets antigos que não mexeram na semana ficam de fora.
 */
import { createHash } from "node:crypto";
import { fetchBotExport } from "./softcsBot";
import { getSettings, getTicketReport, saveTicketReport, type TicketReportRow } from "./db";
import {
  DEFAULT_META,
  PRI_KEYS,
  derive,
  fmtHours,
  isInat,
  mean,
  median,
  norm,
  parseTicketsApi,
  prazo,
  priLabel,
  type Derived,
  type Pri,
  type SlaMetas,
  type Ticket,
} from "./tickets";

/* ---------- semanas (horário de Brasília, seg 00:00 até a seg seguinte) ---------- */

const TZ = "America/Sao_Paulo";
const DAY_MS = 864e5;

/** "YYYY-MM-DD" da data no horário de Brasília. */
function brtYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}
/** Segunda-feira da semana (horário de Brasília) que contém `d`. */
export function weekStartOf(d: Date): string {
  const ymd = brtYmd(d);
  const [y, m, day] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = domingo
  return addDays(ymd, -((dow + 6) % 7));
}
/** Última semana completa (a anterior à atual). */
export const lastCompleteWeek = (now = new Date()) => addDays(weekStartOf(now), -7);
export const isWeekStart = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && weekStartOf(new Date(`${s}T12:00:00-03:00`)) === s;

// O Brasil não tem horário de verão desde 2019: -03:00 fixo.
const rangeOf = (weekStart: string) => {
  const start = new Date(`${weekStart}T00:00:00-03:00`);
  return { start: +start, end: +start + 7 * DAY_MS };
};
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
export const weekLabel = (weekStart: string) => `${ddmm(weekStart)} a ${ddmm(addDays(weekStart, 6))}/${addDays(weekStart, 6).slice(0, 4)}`;
const fmtBrt = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

/* ---------- formato salvo no banco ---------- */

/** Versão do formato de ReportData — relatórios salvos em versão anterior pedem pra gerar de novo. */
export const REPORT_VERSION = 2;

export type WeekTotals = {
  /** criados na semana */
  created: number;
  /** dos criados na semana, quantos já estão resolvidos */
  createdResolved: number;
  createdInat: number;
  createdOpen: number;
  /** SLA de resolução dos criados na semana já resolvidos (mesma regra do Painel, sem lote) */
  slaMeanH: number | null;
  slaMedianH: number | null;
  slaBase: number;
  prazoOk: number;
  prazoN: number;
  /** criados antes e atualizados na semana (sem atualização em lote) */
  moved: number;
  movedResolved: number;
  movedOpen: number;
  /** tempo total (criação → última atualização) dos movimentados que estão resolvidos */
  movedRtMedianH: number | null;
  /** criados antes e atualizados na semana só por atualização em lote — fora do relatório */
  bulkExcluded: number;
};

export type TicketRef = { titulo: string; cliente: string; pri: Pri; etapa: string; situacao: string; origem: "criado" | "movimentado" };

export type ReportData = {
  v: number;
  weekStart: string;
  weekLabel: string;
  /** semana em andamento: números só até `generatedAt` (o cron diário das 9h atualiza; na segunda, a versão completa substitui) */
  partial: boolean;
  generatedAt: string;
  snapshotAt: string | null;
  metas: SlaMetas;
  cur: WeekTotals;
  prev: WeekTotals;
  /** tickets da semana (criados + movimentados) que estão em aberto no momento da geração */
  scopeOpen: number;
  scopeLate: number;
  byPriority: {
    pri: Pri;
    created: number;
    createdResolved: number;
    moved: number;
    open: number;
    late: number;
    slaMedianH: number | null;
    prazoOk: number;
    prazoN: number;
  }[];
  byStageOpen: { etapa: string; n: number; idleMedianH: number | null }[];
  topClients: { cliente: string; n: number; ids: string[] }[];
  byAgent: { agente: string; created: number; moved: number; resolved: number; open: number }[];
  repeatedTitles: { titulo: string; n: number; ids: string[] }[];
  highlights: { tipo: "volume" | "atraso" | "cliente" | "lote" | "antigos"; texto: string; ids: string[] }[];
  tickets: Record<string, TicketRef>;
};

export type ReportTheme = { titulo: string; descricao: string; impacto: "alto" | "medio" | "baixo"; ticketIds: string[] };

export type ReportAi = {
  resumo: string;
  /** temas dos tickets criados na semana */
  temasCriados: ReportTheme[];
  /**
   * temas dos tickets movimentados na semana (criados antes). Por enquanto a IA só vê título,
   * descrição e situação atual — comentários e eventos dos tickets ainda não vêm da SoftCS.
   */
  temasMovimentados: ReportTheme[];
  /** formato antigo (antes da divisão criados/movimentados) — só em relatórios já salvos */
  temas?: ReportTheme[];
  riscos: string[];
  recomendacoes: string[];
};

/* ---------- números (código) ---------- */

const situacaoOf = (x: Derived) => (x.res ? (isInat(x.t) ? "resolvido por inatividade" : "resolvido") : "em aberto");
const within = (d: Date, r: { start: number; end: number }) => +d >= r.start && +d < r.end;
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Separa os tickets da semana: criados nela e movimentados nela (criados antes, atualizados na semana, sem lote). */
function scopeOf(all: Derived[], r: { start: number; end: number }) {
  const created = all.filter((x) => within(x.t.c, r));
  const touchedBefore = all.filter((x) => !within(x.t.c, r) && +x.t.c < r.start && within(x.t.u, r));
  return { created, moved: touchedBefore.filter((x) => !x.t.bulk), bulk: touchedBefore.filter((x) => x.t.bulk) };
}

function totalsFor(all: Derived[], r: { start: number; end: number }): WeekTotals {
  const { created, moved, bulk } = scopeOf(all, r);
  const createdRes = created.filter((x) => x.res);
  const sla = createdRes.filter((x) => x.useSla).map((x) => x.rt!);
  const pz = prazo(createdRes);
  const movedRes = moved.filter((x) => x.res);
  return {
    created: created.length,
    createdResolved: createdRes.length,
    createdInat: createdRes.filter((x) => isInat(x.t)).length,
    createdOpen: created.length - createdRes.length,
    slaMeanH: round1(mean(sla)),
    slaMedianH: round1(median(sla)),
    slaBase: sla.length,
    prazoOk: pz.ok,
    prazoN: pz.n,
    moved: moved.length,
    movedResolved: movedRes.length,
    movedOpen: moved.length - movedRes.length,
    movedRtMedianH: round1(median(movedRes.map((x) => x.rt!))),
    bulkExcluded: bulk.length,
  };
}

const titleKey = (s: string) =>
  norm(s)
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function groupBy<T>(items: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

export function computeReportData(tickets: Ticket[], metas: SlaMetas, weekStart: string, now: Date, snapshotAt: string | null): ReportData {
  const all = tickets.map((t) => derive(t, now, true, metas));
  const r = rangeOf(weekStart);
  const partial = +now < r.end;
  const cur = totalsFor(all, r);
  const prev = totalsFor(all, rangeOf(addDays(weekStart, -7)));

  const { created, moved } = scopeOf(all, r);
  const scope = [...created, ...moved];
  const createdIds = new Set(created.map((x) => x.t.id));
  const open = scope.filter((x) => !x.res);
  const late = open.filter((x) => x.late);

  const byPriority = PRI_KEYS.map((pri) => {
    const c = created.filter((x) => x.t.pri === pri);
    const cRes = c.filter((x) => x.res);
    const pz = prazo(cRes);
    return {
      pri,
      created: c.length,
      createdResolved: cRes.length,
      moved: moved.filter((x) => x.t.pri === pri).length,
      open: open.filter((x) => x.t.pri === pri).length,
      late: late.filter((x) => x.t.pri === pri).length,
      slaMedianH: round1(median(cRes.filter((x) => x.useSla).map((x) => x.rt!))),
      prazoOk: pz.ok,
      prazoN: pz.n,
    };
  }).filter((p) => p.created || p.moved);

  const byStageOpen = [...groupBy(open, (x) => x.t.etapa)]
    .map(([etapa, xs]) => ({ etapa, n: xs.length, idleMedianH: round1(median(xs.map((x) => x.idle))) }))
    .sort((a, b) => b.n - a.n);

  const topClients = [...groupBy(created.filter((x) => x.t.cliente !== "—"), (x) => x.t.cliente)]
    .filter(([, xs]) => xs.length >= 2)
    .map(([cliente, xs]) => ({ cliente, n: xs.length, ids: xs.map((x) => x.t.id) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  const byAgent = [...groupBy(scope, (x) => x.t.agente)]
    .map(([agente, xs]) => ({
      agente,
      created: xs.filter((x) => createdIds.has(x.t.id)).length,
      moved: xs.filter((x) => !createdIds.has(x.t.id)).length,
      resolved: xs.filter((x) => x.res).length,
      open: xs.filter((x) => !x.res).length,
    }))
    .sort((a, b) => b.created + b.moved - (a.created + a.moved))
    .slice(0, 10);

  const repeatedTitles = [...groupBy(created, (x) => titleKey(x.t.titulo))]
    .filter(([k, xs]) => k && xs.length >= 2)
    .map(([, xs]) => ({ titulo: xs[0].t.titulo, n: xs.length, ids: xs.map((x) => x.t.id) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  // Destaques por regra fixa — os mesmos toda semana, sem IA, só com tickets da semana.
  const highlights: ReportData["highlights"] = [];
  if (prev.created > 0) {
    const d = (cur.created - prev.created) / prev.created;
    if (Math.abs(d) >= 0.2)
      highlights.push({
        tipo: "volume",
        texto: `Volume de tickets criados ${d > 0 ? "subiu" : "caiu"} ${Math.round(Math.abs(d) * 100)}% (${prev.created} → ${cur.created}) em relação à semana anterior.`,
        ids: [],
      });
  }
  const lateHigh = late.filter((x) => x.t.pri === "P0" || x.t.pri === "P1").sort((a, b) => +a.t.c - +b.t.c);
  if (lateHigh.length)
    highlights.push({
      tipo: "atraso",
      texto: `${lateHigh.length} ticket(s) P0/P1 da semana seguem em aberto com SLA estourado.`,
      ids: lateHigh.slice(0, 10).map((x) => x.t.id),
    });
  topClients
    .filter((c) => c.n >= 3)
    .forEach((c) => highlights.push({ tipo: "cliente", texto: `${c.cliente} abriu ${c.n} tickets na semana.`, ids: c.ids }));
  const movedRes = moved.filter((x) => x.res);
  if (movedRes.length)
    highlights.push({
      tipo: "antigos",
      texto: `${movedRes.length} ticket(s) criados antes da semana foram movimentados e estão resolvidos (tempo total mediano: ${fmtHours(cur.movedRtMedianH)}).`,
      ids: movedRes.slice(0, 10).map((x) => x.t.id),
    });
  if (cur.bulkExcluded)
    highlights.push({
      tipo: "lote",
      texto: `${cur.bulkExcluded} ticket(s) antigos só foram tocados por atualização em lote nesta semana e ficaram fora do relatório.`,
      ids: [],
    });

  // Referência dos tickets citados (pra exibir título/link sem guardar a base inteira).
  const tickets_: Record<string, TicketRef> = {};
  for (const x of scope)
    tickets_[x.t.id] = {
      titulo: x.t.titulo,
      cliente: x.t.cliente,
      pri: x.t.pri,
      etapa: x.t.etapa,
      situacao: situacaoOf(x),
      origem: createdIds.has(x.t.id) ? "criado" : "movimentado",
    };

  return {
    v: REPORT_VERSION,
    weekStart,
    weekLabel: weekLabel(weekStart),
    partial,
    generatedAt: now.toISOString(),
    snapshotAt,
    metas,
    cur,
    prev,
    scopeOpen: open.length,
    scopeLate: late.length,
    byPriority,
    byStageOpen,
    topClients,
    byAgent,
    repeatedTitles,
    highlights,
    tickets: tickets_,
  };
}

/* ---------- texto (Gemini) ---------- */

const MAX_TICKETS_AI = 250;
const DESC_MAX_AI = 500;
// A função tem até 300s na Vercel (Hobby com Fluid compute); sobra folga pra busca no bot e gravação.
const GEMINI_TIMEOUT_MS = 240_000;

/** Troca nomes de cliente por CLIENTE_N e tira e-mails/telefones antes de mandar pro Gemini. */
function makeAnonymizer(clientNames: string[]) {
  const alias = new Map<string, string>();
  const byName = [...new Set(clientNames.filter((c) => c && c !== "—"))].sort((a, b) => b.length - a.length);
  byName.forEach((c, i) => alias.set(c, `CLIENTE_${i + 1}`));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRes = byName.filter((c) => c.length >= 4).map((c) => [new RegExp(esc(c), "gi"), alias.get(c)!] as const);
  const scrub = (text: string) => {
    let s = text
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[telefone]");
    for (const [re, a] of nameRes) s = s.replace(re, a);
    return s;
  };
  const back = new Map([...alias].map(([name, a]) => [a, name]));
  const unalias = (text: string) => text.replace(/CLIENTE_(\d+)/g, (m) => back.get(m) ?? m);
  return { aliasOf: (c: string) => alias.get(c) ?? "sem cliente", scrub, unalias };
}

const SYSTEM_PROMPT = `Você é analista de operações de suporte de uma empresa de software (SaaS) e escreve o relatório semanal de tickets para a gestão, em português do Brasil.

O relatório cobre só o que aconteceu dentro da semana:
- "criados": tickets abertos na semana. Os números de SLA e prazo são só deles.
- "movimentados": tickets criados antes da semana que tiveram atualização na semana (continuam a história de semanas anteriores).

Regras:
- Use SOMENTE os números que aparecem em METRICAS. Não calcule, estime nem invente números novos.
- Ao citar tickets, use apenas os ids da lista TICKETS. Cada ticket tem o campo "origem" ("criado na semana" ou "movimentado na semana").
- Os clientes estão anonimizados como CLIENTE_N: mantenha esses códigos exatamente como estão.
- "resumo": 2 a 4 parágrafos curtos sobre o que aconteceu na semana, comparando com a semana anterior quando fizer sentido.
- "temasCriados": 3 a 7 assuntos que concentram os tickets CRIADOS na semana (origem "criado na semana"), agrupando tickets parecidos mesmo com palavras diferentes. Para cada tema: título curto, descrição com a causa provável (deixe claro quando for hipótese), impacto (alto, medio ou baixo) e os ids dos tickets. Use só ids de tickets criados na semana.
- "temasMovimentados": 2 a 5 assuntos que concentram os tickets MOVIMENTADOS na semana (origem "movimentado na semana"): o que andou, o que foi resolvido e o que continua travado (por exemplo, parado em sprint de desenvolvimento ou aguardando cliente), com base no título, na descrição, na etapa e na situação atual. Mesmo formato dos temas acima. Use só ids de tickets movimentados. Se não houver tickets movimentados, devolva lista vazia.
- "riscos": pontos que podem piorar se nada for feito (máximo 5).
- "recomendacoes": ações práticas e específicas para a próxima semana (máximo 5).
- Se METRICAS.semana_em_andamento for true, a semana ainda não terminou: deixe claro que os números são parciais (até METRICAS.dados_ate) e cuidado ao comparar com a semana anterior, que está completa.
- Seja direto e objetivo. Não repita a lista de números; interprete-os.`;

const THEME_LIST_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      titulo: { type: "STRING" },
      descricao: { type: "STRING" },
      impacto: { type: "STRING", enum: ["alto", "medio", "baixo"] },
      ticketIds: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["titulo", "descricao", "impacto", "ticketIds"],
  },
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    resumo: { type: "STRING" },
    temasCriados: THEME_LIST_SCHEMA,
    temasMovimentados: THEME_LIST_SCHEMA,
    riscos: { type: "ARRAY", items: { type: "STRING" } },
    recomendacoes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["resumo", "temasCriados", "temasMovimentados", "riscos", "recomendacoes"],
};

export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

/** Modelo usado quando o principal segue sobrecarregado depois das novas tentativas (opcional). */
const geminiFallbackModel = () => process.env.GEMINI_FALLBACK_MODEL?.trim() || null;

// Erros passageiros do Google (sobrecarga, limite de taxa): vale esperar e tentar de novo.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_WAITS_MS = [5_000, 15_000];

async function requestGemini(model: string, prompt: string, key: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        // "Raciocínio" baixo: o texto se apoia em números já calculados, e o raciocínio
        // longo era o que fazia a resposta passar de 50s.
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`Gemini (${model}) respondeu HTTP ${res.status}: ${body?.error?.message ?? "sem detalhe"}`), { status: res.status });
  const parts: { text?: string; thought?: boolean }[] = body?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
  if (!text) throw new Error(`Gemini não devolveu texto (motivo: ${body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? "desconhecido"}).`);
  return JSON.parse(text);
}

/**
 * Pede o texto ao Gemini. Em erro passageiro (503 "high demand", 429...) espera e tenta de novo;
 * se o modelo principal continuar fora, tenta GEMINI_FALLBACK_MODEL (se configurado).
 * Todas as tentativas dividem o mesmo limite de GEMINI_TIMEOUT_MS.
 */
export async function callGemini(prompt: string): Promise<{ result: unknown; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não configurada: o relatório saiu só com os números.");
  const models = [...new Set([geminiModel(), geminiFallbackModel()].filter((m): m is string => !!m))];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  let tries = 0;
  try {
    let lastErr: any;
    for (const model of models) {
      for (let attempt = 0; ; attempt++) {
        tries++;
        try {
          return { result: await requestGemini(model, prompt, key, ctrl.signal), model };
        } catch (e: any) {
          if (!RETRY_STATUS.has(e.status)) throw e;
          lastErr = e;
          if (attempt >= RETRY_WAITS_MS.length) break;
          await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt]));
        }
      }
    }
    throw new Error(`${lastErr.message} (${tries} tentativas)`);
  } catch (e: any) {
    if (e.name === "AbortError") throw new Error(`Gemini demorou mais de ${GEMINI_TIMEOUT_MS / 1000}s para responder (${tries} tentativas).`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const strList = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, max) : []);

/** Monta o que vai pro Gemini: números prontos + tickets da semana, anonimizados. */
export function buildAiInput(tickets: Ticket[], data: ReportData, metas: SlaMetas, now: Date) {
  const r = rangeOf(data.weekStart);
  const all = tickets.map((t) => derive(t, now, true, metas));
  const { created, moved } = scopeOf(all, r);
  const createdIds = new Set(created.map((x) => x.t.id));
  const set = [...created, ...moved]
    .sort((a, b) => (a.t.pri === "—" ? 9 : +a.t.pri[1]) - (b.t.pri === "—" ? 9 : +b.t.pri[1]) || +b.t.c - +a.t.c)
    .slice(0, MAX_TICKETS_AI);
  if (!set.length) throw new Error("Nenhum ticket criado ou movimentado nesta semana: nada para a IA analisar.");

  const anon = makeAnonymizer(tickets.map((t) => t.cliente));
  const ticketsAi = set.map((x) => ({
    id: x.t.id,
    origem: createdIds.has(x.t.id) ? "criado na semana" : "movimentado na semana",
    titulo: anon.scrub(x.t.titulo),
    descricao: anon.scrub(x.t.desc.slice(0, DESC_MAX_AI)),
    cliente: anon.aliasOf(x.t.cliente),
    prioridade: x.t.pri === "—" ? "sem prioridade" : priLabel(x.t.pri),
    nivel: x.t.nivel,
    etapa: x.t.etapa,
    situacao: situacaoOf(x),
    criado_em: fmtBrt(x.t.c),
    horas_ate_resolver: x.res ? round1(x.rt) : null,
    sla_estourado: x.res ? null : x.late,
  }));
  // Números prontos pra IA, sem nomes de agente (não precisam ir pra fora) e com clientes anonimizados.
  const metricas = {
    semana: data.weekLabel,
    semana_em_andamento: data.partial,
    dados_ate: fmtBrt(now),
    metas_sla_horas: metas,
    semana_atual: data.cur,
    semana_anterior: data.prev,
    tickets_da_semana_em_aberto: data.scopeOpen,
    tickets_da_semana_com_sla_estourado: data.scopeLate,
    por_prioridade: data.byPriority,
    em_aberto_por_etapa: data.byStageOpen,
    clientes_com_mais_tickets: data.topClients.map((c) => ({ cliente: anon.aliasOf(c.cliente), tickets: c.n })),
    titulos_repetidos: data.repeatedTitles.map((t) => ({ titulo: anon.scrub(t.titulo), tickets: t.n })),
    destaques: data.highlights.map((h) => anon.scrub(h.texto)),
  };
  const prompt = `METRICAS (JSON):\n${JSON.stringify(metricas)}\n\nTICKETS da semana (${set.length}${set.length === MAX_TICKETS_AI ? ", limitado aos mais prioritários" : ""}) (JSON):\n${JSON.stringify(ticketsAi)}`;

  // Impressão digital do que a IA analisaria, sem nada que mude só com o relógio
  // (horas sem atualização, "dados até"): se nenhum ticket mudou, o texto salvo é reaproveitado.
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({
        v: REPORT_VERSION,
        model: geminiModel(),
        prompt: SYSTEM_PROMPT,
        week: data.weekStart,
        partial: data.partial,
        metas,
        tickets: set.map((x) => [x.t.id, +x.t.u, x.t.etapa, x.t.pri, x.t.status, x.t.titulo, x.t.desc.slice(0, DESC_MAX_AI)]),
      })
    )
    .digest("hex");
  const ids = set.map((x) => x.t.id);
  return { prompt, createdIds: ids.filter((id) => createdIds.has(id)), movedIds: ids.filter((id) => !createdIds.has(id)), anon, inputHash };
}

function parseAi(out: any, created: Set<string>, moved: Set<string>, unalias: (s: string) => string): ReportAi {
  const impacto = (v: unknown): ReportTheme["impacto"] => (v === "alto" || v === "baixo" ? v : "medio");
  const themes = (v: unknown, known: Set<string>, max: number): ReportTheme[] =>
    (Array.isArray(v) ? v : [])
      .slice(0, max)
      .map((t: any) => ({
        titulo: unalias(String(t?.titulo ?? "")),
        descricao: unalias(String(t?.descricao ?? "")),
        impacto: impacto(t?.impacto),
        // descarta ids inventados e ids do outro grupo (criado x movimentado)
        ticketIds: strList(t?.ticketIds, 50).filter((id) => known.has(id)),
      }))
      .filter((t) => t.titulo && t.ticketIds.length);
  return {
    resumo: unalias(typeof out?.resumo === "string" ? out.resumo.trim() : ""),
    temasCriados: themes(out?.temasCriados, created, 7),
    temasMovimentados: themes(out?.temasMovimentados, moved, 5),
    riscos: strList(out?.riscos, 5).map(unalias),
    recomendacoes: strList(out?.recomendacoes, 5).map(unalias),
  };
}

/* ---------- geração completa ---------- */

export type GenerateResult = TicketReportRow & { aiReused: boolean };

/**
 * Busca os tickets no bot, calcula os números, pede o texto ao Gemini e grava.
 * Se os tickets da semana não mudaram desde a última geração com texto, reaproveita
 * o texto salvo em vez de chamar a IA de novo. Sem IA, grava só os números.
 */
export async function generateTicketReport(weekStart = lastCompleteWeek()): Promise<GenerateResult> {
  const exp = await fetchBotExport();
  const { tickets } = parseTicketsApi(exp);
  const settings = await getSettings();
  const metas: SlaMetas = { ...DEFAULT_META, ...settings.ticketSlaHours };
  const now = new Date();
  const data = computeReportData(tickets, metas, weekStart, now, exp.snapshotAt ?? null);

  let ai: ReportAi | null = null;
  let aiError: string | null = null;
  let inputHash: string | null = null;
  let model: string | null = null;
  let aiReused = false;
  const saved = await getTicketReport(weekStart);
  try {
    const input = buildAiInput(tickets, data, metas, now);
    inputHash = input.inputHash;
    if (saved?.ai && saved.aiInputHash === inputHash) {
      ai = saved.ai as ReportAi;
      model = saved.model;
      aiReused = true;
    } else {
      const res = await callGemini(input.prompt);
      ai = parseAi(res.result, new Set(input.createdIds), new Set(input.movedIds), input.anon.unalias);
      model = res.model;
    }
  } catch (e: any) {
    // Não perde um texto já pago: se a IA falhar agora, mantém o da geração anterior, avisando.
    if (saved?.ai && (saved.data as ReportData | null)?.v === REPORT_VERSION) {
      ai = saved.ai as ReportAi;
      model = saved.model;
      inputHash = saved.aiInputHash;
      aiReused = true;
      aiError = `Não foi possível atualizar o texto (${e.message}). O texto abaixo é da geração anterior, de ${fmtBrt(new Date(saved.generatedAt))}.`;
    } else {
      aiError = e.message;
    }
  }
  await saveTicketReport({ weekStart, data, ai, aiError, model, aiInputHash: ai ? inputHash : null });
  return { weekStart, generatedAt: now.toISOString(), data, ai, aiError, model, aiInputHash: ai ? inputHash : null, aiReused };
}
