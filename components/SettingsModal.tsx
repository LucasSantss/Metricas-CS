"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export default function SettingsModal({ open, onClose, children }: Props) {
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
          <b>Ajustes</b>
          <button className="btn small" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="modal-body">
          {children}
          {/* crédito exigido pela licença gratuita dos ícones */}
          <div className="modal-credit">
            Ícones:{" "}
            <a href="https://www.flaticon.com/uicons" target="_blank" rel="noopener noreferrer">
              Uicons by Flaticon
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
