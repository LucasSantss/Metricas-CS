"use client";

import { fmtMinSec, fmtMinSecDelta, fmtPct0, fmtPctDelta1 } from "@/lib/format";

type Stats = { p50: number | null; p75: number | null; p90: number | null; count: number };
type GoalStats = { p50: number; p75: number; p90: number };
type MetricGoals = { tme: GoalStats; tma: GoalStats; tmr: GoalStats };
type PctAboveGoalP90 = { tme: number | null; tma: number | null; tmr: number | null };

const TARGET_PCT_ABOVE_P90 = 10; // por definição do percentil: ~10% dos atendimentos deveriam ficar acima do P90-meta

function DeviationCell({ diff }: { diff: number | null }) {
  if (diff == null) return <td className="pct-tbl-dev">—</td>;
  const cls = diff > 0.05 ? "bad" : diff < -0.05 ? "good" : "";
  return <td className={`pct-tbl-dev ${cls}`}>{fmtMinSecDelta(diff)}</td>;
}

function MetricTable({
  label,
  stats,
  goals,
  pctAboveGoalP90,
  onOpenDetail,
}: {
  label: string;
  stats: Stats;
  goals: GoalStats;
  pctAboveGoalP90: number | null;
  onOpenDetail: () => void;
}) {
  const rows: { tag: string; value: number | null; goal: number }[] = [
    { tag: "P50", value: stats.p50, goal: goals.p50 },
    { tag: "P75", value: stats.p75, goal: goals.p75 },
    { tag: "P90", value: stats.p90, goal: goals.p90 },
  ];
  const pctDiff = pctAboveGoalP90 == null ? null : pctAboveGoalP90 - TARGET_PCT_ABOVE_P90;
  const pctCls = pctDiff == null ? "" : pctDiff > 0.05 ? "bad" : pctDiff < -0.05 ? "good" : "";

  return (
    <div
      className="pct-metric-block"
      onClick={onOpenDetail}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpenDetail()}
      role="button"
      tabIndex={0}
      title="Ver atendimentos no P90"
    >
      <div className="pct-metric-label">{label}</div>
      <table className="pct-tbl">
        <tbody>
          {rows.map((r) => (
            <tr key={r.tag}>
              <td className="pct-tbl-tag">{r.tag}</td>
              <td className="pct-tbl-value">{fmtMinSec(r.value)}</td>
              <td className="pct-tbl-goal">≤ {fmtMinSec(r.goal)}</td>
              <DeviationCell diff={r.value == null ? null : r.value - r.goal} />
            </tr>
          ))}
          <tr className="pct-tbl-extra">
            <td className="pct-tbl-tag">% +P90</td>
            <td className="pct-tbl-value">{pctAboveGoalP90 == null ? "—" : fmtPct0(pctAboveGoalP90)}%</td>
            <td className="pct-tbl-goal">≤ {TARGET_PCT_ABOVE_P90}%</td>
            <td className={`pct-tbl-dev ${pctCls}`}>{pctDiff == null ? "—" : `${fmtPctDelta1(pctDiff)}%p.p.`}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type Props = {
  name: string;
  tme: Stats;
  tma: Stats;
  tmr: Stats;
  goals: MetricGoals;
  pctAboveGoalP90: PctAboveGoalP90;
  onOpenMetric: (metric: "tme" | "tma" | "tmr") => void;
};

export default function PercentileDeptCard({ name, tme, tma, tmr, goals, pctAboveGoalP90, onOpenMetric }: Props) {
  return (
    <div className="pct-dept-card">
      <div className="pct-dept-head">
        <h2>{name}</h2>
        <span className="pct-dept-count">{tme.count} atendimento{tme.count === 1 ? "" : "s"}</span>
      </div>
      <div className="pct-dept-body">
        <MetricTable
          label="TME — tempo médio de espera"
          stats={tme}
          goals={goals.tme}
          pctAboveGoalP90={pctAboveGoalP90.tme}
          onOpenDetail={() => onOpenMetric("tme")}
        />
        <MetricTable
          label="TMA — tempo médio de atendimento"
          stats={tma}
          goals={goals.tma}
          pctAboveGoalP90={pctAboveGoalP90.tma}
          onOpenDetail={() => onOpenMetric("tma")}
        />
        <MetricTable
          label="TMR — tempo médio de resposta"
          stats={tmr}
          goals={goals.tmr}
          pctAboveGoalP90={pctAboveGoalP90.tmr}
          onOpenDetail={() => onOpenMetric("tmr")}
        />
      </div>
    </div>
  );
}
