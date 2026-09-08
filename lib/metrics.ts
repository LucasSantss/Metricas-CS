import type { Department } from "./db";
import type { SuriAttendance } from "./suri";
import type { WeekRange } from "./weeks";

export type MetricKey = "tme" | "tma" | "tmr" | "csat";

export type MetricStat = {
  key: MetricKey;
  label: string;
  /** valor médio em segundos (tme/tma/tmr) ou nota 0-5 (csat) */
  value: number | null;
  formatted: string;
  goalLabel: string;
  goalMet: boolean | null;
};

export type DepartmentReport = {
  departmentId: string;
  name: string;
  atendimentos: { current: number; previous: number; deltaPct: number | null };
  respostas: { current: number; previous: number; deltaPct: number | null };
  metrics: {
    key: MetricKey;
    label: string;
    from: string;
    to: string;
    goalLabel: string;
    deltaPct: number | null;
    /** direção real da variação (up = aumentou, down = diminuiu, flat = igual) */
    direction: "up" | "down" | "flat";
    /** se a variação é boa (verde) ou ruim (laranja), dado o sentido da métrica */
    isImprovement: boolean | null;
    goalMet: boolean | null;
    prevGoalMet: boolean | null;
    sampleTooSmall: boolean;
    /** quantas semanas seguidas (incluindo a atual) a meta ficou fora, até o limite do histórico consultado */
    streak: number;
    /** tamanho da série usada pra calcular o streak — se streak === isso, o streak real pode ser maior (não olhamos mais pra trás) */
    streakSeriesLength: number;
  }[];
  goalsMet: number;
  goalsTotal: number;
};

export type Callout = { level: "good" | "warn" | "bad"; departmentId: string; text: string };

/** callout agregado por setor (combina várias métricas numa frase só), usado no resumo final */
export type SummaryCallout = { level: "good" | "warn" | "bad"; emoji: string; departmentId: string; departmentName: string; text: string };

export type ReportResult = {
  currentWeek: { label: string; mondayDate: string; start: string; end: string };
  previousWeek: { label: string; mondayDate: string; start: string; end: string };
  departments: DepartmentReport[];
  highlights: Callout[];
  attention: Callout[];
  summary: { highlights: SummaryCallout[]; attention: SummaryCallout[] };
};

const MIN_CSAT_SAMPLE = 5;
const LOWER_IS_BETTER: Record<MetricKey, boolean> = { tme: true, tma: true, tmr: true, csat: false };

function fmtHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

