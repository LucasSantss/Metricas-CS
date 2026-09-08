"use client";

import { fmtDuration } from "@/lib/format";

type Stats = { p50: number | null; p75: number | null; p90: number | null; count: number };
type GoalStats = { p50: number; p75: number; p90: number };
type MetricGoals = { tme: GoalStats; tma: GoalStats; tmr: GoalStats };

const SERIES: { key: "p50" | "p75" | "p90"; tag: string; color: string }[] = [
  { key: "p50", tag: "P50", color: "var(--accent)" },
  { key: "p75", tag: "P75", color: "var(--warn)" },
  { key: "p90", tag: "P90", color: "var(--bad)" },
];

function MetricBars({
  label,
  stats,
  goals,
  onOpenDetail,
}: {
  label: string;
  stats: Stats;
  goals: GoalStats;
  onOpenDetail: () => void;
}) {
  const max = Math.max(1, stats.p90 ?? stats.p75 ?? stats.p50 ?? 1, goals.p90);
  return (
    <button type="button" className="pct-metric-row" onClick={onOpenDetail} title="Ver atendimentos no P90">
      <div className="pct-metric-label">{label}</div>
      <div className="pct-metric-bars">
        {SERIES.map((s) => {
          const value = stats[s.key];
          const goal = goals[s.key];
          const width = value == null ? 0 : Math.max(2, (value / max) * 100);
          const goalMet = value == null ? null : value <= goal;
          return (
            <div className="pct-bar-line" key={s.key}>
              <span className="pct-bar-tag" style={{ color: s.color }}>
                {s.tag}
              </span>
              <div className="pct-bar-track">
                <div className="pct-bar-fill" style={{ width: `${width}%`, background: s.color }} />
                <div className="pct-bar-goal-mark" style={{ left: `${Math.min(100, (goal / max) * 100)}%` }} title={`Meta: ${fmtDuration(goal)}`} />
              </div>
              <span className={`pct-bar-value ${goalMet == null ? "" : goalMet ? "goal-ok" : "goal-bad"}`}>{fmtDuration(value)}</span>
              <span className="pct-bar-goal">meta {fmtDuration(goal)}</span>
            </div>
          );
        })}
      </div>
    </button>
  );
}

type Props = {
  name: string;
  tme: Stats;
  tma: Stats;
  tmr: Stats;
  goals: MetricGoals;
  onOpenMetric: (metric: "tme" | "tma" | "tmr") => void;
};

export default function PercentileDeptCard({ name, tme, tma, tmr, goals, onOpenMetric }: Props) {
  return (
    <div className="pct-dept-card">
      <div className="pct-dept-head">
        <h2>{name}</h2>
        <span className="pct-dept-count">{tme.count} atendimento{tme.count === 1 ? "" : "s"}</span>
      </div>
      <div className="pct-dept-body">
        <MetricBars label="TME — tempo médio de espera" stats={tme} goals={goals.tme} onOpenDetail={() => onOpenMetric("tme")} />
        <MetricBars label="TMA — tempo médio de atendimento" stats={tma} goals={goals.tma} onOpenDetail={() => onOpenMetric("tma")} />
        <MetricBars label="TMR — tempo médio de resposta" stats={tmr} goals={goals.tmr} onOpenDetail={() => onOpenMetric("tmr")} />
      </div>
    </div>
  );
}
