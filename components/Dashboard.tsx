"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReportResult } from "@/lib/metrics";
import type { PeriodAttendantDto } from "@/lib/types";
import { isFresh, readReportCache, writeReportCache } from "@/lib/reportCache";
import { useFilterState } from "./useFilterState";
import SettingsPanel from "./SettingsPanel";
import SettingsModal from "./SettingsModal";
import TopBar from "./TopBar";
import Icon from "./Icon";
import DepartmentCard from "./DepartmentCard";
import WeeklySummary from "./WeeklySummary";
import FilterBar from "./FilterBar";
import TopRecurrentClients, { type RecurrentClient } from "./TopRecurrentClients";
import TopReasons, { type ReasonCount } from "./TopReasons";

type DepartmentRanking = { departmentId: string; name: string; topRecurrentClients: RecurrentClient[]; topReasons: ReasonCount[] };
type OverallRanking = { topRecurrentClients: RecurrentClient[]; topReasons: ReasonCount[] };
type ReportWithRankings = ReportResult & {
  chatbotId: string | null;
  departmentRankings: DepartmentRanking[];
  overallRanking: OverallRanking;
  periodAttendants: PeriodAttendantDto[];
};

const GROUPED_LAYOUT_KEY = "termo:groupedByDept";

// Último relatório exibido, guardado fora do componente: ao voltar pra aba, a tela já
// nasce com ele (sem o instante em branco enquanto filtros e cache são lidos).
let lastShown: { report: ReportWithRankings; savedAt: number } | null = null;

