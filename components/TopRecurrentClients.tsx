"use client";

import { conversationUrl } from "@/lib/portal";

export type RecurrentClient = { userId: string; userName: string | null; count: number };

type Props = {
  title?: string;
  clients: RecurrentClient[];
  chatbotId: string | null;
};

export default function TopRecurrentClients({ title = "Clientes recorrentes", clients, chatbotId }: Props) {
  return (
    <div className="pct-dept-card">
      <div className="pct-dept-head">
        <h2>{title}</h2>
        <span className="pct-dept-count">top {clients.length}</span>
      </div>
      <div className="pct-dept-body">
        {clients.length === 0 ? (
          <div className="hint">Nenhum cliente com mais de uma solicitação neste período.</div>
        ) : (
          <div className="ranking-list">
            {clients.map((c, i) => (
              <div className="ranking-row" key={c.userId}>
                <span className="ranking-rank">{i + 1}º</span>
                <span className="ranking-label">{c.userName ?? "Cliente não identificado"}</span>
                <span className="ranking-count">{c.count} solicitações</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
