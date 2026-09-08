"use client";

export type ReasonCount = { reason: string; count: number };

type Props = {
  title?: string;
  reasons: ReasonCount[];
};

export default function TopReasons({ title = "Motivos de atendimento", reasons }: Props) {
  const max = Math.max(1, ...reasons.map((r) => r.count));
  return (
    <div className="pct-dept-card">
      <div className="pct-dept-head">
        <h2>{title}</h2>
        <span className="pct-dept-count">top {reasons.length}</span>
      </div>
      <div className="pct-dept-body">
        {reasons.length === 0 ? (
          <div className="hint">Nenhum motivo informado neste período.</div>
        ) : (
          <div className="ranking-list">
            {reasons.map((r, i) => (
              <div className="ranking-row reason" key={r.reason}>
                <span className="ranking-rank">{i + 1}º</span>
                <div className="ranking-label-col">
                  <span className="ranking-label">{r.reason}</span>
                </div>
                <span className="ranking-count">{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