export default function Dashboard() {
  const f = useFilterState();

  const [report, setReport] = useState<ReportWithRankings | null>(() => lastShown?.report ?? null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportSavedAt, setReportSavedAt] = useState<number | null>(() => lastShown?.savedAt ?? null);
  const [linkCopied, setLinkCopied] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // "agrupado por setor" — layout alternativo onde clientes recorrentes/motivos
  // de atendimento aparecem logo abaixo do card de cada setor, em vez de num
  // bloco único no fim da página. Preferência só do navegador (não vai pro link).
  const [groupedByDept, setGroupedByDept] = useState(false);
  useEffect(() => {
    try {
      setGroupedByDept(window.localStorage.getItem(GROUPED_LAYOUT_KEY) === "1");
    } catch {
      // localStorage indisponível — mantém o padrão
    }
  }, []);
  const toggleGroupedByDept = useCallback(() => {
    setGroupedByDept((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(GROUPED_LAYOUT_KEY, next ? "1" : "0");
      } catch {
        // ignora
      }
      return next;
    });
  }, []);

  const [checkedInitialConfig, setCheckedInitialConfig] = useState(false);
  useEffect(() => {
    if (!f.config || checkedInitialConfig) return;
    setCheckedInitialConfig(true);
    if (!f.config.chatbotUrl || !f.config.hasToken) setSettingsOpen(true);
  }, [f.config, checkedInitialConfig]);

  /**
   * Abrir a aba nunca "recarrega" a tela: com cache, mostra o cache na hora. Se ele passou dos
   * 15 min, atualiza em silêncio (sem "Recarregando…") e só troca a tela se os dados mudaram.
   * `force` = botão "Recarregar": busca de novo e mostra o indicador.
   */
  const loadReport = useCallback(
    async (force = false) => {
      if (!f.prefsLoaded) return;
      if (f.viewMode === "week" && !f.weekStart) return;
      if (f.viewMode === "day" && !f.dayDate) return;

      // o cache é lido antes de esperar os Ajustes carregarem, pra tela não ficar vazia nesse meio-tempo
      const cached = force ? null : readReportCache<ReportWithRankings>(f.periodKey, f.deptIdsArr, f.attendantIdsArr);
      if (cached) {
        setReport((cur) => (cur && JSON.stringify(cur) === JSON.stringify(cached.report) ? cur : cached.report));
        setReportSavedAt(cached.savedAt);
        f.setPeriodAttendants(cached.report.periodAttendants ?? []);
        lastShown = cached;
        if (isFresh(cached.savedAt)) return; // cache ainda fresco, não busca de novo
      }

      if (!f.config?.chatbotUrl || !f.config?.hasToken) return;
      setError(null);
      const silent = Boolean(cached); // cache velho na tela: atualiza sem indicador
      if (force) setRefreshing(true);
      else if (!silent) setLoading(true);
      try {
        const idsParam = f.deptIdsArr && f.deptIdsArr.length > 0 ? `&departmentIds=${f.deptIdsArr.join(",")}` : "";
        const attendantsParam = f.attendantIdsArr ? `&attendantIds=${f.attendantIdsArr.join(",")}` : "";
        const res = await fetch(`/api/report?${f.periodQuery}${idsParam}${attendantsParam}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Falha ao carregar relatório");
        // só troca a tela se algo mudou — evita a "piscada" de re-desenhar os mesmos números
        setReport((cur) => (cur && JSON.stringify(cur) === JSON.stringify(json) ? cur : json));
        f.setPeriodAttendants(json.periodAttendants ?? []);
        writeReportCache(f.periodKey, f.deptIdsArr, f.attendantIdsArr, json);
        const savedAt = Date.now();
        setReportSavedAt(savedAt);
        lastShown = { report: json, savedAt };
      } catch (e: any) {
        // atualização silenciosa que falhou: mantém o que está na tela, sem alarde
        if (!silent || force) setError(e.message);
        if (!cached && !silent) setReport(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [f.prefsLoaded, f.viewMode, f.weekStart, f.dayDate, f.config, f.periodKey, f.periodQuery, f.deptIdsArr, f.attendantIdsArr, f.setPeriodAttendants]
  );

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // clipboard indisponível (ex.: contexto não seguro) — ignora silenciosamente
    }
  }

  return (
    <>
      <TopBar
        breadcrumb="Relatórios / Suporte"
        title="Termômetro Operacional"
        configured={f.configured}
        onOpenSettings={() => setSettingsOpen(true)}
        groupedByDept={groupedByDept}
        onToggleGroupedByDept={toggleGroupedByDept}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel config={f.config} departments={f.departments} onConfigSaved={f.loadConfig} onDepartmentsChanged={f.loadDepartments} />
      </SettingsModal>

      <div className="wrap">
        <header>
          <div className="page-header-row">
            <h1>Termômetro Operacional</h1>
            <div className="page-header-actions">
              <button className="btn small btn-icon" onClick={copyLink}>
                <Icon name={linkCopied ? "check" : "link"} />
                {linkCopied ? "Link copiado" : "Copiar link"}
              </button>
              <button className="btn small btn-icon" disabled={loading || refreshing} onClick={() => loadReport(true)}>
                <Icon name="refresh" className={refreshing ? "ui-icon-spin" : ""} />
                {refreshing ? "Recarregando…" : "Recarregar"}
              </button>
            </div>
          </div>
          {report && (
            <div className="subtitle">
              {report.previousWeek.label} → {report.currentWeek.label} · comparativo de TME, TMA, TMR, CSAT e volume por setor
            </div>
          )}
        </header>

        <FilterBar
          year={f.year}
          onYearChange={f.setYear}
          month={f.month}
          onMonthChange={f.setMonth}
          viewMode={f.viewMode}
          onViewModeChange={f.setViewMode}
          weeks={f.weeks}
          weekStart={f.weekStart}
          onWeekStartChange={f.setWeekStart}
          dayDate={f.dayDate}
          onDayDateChange={f.setDayDate}
          activeDepartments={f.activeDepartments}
          periodAttendants={f.periodAttendants}
          selectedAttendantIds={f.selectedAttendantIds}
          onAttendantFilterChange={f.updateAttendantFilter}
          selectedDeptIds={f.selectedDeptIds}
          onSelectedDeptIdsChange={f.setSelectedDeptIds}
        />

        {!f.configured && (
          <div className="error-box">
            Configure a URL do chatbot e o token clicando no ícone de ajustes (<Icon name="settings" />) no topo da página para começar.
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        {loading && <div className="loading">Carregando relatório…</div>}

        {report && !loading && (
          <>
            {report.departments.map((d) => {
              const dr = (report.departmentRankings ?? []).find((r) => r.departmentId === d.departmentId);
              return (
                <div key={d.departmentId} className={groupedByDept ? "dept-group" : undefined}>
                  <DepartmentCard
                    report={d}
                    highlights={report.highlights.filter((h) => h.departmentId === d.departmentId)}
                    attention={report.attention.filter((a) => a.departmentId === d.departmentId)}
                  />
                  {groupedByDept && dr && (
                    <div className="rankings-dept-block">
                      <div className="section-title">{dr.name}</div>
                      <div className="rankings-grid">
                        <TopRecurrentClients
                          title="Clientes recorrentes"
                          clients={dr.topRecurrentClients ?? []}
                          chatbotId={report.chatbotId ?? null}
                        />
                        <TopReasons title="Motivos de atendimento" reasons={dr.topReasons ?? []} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <WeeklySummary highlights={report.summary?.highlights ?? []} attention={report.summary?.attention ?? []} />

            {!groupedByDept &&
              (report.departmentRankings ?? []).map((dr) => (
                <div key={dr.departmentId} className="rankings-dept-block">
                  <div className="section-title">{dr.name}</div>
                  <div className="rankings-grid">
                    <TopRecurrentClients title="Clientes recorrentes" clients={dr.topRecurrentClients ?? []} chatbotId={report.chatbotId ?? null} />
                    <TopReasons title="Motivos de atendimento" reasons={dr.topReasons ?? []} />
                  </div>
                </div>
              ))}

            {report.overallRanking && (
              <div className="rankings-dept-block">
                <div className="section-title">Resultado geral</div>
                <div className="rankings-grid">
                  <TopRecurrentClients
                    title="Clientes recorrentes"
                    clients={report.overallRanking.topRecurrentClients ?? []}
                    chatbotId={report.chatbotId ?? null}
                  />
                  <TopReasons title="Motivos de atendimento" reasons={report.overallRanking.topReasons ?? []} />
                </div>
              </div>
            )}

            <footer>
              Termômetro Operacional do Suporte — comparativo {report.previousWeek.label} vs {report.currentWeek.label}
            </footer>
          </>
        )}
      </div>
    </>
  );
}
