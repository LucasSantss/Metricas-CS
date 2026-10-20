"use client";

import { useCallback, useEffect, useState } from "react";
import TopBar from "./TopBar";
import SettingsModal from "./SettingsModal";
import SettingsPanel from "./SettingsPanel";
import type { ConfigResponse, DepartmentDto } from "@/lib/types";
import type { ReportAi, ReportData, ReportTheme, WeekTotals } from "@/lib/ticketReport";

// Mesmo valor de REPORT_VERSION em lib/ticketReport.ts (que não pode ser importado aqui: roda só no servidor).
const REPORT_VERSION = 2;
import { PRI, TICKET_URL, fmtHours, pct, priLabel } from "@/lib/tickets";

type Report = { weekStart: string; generatedAt: string; data: ReportData; ai: ReportAi | null; aiError: string | null; model: string | null };
type ListItem = { weekStart: string; generatedAt: string; hasAi: boolean };

const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 864e5).toISOString().slice(0, 10);
};
const weekText = (ymd: string) => `${ddmmyyyy(ymd)} a ${ddmmyyyy(plusDays(ymd, 6))}`;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "+12%" / "−5%" / "=" comparando com a semana anterior. */
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

function TicketLinks({ ids, data, max = 12 }: { ids: string[]; data: ReportData; max?: number }) {
  if (!ids.length) return null;
  return (
    <div className="rp-ids">
      {ids.slice(0, max).map((id) => (
        <a
          key={id}
          className="tk-id"
          href={`${TICKET_URL}${encodeURIComponent(id)}`}
          target="_blank"
          rel="noopener noreferrer"
          title={data.tickets[id] ? `${data.tickets[id].titulo} · ${data.tickets[id].cliente} · ${data.tickets[id].situacao}` : "Abrir ticket"}
        >
          {id}
        </a>
      ))}
      {ids.length > max && <span className="hint">+{ids.length - max}</span>}
    </div>
  );
}

const prazoPct = (t: WeekTotals) => (t.prazoN ? t.prazoOk / t.prazoN : null);

function ThemesPanel({ title, sub, themes, data, empty, note }: { title: string; sub: string; themes: ReportTheme[]; data: ReportData; empty?: string; note?: string }) {
  return (
    <section className="tk-panel">
      <div className="tk-panel-head">
        <h2>{title}</h2>
        <span className="tk-panel-sub">{sub}</span>
      </div>
      <div className="tk-body rp-themes">
        {themes.length ? (
          themes.map((t, i) => (
            <div className="rp-theme" key={i}>
              <div className="rp-theme-head">
                <b>{t.titulo}</b>
                <span className={`rp-impact ${t.impacto}`}>impacto {t.impacto === "medio" ? "médio" : t.impacto}</span>
                <span className="hint">{t.ticketIds.length} ticket(s)</span>
              </div>
              <p className="rp-par">{t.descricao}</p>
              <TicketLinks ids={t.ticketIds} data={data} />
            </div>
          ))
        ) : (
          <span className="hint">{empty}</span>
        )}
        {note && <span className="hint">{note}</span>}
      </div>
    </section>
  );
}

