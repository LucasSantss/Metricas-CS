"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./TopBar";
import SettingsModal from "./SettingsModal";
import SettingsPanel from "./SettingsPanel";
import type { ConfigResponse, DepartmentDto } from "@/lib/types";
import {
  BUCKETS,
  KPI_FILTERS,
  MES_LONGO,
  PAGE_SIZE,
  PRI,
  PRI_KEYS,
  TICKET_URL,
  baseDate,
  baseMonth,
  baseWeek,
  bucketOf,
  defaultFilters,
  derive,
  exportCSV,
  fmtDate,
  fmtHours,
  isInat,
  max,
  mean,
  median,
  mlabel,
  monthWeeks,
  normalizeDates,
  pad,
  parseTicketsFile,
  passes,
  pct,
  periodLabel,
  prazo,
  priLabel,
  metaLabel,
  SEM_NIVEL,
  DEFAULT_META,
  metaOf,
  type SlaMetas,
  sortVal,
  toLocalInput,
  uniq,
  weekLabel,
  weekShort,
  type Derived,
  type KpiKey,
  type Period,
  type Pri,
  type Sort,
  type SortKey,
  type Ticket,
  type TicketFilters,
  type Week,
} from "@/lib/tickets";

const COLS_T: [SortKey, string][] = [
  ["id", "ID"],
  ["titulo", "Título"],
  ["cliente", "Cliente"],
  ["pri", "Prioridade"],
  ["nivel", "Nível"],
  ["etapa", "Etapa"],
  ["status", "Situação"],
  ["agente", "Agente"],
  ["c", "Criado em"],
  ["u", "Atualizado em"],
  ["idle", "Sem atualização"],
  ["rt", "Tempo de resolução"],
];

type Loaded = { name: string; tickets: Ticket[]; exportDate: Date | null; bulkNote: string };

const smoothScroll = (el: Element | null) =>
  el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

function PriTag({ p }: { p: Pri }) {
  return (
    <span className="tk-tag">
      <i className="tk-dot" style={{ background: PRI[p].c }} />
      {priLabel(p)}
    </span>
  );
}

function PriBar({ items }: { items: Derived[] }) {
  const n = items.length;
  if (!n) return <span className="hint">—</span>;
  const cnt: Partial<Record<Pri, number>> = {};
  items.forEach((x) => (cnt[x.t.pri] = (cnt[x.t.pri] || 0) + 1));
  const keys = PRI_KEYS.filter((k) => cnt[k]);
  return (
    <div className="tk-pbar" title={keys.map((k) => `${priLabel(k)}: ${cnt[k]}`).join(" | ")}>
      {keys.map((k) => (
        <i key={k} style={{ width: `${(cnt[k]! / n) * 100}%`, background: PRI[k].c }} />
      ))}
    </div>
  );
}

