"use client";

import { useEffect } from "react";
import { fmtDuration } from "@/lib/format";
import { conversationUrl } from "@/lib/portal";

export type P90Entry = {
  protocol: string;
  valueSeconds: number;
  attendantName: string | null;
  userId: string | null;
  userName: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  metricLabel: string;
  deptName: string;
  entries: P90Entry[];
  chatbotId: string | null;
};

export default function PercentileDetailModal({ open, onClose, metricLabel, deptName, entries, chatbotId }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <b>
              {metricLabel} — P90 · {deptName}
            </b>
            <div className="hint" style={{ marginTop: 2 }}>
              {entries.length} conversa{entries.length === 1 ? "" : "s"}
            </div>
          </div>
          <button className="btn small" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="modal-body">
          {!chatbotId && (
            <div className="hint" style={{ marginBottom: 12 }}>
              Não foi possível identificar o id do chatbot (cbXXXXXXX) na URL configurada — o link direto da conversa fica indisponível.
            </div>
          )}
          {entries.length === 0 ? (
            <div className="hint">Nenhum atendimento no P90 deste período.</div>
          ) : (
            <div className="p90-list">
              {entries.map((e) => (
                <div className="p90-row" key={e.protocol}>
                  <div className="p90-row-main">
                    <span className="p90-user">{e.userName ?? "Cliente não identificado"}</span>
                    <span className="p90-attendant">{e.attendantName ?? "—"}</span>
                  </div>
                  <span className="p90-value">{fmtDuration(e.valueSeconds)}</span>
                  {chatbotId && e.userId ? (
                    <a className="btn small" href={conversationUrl(chatbotId, e.userId)} target="_blank" rel="noopener noreferrer">
                      Abrir conversa
                    </a>
                  ) : (
                    <span className="hint">sem cliente</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
