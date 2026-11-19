"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar from "./TopBar";
import SettingsModal from "./SettingsModal";
import SettingsPanel from "./SettingsPanel";
import type { ConfigResponse, DepartmentDto } from "@/lib/types";
import { PAGE_SIZE, PRI, PRI_KEYS, TICKET_URL, fmtHours, norm, pct, priLabel, type Pri } from "@/lib/tickets";
import {
  KA_NOTE,
  KIND_LABEL,
  byPriority,
  inSegment,
  plusDays,
  resolvedWeekText,
  segmentLabel,
  segmentOptions,
  totalsOf,
  weekStartBrt,
  type ResolvedKind,
  type ResolvedResponse,
  type ResolvedRow,
  type ResolvedTotals,
} from "@/lib/resolved";
import { CACHE_TTL, cachedJson, invalidateCached } from "@/lib/clientCache";

const WEEKS_BACK = 12;
const SEG_KEY = "resolvidos:segment";
const SEM_CATEGORIA = "Sem resumo ainda";

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtShort = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const readSeg = () => {
  try {
    return window.localStorage.getItem(SEG_KEY) || "all";
  } catch {
    return "all";
  }
};
const writeSeg = (v: string) => {
  try {
    window.localStorage.setItem(SEG_KEY, v);
  } catch {}
};

/** "+12% vs. semana anterior", colorido conforme o que é bom. */
function Delta({ cur, prev, goodWhenUp }: { cur: number | null; prev: number | null; goodWhenUp?: boolean }) {
  if (cur == null || prev == null || prev === 0) return null;
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return <span className="rp-delta flat">= semana anterior</span>;
  const up = d > 0;
  const cls = goodWhenUp == null ? "flat" : up === goodWhenUp ? "good" : "bad";
  return (
    <span className={`rp-delta ${cls}`}>
      {up ? "+" : "−"}
      {Math.round(Math.abs(d) * 100)}% vs. semana anterior
    </span>
  );
}

/** Diferença em pontos percentuais do "no prazo". */
function PrazoDelta({ cur, prev }: { cur: ResolvedTotals; prev: ResolvedTotals }) {
  if (!cur.prazoN || !prev.prazoN) return null;
  const pp = Math.round((cur.prazoOk / cur.prazoN - prev.prazoOk / prev.prazoN) * 100);
  if (pp === 0) return <span className="rp-delta flat">= semana anterior</span>;
  return (
    <span className={`rp-delta ${pp > 0 ? "good" : "bad"}`}>
      {pp > 0 ? "+" : "−"}
      {Math.abs(pp)} p.p. vs. semana anterior
    </span>
  );
}

function PriTag({ p }: { p: Pri }) {
  return (
    <span className="tk-tag">
      <i className="tk-dot" style={{ background: PRI[p].c }} />
      {priLabel(p)}
    </span>
  );
}

const ticketHref = (id: string) => `${TICKET_URL}${encodeURIComponent(id)}`;

function TicketLinks({ ids, byId, max = 15 }: { ids: string[]; byId: Map<string, ResolvedRow>; max?: number }) {
  if (!ids.length) return null;
  return (
    <div className="rp-ids">
      {ids.slice(0, max).map((id) => (
        <a key={id} className="tk-id" href={ticketHref(id)} target="_blank" rel="noopener noreferrer" title={byId.get(id) ? `${byId.get(id)!.titulo} · ${byId.get(id)!.cliente}` : "Abrir ticket"}>
          {id}
        </a>
      ))}
      {ids.length > max && <span className="hint">+{ids.length - max}</span>}
    </div>
  );
}

type Filters = { q: string; pri: string; agente: string; categoria: string; kind: string; prazo: string };
const EMPTY: Filters = { q: "", pri: "", agente: "", categoria: "", kind: "", prazo: "" };

