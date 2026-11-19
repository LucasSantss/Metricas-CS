/**
 * Tickets resolvidos na semana — números (código, sempre exatos) e tipos da tela
 * /resolvidos. Roda no servidor e no navegador: o servidor monta as linhas a partir da
 * exportação do SoftCS Bot e a tela recorta por Todos / KA / grupo e calcula os números
 * de cada recorte sem nova busca.
 *
 * "Resolvido na semana" = encerrado hoje (resolvido, resolvido por inatividade ou
 * cancelado) com a data de resolução dentro da semana (seg 00:00 a dom 23:59, Brasília).
 * Data de resolução = closedAt da SoftCS. O "Atualizado em" (regra do Painel de tickets)
 * não serve aqui: muitos tickets encerrados há meses recebem atualização depois de
 * fechados e apareceriam como resolvidos na semana, com tempo de resolução inflado.
 * Sem closedAt (ex.: encerrado só por mudança de coluna, como "Resolvido por
 * Inatividade"), vale o "Atualizado em"; se essa atualização foi em lote, o ticket conta
 * na semana do lote mas fica fora do tempo de resolução e do prazo.
 * Limite conhecido: a SoftCS não limpa o closedAt quando o ticket é reaberto; um ticket
 * reaberto e encerrado de novo só por coluna fica com a data do primeiro encerramento.
 */
import {
  KA_JOURNEYS,
  PRI_KEYS,
  groupLabel,
  isInat,
  isKaJourney,
  isRes,
  mean,
  median,
  metaOf,
  norm,
  type Pri,
  type SlaMetas,
  type Ticket,
} from "./tickets";

/** Versão do formato — muda quando as linhas ou as regras mudam. */
export const RESOLVED_VERSION = 1;

export type ResolvedKind = "resolvido" | "inatividade" | "cancelado";
export const KIND_LABEL: Record<ResolvedKind, string> = {
  resolvido: "Resolvido",
  inatividade: "Resolvido por inatividade",
  cancelado: "Cancelado",
};

export type ResolvedRow = {
  id: string;
  titulo: string;
  cliente: string;
  agente: string;
  pri: Pri;
  nivel: string;
  etapa: string;
  kind: ResolvedKind;
  /** criado em (ISO) */
  c: string;
  /** resolvido em (ISO) */
  r: string;
  /** horas da criação à resolução; null quando a data de resolução não é confiável (lote sem closedAt) */
  rtH: number | null;
  /** meta de SLA da prioridade, em horas */
  meta: number | null;
  /** resolveu dentro da meta? null = sem meta ou sem tempo confiável */
  inSla: boolean | null;
  groups: string[];
  journeys: string[];
};

const DAY_MS = 864e5;
export const weekRange = (weekStart: string) => {
  // O Brasil não tem horário de verão desde 2019: -03:00 fixo.
  const start = +new Date(`${weekStart}T00:00:00-03:00`);
  return { start, end: start + 7 * DAY_MS };
};
export const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
};
/** Segunda-feira (horário de Brasília) da semana que contém `d`. */
export function weekStartBrt(d = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [y, m, day] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = domingo
  return plusDays(ymd, -((dow + 6) % 7));
}
const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
export const resolvedWeekText = (weekStart: string) => `${ddmmyyyy(weekStart)} a ${ddmmyyyy(plusDays(weekStart, 6))}`;

const kindOf = (t: Ticket): ResolvedKind => (isInat(t) ? "inatividade" : norm(t.status) === "cancelado" ? "cancelado" : "resolvido");
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Data de resolução e se ela é confiável pra medir tempo (ver comentário do arquivo). */
function resolvedAt(t: Ticket): { at: Date; exact: boolean } {
  if (t.closed && +t.closed >= +t.c) return { at: t.closed, exact: true };
  return { at: t.u, exact: !t.bulk };
}

/** Tickets encerrados hoje cuja resolução caiu na semana, do mais recente pro mais antigo. */
export function resolvedRows(tickets: Ticket[], weekStart: string, metas: SlaMetas): ResolvedRow[] {
  const { start, end } = weekRange(weekStart);
  const rows: ResolvedRow[] = [];
  for (const t of tickets) {
    if (!isRes(t)) continue;
    const { at, exact } = resolvedAt(t);
    if (+at < start || +at >= end) continue;
    const rtH = exact ? round1((+at - +t.c) / 36e5) : null;
    const meta = metaOf(t.pri, metas);
    rows.push({
      id: t.id,
      titulo: t.titulo,
      cliente: t.cliente,
      agente: t.agente,
      pri: t.pri,
      nivel: t.nivel,
      etapa: t.etapa,
      kind: kindOf(t),
      c: t.c.toISOString(),
      r: at.toISOString(),
      rtH,
      meta,
      inSla: rtH != null && meta != null ? rtH <= meta : null,
      groups: t.groups,
      journeys: t.journeys,
    });
  }
  return rows.sort((a, b) => b.r.localeCompare(a.r));
}

