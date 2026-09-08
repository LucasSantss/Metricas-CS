"use client";

import { useEffect, useState } from "react";
import type { ConfigResponse, DepartmentDto } from "@/lib/types";

type Props = {
  config: ConfigResponse | null;
  departments: DepartmentDto[];
  onConfigSaved: () => void;
  onDepartmentsChanged: () => void;
};

type DraftDept = DepartmentDto & {
  goalTmeMin: number;
  goalTmaMin: number;
  goalTmrMin: number;
  goalTmeP50Min: number;
  goalTmeP75Min: number;
  goalTmeP90Min: number;
  goalTmaP50Min: number;
  goalTmaP75Min: number;
  goalTmaP90Min: number;
  goalTmrP50Min: number;
  goalTmrP75Min: number;
  goalTmrP90Min: number;
};

function toDraft(d: DepartmentDto): DraftDept {
  return {
    ...d,
    goalTmeMin: d.goalTmeSeconds / 60,
    goalTmaMin: d.goalTmaSeconds / 60,
    goalTmrMin: d.goalTmrSeconds / 60,
    goalTmeP50Min: d.goalTmeP50Seconds / 60,
    goalTmeP75Min: d.goalTmeP75Seconds / 60,
    goalTmeP90Min: d.goalTmeP90Seconds / 60,
    goalTmaP50Min: d.goalTmaP50Seconds / 60,
    goalTmaP75Min: d.goalTmaP75Seconds / 60,
    goalTmaP90Min: d.goalTmaP90Seconds / 60,
    goalTmrP50Min: d.goalTmrP50Seconds / 60,
    goalTmrP75Min: d.goalTmrP75Seconds / 60,
    goalTmrP90Min: d.goalTmrP90Seconds / 60,
  };
}