export default function TicketReportView() {
  // Ajustes (mesma engrenagem das outras telas)
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadConfig = useCallback(async () => {
    const res = await fetch("/api/config");
    setConfig(await res.json());
  }, []);
  const loadDepartments = useCallback(async () => {
    const res = await fetch("/api/departments");
    const json = await res.json();
    setDepartments(json.departments ?? []);
  }, []);
  useEffect(() => {
    loadConfig();
    loadDepartments();
  }, [loadConfig, loadDepartments]);
  const configured = Boolean(config?.chatbotUrl && config?.hasToken);

  const [list, setList] = useState<ListItem[]>([]);
  const [lastWeek, setLastWeek] = useState("");
  const [currentWeek, setCurrentWeek] = useState("");
  const [week, setWeek] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    const res = await fetch("/api/ticket-reports", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Falha ao listar relatórios");
    setList(json.reports);
    setLastWeek(json.lastCompleteWeek);
    setCurrentWeek(json.currentWeek);
    return json as { reports: ListItem[]; lastCompleteWeek: string; currentWeek: string };
  }, []);

  const loadReport = useCallback(async (w: string) => {
    setWeek(w);
    setErr("");
    setNotice("");
    setLoading(true);
    try {
      const res = await fetch(`/api/ticket-reports?week=${w}`, { cache: "no-store" });
      const json = await res.json();
      if (res.status === 404) setReport(null);
      else if (!res.ok) throw new Error(json.error ?? "Falha ao carregar o relatório");
      else setReport(json);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList()
      .then((l) => loadReport(l.reports[0]?.weekStart ?? l.lastCompleteWeek))
      .catch((e) => {
        setErr(e.message);
        setLoading(false);
      });
  }, [loadList, loadReport]);

  // Gera na hora do clique, independente do cron de segunda (que gera a semana completa por cima depois).
  async function generate(w: string) {
    setGenerating(true);
    setErr("");
    setNotice("");
    setWeek(w);
    try {
      const res = await fetch("/api/ticket-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: w }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao gerar o relatório");
      setReport(json);
      setNotice(
        json.notice ??
          (json.aiReused && !json.aiError ? "Os tickets da semana não mudaram desde a última geração: os números foram recalculados e o texto da IA foi reaproveitado, sem nova consulta." : "")
      );
      await loadList();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // semanas no seletor: as geradas + a última semana completa, mesmo que ainda não exista
  const weeks = [...new Set([currentWeek, lastWeek, ...list.map((l) => l.weekStart), week].filter(Boolean))].sort().reverse();
  // relatório salvo antes da regra "só o que aconteceu na semana" (sem v) não é exibido
  const isCurrentFormat = report?.data?.v === REPORT_VERSION;
  const d = isCurrentFormat ? report!.data : undefined;
  const ai = isCurrentFormat ? report!.ai : undefined;

  return (
    <>
      <TopBar breadcrumb="Relatórios / Suporte" title="Relatório de tickets" configured={configured} onOpenSettings={() => setSettingsOpen(true)} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel config={config} departments={departments} onConfigSaved={loadConfig} onDepartmentsChanged={loadDepartments} initialTab="tickets" />
      </SettingsModal>

      <div className="wrap tk">
        <header>
          <div className="page-header-row">
            <h1>Relatório de tickets</h1>
            <div className="page-header-actions">
              <div className="field">
                <label>Semana (seg a dom)</label>
                <select value={week} onChange={(e) => loadReport(e.target.value)} disabled={generating}>
                  {weeks.map((w) => (
                    <option key={w} value={w}>
                      {weekText(w)}
                      {w === currentWeek ? " (em andamento)" : ""}
                      {list.some((l) => l.weekStart === w) ? "" : " (não gerado)"}
                    </option>
                  ))}
                </select>
              </div>
              {week && week !== currentWeek && (
                <button className="btn rp-gen" onClick={() => generate(week)} disabled={generating || loading}>
                  {report ? "Gerar novamente esta semana" : "Gerar esta semana"}
                </button>
              )}
              {currentWeek && (
                <button
                  className="btn primary rp-gen"
                  onClick={() => generate(currentWeek)}
                  disabled={generating || loading}
                  title="Gera agora o relatório da semana atual, com os dados até este momento"
                >
                  {generating ? "Gerando… (pode levar 1 a 2 min)" : "Gerar agora"}
                </button>
              )}
            </div>
          </div>
          <div className="subtitle">
            {report
              ? `Gerado em ${fmtWhen(report.generatedAt)}`
              : "Gerado automaticamente toda segunda-feira às 9h com a semana anterior"}
          </div>
        </header>

        {err && <div className="error-box">{err}</div>}
        {loading && <div className="loading">Carregando relatório…</div>}
        {!loading && report?.data.partial && (
          <div className="callout warn">
            <span className="dot" />
            <span className="body">
              <b>Relatório parcial:</b> a semana ainda não terminou, os números vão até {fmtWhen(report.generatedAt)}. Na segunda às 8h o relatório
              completo desta semana é gerado automaticamente e substitui este.
            </span>
          </div>
        )}

        {!loading && !report && !err && (
          <div className="tk-panel">
            <div className="tk-body">
              <p className="hint">
                O relatório da semana {week && weekText(week)} ainda não foi gerado. Ele é gerado sozinho toda segunda às 8h; para gerar agora, clique
                em {week === currentWeek ? <>&quot;Gerar agora&quot; (sai parcial, com os dados até o momento)</> : <>&quot;Gerar esta semana&quot;</>}.
              </p>
            </div>
          </div>
        )}

        {!loading && report && !isCurrentFormat && (
          <div className="tk-panel">
            <div className="tk-body">
              <p className="hint">
                Este relatório foi salvo num formato antigo, que contava tickets fora da semana. Clique em &quot;Gerar novamente esta semana&quot; para
                refazê-lo só com os tickets criados e movimentados na semana.
              </p>
            </div>
          </div>
        )}

        {!loading && d && (
          <>
            {notice && (
              <div className="callout good">
                <span className="dot" />
                <span className="body">{notice}</span>
              </div>
            )}
            {/* NÚMEROS (código) */}
            <section className="tk-kpis rp-kpis" aria-label="Indicadores da semana">
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Criados</div>
                <div className="tk-kpi-value">{d.cur.created}</div>
                <div className="tk-kpi-sub">
                  <Delta cur={d.cur.created} prev={d.prev.created} />
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Resolvidos (dos criados)</div>
                <div className="tk-kpi-value">{d.cur.createdResolved}</div>
                <div className="tk-kpi-sub">
                  {pct(d.cur.createdResolved, d.cur.created)} dos criados · {d.cur.createdInat} por inatividade
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">SLA médio (dos criados)</div>
                <div className="tk-kpi-value">{fmtHours(d.cur.slaMeanH)}</div>
                <div className="tk-kpi-sub">
                  mediana {fmtHours(d.cur.slaMedianH)} · <Delta cur={d.cur.slaMeanH} prev={d.prev.slaMeanH} goodWhenUp={false} />
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Resolvidos no prazo</div>
                <div className="tk-kpi-value">{pct(d.cur.prazoOk, d.cur.prazoN)}</div>
                <div className="tk-kpi-sub">
                  {d.cur.prazoOk} de {d.cur.prazoN} · antes {pct(d.prev.prazoOk, d.prev.prazoN)}
                  {prazoPct(d.prev) != null && prazoPct(d.cur) != null && (
                    <span className={prazoPct(d.cur)! >= prazoPct(d.prev)! ? "rp-delta good" : "rp-delta bad"}> {prazoPct(d.cur)! >= prazoPct(d.prev)! ? "▲" : "▼"}</span>
                  )}
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Movimentados</div>
                <div className="tk-kpi-value">{d.cur.moved}</div>
                <div className="tk-kpi-sub">
                  criados antes · {d.cur.movedResolved} resolvidos, {d.cur.movedOpen} em aberto
                </div>
              </div>
              <div className="tk-kpi rp-static">
                <div className="tk-kpi-label">Em aberto (da semana)</div>
                <div className="tk-kpi-value">{d.scopeOpen}</div>
                <div className="tk-kpi-sub">
                  {d.cur.createdOpen} criados + {d.cur.movedOpen} movimentados · {d.scopeLate} com SLA estourado
                </div>
              </div>
            </section>

            {/* TEXTO (IA) */}
            <section className="tk-panel">
              <div className="tk-panel-head">
                <h2>Resumo da semana</h2>
                <span className="tk-panel-sub">{ai ? "escrito por IA a partir dos números abaixo · confira antes de repassar" : "sem texto de IA"}</span>
              </div>
              <div className="tk-body">
                {ai && report?.aiError && <p className="hint rp-ai-warn">{report.aiError}</p>}
                {ai ? (
                  ai.resumo.split(/\n{2,}|\n/).filter(Boolean).map((p, i) => (
                    <p key={i} className="rp-par">
                      {p}
                    </p>
                  ))
                ) : (
                  <p className="hint">
                    {report?.aiError ?? "O texto não foi gerado."} Os números abaixo estão completos; use &quot;Gerar novamente&quot; para tentar o texto de novo.
                  </p>
                )}
              </div>
            </section>

            {ai && !ai.temasCriados && ai.temas && ai.temas.length > 0 && (
              // relatório salvo antes da divisão criados/movimentados
              <ThemesPanel title="Principais temas" sub="agrupados pela IA a partir de títulos e descrições" themes={ai.temas} data={d} />
            )}

            {ai?.temasCriados && (
              <ThemesPanel
                title="Principais temas · tickets criados na semana"
                sub={`${d.cur.created} criados · agrupados pela IA a partir de títulos e descrições`}
                themes={ai.temasCriados}
                data={d}
                empty="Nenhum tema identificado entre os tickets criados na semana."
              />
            )}

            {ai?.temasMovimentados && (
              <ThemesPanel
                title="Principais temas · tickets movimentados na semana"
                sub={`${d.cur.moved} movimentados (criados antes) · com base em título, descrição e situação atual`}
                themes={ai.temasMovimentados}
                data={d}
                empty={d.cur.moved ? "Nenhum tema identificado entre os tickets movimentados." : "Nenhum ticket antigo foi movimentado nesta semana."}
                note="Comentários e eventos dos tickets ainda não são considerados: a SoftCS não os disponibiliza para o bot por enquanto."
              />
            )}

            {ai && (ai.riscos.length > 0 || ai.recomendacoes.length > 0) && (
              <div className="tk-grid2">
                <section className="tk-panel">
                  <div className="tk-panel-head">
                    <h2>Riscos</h2>
                  </div>
                  <div className="tk-body">
                    <ul className="rp-list">
                      {ai.riscos.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </section>
                <section className="tk-panel">
                  <div className="tk-panel-head">
                    <h2>Recomendações para a próxima semana</h2>
                  </div>
                  <div className="tk-body">
                    <ul className="rp-list">
                      {ai.recomendacoes.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </section>
              </div>
            )}

            {/* DESTAQUES (regras fixas) */}
            {d.highlights.length > 0 && (
              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Destaques</h2>
                  <span className="tk-panel-sub">regras fixas da plataforma</span>
                </div>
                <div className="tk-body rp-themes">
                  {d.highlights.map((h, i) => (
                    <div className="rp-theme" key={i}>
                      <p className="rp-par">{h.texto}</p>
                      <TicketLinks ids={h.ids} data={d} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="tk-panel">
              <div className="tk-panel-head">
                <h2>Por prioridade</h2>
                <span className="tk-panel-sub">
                  metas: {(["P0", "P1", "P2", "P3"] as const).map((p) => `${p} ${fmtHours(d.metas[p])}`).join(", ")}
                </span>
              </div>
              <div className="tk-scroll">
                <table className="tk-table">
                  <thead>
                    <tr>
                      <th>Prioridade</th>
                      <th className="num">Criados</th>
                      <th className="num">Resolvidos (dos criados)</th>
                      <th className="num">SLA mediano</th>
                      <th className="num">No prazo</th>
                      <th className="num">Movimentados</th>
                      <th className="num">Em aberto</th>
                      <th className="num">SLA estourado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byPriority.map((p) => (
                      <tr key={p.pri}>
                        <td>
                          <span className="tk-tag">
                            <i className="tk-dot" style={{ background: PRI[p.pri].c }} />
                            {priLabel(p.pri)}
                          </span>
                        </td>
                        <td className="num">{p.created}</td>
                        <td className="num">{p.createdResolved}</td>
                        <td className="num">{fmtHours(p.slaMedianH)}</td>
                        <td className="num">{p.prazoN ? `${p.prazoOk}/${p.prazoN}` : "—"}</td>
                        <td className="num">{p.moved}</td>
                        <td className="num">{p.open}</td>
                        <td className="num">{p.late}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="tk-grid2">
              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Em aberto por etapa</h2>
                  <span className="tk-panel-sub">tickets da semana ainda abertos</span>
                </div>
                <div className="tk-scroll">
                  <table className="tk-table">
                    <thead>
                      <tr>
                        <th>Etapa</th>
                        <th className="num">Tickets</th>
                        <th className="num">Sem atualização (mediana)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byStageOpen.map((s) => (
                        <tr key={s.etapa}>
                          <td>{s.etapa}</td>
                          <td className="num">{s.n}</td>
                          <td className="num">{fmtHours(s.idleMedianH)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Por agente</h2>
                  <span className="tk-panel-sub">tickets da semana</span>
                </div>
                <div className="tk-scroll">
                  <table className="tk-table">
                    <thead>
                      <tr>
                        <th>Agente</th>
                        <th className="num">Criados</th>
                        <th className="num">Movimentados</th>
                        <th className="num">Resolvidos</th>
                        <th className="num">Em aberto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byAgent.map((a) => (
                        <tr key={a.agente}>
                          <td>{a.agente}</td>
                          <td className="num">{a.created}</td>
                          <td className="num">{a.moved}</td>
                          <td className="num">{a.resolved}</td>
                          <td className="num">{a.open}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {(d.topClients.length > 0 || d.repeatedTitles.length > 0) && (
              <div className="tk-grid2">
                <section className="tk-panel">
                  <div className="tk-panel-head">
                    <h2>Clientes com mais tickets</h2>
                    <span className="tk-panel-sub">2+ tickets criados na semana</span>
                  </div>
                  <div className="tk-body rp-themes">
                    {d.topClients.length ? (
                      d.topClients.map((c) => (
                        <div className="rp-theme" key={c.cliente}>
                          <div className="rp-theme-head">
                            <b>{c.cliente}</b>
                            <span className="hint">{c.n} tickets</span>
                          </div>
                          <TicketLinks ids={c.ids} data={d} />
                        </div>
                      ))
                    ) : (
                      <span className="hint">Nenhum cliente com 2 ou mais tickets.</span>
                    )}
                  </div>
                </section>
                <section className="tk-panel">
                  <div className="tk-panel-head">
                    <h2>Títulos repetidos</h2>
                    <span className="tk-panel-sub">possível incidente</span>
                  </div>
                  <div className="tk-body rp-themes">
                    {d.repeatedTitles.length ? (
                      d.repeatedTitles.map((t) => (
                        <div className="rp-theme" key={t.titulo}>
                          <div className="rp-theme-head">
                            <b>{t.titulo}</b>
                            <span className="hint">{t.n} tickets</span>
                          </div>
                          <TicketLinks ids={t.ids} data={d} />
                        </div>
                      ))
                    ) : (
                      <span className="hint">Nenhum título repetido.</span>
                    )}
                  </div>
                </section>
              </div>
            )}

            <div className="note-inline tk-note rp-foot">
              Semana {d.weekLabel}, segunda 00:00 a domingo 23:59 (horário de Brasília). Só entra o que aconteceu na semana: <b>criados</b> = &quot;Criado
              em&quot; na semana (resolvidos, SLA e prazo são só deles, pela mesma regra do Painel de tickets filtrado por esta semana);{" "}
              <b>movimentados</b> = criados antes e com &quot;Atualizado em&quot; na semana, sem contar atualização em lote. Como a SoftCS só informa a
              última atualização, um ticket mexido na semana e de novo depois dela passa a contar na semana da atualização mais recente. Situação
              (resolvido/em aberto) em {fmtWhen(d.snapshotAt ?? d.generatedAt)}. A IA recebe os clientes anonimizados e não recebe nomes de agentes.
            </div>
          </>
        )}
      </div>
    </>
  );
}
