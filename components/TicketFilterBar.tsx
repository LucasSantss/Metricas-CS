"use client";

import { useMemo, useState } from "react";
import Icon from "./Icon";
import {
  MES_LONGO,
  PRI,
  PRI_KEYS,
  fmtDate,
  groupLabel,
  groupOptions,
  inGroup,
  journeyOptions,
  metaLabel,
  monthWeeks,
  pad,
  priLabel,
  toLocalInput,
  weekLabel,
  type Period,
  type Pri,
  type SlaMetas,
  type Ticket,
  type TicketFilters,
} from "@/lib/tickets";

type Props = {
  f: TicketFilters;
  tickets: Ticket[];
  options: { etapa: string[]; nivel: string[]; agente: string[]; cliente: string[]; hasNoPri: boolean; years: number[] };
  metas: SlaMetas;
  patch: (p: Partial<TicketFilters>, normalize?: boolean) => void;
  onBulkChange: (bulk: boolean) => void;
  onClear: () => void;
  refDate: Date;
  /** a referência de tempo está acompanhando o relógio (não foi escolhida à mão) */
  refIsNow: boolean;
  onRefChange: (d: Date, followNow?: boolean) => void;
  dataDate: Date | null;
  dataDateLabel: string;
  bulkNote: string;
};

const toggled = <T,>(set: Set<T>, v: T) => {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
};

const STATUS_LABEL = { res: "Resolvidos", open: "Em aberto" };

/**
 * Filtros do Painel de tickets. Ficam à vista só o período e os recortes mais usados;
 * o resto abre em "Mais filtros" e, fechado, cada filtro ativo aparece como etiqueta
 * removível, pra nenhum filtro escondido mudar os números sem a pessoa ver.
 */
export default function TicketFilterBar({ f, tickets, options, metas, patch, onBulkChange, onClear, refDate, refIsNow, onRefChange, dataDate, dataDateLabel, bulkNote }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const groups = useMemo(() => groupOptions(tickets), [tickets]);
  // só as jornadas que existem no grupo escolhido
  const journeys = useMemo(() => journeyOptions(f.grupo ? tickets.filter((t) => inGroup(t, f.grupo)) : tickets), [tickets, f.grupo]);

  const chips = [
    ...[...f.pri].map((p: Pri) => ({ key: `pri-${p}`, label: priLabel(p), clear: () => patch({ pri: toggled(f.pri, p) }) })),
    ...[...f.nivel].map((n) => ({ key: `nivel-${n}`, label: n, clear: () => patch({ nivel: toggled(f.nivel, n) }) })),
    ...(f.status ? [{ key: "status", label: STATUS_LABEL[f.status], clear: () => patch({ status: "" }) }] : []),
    ...(f.etapa ? [{ key: "etapa", label: `Etapa: ${f.etapa}`, clear: () => patch({ etapa: "" }) }] : []),
    ...(f.agente ? [{ key: "agente", label: `Agente: ${f.agente}`, clear: () => patch({ agente: "" }) }] : []),
    ...(f.cliente ? [{ key: "cliente", label: `Cliente: ${f.cliente}`, clear: () => patch({ cliente: "" }) }] : []),
    ...(f.bulk ? [] : [{ key: "bulk", label: "Inclui atualizações em massa no SLA", clear: () => onBulkChange(true) }]),
    ...(refIsNow ? [] : [{ key: "ref", label: `Referência: ${fmtDate(refDate)}`, clear: () => onRefChange(new Date(), true) }]),
  ];

  return (
    <div className="filter-bar tk-filter-bar">
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
        {groups.length > 0 && (
          <div className="field">
            <label>Grupo</label>
            <select value={f.grupo} onChange={(e) => patch({ grupo: e.target.value, jornada: "" })}>
              <option value="">Todos</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {groupLabel(g)}
                </option>
              ))}
            </select>
          </div>
        )}
        {journeys.length > 0 && (
          <div className="field">
            <label>Jornada</label>
            <select value={f.jornada} onChange={(e) => patch({ jornada: e.target.value })}>
              <option value="">Todas</option>
              {journeys.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field grow">
          <label>Buscar</label>
          <input type="text" placeholder="ID, título ou descrição" value={f.q} onChange={(e) => patch({ q: e.target.value })} />
        </div>
        <button type="button" className={`btn btn-icon tk-more-btn ${moreOpen ? "on" : ""}`} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
          <Icon name="filter" />
          Mais filtros
          {chips.length > 0 && <span className="tk-more-count">{chips.length}</span>}
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Limpar filtros
        </button>
      </div>

      {!moreOpen && chips.length > 0 && (
        <div className="tk-chips">
          {chips.map((c) => (
            <button type="button" key={c.key} className="tk-chip" title="Remover este filtro" onClick={c.clear}>
              {c.label}
              <Icon name="cross-small" />
            </button>
          ))}
        </div>
      )}

      {moreOpen && (
        <div className="tk-more">
          <div className="filter-bar-row">
            <div className="field">
              <label>Prioridade (define a meta de SLA)</label>
              <div className="dept-toggle-list">
                {PRI_KEYS.filter((k) => k !== "—" || options.hasNoPri).map((k) => {
                  const on = f.pri.has(k);
                  return (
                    <button key={k} type="button" className={`dept-toggle tk-pri-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => patch({ pri: toggled(f.pri, k) })}>
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
                    <button key={n} type="button" className={`dept-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => patch({ nivel: toggled(f.nivel, n) })}>
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
            <div className="field grow">
              <label>Cliente</label>
              <input type="text" list="tk-clientes" placeholder="Nome do cliente" value={f.cliente} onChange={(e) => patch({ cliente: e.target.value })} />
              <datalist id="tk-clientes">
                {options.cliente.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="filter-bar-row">
            <div className="field">
              <label>Referência de tempo (agora)</label>
              <div className="tk-ref">
                <input
                  type="datetime-local"
                  value={toLocalInput(refDate)}
                  onChange={(e) => {
                    const d = new Date(e.target.value);
                    if (!isNaN(+d)) onRefChange(d);
                  }}
                />
                <button className="btn" onClick={() => onRefChange(new Date(), true)}>
                  Agora
                </button>
                {dataDate && (
                  <button className="btn" onClick={() => onRefChange(dataDate)}>
                    {dataDateLabel}
                  </button>
                )}
              </div>
            </div>
            <label className="checkbox-field tk-bulk">
              <input type="checkbox" checked={f.bulk} onChange={(e) => onBulkChange(e.target.checked)} />
              <span>
                Ignorar atualizações em massa no SLA
                <span className="hint">{bulkNote}</span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
