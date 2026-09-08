"use client";

import { useState } from "react";

export type ReasonCount = { reason: string; count: number };

type Props = {
  title?: string;
  reasons: ReasonCount[];
};

const COLLAPSED_LIMIT = 5;
const EXPANDED_LIMIT = 15;

export default function TopReasons({ title = "Motivos de atendimento", reasons }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? reasons.slice(0, EXPANDED_LIMIT) : reasons.slice(0, COLLAPSED_LIMIT);
  const canExpand = reasons.length > COLLAPSED_LIMIT;

  return (
    <div className="pct-dept-card">
      <div className="pct-dept-head">
        <h2>{title}</h2>
        <span className="pct-dept-count">top {visible.length}</span>
      </div>
      <div className="pct-dept-body">
        {reasons.length === 0 ? (
          <div className="hint">Nenhum motivo informado neste período.</div>
        ) : (
          <>
            <div className="ranking-list">
              {visible.map((r, i) => (
                <div className="ranking-row reason" key={r.reason}>
                  <span className="ranking-rank">{i + 1}º</span>
                  <div className="ranking-label-col">
                    <span className="ranking-label">{r.reason}</span>
                  </div>
                  <span className="ranking-count">{r.count}</span>
                </div>
              ))}
            </div>
            {canExpand && (
              <button type="button" className="btn small ranking-toggle" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Mostrar menos" : `Ver top ${Math.min(EXPANDED_LIMIT, reasons.length)}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