export default function SettingsPanel({ config, departments, onConfigSaved, onDepartmentsChanged }: Props) {
  const [useBusinessHours, setUseBusinessHours] = useState(config?.useBusinessHours ?? false);
  const [getCurrent, setGetCurrent] = useState(config?.getCurrent ?? false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [drafts, setDrafts] = useState<DraftDept[]>(departments.map(toDraft));
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<{ departmentId: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [savedFlashId, setSavedFlashId] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [syncingAttendants, setSyncingAttendants] = useState(false);
  const [syncSummary, setSyncSummary] = useState<{ name: string; attendantCount: number }[] | null>(null);

  useEffect(() => setUseBusinessHours(config?.useBusinessHours ?? false), [config?.useBusinessHours]);
  useEffect(() => setGetCurrent(config?.getCurrent ?? false), [config?.getCurrent]);
  useEffect(() => setDrafts(departments.map(toDraft)), [departments]);

  async function saveConfig() {
    setSavingConfig(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useBusinessHours, getCurrent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      onConfigSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingConfig(false);
    }
  }

  async function saveDepartment(d: DraftDept) {
    setError(null);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: d.departmentId,
          name: d.name,
          active: d.active,
          sortOrder: d.sortOrder,
          goalTmeSeconds: Math.round(d.goalTmeMin * 60),
          goalTmaSeconds: Math.round(d.goalTmaMin * 60),
          goalTmrSeconds: Math.round(d.goalTmrMin * 60),
          goalCsat: d.goalCsat,
          goalTmeP50Seconds: Math.round(d.goalTmeP50Min * 60),
          goalTmeP75Seconds: Math.round(d.goalTmeP75Min * 60),
          goalTmeP90Seconds: Math.round(d.goalTmeP90Min * 60),
          goalTmaP50Seconds: Math.round(d.goalTmaP50Min * 60),
          goalTmaP75Seconds: Math.round(d.goalTmaP75Min * 60),
          goalTmaP90Seconds: Math.round(d.goalTmaP90Min * 60),
          goalTmrP50Seconds: Math.round(d.goalTmrP50Min * 60),
          goalTmrP75Seconds: Math.round(d.goalTmrP75Min * 60),
          goalTmrP90Seconds: Math.round(d.goalTmrP90Min * 60),
          attendantIds: d.attendantIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar setor");
      onDepartmentsChanged();
      setSavedFlashId(d.id);
      setTimeout(() => setSavedFlashId((cur) => (cur === d.id ? null : cur)), 1500);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function syncAttendants() {
    setSyncingAttendants(true);
    setError(null);
    setSyncSummary(null);
    try {
      const res = await fetch("/api/departments/sync-attendants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 60 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao sincronizar atendentes");
      setSyncSummary(json.results);
      onDepartmentsChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncingAttendants(false);
    }
  }

  async function removeDepartment(id: number) {
    setError(null);
    try {
      const res = await fetch(`/api/departments?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao remover setor");
      onDepartmentsChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function seedKnownDepartments() {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch("/api/departments/seed", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar setores padrão");
      onDepartmentsChanged();
      // já aproveita e busca os atendentes de cada setor no histórico de atendimentos
      await syncAttendants();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSeeding(false);
    }
  }

  async function discoverDepartments() {
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch("/api/departments/discover", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao detectar setores");
      setDiscovered(json.departments);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDiscovering(false);
    }
  }

  async function addDiscovered(d: { departmentId: string; name: string }) {
    await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId: d.departmentId, name: d.name, sortOrder: drafts.length }),
    });
    setDiscovered((arr) => arr.filter((x) => x.departmentId !== d.departmentId));
    onDepartmentsChanged();
    // busca os atendentes desse setor recém-adicionado (e dos demais) no histórico
    await syncAttendants();
  }

  return (
    <div className="settings-body">
      {error && <div className="error-box">{error}</div>}

      <section className="settings-section">
        <div className="settings-section-title">Opções</div>
        <div className="dept-toggle-list">
          <button
            type="button"
            className={`dept-toggle ${useBusinessHours ? "on" : "off"}`}
            aria-pressed={useBusinessHours}
            onClick={() => setUseBusinessHours((v) => !v)}
          >
            <span className="dept-toggle-check" />
            Considerar apenas horário comercial
          </button>
          <button
            type="button"
            className={`dept-toggle ${getCurrent ? "on" : "off"}`}
            aria-pressed={getCurrent}
            onClick={() => setGetCurrent((v) => !v)}
          >
            <span className="dept-toggle-check" />
            Incluir atendimentos em andamento
          </button>
          <div className="settings-row">
          <button className="btn primary" disabled={savingConfig} onClick={saveConfig}>
            {savingConfig ? "Salvando…" : "Salvar opções"}
          </button>
        </div>
        </div>
        
      </section>

      <section className="settings-section">
        <div className="settings-section-title">
          Setores acompanhados
          <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>
            {departments.filter((d) => d.active).length} de {departments.length} ativos
          </span>
        </div>

        <div className="dept-config-table">
        <div className="dept-config-head">
          <span></span>
          <span>Setor</span>
          <span>TME (min)</span>
          <span>TMA (min)</span>
          <span>TMR (min)</span>
          <span>CSAT</span>
          <span></span>
        </div>
        <div className="dept-list">
          {drafts.map((d, i) => (
            <div className="dept-config-row" key={d.id}>
              <label className="switch" title={d.active ? "Setor ativo — clique para ocultar" : "Setor oculto — clique para mostrar"}>
                <input
                  type="checkbox"
                  checked={d.active}
                  onChange={(e) => {
                    const active = e.target.checked;
                    setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, active } : x)));
                    saveDepartment({ ...d, active });
                  }}
                />
                <span className="switch-track" />
                <span className="switch-thumb" />
              </label>
              <input
                type="text"
                value={d.name}
                onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                onBlur={() => saveDepartment(d)}
                title={`departmentId: ${d.departmentId}`}
              />
              <input
                type="number"
                step="0.5"
                value={d.goalTmeMin}
                onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, goalTmeMin: Number(e.target.value) } : x)))}
                onBlur={() => saveDepartment(d)}
              />
              <input
                type="number"
                step="0.5"
                value={d.goalTmaMin}
                onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, goalTmaMin: Number(e.target.value) } : x)))}
                onBlur={() => saveDepartment(d)}
              />
              <input
                type="number"
                step="0.5"
                value={d.goalTmrMin}
                onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, goalTmrMin: Number(e.target.value) } : x)))}
                onBlur={() => saveDepartment(d)}
              />
              <input
                type="number"
                step="0.1"
                min="0"
                max="5"
                value={d.goalCsat}
                onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, goalCsat: Number(e.target.value) } : x)))}
                onBlur={() => saveDepartment(d)}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {savedFlashId === d.id && <span className="hint" style={{ color: "var(--good)" }}>Salvo ✓</span>}
                <button className="btn small" onClick={() => saveDepartment(d)}>Salvar</button>
                <button className="btn small danger" onClick={() => removeDepartment(d.id)}>Remover</button>
              </div>
            </div>
          ))}
          {drafts.length === 0 && <div className="hint">Nenhum setor cadastrado ainda.</div>}
        </div>
        </div>
        <div className="hint">
          A escolha de quais atendentes acompanhar fica no filtro "Atendente" da tela principal — é pessoal, salva só no
          seu navegador e não afeta o que os outros veem. Aqui embaixo você só atualiza a lista de atendentes conhecidos de cada setor.
        </div>

        <div className="settings-row">
          <button className="btn" disabled={seeding} onClick={seedKnownDepartments}>
            {seeding ? "Carregando…" : "Carregar os 6 setores acompanhados"}
          </button>
          <button className="btn" disabled={discovering} onClick={discoverDepartments}>
            {discovering ? "Buscando…" : "Carregar setores da API"}
          </button>
          <button className="btn" disabled={syncingAttendants} onClick={syncAttendants}>
            {syncingAttendants ? "Sincronizando…" : "Sincronizar atendentes (últimos 60 dias)"}
          </button>
        </div>
        {syncSummary && (
          <div className="hint">
            {syncSummary.map((r) => `${r.name}: ${r.attendantCount} atendente(s)`).join(" · ")}
          </div>
        )}

        {discovered.length > 0 && (
          <div>
            <div className="hint" style={{ marginBottom: 6 }}>Setores encontrados na API e ainda não cadastrados:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {discovered.map((d) => (
                <button key={d.departmentId} className="btn small" onClick={() => addDiscovered(d)}>
                  + {d.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">
          Metas de percentis (P50/P75/P90)
          <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>
            usadas nos painéis da tela "Percentis operacionais"
          </span>
        </div>
        <div className="hint" style={{ marginBottom: -4 }}>
          Tempo máximo aceitável em cada percentil, por setor. Valores acima da meta aparecem em vermelho nos painéis de percentis; dentro da meta, em verde.
        </div>

        {(
          [
            { title: "TME — tempo médio de espera", p50: "goalTmeP50Min", p75: "goalTmeP75Min", p90: "goalTmeP90Min" },
            { title: "TMA — tempo médio de atendimento", p50: "goalTmaP50Min", p75: "goalTmaP75Min", p90: "goalTmaP90Min" },
            { title: "TMR — tempo médio de resposta", p50: "goalTmrP50Min", p75: "goalTmrP75Min", p90: "goalTmrP90Min" },
          ] as const
        ).map((metric) => (
          <div key={metric.title} className="dept-config-table pct-goal-table">
            <div className="dept-config-head pct-goal-head">
              <span>{metric.title}</span>
              <span>P50 (min)</span>
              <span>P75 (min)</span>
              <span>P90 (min)</span>
              <span></span>
            </div>
            <div className="dept-list">
              {drafts.map((d, i) => (
                <div className="dept-config-row pct-goal-row" key={d.id}>
                  <span className="pct-goal-dept-name" title={`departmentId: ${d.departmentId}`}>
                    {d.name}
                  </span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={d[metric.p50]}
                    onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, [metric.p50]: Number(e.target.value) } : x)))}
                    onBlur={() => saveDepartment(d)}
                  />
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={d[metric.p75]}
                    onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, [metric.p75]: Number(e.target.value) } : x)))}
                    onBlur={() => saveDepartment(d)}
                  />
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={d[metric.p90]}
                    onChange={(e) => setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, [metric.p90]: Number(e.target.value) } : x)))}
                    onBlur={() => saveDepartment(d)}
                  />
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {savedFlashId === d.id && <span className="hint" style={{ color: "var(--good)" }}>Salvo ✓</span>}
                    <button className="btn small" onClick={() => saveDepartment(d)}>Salvar</button>
                  </div>
                </div>
              ))}
              {drafts.length === 0 && <div className="hint">Nenhum setor cadastrado ainda.</div>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
