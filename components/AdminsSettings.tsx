"use client";

import { useCallback, useEffect, useState } from "react";
import { invalidateCached } from "@/lib/clientCache";

type Admin = { email: string; addedBy: string | null; createdAt: string | null; fixed: boolean };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");

// Ajustes > Administradores: quem vê a aba Conversas e os Ajustes (lib/admin.ts).
// O administrador principal é fixo e não pode ser removido.
export default function AdminsSettings() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admins");
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Falha ao carregar administradores");
    setAdmins(j.admins);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const changed = async () => {
    invalidateCached("/api/me");
    await load();
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falha ao adicionar");
      setEmail("");
      await changed();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Admin) {
    if (!confirm(`Remover ${a.email} dos administradores?`)) return;
    setError(null);
    const r = await fetch(`/api/admins?email=${encodeURIComponent(a.email)}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Falha ao remover");
    await changed();
  }

  return (
    <section className="settings-section">
      <div className="settings-section-title">
        Administradores
        <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>
          veem a aba Conversas e os Ajustes
        </span>
      </div>
      <div className="hint">
        Os demais usuários @chatbotmaker.io continuam vendo o Termômetro, Percentis, Painel e Relatório de tickets. A mudança vale no próximo
        carregamento da página de quem foi adicionado ou removido.
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="dept-config-table">
        <div className="dept-list">
          {admins.map((a) => (
            <div className="dept-config-row admin-row" key={a.email}>
              <span className="pct-goal-dept-name">{a.email}</span>
              <span className="hint">
                {a.fixed ? "administrador principal" : `adicionado${a.addedBy ? ` por ${a.addedBy}` : ""} em ${fmtDate(a.createdAt)}`}
              </span>
              {a.fixed ? (
                <span />
              ) : (
                <button className="btn small danger" onClick={() => remove(a)}>
                  Remover
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <form className="settings-row" onSubmit={add}>
        <div className="field grow">
          <label>Novo administrador</label>
          <input type="text" placeholder="nome@chatbotmaker.io" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Adicionando…" : "Adicionar"}
        </button>
      </form>
    </section>
  );
}