/* ---------- recortes ---------- */

/** "all" = base inteira; "ka" = clientes nas jornadas KA; "g:<comando>" = um grupo de jornada do bot. */
export type SegmentKey = string;

export const segmentLabel = (key: SegmentKey) =>
  key === "all" ? "Todos" : key === "ka" ? "KA (jornadas KA)" : key.startsWith("g:") ? `Grupo ${groupLabel(key.slice(2))}` : key;

export const inSegment = (row: { groups: string[]; journeys: string[] }, key: SegmentKey) =>
  key === "all" ? true : key === "ka" ? row.journeys.some(isKaJourney) : key.startsWith("g:") ? row.groups.includes(key.slice(2)) : false;

/** Todos, KA e cada grupo que aparece nos tickets. */
export function segmentOptions(rows: { groups: string[] }[]): SegmentKey[] {
  const groups = [...new Set(rows.flatMap((r) => r.groups))].sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), "pt-BR"));
  return ["all", "ka", ...groups.map((g) => `g:${g}`)];
}

export const KA_NOTE = `clientes nas jornadas ${KA_JOURNEYS.join(" ou ")}`;

/* ---------- números ---------- */

export type ResolvedTotals = {
  n: number;
  resolvido: number;
  inatividade: number;
  cancelado: number;
  rtMedianH: number | null;
  rtMeanH: number | null;
  /** quantos entram no tempo de resolução */
  rtBase: number;
  prazoOk: number;
  prazoN: number;
};

export function totalsOf(rows: ResolvedRow[]): ResolvedTotals {
  const rts = rows.filter((r) => r.rtH != null).map((r) => r.rtH!);
  const withMeta = rows.filter((r) => r.inSla != null);
  return {
    n: rows.length,
    resolvido: rows.filter((r) => r.kind === "resolvido").length,
    inatividade: rows.filter((r) => r.kind === "inatividade").length,
    cancelado: rows.filter((r) => r.kind === "cancelado").length,
    rtMedianH: round1(median(rts)),
    rtMeanH: round1(mean(rts)),
    rtBase: rts.length,
    prazoOk: withMeta.filter((r) => r.inSla).length,
    prazoN: withMeta.length,
  };
}

export type PriorityRow = ResolvedTotals & { pri: Pri; prevN: number };

export function byPriority(rows: ResolvedRow[], prevRows: ResolvedRow[]): PriorityRow[] {
  return PRI_KEYS.map((pri) => ({
    pri,
    ...totalsOf(rows.filter((r) => r.pri === pri)),
    prevN: prevRows.filter((r) => r.pri === pri).length,
  })).filter((p) => p.n || p.prevN);
}

/* ---------- IA ---------- */

export type TicketAi = { resumo: string; categoria: string };

export type OverviewTheme = { titulo: string; descricao: string; ticketIds: string[] };
export type ResolvedOverviewAi = { visaoGeral: string; temas: OverviewTheme[] };

export type ResolvedOverview = {
  generatedAt: string;
  /** gerado com a semana ainda em andamento */
  partial: boolean;
  ai: ResolvedOverviewAi | null;
  aiError: string | null;
  model: string | null;
  /** quantos tickets resolvidos o texto considerou */
  ticketCount: number;
};

/** Resposta de GET /api/resolved e POST /api/resolved. */
export type ResolvedResponse = {
  v: number;
  weekStart: string;
  currentWeek: string;
  partial: boolean;
  /** quando a cópia do bot foi atualizada da SoftCS */
  snapshotAt: string | null;
  fetchedAt: string;
  metas: SlaMetas;
  rows: ResolvedRow[];
  prevRows: ResolvedRow[];
  summaries: Record<string, TicketAi>;
  overviews: Record<SegmentKey, ResolvedOverview>;
  /** só no POST: o que aconteceu na geração */
  generation?: { summarized: number; reused: number; overview: "gerada" | "reaproveitada" | "sem tickets" | "falhou"; errors: string[] };
};