function MonthRow({ label, items, cls }: { label: string; items: Derived[]; cls?: string }) {
  const res = items.filter((x) => x.res);
  const open = items.filter((x) => !x.res);
  const sla = res.filter((x) => x.useSla).map((x) => x.rt!);
  const idle = open.map((x) => x.idle);
  const p = prazo(res);
  return (
    <tr className={cls}>
      <td>{label}</td>
      <td className="num">{items.length}</td>
      <td>
        <PriBar items={items} />
      </td>
      <td className="num">
        {res.length} <span className="faint">({pct(res.length, items.length)})</span>
      </td>
      <td className="num">{fmtHours(mean(sla))}</td>
      <td className="num">{fmtHours(median(sla))}</td>
      <td className="num">
        {p.n ? (
          <>
            {p.ok}/{p.n} <span className="faint">({pct(p.ok, p.n)})</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="num">{open.length}</td>
      <td className="num">{open.filter((x) => x.late).length}</td>
      <td className="num">{fmtHours(mean(idle))}</td>
      <td className="num">{fmtHours(max(idle))}</td>
    </tr>
  );
}

export default function TicketsView() {
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
  // metas de SLA por prioridade (Ajustes > Tickets); padrão enquanto o banco não responde
  const metas: SlaMetas = useMemo(() => ({ ...DEFAULT_META, ...config?.ticketSlaHours }), [config?.ticketSlaHours]);

  // Arquivo e filtros
  const [file, setFile] = useState<Loaded | null>(null);
  const [err, setErr] = useState("");
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [f, setF] = useState<TicketFilters | null>(null);
  const [ref, setRef] = useState(() => new Date());
  const [cell, setCell] = useState<{ p: Pri; b: number } | null>(null);
  const [kf, setKf] = useState<KpiKey | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<Sort>({ k: "idle", dir: -1 });
  const fileInput = useRef<HTMLInputElement>(null);
  const tablePanel = useRef<HTMLElement>(null);

  const handleFile = useCallback(async (fl: File | undefined) => {
    if (!fl) return;
    setErr("");
    setReading(true);
    try {
      const parsed = await parseTicketsFile(fl);
      setFile({ name: fl.name, ...parsed });
      setF(defaultFilters(parsed.tickets));
      setRef(new Date());
      setCell(null);
      setKf(null);
      setPage(0);
      setSort({ k: "idle", dir: -1 });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  // permite soltar o arquivo em qualquer lugar da página
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer?.files[0]) handleFile(e.dataTransfer.files[0]);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", drop);
    };
  }, [handleFile]);

  const tickets = file?.tickets ?? [];

  /** Atualiza filtros e volta pra primeira página. */
  const patch = (p: Partial<TicketFilters>, normalize = false) => {
    setF((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...p };
      return normalize ? normalizeDates(next) : next;
    });
    setPage(0);
  };

  const list = useMemo(() => (f ? tickets.filter((t) => passes(t, f)).map((t) => derive(t, ref, f.bulk, metas)) : []), [tickets, f, ref, metas]);

  const options = useMemo(
    () => ({
      etapa: uniq(tickets, "etapa"),
      nivel: uniq(tickets, "nivel"),
      agente: uniq(tickets, "agente"),
      cliente: uniq(tickets, "cliente"),
      hasNoPri: tickets.some((t) => t.pri === "—"),
      years: tickets.flatMap((t) => [t.c.getFullYear(), t.u.getFullYear()]),
      range: tickets.length
        ? [new Date(Math.min(...tickets.map((t) => +t.c))), new Date(Math.max(...tickets.map((t) => +t.c)))]
        : null,
    }),
    [tickets]
  );

  const monthData = useMemo(() => {
    if (!f) return { keys: [] as string[], groups: new Map<string, Derived[]>(), all: [] as Derived[] };
    const all = tickets.filter((t) => passes(t, f, true) && baseDate(t, f).getFullYear() === f.year).map((t) => derive(t, ref, f.bulk, metas));
    const groups = new Map<string, Derived[]>();
    all.forEach((x) => {
      const k = baseMonth(x.t, f);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(x);
    });
    return { keys: [...groups.keys()].sort(), groups, all };
  }, [tickets, f, ref, metas]);

  const weekRows = useMemo(() => {
    if (!f) return [];
    const g = new Map<string, { w: Week; r: number; o: number }>();
    list.forEach((x) => {
      const w = baseWeek(x.t, f);
      if (!g.has(w.key)) g.set(w.key, { w, r: 0, o: 0 });
      const e = g.get(w.key)!;
      if (x.res) e.r++;
      else e.o++;
    });
    return [...g.values()].sort((a, b) => +a.w.mon - +b.w.mon);
  }, [list, f]);

  const aging = useMemo(() => {
    const open = list.filter((x) => !x.res);
    const has = new Set(open.map((x) => x.t.pri));
    const pris = PRI_KEYS.filter((k) => k !== "—" || has.has("—"));
    const m = {} as Record<Pri, number[]>;
    pris.forEach((p) => (m[p] = BUCKETS.map(() => 0)));
    open.forEach((x) => {
      if (m[x.t.pri]) m[x.t.pri][bucketOf(x.idle)]++;
    });
    const top = Math.max(1, ...pris.flatMap((p) => m[p]));
    const tot = BUCKETS.map((_, i) => pris.reduce((s, p) => s + m[p][i], 0));
    return { open, pris, m, top, tot };
  }, [list]);

  const rows = useMemo(() => {
    let r = list;
    if (cell) r = r.filter((x) => !x.res && x.t.pri === cell.p && bucketOf(x.idle) === cell.b);
    if (kf) r = r.filter(KPI_FILTERS[kf].test);
    return [...r].sort((a, b) => {
      const va = sortVal(a, sort.k);
      const vb = sortVal(b, sort.k);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [list, cell, kf, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pages - 1);

  function pickKpi(key: KpiKey) {
    const next = kf === key ? null : key;
    setKf(next);
    setCell(null);
    setPage(0);
    if (next) {
      setSort({ ...KPI_FILTERS[next].sort });
      smoothScroll(tablePanel.current);
    }
  }

  function pickCell(p: Pri, b: number) {
    const next = cell && cell.p === p && cell.b === b ? null : { p, b };
    setCell(next);
    setKf(null);
    setSort({ k: "idle", dir: -1 });
    setPage(0);
    if (next) smoothScroll(tablePanel.current);
  }

  function pickWeek(key: string) {
    if (!f) return;
    if (f.period === "week" && f.week === key) patch({ period: "month" }, true);
    else patch({ period: "week", week: key }, true);
  }

  function togglePri(p: Pri) {
    if (!f) return;
    const next = new Set(f.pri);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    patch({ pri: next });
  }

  function toggleNivel(n: string) {
    if (!f) return;
    const next = new Set(f.nivel);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    patch({ nivel: next });
  }

  function clearFilters() {
    if (!f) return;
    setF(defaultFilters(tickets, f.base, f.bulk));
    setCell(null);
    setKf(null);
    setPage(0);
  }

  function sortBy(k: SortKey) {
    setSort((s) => (s.k === k ? { k, dir: (-s.dir as 1 | -1) } : { k, dir: ["idle", "rt", "c", "u"].includes(k) ? -1 : 1 }));
  }

  const fileInputEl = (
    <input
      ref={fileInput}
      type="file"
      accept=".xlsx,.xls,.xlsm"
      hidden
      onChange={(e) => {
        handleFile(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <>
      <TopBar breadcrumb="Relatórios / Suporte" title="Painel de tickets" configured={configured} onOpenSettings={() => setSettingsOpen(true)} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel config={config} departments={departments} onConfigSaved={loadConfig} onDepartmentsChanged={loadDepartments} initialTab="tickets" />
      </SettingsModal>

      {fileInputEl}

      <div className="wrap tk">
        <header>
          <div className="page-header-row">
            <h1>Painel de tickets</h1>
            {file && (
              <div className="page-header-actions">
                <span className="hint">
                  {file.name} ({file.tickets.length} tickets)
                </span>
                <button className="btn" onClick={() => fileInput.current?.click()}>
                  Trocar arquivo
                </button>
              </div>
            )}
          </div>
          <div className="subtitle">
            {file && options.range
              ? `Tickets criados de ${fmtDate(options.range[0])} a ${fmtDate(options.range[1])}`
              : "Carregue o .xlsx exportado para ver volume, resolução, SLA e tempo sem atualização"}
          </div>
        </header>

        {err && <div className="error-box">{err}</div>}

        {!file || !f ? (
          <div
            className={`tk-drop ${dragOver ? "over" : ""}`}
            tabIndex={0}
            role="button"
            aria-label="Escolher arquivo xlsx"
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
            onDragEnter={() => setDragOver(true)}
            onDragOver={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
          >
            <strong>{reading ? "Lendo arquivo…" : "Solte aqui o .xlsx de tickets"}</strong>
            <span className="hint">ou clique para escolher. O arquivo é lido só no seu navegador, nada é enviado para fora.</span>
          </div>
        ) : (
          <>
            {/* FILTROS */}
            <div className="filter-bar">
              <div className="filter-bar-row">
                <div className="field">
                  <label>Filtrar datas por</label>
                  <div className="view-mode-toggle">
                    {(
                      [
                        ["c", "Criado em"],
                        ["u", "Atualizado em"],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} type="button" className={f.base === v ? "on" : ""} onClick={() => patch({ base: v }, true)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Ano</label>
                  <input
                    type="number"
                    className="field-year"
                    value={f.year}
                    min={Math.min(...options.years)}
                    max={Math.max(...options.years)}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      if (y) patch({ year: y }, true);
                    }}
                  />
                </div>
                <div className="field">
                  <label>Mês</label>
                  <select value={f.month} onChange={(e) => patch({ month: Number(e.target.value) }, true)}>
                    {MES_LONGO.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Período</label>
                  <div className="view-mode-toggle">
                    {(
                      [
                        ["day", "Dia"],
                        ["week", "Semana"],
                        ["month", "Mês inteiro"],
                      ] as [Period, string][]
                    ).map(([v, l]) => (
                      <button key={v} type="button" className={f.period === v ? "on" : ""} onClick={() => patch({ period: v }, true)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {f.period === "week" && (
                  <div className="field grow">
                    <label>Semana (seg–sáb)</label>
                    <select value={f.week} onChange={(e) => patch({ week: e.target.value })}>
                      {monthWeeks(f.year, f.month).map((w) => (
                        <option key={w.key} value={w.key}>
                          {weekLabel(w)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {f.period === "day" && (
                  <div className="field">
                    <label>Dia</label>
                    <input
                      type="date"
                      value={f.day}
                      min={`${f.year}-${pad(f.month)}-01`}
                      max={`${f.year}-${pad(f.month)}-${pad(new Date(f.year, f.month, 0).getDate())}`}
                      onChange={(e) => e.target.value && patch({ day: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="filter-bar-row">
                <div className="field">
                  <label>Prioridade (define a meta de SLA)</label>
                  <div className="dept-toggle-list">
                    {PRI_KEYS.filter((k) => k !== "—" || options.hasNoPri).map((k) => {
                      const on = f.pri.has(k);
                      return (
                        <button key={k} type="button" className={`dept-toggle tk-pri-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => togglePri(k)}>
                          <i className="tk-dot" style={{ background: PRI[k].c }} />
                          {priLabel(k)}
                          <span className="tk-meta">{metaLabel(k, metas)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="field">
                  <label>Nível de atendimento</label>
                  <div className="dept-toggle-list">
                    {options.nivel.map((n) => {
                      const on = f.nivel.has(n);
                      return (
                        <button key={n} type="button" className={`dept-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleNivel(n)}>
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="filter-bar-row">
                <div className="field">
                  <label>Situação</label>
                  <select value={f.status} onChange={(e) => patch({ status: e.target.value as TicketFilters["status"] })}>
                    <option value="">Todas</option>
                    <option value="res">Resolvidos</option>
                    <option value="open">Em aberto</option>
                  </select>
                </div>
                {(
                  [
                    ["etapa", "Etapa", "Todas"],
                    ["agente", "Agente responsável", "Todos"],
                  ] as const
                ).map(([k, l, all]) => (
                  <div className="field" key={k}>
                    <label>{l}</label>
                    <select value={f[k]} onChange={(e) => patch({ [k]: e.target.value })}>
                      <option value="">{all}</option>
                      {options[k].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="field">
                  <label>Cliente</label>
                  <input type="text" list="tk-clientes" placeholder="Nome do cliente" value={f.cliente} onChange={(e) => patch({ cliente: e.target.value })} />
                  <datalist id="tk-clientes">
                    {options.cliente.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </div>
                <div className="field grow">
                  <label>Buscar</label>
                  <input type="text" placeholder="ID, título ou descrição" value={f.q} onChange={(e) => patch({ q: e.target.value })} />
                </div>
              </div>

              <div className="filter-bar-row">
                <div className="field">
                  <label>Referência de tempo (agora)</label>
                  <div className="tk-ref">
                    <input
                      type="datetime-local"
                      value={toLocalInput(ref)}
                      onChange={(e) => {
                        const d = new Date(e.target.value);
                        if (!isNaN(+d)) setRef(d);
                      }}
                    />
                    <button className="btn" onClick={() => setRef(new Date())}>
                      Agora
                    </button>
                    {file.exportDate && (
                      <button className="btn" onClick={() => setRef(file.exportDate!)}>
                        Horário da exportação
                      </button>
                    )}
                  </div>
                </div>
                <label className="checkbox-field tk-bulk">
                  <input type="checkbox" checked={f.bulk} onChange={(e) => setF({ ...f, bulk: e.target.checked })} />
                  <span>
                    Ignorar atualizações em massa no SLA
                    <span className="hint">{file.bulkNote}</span>
                  </span>
                </label>
                <div className="tk-push">
                  <button className="btn" onClick={clearFilters}>
                    Limpar filtros
                  </button>
                </div>
              </div>
            </div>

            {/* KPIs */}
            <Kpis list={list} f={f} kf={kf} onPick={pickKpi} />

            {/* RESUMO POR MÊS */}
            <section className="tk-panel">
              <div className="tk-panel-head">
                <h2>Resumo por mês</h2>
                <span className="tk-panel-sub">
                  Todos os meses de {f.year} (demais filtros aplicados), pela data de {f.base === "u" ? "atualização" : "criação"}; tempos até {fmtDate(ref)}
                </span>
              </div>
              <div className="tk-scroll">
                <table className="tk-table">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th className="num">Tickets</th>
                      <th>Prioridade</th>
                      <th className="num">Resolvidos</th>
                      <th className="num">SLA médio</th>
                      <th className="num">SLA mediano</th>
                      <th className="num">No prazo</th>
                      <th className="num">Em aberto</th>
                      <th className="num">SLA estourado</th>
                      <th className="num">Sem atualização (média)</th>
                      <th className="num">Mais antigo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthData.keys.length ? (
                      <>
                        {monthData.keys.map((k) => (
                          <MonthRow key={k} label={mlabel(k, true)} items={monthData.groups.get(k)!} cls={k === `${f.year}-${pad(f.month)}` ? "cur" : ""} />
                        ))}
                        {monthData.keys.length > 1 && <MonthRow label={`Total ${f.year}`} items={monthData.all} cls="total" />}
                      </>
                    ) : (
                      <tr>
                        <td colSpan={11} className="hint">
                          Nenhum ticket com os filtros atuais. Ajuste ou limpe os filtros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="note-inline tk-note">
                SLA de resolução = &quot;Atualizado em&quot; menos &quot;Criado em&quot; dos tickets resolvidos (a exportação não traz a data exata de resolução). Tempo sem
                atualização = referência de tempo menos &quot;Atualizado em&quot; dos tickets em aberto. Metas de SLA por prioridade:{" "}
                {PRI_KEYS.filter((k) => metaOf(k, metas) != null)
                  .map((k) => `${k} ${fmtHours(metaOf(k, metas))}`)
                  .join(", ")}{" "}
                (editáveis em Ajustes ⚙️ &gt; Tickets). O nível (N1–N4) não altera a meta. Em aberto: vale a coluna SLA da planilha; quando ela vem
                vazia, o ticket conta como estourado se já passou da meta da prioridade desde a criação.
              </div>
            </section>

            <div className="tk-grid2">
              {/* SEMANAS */}
              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Por semana</h2>
                  <div className="tk-legend">
                    <span>
                      <i className="tk-sw r" />
                      Resolvidos
                    </span>
                    <span>
                      <i className="tk-sw o" />
                      Em aberto
                    </span>
                  </div>
                </div>
                <div className="tk-body">
                  <div className="tk-weeks">
                    {weekRows.length ? (
                      weekRows.map((e) => {
                        const tot = e.r + e.o;
                        const top = Math.max(1, ...weekRows.map((x) => x.r + x.o));
                        return (
                          <button key={e.w.key} className={`tk-wk ${f.period === "week" && f.week === e.w.key ? "sel" : ""}`} onClick={() => pickWeek(e.w.key)}>
                            <span>{weekShort(e.w)}</span>
                            <span className="tk-wk-bar" style={{ width: `${(tot / top) * 100}%` }}>
                              <i className="r" style={{ width: `${(e.r / tot) * 100}%` }} />
                              <i className="o" style={{ width: `${(e.o / tot) * 100}%` }} />
                            </span>
                            <span className="tk-wk-count">
                              {tot}{" "}
                              <span className="faint">
                                ({e.r} res, {e.o} ab)
                              </span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <span className="hint">Nenhum ticket com os filtros atuais.</span>
                    )}
                  </div>
                  <div className="hint tk-note">Clique em uma semana para filtrar por ela.</div>
                </div>
              </section>

              {/* AGING */}
              <section className="tk-panel">
                <div className="tk-panel-head">
                  <h2>Em aberto: tempo sem atualização</h2>
                  <span className="tk-panel-sub">
                    {aging.open.length} tickets, até {fmtDate(ref)}
                  </span>
                </div>
                <div className="tk-body">
                  <div className="tk-scroll">
                    <table className="tk-table tk-heat">
                      <thead>
                        <tr>
                          <th>Prioridade</th>
                          {BUCKETS.map((b) => (
                            <th key={b[1]} className="center">
                              {b[1]}
                            </th>
                          ))}
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aging.pris.map((p) => (
                          <tr key={p}>
                            <td>
                              <PriTag p={p} />
                            </td>
                            {aging.m[p].map((v, i) =>
                              v ? (
                                <td
                                  key={i}
                                  className={`cell ${cell && cell.p === p && cell.b === i ? "sel" : ""}`}
                                  style={{ background: `rgba(91,168,245,${(0.12 + (0.6 * v) / aging.top).toFixed(2)})` }}
                                  onClick={() => pickCell(p, i)}
                                >
                                  {v}
                                </td>
                              ) : (
                                <td key={i} className="cell zero">
                                  0
                                </td>
                              )
                            )}
                            <td className="num">{aging.m[p].reduce((a, b) => a + b, 0)}</td>
                          </tr>
                        ))}
                        <tr className="total">
                          <td>Total</td>
                          {aging.tot.map((v, i) => (
                            <td key={i} className="center">
                              {v}
                            </td>
                          ))}
                          <td className="num">{aging.open.length}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="hint tk-note">Clique em um número para ver esses tickets na lista abaixo.</div>
                </div>
              </section>
            </div>

            {/* LISTA DE TICKETS */}
            <section className="tk-panel" ref={tablePanel}>
              <div className="tk-panel-head">
                <h2>
                  Tickets <span className="tk-panel-sub">({rows.length})</span>
                </h2>
                <div className="page-header-actions">
                  {(kf || cell) && (
                    <span className="chip">
                      {kf ? KPI_FILTERS[kf].label : cell && `Em aberto, ${cell.p === "—" ? "sem prioridade" : cell.p}, ${BUCKETS[cell.b][1]}`}
                      <button
                        aria-label="Remover recorte"
                        onClick={() => {
                          setKf(null);
                          setCell(null);
                          setPage(0);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  )}
                  <button className="btn small" onClick={() => exportCSV(rows)}>
                    Exportar lista (.csv)
                  </button>
                </div>
              </div>
              <div className="tk-tbl-wrap">
                <table className="tk-table tk-list">
                  <thead>
                    <tr>
                      {COLS_T.map(([k, l]) => (
                        <th key={k} onClick={() => sortBy(k)} aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
                          {l}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE).map((x, i) => <TicketRow key={`${x.t.id}-${i}`} x={x} />)
                    ) : (
                      <tr>
                        <td colSpan={COLS_T.length} className="hint">
                          Nenhum ticket com os filtros atuais.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="tk-pager">
                <button className="btn small" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
                  Anterior
                </button>
                <span className="hint">
                  Página {curPage + 1} de {pages}
                </span>
                <button className="btn small" disabled={curPage >= pages - 1} onClick={() => setPage(curPage + 1)}>
                  Próxima
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Kpis({ list, f, kf, onPick }: { list: Derived[]; f: TicketFilters; kf: KpiKey | null; onPick: (k: KpiKey) => void }) {
  const res = list.filter((x) => x.res);
  const open = list.filter((x) => !x.res);
  const inat = res.filter((x) => isInat(x.t)).length;
  const sla = res.filter((x) => x.useSla).map((x) => x.rt!);
  const pz = prazo(res);
  const idle = open.map((x) => x.idle);
  const late = open.filter((x) => x.late).length;

  const sub = (k: KpiKey, children: React.ReactNode) => (
    <button
      key={k}
      className={`tk-kpi-link ${kf === k ? "sel" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick(k);
      }}
    >
      {children}
    </button>
  );
  const kpi = (k: KpiKey, v: React.ReactNode, l: string, s: React.ReactNode) => (
    <div
      key={k}
      className={`tk-kpi ${kf === k ? "sel" : ""}`}
      role="button"
      tabIndex={0}
      title="Clique para ver estes tickets"
      onClick={() => onPick(k)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onPick(k);
        }
      }}
    >
      <div className="tk-kpi-label">{l}</div>
      <div className="tk-kpi-value">{v}</div>
      <div className="tk-kpi-sub">{s}</div>
    </div>
  );

  return (
    <section className="tk-kpis" aria-label="Indicadores">
      {kpi("all", list.length, "Tickets", periodLabel(f))}
      {kpi("res", res.length, "Resolvidos", <>{pct(res.length, list.length)} do total, {sub("inat", `${inat} por inatividade`)}</>)}
      {kpi("sla", fmtHours(mean(sla)), "SLA médio de resolução", `mediana ${fmtHours(median(sla))}, base de ${sla.length} tickets`)}
      {kpi(
        "prazo",
        pct(pz.ok, pz.n),
        "Resolvidos no prazo",
        <>
          {sub("ok", `${pz.ok} no prazo`)} e {sub("fora", `${pz.n - pz.ok} fora`)} de {pz.n} com meta
        </>
      )}
      {kpi("open", open.length, "Em aberto", sub("late", `${late} com SLA estourado`))}
      {kpi("idle", fmtHours(mean(idle)), "Sem atualização (média)", `mais antigo: ${fmtHours(max(idle))}`)}
    </section>
  );
}

function TicketRow({ x }: { x: Derived }) {
  const t = x.t;
  const ageCls = x.res ? "faint" : x.idle >= 168 ? "tk-age-bad" : x.idle >= 72 ? "tk-age-warn" : "";
  return (
    <tr>
      <td>
        {t.id ? (
          <a className="tk-id" href={`${TICKET_URL}${encodeURIComponent(t.id)}`} target="_blank" rel="noopener noreferrer" title="Abrir ticket em nova guia">
            {t.id}
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="title" title={t.desc.slice(0, 600)}>
        {t.titulo}
      </td>
      <td>{t.cliente}</td>
      <td title={x.meta != null ? `Meta de SLA ${t.pri}: ${fmtHours(x.meta)}` : "Sem prioridade: sem meta de SLA"}>
        {t.pri === "—" ? "—" : <PriTag p={t.pri} />}
      </td>
      <td className={t.nivel === SEM_NIVEL ? "faint" : ""}>{t.nivel}</td>
      <td>{t.etapa}</td>
      <td>
        {x.res ? (
          <span className="tk-badge res">{isInat(t) ? "Resolvido por inatividade" : "Resolvido"}</span>
        ) : (
          <span className="tk-badge open">Em aberto</span>
        )}
        {x.late && (
          <span
            className="tk-badge late"
            title={x.slaSrc === "meta" ? `A planilha não trouxe o SLA: calculado pela meta da prioridade (${fmtHours(x.meta)})` : "SLA informado na planilha"}
          >
            SLA estourado{x.slaSrc === "meta" ? " *" : ""}
          </span>
        )}
      </td>
      <td>{t.agente}</td>
      <td className="mono">{fmtDate(t.c)}</td>
      <td className="mono">
        {fmtDate(t.u)}
        {t.bulk && (
          <span className="faint" title="Atualização em lote">
            {" "}
            •
          </span>
        )}
      </td>
      <td className={`mono ${ageCls}`}>{fmtHours(x.idle)}</td>
      <td className="mono">
        {x.res ? (
          <>
            <span className={x.inSla === true ? "tk-ok" : x.inSla === false ? "tk-over" : ""} title={x.meta != null ? `Meta da prioridade ${t.pri}: ${fmtHours(x.meta)}` : "Sem meta (sem prioridade)"}>
              {fmtHours(x.rt)}
            </span>
            {!x.useSla && (
              <span className="faint" title="Fora da média: atualização em lote">
                {" "}
                *
              </span>
            )}
          </>
        ) : (
          <span className="faint">—</span>
        )}
      </td>
    </tr>
  );
}
