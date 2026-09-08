"use client";

import { useState } from "react";
import { conversationUrl } from "@/lib/portal";

export type RecurrentClient = { userId: string; userName: string | null; count: number };

type Props = {
  title?: string;
  clients: RecurrentClient[];
  chatbotId: string | null;
};

const COLLAPSED_LIMIT = 5;
const EXPANDED_LIMIT = 15;

export default function TopRecurrentClients({ title = "Clientes recorrentes", clients, chatbotId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? clients.slice(0, EXPANDED_LIMIT) : clients.slice(0, COLLAPSED_LIMIT);
  const canExpand = clients.length > COLLAPSED_LIMIT;

  return (
    <div className="pct-dept-card">
      <div className="pct-dept-head">
        <h2>{title}</h2>
        <span className="pct-dept-count">top {visible.length}</span>
      </div>
      <div className="pct-dept-body">
        {clients.length === 0 ? (
          <div className="hint">Nenhum cliente com mais de uma solicitação neste período.</div>
        ) : (
          <>
            <div className="ranking-list">
              {visible.map((c, i) => (
                <div className="ranking-row" key={c.userId}>
                  <span className="ranking-rank">{i + 1}º</span>
                  <span className="ranking-label">{c.userName ?? "Cliente não identificado"}</span>
                  <span className="ranking-count">{c.count} solicitações</span>
                </div>
              ))}
            </div>
            {canExpand && (
              <button type="button" className="btn small ranking-toggle" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Mostrar menos" : `Ver top ${Math.min(EXPANDED_LIMIT, clients.length)}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