export default function ResolvedView() {
  // Ajustes (mesma engrenagem das outras telas)
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadConfig = useCallback(async () => {
    setConfig((await cachedJson("/api/config", CACHE_TTL.config)).data);
  }, []);
  const loadDepartments = useCallback(async () => {
    setDepartments((await cachedJson("/api/departments", CACHE_TTL.config)).data?.departments ?? []);
  }, []);
  useEffect(() => {
    loadConfig();
    loadDepartments();
  }, [loadConfig, loadDepartments]);
  const configured = Boolean(config?.chatbotUrl && config?.hasToken);

  const [currentWeek, setCurrentWeek] = useState(() => weekStartBrt());
  const [week, setWeek] = useState(currentWeek);
  const [segment, setSegment] = useState("all");
  const [data, setData] = useState<ResolvedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [f, setF] = useState<Filters>(EMPTY);
  const [shown, setShown] = useState(PAGE_SIZE);

  useEffect(() => setSegment(readSeg()), []);

  const load = useCallback(async (w: string, force = false) => {
    setWeek(w);
    setErr("");
    setLoading(true);
    try {
      const r = await cachedJson<ResolvedResponse & { error?: string }>(`/api/resolved?week=${w}`, CACHE_TTL.resolved, { force });
      if (!r.ok) throw new Error(r.data?.error ?? "Falha ao carregar os tickets resolvidos");
      setData(r.data);
      setCurrentWeek(r.data.currentWeek);
    } catch (e) {
      setErr((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setGenerating(true);
    setErr("");
    setNotice("");
    try {
      const res = await fetch("/api/resolved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week, segment }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao gerar os resumos");
      invalidateCached("/api/resolved");
      setData(json);
      const g = (json as ResolvedResponse).generation;
      if (g) {
        const parts = [
          g.summarized ? `${g.summarized} ticket(s) resumido(s) agora` : "",
          g.reused ? `${g.reused} já tinham resumo e foram reaproveitados` : "",
          g.overview === "gerada" ? "visão geral atualizada" : g.overview === "reaproveitada" ? "visão geral mantida (nada mudou)" : "",
        ].filter(Boolean);
        setNotice(parts.length ? parts.join(" · ") + "." : "");
        if (g.errors.length) setErr(`Parte da geração falhou: ${g.errors.join("; ")}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const weeks = useMemo(() => Array.from({ length: WEEKS_BACK }, (_, i) => plusDays(currentWeek, -7 * i)), [currentWeek]);

  // recorte (Todos / KA / grupo): tudo abaixo é recalculado aqui, sem nova busca
  const segOptions = useMemo(() => (data ? segmentOptions([...data.rows, ...data.prevRows]) : ["all", "ka"]), [data]);
  const seg = segOptions.includes(segment) ? segment : "all";
  const rows = useMemo(() => (data ? data.rows.filter((r) => inSegment(r, seg)) : []), [data, seg]);
  const prevRows = useMemo(() => (data ? data.prevRows.filter((r) => inSegment(r, seg)) : []), [data, seg]);
  const cur = useMemo(() => totalsOf(rows), [rows]);
  const prev = useMemo(() => totalsOf(prevRows), [prevRows]);
  const pris = useMemo(() => byPriority(rows, prevRows), [rows, prevRows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const catOf = useCallback((id: string) => data?.summaries[id]?.categoria ?? SEM_CATEGORIA, [data]);
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(catOf(r.id), (m.get(catOf(r.id)) ?? 0) + 1);
    return [...m].sort((a, b) => (a[0] === SEM_CATEGORIA ? 1 : b[0] === SEM_CATEGORIA ? -1 : b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR")));
  }, [rows, catOf]);
  const agents = useMemo(() => [...new Set(rows.map((r) => r.agente))].sort((a, b) => a.localeCompare(b, "pt-BR")), [rows]);
  const withSummary = rows.filter((r) => data?.summaries[r.id]).length;
  const overview = data?.overviews[seg];

  const list = useMemo(() => {
    const q = norm(f.q);
    return rows.filter((r) => {
      if (f.pri && r.pri !== f.pri) return false;
      if (f.agente && r.agente !== f.agente) return false;
      if (f.categoria && catOf(r.id) !== f.categoria) return false;
      if (f.kind && r.kind !== f.kind) return false;
      if (f.prazo === "ok" && r.inSla !== true) return false;
      if (f.prazo === "fora" && r.inSla !== false) return false;
      if (f.prazo === "sem" && r.inSla !== null) return false;
      if (q && !norm([r.id, r.titulo, r.cliente, data?.summaries[r.id]?.resumo ?? ""].join(" ")).includes(q)) return false;
      return true;
    });
  }, [rows, f, catOf, data]);

  const patch = (p: Partial<Filters>) => {
    setF((x) => ({ ...x, ...p }));
    setShown(PAGE_SIZE);
  };
  const filtersOn = Object.values(f).some(Boolean);

  return (
    <>
      <TopBar breadcrumb="Relatórios / Suporte" title="Resolvidos na semana" configured={configured} onOpenSettings={() => setSettingsOpen(true)} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel config={config} departments={departments} onConfigSaved={loadConfig} onDepartmentsChanged={loadDepartments} initialTab="tickets" />
      </SettingsModal>

      <div className="wrap tk">
        <header>
          <div className="page-header-row">
            <h1>Tickets resolvidos na semana</h1>
            <div className="page-header-actions">
              <div className="field">
                <label>Semana (seg a dom)</label>
                <select value={week} onChange={(e) => load(e.target.value)} disabled={generating}>
                  {weeks.map((w) => (
                    <option key={w} value={w}>
                      {resolvedWeekText(w)}
                      {w === currentWeek ? " (em andamento)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Recorte</label>
                <select
                  value={seg}
                  onChange={(e) => {
                    setSegment(e.target.value);
                    writeSeg(e.target.value);
                    patch(EMPTY);
                  }}
                  disabled={generating}
                >
                  {segOptions.map((s) => (
                    <option key={s} value={s}>
                      {segmentLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn rp-gen" onClick={() => load(week, true)} disabled={generating || loading} title="Busca de novo os tickets no SoftCS Bot">
                Atualizar
              </button>
              <button
                className="btn primary rp-gen"
                onClick={generate}
                disabled={generating || loading || !data}
                title="Resume os tickets deste recorte que ainda não têm resumo e atualiza a visão geral. O que não mudou é reaproveitado."
              >
                {generating ? "Gerando… (pode levar 1 a 2 min)" : "Gerar resumos agora"}
              </button>
            </div>
          </div>
          <div className="subtitle">
            {data ? `Dados de ${fmtWhen(data.snapshotAt ?? data.fetchedAt)}` : "Números ao vivo do SoftCS Bot"} · resumos da IA atualizados automaticamente todo dia às
            10h
            {seg === "ka" && ` · só ${KA_NOTE}`}
          </div>
        </header>

        {err && <div className="error-box">{err}</div>}
        {loading && <div className="loading">Carregando tickets resolvidos…</div>}
        {!loading && data?.partial && (
          <div className="callout warn">
            <span className="dot" />
            <span className="body">
              <b>Semana em andamento:</b> os números vão até agora e mudam conforme novos tickets são resolvidos.
            </span>
          </div>
        )}
        {!loading && notice && (
          <div className="callout good">
            <span className="dot" />
            <span className="body">{notice}</span>
          </div>
        )}

        {!loading && data && (
          <>
            {/* NÚMEROS (código) */}
            <section className="tk-kpis rp-kpis rs-kpis" aria-label="Indicadores da semana">
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Resolvidos na semana</div>
                <div className="tk-kpi-value">{cur.n}</div>
                <div className="tk-kpi-sub">
                  antes {prev.n} · <Delta cur={cur.n} prev={prev.n} goodWhenUp />
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Resolvidos no prazo</div>
                <div className="tk-kpi-value">{pct(cur.prazoOk, cur.prazoN)}</div>
                <div className="tk-kpi-sub">
                  {cur.prazoOk} de {cur.prazoN} com meta · antes {pct(prev.prazoOk, prev.prazoN)} · <PrazoDelta cur={cur} prev={prev} />
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Tempo de resolução (mediana)</div>
                <div className="tk-kpi-value">{fmtHours(cur.rtMedianH)}</div>
                <div className="tk-kpi-sub">
                  média {fmtHours(cur.rtMeanH)} · antes {fmtHours(prev.rtMedianH)} · <Delta cur={cur.rtMedianH} prev={prev.rtMedianH} goodWhenUp={false} />
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Por inatividade</div>
                <div className="tk-kpi-value">{cur.inatividade}</div>
                <div className="tk-kpi-sub">
                  {pct(cur.inatividade, cur.n)} dos resolvidos · antes {prev.inatividade}
                  {cur.cancelado ? ` · ${cur.cancelado} cancelado(s)` : ""}
                </div>
              </div>
            </section>

            {/* VISÃO GERAL (IA) */}
            <section className="tk-panel">
              <div className="tk-panel-head">
                <h2>Visão geral da semana · {segmentLabel(seg)}</h2>
                <span className="tk-panel-sub">
                  {overview?.ai ? `escrita por IA em ${fmtWhen(overview.generatedAt)} · confira antes de repassar` : "sem texto de IA"}
                </span>
              </div>
              <div className="tk-body">
                {overview?.aiError && <p className="hint rp-ai-warn">{overview.aiError}</p>}
                {overview?.ai && overview.ticketCount !== rows.length && (
                  <p className="hint rp-ai-warn">
                    O texto considera {overview.ticketCount} ticket(s); hoje são {rows.length} resolvidos neste recorte. Clique em &quot;Gerar resumos agora&quot; para atualizar.
                  </p>
                )}
                {overview?.ai ? (
                  overview.ai.visaoGeral
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((p, i) => (
                      <p key={i} className="rp-par">
                        {p}
                      </p>
                    ))
                ) : (
                  <p className="hint">
                    {rows.length
                      ? 'A visão geral deste recorte ainda não foi gerada. Ela sai todo dia às 10h; para gerar agora, clique em "Gerar resumos agora".'
                      : "Nenhum ticket resolvido nesta semana neste recorte."}
                  </p>
                )}
              </div>
            </section>

            {overview?.ai && overview.ai.temas.length > 0 && (
              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Principais temas resolvidos</h2>
                  <span className="tk-panel-sub">agrupados pela IA a partir dos resumos</span>
                </div>
                <div className="tk-body rp-themes">
                  {overview.ai.temas.map((t, i) => (
                    <div className="rp-theme" key={i}>
                      <div className="rp-theme-head">
                        <b>{t.titulo}</b>
                        <span className="hint">{t.ticketIds.length} ticket(s)</span>
                      </div>
                      <p className="rp-par">{t.descricao}</p>
                      <TicketLinks ids={t.ticketIds} byId={byId} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="tk-grid2">
              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Por prioridade</h2>
                  <span className="tk-panel-sub">
                    metas: {(["P0", "P1", "P2", "P3"] as const).map((p) => `${p} ${fmtHours(data.metas[p])}`).join(", ")}
                  </span>
                </div>
                <div className="tk-scroll">
                  <table className="tk-table">
                    <thead>
                      <tr>
                        <th>Prioridade</th>
                        <th className="num">Resolvidos</th>
                        <th className="num">Semana anterior</th>
                        <th className="num">Tempo mediano</th>
                        <th className="num">Tempo médio</th>
                        <th className="num">No prazo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pris.map((p) => (
                        <tr key={p.pri}>
                          <td>
                            <button type="button" className="tk-kpi-link rs-plain" onClick={() => patch({ pri: f.pri === p.pri ? "" : p.pri })} title="Filtrar a lista por esta prioridade">
                              <PriTag p={p.pri} />
                            </button>
                          </td>
                          <td className="num">{p.n}</td>
                          <td className="num">{p.prevN}</td>
                          <td className="num">{fmtHours(p.rtMedianH)}</td>
                          <td className="num">{fmtHours(p.rtMeanH)}</td>
                          <td className="num">{p.prazoN ? `${pct(p.prazoOk, p.prazoN)} (${p.prazoOk}/${p.prazoN})` : "—"}</td>
                        </tr>
                      ))}
                      {!pris.length && (
                        <tr>
                          <td colSpan={6} className="faint">
                            Nenhum ticket resolvido.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Por categoria</h2>
                  <span className="tk-panel-sub">
                    categoria da IA · {withSummary} de {rows.length} com resumo
                  </span>
                </div>
                <div className="tk-body rs-cats">
                  {categories.length ? (
                    categories.map(([c, n]) => (
                      <button
                        type="button"
                        key={c}
                        className={`rs-cat ${f.categoria === c ? "on" : ""} ${c === SEM_CATEGORIA ? "none" : ""}`}
                        onClick={() => patch({ categoria: f.categoria === c ? "" : c })}
                        title="Filtrar a lista por esta categoria"
                      >
                        <span>{c}</span>
                        <b>{n}</b>
                      </button>
                    ))
                  ) : (
                    <span className="hint">Nenhum ticket resolvido.</span>
                  )}
                </div>
              </section>
            </div>

            {/* LISTA */}
            <section className="tk-panel">
              <div className="tk-panel-head">
                <h2>Tickets resolvidos</h2>
                <span className="tk-panel-sub">
                  {list.length === rows.length ? `${rows.length} tickets` : `${list.length} de ${rows.length} tickets`} · clique no número para abrir na SoftCS
                </span>
              </div>
              <div className="tk-body rs-filters">
                <div className="field grow">
                  <label>Buscar</label>
                  <input type="text" placeholder="ID, título, cliente ou resumo" value={f.q} onChange={(e) => patch({ q: e.target.value })} />
                </div>
                <div className="field">
                  <label>Prioridade</label>
                  <select value={f.pri} onChange={(e) => patch({ pri: e.target.value })}>
                    <option value="">Todas</option>
                    {PRI_KEYS.map((p) => (
                      <option key={p} value={p}>
                        {priLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Agente</label>
                  <select value={f.agente} onChange={(e) => patch({ agente: e.target.value })}>
                    <option value="">Todos</option>
                    {agents.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Categoria</label>
                  <select value={f.categoria} onChange={(e) => patch({ categoria: e.target.value })}>
                    <option value="">Todas</option>
                    {categories.map(([c]) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Situação</label>
                  <select value={f.kind} onChange={(e) => patch({ kind: e.target.value })}>
                    <option value="">Todas</option>
                    {(Object.keys(KIND_LABEL) as ResolvedKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Prazo</label>
                  <select value={f.prazo} onChange={(e) => patch({ prazo: e.target.value })}>
                    <option value="">Todos</option>
                    <option value="ok">No prazo</option>
                    <option value="fora">Fora do prazo</option>
                    <option value="sem">Sem meta / sem tempo</option>
                  </select>
                </div>
                {filtersOn && (
                  <button type="button" className="btn rp-gen" onClick={() => patch(EMPTY)}>
                    Limpar filtros
                  </button>
                )}
              </div>
              <div className="tk-scroll">
                <table className="tk-table rs-list">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Título e resumo da IA</th>
                      <th>Cliente</th>
                      <th>Prioridade</th>
                      <th>Agente</th>
                      <th>Resolvido em</th>
                      <th className="num">Tempo</th>
                      <th>Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.slice(0, shown).map((r) => {
                      const s = data.summaries[r.id];
                      return (
                        <tr key={r.id}>
                          <td>
                            <a className="tk-id" href={ticketHref(r.id)} target="_blank" rel="noopener noreferrer" title="Abrir ticket na SoftCS em nova guia">
                              {r.id}
                            </a>
                          </td>
                          <td className="rs-sum">
                            <div className="rs-title">{r.titulo}</div>
                            {s ? <div className="rs-ai">{s.resumo}</div> : <div className="rs-ai faint">Sem resumo da IA ainda.</div>}
                            {r.kind !== "resolvido" && <span className={`tk-badge ${r.kind === "cancelado" ? "open" : "res"}`}>{KIND_LABEL[r.kind]}</span>}
                          </td>
                          <td className="rs-wrap">{r.cliente}</td>
                          <td>{r.pri === "—" ? <span className="faint">—</span> : <PriTag p={r.pri} />}</td>
                          <td className="rs-wrap">{r.agente}</td>
                          <td className="mono">{fmtShort(r.r)}</td>
                          <td className="num">
                            {r.rtH == null ? (
                              <span className="faint" title="Resolução registrada só por atualização em lote: fora do tempo e do prazo">
                                —
                              </span>
                            ) : (
                              <span
                                className={r.inSla === true ? "tk-ok" : r.inSla === false ? "tk-over" : ""}
                                title={r.meta != null ? `Meta da prioridade ${r.pri}: ${fmtHours(r.meta)}${r.inSla ? " · no prazo" : " · fora do prazo"}` : "Sem meta (sem prioridade)"}
                              >
                                {fmtHours(r.rtH)}
                              </span>
                            )}
                          </td>
                          <td>
                            {s ? (
                              <button type="button" className="rs-cat small" onClick={() => patch({ categoria: s.categoria })} title="Filtrar por esta categoria">
                                {s.categoria}
                              </button>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!list.length && (
                      <tr>
                        <td colSpan={8} className="faint">
                          {rows.length ? "Nenhum ticket com esses filtros." : "Nenhum ticket resolvido nesta semana neste recorte."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {list.length > shown && (
                <div className="tk-body">
                  <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Mostrar mais {Math.min(PAGE_SIZE, list.length - shown)} de {list.length - shown}
                  </button>
                </div>
              )}
            </section>

            <div className="note-inline tk-note rp-foot">
              Semana de segunda 00:00 a domingo 23:59 (horário de Brasília). Entram os tickets encerrados hoje (resolvidos, resolvidos por inatividade ou
              cancelados) cuja resolução caiu na semana. Data de resolução = data de encerramento da SoftCS (e não o &quot;Atualizado em&quot;, que muda quando
              alguém mexe num ticket já fechado); sem ela, vale o &quot;Atualizado em&quot;, e se ele veio de atualização em lote o ticket fica fora do tempo e
              do prazo. Tempo = da criação à resolução;
              no prazo = dentro da meta da prioridade (Ajustes &gt; Tickets). A IA recebe os clientes anonimizados, não recebe nomes de agentes e só vê título,
              descrição, etapa e situação: comentários dos tickets ainda não vêm da SoftCS, então o resumo descreve a demanda e o desfecho, não o passo a passo da
              solução.
            </div>
          </>
        )}
      </div>
    </>
  );
}