function fmtGoalTime(seconds: number): string {
  if (seconds % 3600 === 0) return `meta ≤ ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `meta ≤ ${seconds / 60} min`;
  return `meta ≤ ${fmtHms(seconds)}`;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function parseCsat(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type Agg = {
  count: number;
  tmeSeconds: number[];
  tmaSeconds: number[];
  tmrSeconds: number[];
  csatValues: number[];
};

function aggregate(records: SuriAttendance[]): Agg {
  const a: Agg = { count: 0, tmeSeconds: [], tmaSeconds: [], tmrSeconds: [], csatValues: [] };
  for (const r of records) {
    a.count += 1;
    a.tmeSeconds.push((r.waitingTime ?? 0) * 60);
    a.tmaSeconds.push((r.attendanceTime ?? 0) * 60);
    a.tmrSeconds.push((r.avgResponseTime ?? 0) * 60);
    const csat = parseCsat(r.surveyGrade);
    if (csat != null) a.csatValues.push(csat);
  }
  return a;
}

/**
 * Registros de um setor. O filtro de atendente(s) (setor ou pessoal) já é
 * aplicado na própria chamada à API Suri (ver app/api/report/route.ts); aqui
 * só garantimos que cada registro pertence de fato ao setor certo.
 */
export function recordsForDepartment(records: SuriAttendance[], dept: Department): SuriAttendance[] {
  return records.filter((r) => {
    const key = r.departmentId ?? r.departmentName ?? "sem-setor";
    return key === dept.departmentId;
  });
}

// "Atendimentos" conta atendimentos SOLICITADOS dentro do período
// (requestDate) — igual à coluna "Solicitados" do portal.
function filterByWindow(records: SuriAttendance[], week: WeekRange): SuriAttendance[] {
  return records.filter((r) => {
    if (!r.requestDate) return false;
    const t = new Date(r.requestDate).getTime();
    return t >= week.start.getTime() && t < week.end.getTime();
  });
}

/**
 * A API da Suri pode retornar mais de uma linha para o mesmo atendimento
 * (mesmo protocolo, timestamps quase idênticos) — provavelmente reenvio/
 * reprocessamento interno. Deduplicamos por protocolo para bater com o
 * número de "Finalizados" do próprio portal.
 */
export function dedupeByProtocol(records: SuriAttendance[]): SuriAttendance[] {
  const byProtocol = new Map<string, SuriAttendance>();
  for (const r of records) {
    if (!r.protocol) continue;
    const existing = byProtocol.get(r.protocol);
    if (!existing || new Date(r.endDate).getTime() >= new Date(existing.endDate).getTime()) {
      byProtocol.set(r.protocol, r);
    }
  }
  return Array.from(byProtocol.values());
}

/** Exclui atendimentos internos de teste (motivo contendo "teste"). */
export function isTestAttendance(r: SuriAttendance): boolean {
  return /teste/i.test(r.reason ?? "");
}

/** Aplica a mesma limpeza usada no relatório principal (janela, dedupe, filtro de teste). */
export function cleanRecordsForWindow(recordsRaw: SuriAttendance[], week: WeekRange): SuriAttendance[] {
  return dedupeByProtocol(filterByWindow(recordsRaw, week)).filter((r) => !isTestAttendance(r));
}

export type RecurrentClient = { userId: string; userName: string | null; count: number };

/**
 * Clientes com mais de uma solicitação dentro do período filtrado, ordenados
 * do mais recorrente pro menos — usados no ranking "clientes recorrentes".
 */
export function buildTopRecurrentClients(records: SuriAttendance[], limit: number): RecurrentClient[] {
  const byUser = new Map<string, { userName: string | null; count: number }>();
  for (const r of records) {
    const id = r.user?.id;
    if (!id) continue;
    const existing = byUser.get(id);
    if (existing) {
      existing.count += 1;
      if (!existing.userName && r.user?.name) existing.userName = r.user.name;
    } else {
      byUser.set(id, { userName: r.user?.name ?? null, count: 1 });
    }
  }
  return Array.from(byUser.entries())
    .map(([userId, v]) => ({ userId, userName: v.userName, count: v.count }))
    .filter((c) => c.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export type ReasonCount = { reason: string; count: number };

/** Ranking dos motivos de atendimento (campo "reason") mais frequentes no período filtrado. */
export function buildTopReasons(records: SuriAttendance[], limit: number): ReasonCount[] {
  const byReason = new Map<string, number>();
  for (const r of records) {
    const reason = (r.reason ?? "").trim();
    if (!reason) continue;
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  return Array.from(byReason.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function deltaPct(from: number, to: number): number | null {
  if (from === 0) return to === 0 ? 0 : null;
  return ((to - from) / from) * 100;
}

// quantas vezes o valor multiplicou (>=1 sempre): pct=122 (aumentou) -> 2.22x; pct=-60 (caiu) -> 2.5x menor
function ratioOf(pct: number): number {
  return pct >= 0 ? 1 + pct / 100 : 1 / (1 + pct / 100);
}

function severityOf(pct: number): "mild" | "moderate" | "severe" {
  if (ratioOf(pct) >= 1.8) return "severe";
  if (Math.abs(pct) >= 20) return "moderate";
  return "mild";
}

/** verbo que descreve a direção e a intensidade real do número, independente de ser bom ou ruim */
function changeVerb(key: MetricKey, pct: number): string {
  const csat = key === "csat";
  const ratio = ratioOf(pct);
  if (pct > 0) {
    if (ratio >= 3) return "disparou";
    if (ratio >= 2) return "mais que dobrou";
    if (ratio >= 1.8) return "quase dobrou";
    if (pct >= 30) return csat ? "subiu bastante" : "aumentou bastante";
    return csat ? "subiu" : "aumentou";
  }
  if (ratio >= 3) return "despencou";
  if (ratio >= 2) return "caiu mais da metade";
  if (ratio >= 1.8) return "caiu quase pela metade";
  if (pct <= -30) return csat ? "caiu bastante" : "diminuiu bastante";
  return csat ? "caiu" : "diminuiu";
}

/** pra métricas de tempo, estourar a meta é ficar ACIMA; pro CSAT (nota), é ficar ABAIXO */
function failWord(key: MetricKey): string {
  return key === "csat" ? "abaixo" : "acima";
}

/** remove o prefixo "meta " do goalLabel, pra encaixar em frases tipo "rompendo a meta (${threshold})" */
function goalThreshold(goalLabel: string): string {
  return goalLabel.replace(/^meta\s*/i, "");
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function numberWord(n: number): string {
  const words: Record<number, string> = { 2: "duas", 3: "três", 4: "quatro" };
  return words[n] ?? String(n);
}

/** Conta quantas semanas seguidas (a partir da mais recente, voltando no tempo) a meta ficou fora — para em null/true. */
function failStreak(seriesOldToNew: (boolean | null)[]): number {
  let streak = 0;
  for (let i = seriesOldToNew.length - 1; i >= 0; i--) {
    if (seriesOldToNew[i] === false) streak++;
    else break;
  }
  return streak;
}

/**
 * Frase pra streaks de meta fora do padrão. Quando o streak bate no limite do
 * histórico disponível (ex.: só olhamos 4 semanas pra trás), usamos "4+" em
 * vez de afirmar um número exato que pode estar subestimado.
 */
function streakPhrase(streak: number, seriesLength: number): string {
  if (streak >= 3) return ` há ${streak}${streak >= seriesLength ? "+" : ""} semanas seguidas`;
  if (streak === 2) return " pela segunda semana consecutiva";
  return "";
}

function goalMetForValue(key: MetricKey, value: number | null, dept: Department): boolean | null {
  if (value == null) return null;
  if (key === "csat") return value >= dept.goalCsat;
  const goalSeconds = key === "tme" ? dept.goalTmeSeconds : key === "tma" ? dept.goalTmaSeconds : dept.goalTmrSeconds;
  return value <= goalSeconds;
}

function goalMetForWeek(recordsRaw: SuriAttendance[], week: WeekRange, dept: Department, key: MetricKey): boolean | null {
  const records = recordsForDepartment(cleanRecordsForWindow(recordsRaw, week), dept);
  const agg = aggregate(records);
  const series = key === "tme" ? agg.tmeSeconds : key === "tma" ? agg.tmaSeconds : key === "tmr" ? agg.tmrSeconds : agg.csatValues;
  return goalMetForValue(key, avg(series), dept);
}

type MetricOutcome = DepartmentReport["metrics"][number];

/**
 * Combina os resultados de todas as métricas de um setor num resumo mais enxuto
 * (poucas frases narrativas por setor, em vez de um callout por métrica).
 */
function summarizeDepartment(
  deptId: string,
  deptName: string,
  metrics: MetricOutcome[]
): { highlights: SummaryCallout[]; attention: SummaryCallout[] } {
  // prevGoalMet só é null quando não há dado da semana anterior — nesses casos deltaPct também é null,
  // então filtrar por deltaPct != null já garante prevGoalMet booleano daqui em diante.
  const withDelta = metrics.filter((m): m is MetricOutcome & { deltaPct: number } => m.deltaPct != null);

  const recovered = withDelta.filter((m) => m.goalMet === true && m.prevGoalMet === false);
  const improvedInGoal = withDelta.filter(
    (m) => m.goalMet === true && m.prevGoalMet === true && m.isImprovement && Math.abs(m.deltaPct) >= 10
  );
  const worsenedInGoal = withDelta.filter(
    (m) => m.goalMet === true && m.prevGoalMet === true && !m.isImprovement && Math.abs(m.deltaPct) >= 15
  );

  const brokeGoal = withDelta.filter((m) => m.goalMet === false && m.prevGoalMet === true);
  const severeBroke = brokeGoal.filter((m) => severityOf(m.deltaPct) === "severe");
  const moderateBroke = brokeGoal.filter((m) => severityOf(m.deltaPct) !== "severe");

  const stillFailing = withDelta.filter((m) => m.goalMet === false && m.prevGoalMet === false);
  const severeStillFailing = stillFailing.filter((m) => !m.isImprovement && severityOf(m.deltaPct) === "severe");
  const otherStillFailing = stillFailing.filter((m) => !severeStillFailing.includes(m));

  const highlights: SummaryCallout[] = [];
  const attention: SummaryCallout[] = [];

  // --- destaques ---
  if (recovered.length >= 2) {
    const names = joinNatural(recovered.map((m) => m.label));
    const extra = improvedInGoal.length > 0 ? `, e reduziu significativamente ${joinNatural(improvedInGoal.map((m) => m.label))}` : "";
    highlights.push({
      level: "good",
      emoji: "🌟",
      departmentId: deptId,
      departmentName: deptName,
      text: `${deptName}: recuperou ${names}, voltando a cumprir as ${numberWord(recovered.length)} metas após a semana anterior fora do padrão${extra}.`,
    });
  } else if (recovered.length === 1) {
    const extra = improvedInGoal.length > 0 ? ` e reduziu significativamente ${joinNatural(improvedInGoal.map((m) => m.label))}` : "";
    highlights.push({
      level: "good",
      emoji: "📈",
      departmentId: deptId,
      departmentName: deptName,
      text: `${deptName}: voltou a atingir a meta de ${recovered[0].label}${extra}.`,
    });
  } else if (improvedInGoal.length >= 2) {
    highlights.push({
      level: "good",
      emoji: "📈",
      departmentId: deptId,
      departmentName: deptName,
      text: `${deptName}: melhorou significativamente ${joinNatural(improvedInGoal.map((m) => m.label))}, seguindo dentro das metas.`,
    });
  } else if (improvedInGoal.length === 1) {
    const m = improvedInGoal[0];
    highlights.push({
      level: "good",
      emoji: "📈",
      departmentId: deptId,
      departmentName: deptName,
      text: `${deptName}: ${m.label} melhorou significativamente (${m.from} → ${m.to}), seguindo dentro da meta (${goalThreshold(m.goalLabel)}).`,
    });
  }

  // --- pontos de atenção graves: um bullet por métrica, sem diluir o alerta ---
  for (const m of severeBroke) {
    const verb = changeVerb(m.key, m.deltaPct);
    const threshold = goalThreshold(m.goalLabel);
    const text =
      ratioOf(m.deltaPct) >= 3
        ? `${deptName}: ${m.label} ${verb} de ${m.from} para ${m.to}, ficando bem ${failWord(m.key)} da meta (${threshold}).`
        : `${deptName}: ${m.label} ${verb} (${m.from} → ${m.to}), rompendo a meta (${threshold}).`;
    attention.push({ level: "bad", emoji: "🔴", departmentId: deptId, departmentName: deptName, text });
  }
  for (const m of severeStillFailing) {
    const verb = changeVerb(m.key, m.deltaPct);
    const consecutive = streakPhrase(m.streak, m.streakSeriesLength) || " pela segunda semana consecutiva";
    attention.push({
      level: "bad",
      emoji: "🔴",
      departmentId: deptId,
      departmentName: deptName,
      text: `${deptName}: ${m.label} ${verb} (${m.from} → ${m.to}) e segue ${failWord(m.key)} da meta (${goalThreshold(m.goalLabel)})${consecutive}.`,
    });
  }

  // --- pontos de atenção moderados: combinados numa única frase por setor ---
  const moderateFragments: string[] = [];
  for (const m of moderateBroke) {
    const verb = changeVerb(m.key, m.deltaPct);
    moderateFragments.push(`${m.label} ${verb} e passou a ficar ${failWord(m.key)} da meta (${goalThreshold(m.goalLabel)}) esta semana, com ${m.to}`);
  }
  for (const m of otherStillFailing) {
    const consecutive = streakPhrase(m.streak, m.streakSeriesLength) || " pela segunda semana consecutiva";
    moderateFragments.push(
      m.isImprovement
        ? `${m.label} melhorou mas segue ${failWord(m.key)} da meta (${goalThreshold(m.goalLabel)}), com ${m.to}`
        : `${m.label} segue ${failWord(m.key)} da meta${consecutive}, com ${m.to}`
    );
  }
  for (const m of worsenedInGoal) {
    const verb = changeVerb(m.key, m.deltaPct);
    moderateFragments.push(`${m.label} ${verb} mas segue dentro da meta (${goalThreshold(m.goalLabel)})`);
  }
  if (metrics.some((m) => m.sampleTooSmall)) {
    moderateFragments.push(`CSAT tem poucas respostas nesta semana — leitura sensível à amostra pequena`);
  }

  if (moderateFragments.length > 0) {
    attention.push({
      level: "warn",
      emoji: "⚠️",
      departmentId: deptId,
      departmentName: deptName,
      text: `${deptName}: ${joinNatural(moderateFragments)}.`,
    });
  }

  return { highlights, attention };
}

export function buildReport(
  departments: Department[],
  currentRecordsRaw: SuriAttendance[],
  previousRecordsRaw: SuriAttendance[],
  currentWeek: WeekRange,
  previousWeek: WeekRange,
  /** semanas mais antigas que "previousWeek", da mais antiga pra mais recente — só usadas pra detectar streaks de 3+ semanas fora da meta; o comparativo principal continua sendo só semana atual x anterior. */
  extraHistoryWeeksOldToNew: { week: WeekRange; records: SuriAttendance[] }[] = []
): ReportResult {
  const currentRecords = cleanRecordsForWindow(currentRecordsRaw, currentWeek);
  const previousRecords = cleanRecordsForWindow(previousRecordsRaw, previousWeek);

  const highlights: ReportResult["highlights"] = [];
  const attention: ReportResult["attention"] = [];
  const summaryHighlights: SummaryCallout[] = [];
  const summaryAttention: SummaryCallout[] = [];

  const deptReports: DepartmentReport[] = departments.map((dept) => {
    const cur = aggregate(recordsForDepartment(currentRecords, dept));
    const prev = aggregate(recordsForDepartment(previousRecords, dept));

    const metricDefs: { key: MetricKey; label: string; goalSeconds?: number; goalCsat?: number }[] = [
      { key: "tme", label: "TME", goalSeconds: dept.goalTmeSeconds },
      { key: "tma", label: "TMA", goalSeconds: dept.goalTmaSeconds },
      { key: "tmr", label: "TMR", goalSeconds: dept.goalTmrSeconds },
      { key: "csat", label: "CSAT", goalCsat: dept.goalCsat },
    ];

    let goalsMet = 0;
    let goalsTotal = 0;

    const metrics = metricDefs.map((def) => {
      const curSeries = def.key === "tme" ? cur.tmeSeconds : def.key === "tma" ? cur.tmaSeconds : def.key === "tmr" ? cur.tmrSeconds : cur.csatValues;
      const prevSeries = def.key === "tme" ? prev.tmeSeconds : def.key === "tma" ? prev.tmaSeconds : def.key === "tmr" ? prev.tmrSeconds : prev.csatValues;

      const curAvg = avg(curSeries);
      const prevAvg = avg(prevSeries);

      const isCsat = def.key === "csat";
      const from = prevAvg == null ? "—" : isCsat ? prevAvg.toFixed(2).replace(".", ",") : fmtHms(prevAvg);
      const to = curAvg == null ? "—" : isCsat ? curAvg.toFixed(2).replace(".", ",") : fmtHms(curAvg);
      const goalLabel = isCsat ? `meta ≥ ${def.goalCsat!.toFixed(1).replace(".", ",")}` : fmtGoalTime(def.goalSeconds!);

      const pct = prevAvg != null && curAvg != null ? deltaPct(prevAvg, curAvg) : null;
      const direction: "up" | "down" | "flat" = pct == null ? "flat" : pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
      const isImprovement =
        pct == null
          ? null
          : LOWER_IS_BETTER[def.key]
          ? pct < 0
          : pct > 0;

      const goalMet = curAvg == null ? null : isCsat ? curAvg >= def.goalCsat! : curAvg <= def.goalSeconds!;
      const prevGoalMet = prevAvg == null ? null : isCsat ? prevAvg >= def.goalCsat! : prevAvg <= def.goalSeconds!;

      if (goalMet != null) {
        goalsTotal += 1;
        if (goalMet) goalsMet += 1;
      }

      const sampleTooSmall = isCsat && cur.csatValues.length < MIN_CSAT_SAMPLE;

      const historyGoalMets = extraHistoryWeeksOldToNew.map((h) => goalMetForWeek(h.records, h.week, dept, def.key));
      const streakSeries = [...historyGoalMets, prevGoalMet, goalMet];
      const streak = failStreak(streakSeries);

      return { key: def.key, label: def.label, from, to, goalLabel, deltaPct: pct, direction, isImprovement, goalMet, prevGoalMet, sampleTooSmall, streak, streakSeriesLength: streakSeries.length };
    });

    // destaques e pontos de atenção, gerados a partir dos números reais
    for (const m of metrics) {
      if (m.deltaPct == null) continue;
      const abs = Math.abs(m.deltaPct);
      const pctStr = abs.toFixed(1).replace(".", ",");
      const verb = changeVerb(m.key, m.deltaPct);
      const sev = severityOf(m.deltaPct);
      const threshold = goalThreshold(m.goalLabel);
      const consecutive = streakPhrase(m.streak, m.streakSeriesLength);

      if (m.goalMet === true) {
        if (m.prevGoalMet === false) {
          highlights.push({
            level: "good",
            departmentId: dept.departmentId,
            text: `${m.label} voltou a atingir a meta (${goalThreshold(m.goalLabel)}) após a semana anterior fora do padrão, agora em ${m.to}.`,
          });
        } else if (m.isImprovement && abs >= 10) {
          highlights.push({
            level: "good",
            departmentId: dept.departmentId,
            text: `${m.label} melhorou ${pctStr}% (${m.from} → ${m.to}) e segue dentro da meta (${goalThreshold(m.goalLabel)}).`,
          });
        } else if (!m.isImprovement && abs >= 15) {
          // dentro da meta, mas a tendência é ruim — vale acompanhar antes que estoure a meta
          attention.push({
            level: "warn",
            departmentId: dept.departmentId,
            text: `${m.label} ${verb} ${pctStr}% (${m.from} → ${m.to}) mas ainda permanece dentro da meta (${goalThreshold(m.goalLabel)}) ⚠️`,
          });
        }
      } else if (m.goalMet === false) {
        if (m.prevGoalMet === true) {
          // acabou de estourar a meta nesta semana — merece destaque diferente de "segue fora"
          attention.push({
            level: "bad",
            departmentId: dept.departmentId,
            text:
              sev === "severe"
                ? ratioOf(m.deltaPct) >= 3
                  ? `${m.label} ${verb} de ${m.from} para ${m.to}, ficando bem ${failWord(m.key)} da meta (${threshold}).`
                  : `${m.label} ${verb} (${m.from} → ${m.to}), rompendo a meta (${threshold}).`
                : `${m.label} saiu da meta (${goalThreshold(m.goalLabel)}) nesta semana: ${verb} ${pctStr}% e foi para ${m.to}.`,
          });
        } else if (!m.isImprovement && abs >= 20) {
          attention.push({
            level: "bad",
            departmentId: dept.departmentId,
            text: `${m.label} ${verb} (${m.from} → ${m.to}), seguindo ${failWord(m.key)} da meta (${goalThreshold(m.goalLabel)})${consecutive}.`,
          });
        } else if (m.isImprovement && abs >= 10) {
          // ainda fora da meta, mas caminhando na direção certa
          attention.push({
            level: "warn",
            departmentId: dept.departmentId,
            text: `${m.label} ${verb} ${pctStr}% e melhorou (${m.from} → ${m.to}), mas ainda está ${failWord(m.key)} da meta (${goalThreshold(m.goalLabel)}).`,
          });
        } else {
          attention.push({
            level: "warn",
            departmentId: dept.departmentId,
            text: `${m.label} segue ${failWord(m.key)} da meta (${goalThreshold(m.goalLabel)})${consecutive}, com ${m.to}.`,
          });
        }
      }

      if (m.sampleTooSmall) {
        attention.push({
          level: "warn",
          departmentId: dept.departmentId,
          text: `CSAT calculado com poucas respostas (${cur.csatValues.length}) — leitura sensível à amostra pequena.`,
        });
      }
    }

    const deptSummary = summarizeDepartment(dept.departmentId, dept.name, metrics);
    summaryHighlights.push(...deptSummary.highlights);
    summaryAttention.push(...deptSummary.attention);

    return {
      departmentId: dept.departmentId,
      name: dept.name,
      atendimentos: { current: cur.count, previous: prev.count, deltaPct: deltaPct(prev.count, cur.count) },
      respostas: {
        current: cur.csatValues.length,
        previous: prev.csatValues.length,
        deltaPct: deltaPct(prev.csatValues.length, cur.csatValues.length),
      },
      metrics,
      goalsMet,
      goalsTotal,
    };
  });

  return {
    currentWeek: {
      label: currentWeek.label,
      mondayDate: currentWeek.mondayDate,
      start: currentWeek.start.toISOString(),
      end: currentWeek.end.toISOString(),
    },
    previousWeek: {
      label: previousWeek.label,
      mondayDate: previousWeek.mondayDate,
      start: previousWeek.start.toISOString(),
      end: previousWeek.end.toISOString(),
    },
    departments: deptReports,
    highlights,
    attention,
    summary: { highlights: summaryHighlights, attention: summaryAttention },
  };
}
