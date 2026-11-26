"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PRI, TICKET_URL, fmtHours, priLabel } from "@/lib/tickets";
import { KIND_LABEL, inSegment, type ResolvedResponse } from "@/lib/resolved";
import { CACHE_TTL, cachedJson, invalidateCached } from "@/lib/clientCache";

const PREVIEW = 20;
const fmtShort = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Seção do Relatório de tickets / KA: resumo da IA de cada ticket que foi para "Resolvido"
 * (resolvido, por inatividade ou cancelado) dentro da semana. Mesmos dados e resumos da tela
 * /resolvidos (lib/resolvedReport.ts), que o cron diário mantém atualizados.
 */
export default function ResolvedSummaries({ week, segment }: { week: string; segment: "all" | "ka" }) {
  const [data, setData] = useState<ResolvedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (w: string, force = false) => {
    setLoading(true);
    setErr("");
    try {
      const r = await cachedJson<ResolvedResponse & { error?: string }>(`/api/resolved?week=${w}`, CACHE_TTL.resolved, { force });
      if (!r.ok) throw new Error(r.data?.error ?? "Falha ao carregar os tickets resolvidos");
      setData(r.data);
    } catch (e) {
      setErr((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setShowAll(false);
    setNotice("");
    if (week) load(week);
  }, [week, load]);

  const rows = useMemo(() => (data && data.weekStart === week ? data.rows.filter((r) => inSegment(r, segment)) : []), [data, week, segment]);
  const missing = data ? rows.filter((r) => !data.summaries[r.id]).length : 0;

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
      if (g?.errors.length) setErr(`Alguns resumos não saíram: ${g.errors.join("; ")}`);
      else if (g) setNotice(g.summarized ? `${g.summarized} ticket(s) resumido(s) agora.` : "Nenhum resumo novo era necessário.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const list = showAll ? rows : rows.slice(0, PREVIEW);

  return (
    <section className="tk-panel">
      <div className="tk-panel-head">
        <h2>Resumos · tickets resolvidos na semana</h2>
        <span className="tk-panel-sub">
          {data ? `${rows.length} movido(s) para Resolvido na semana · resumo da IA por ticket` : "resumo da IA por ticket"}
          {data && missing > 0 && ` · ${missing} ainda sem resumo`}
        </span>
      </div>
      {err && <div className="tk-body"><p className="hint rp-ai-warn">{err}</p></div>}
      {notice && <div className="tk-body"><p className="hint">{notice}</p></div>}
      {loading ? (
        <div className="tk-body">
          <span className="hint">Carregando tickets resolvidos…</span>
        </div>
      ) : data ? (
        <>
          <div className="tk-scroll">
            <table className="tk-table rs-list">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Título e resumo da IA</th>
                  <th>Cliente</th>
                  <th>Prioridade</th>
                  <th>Resolvido em</th>
                  <th className="num">Tempo</th>
                  <th>Categoria</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const s = data.summaries[r.id];
                  return (
                    <tr key={r.id}>
                      <td>
                        <a className="tk-id" href={`${TICKET_URL}${encodeURIComponent(r.id)}`} target="_blank" rel="noopener noreferrer" title="Abrir ticket na SoftCS em nova guia">
                          {r.id}
                        </a>
                      </td>
                      <td className="rs-sum">
                        <div className="rs-title">{r.titulo}</div>
                        {s ? <div className="rs-ai">{s.resumo}</div> : <div className="rs-ai faint">Sem resumo da IA ainda.</div>}
                        {r.kind !== "resolvido" && <span className={`tk-badge ${r.kind === "cancelado" ? "open" : "res"}`}>{KIND_LABEL[r.kind]}</span>}
                      </td>
                      <td className="rs-wrap">{r.cliente}</td>
                      <td>
                        {r.pri === "—" ? (
                          <span className="faint">—</span>
                        ) : (
                          <span className="tk-tag">
                            <i className="tk-dot" style={{ background: PRI[r.pri].c }} />
                            {priLabel(r.pri)}
                          </span>
                        )}
                      </td>
                      <td className="mono">{fmtShort(r.r)}</td>
                      <td className="num">
                        {r.rtH == null ? (
                          <span className="faint" title="Resolução registrada só por atualização em lote: fora do tempo e do prazo">—</span>
                        ) : (
                          <span className={r.inSla === true ? "tk-ok" : r.inSla === false ? "tk-over" : ""}>{fmtHours(r.rtH)}</span>
                        )}
                      </td>
                      <td>{s ? <span className="rs-cat small">{s.categoria}</span> : <span className="faint">—</span>}</td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={7} className="faint">
                      Nenhum ticket foi movido para Resolvido nesta semana{segment === "ka" ? " entre os clientes KA" : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {(rows.length > PREVIEW || missing > 0) && (
            <div className="tk-body">
              <div className="page-header-actions">
                {rows.length > PREVIEW && (
                  <button type="button" className="btn rp-gen" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Mostrar menos" : `Mostrar todos (${rows.length})`}
                  </button>
                )}
                {missing > 0 && (
                  <button type="button" className="btn rp-gen" onClick={generate} disabled={generating} title="Resume só os tickets que ainda não têm resumo; o que já existe é reaproveitado">
                    {generating ? "Gerando resumos… (pode levar 1 a 2 min)" : `Gerar os ${missing} resumo(s) que faltam`}
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="tk-body">
            <span className="hint">
              Resolvido na semana = encerrado (resolvido, por inatividade ou cancelado) com a data de resolução nesta semana, mesma regra da tela{" "}
              <a href="/resolvidos">Resolvidos na semana</a>. Os resumos são atualizados automaticamente todo dia.
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
