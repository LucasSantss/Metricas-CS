"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReportResult } from "@/lib/metrics";
import type { PeriodAttendantDto } from "@/lib/types";
import { isFresh, readReportCache, writeReportCache } from "@/lib/reportCache";
import { useFilterState } from "./useFilterState";
import SettingsPanel from "./SettingsPanel";
import SettingsModal from "./SettingsModal";
import TopBar from "./TopBar";
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

export default function Dashboard() {
  const f = useFilterState();

  const [report, setReport] = useState<ReportWithRankings | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportSavedAt, setReportSavedAt] = useState<number | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [checkedInitialConfig, setCheckedInitialConfig] = useState(false);
  useEffect(() => {
    if (!f.config || checkedInitialConfig) return;
    setCheckedInitialConfig(true);
    if (!f.config.chatbotUrl || !f.config.hasToken) setSettingsOpen(true);
  }, [f.config, checkedInitialConfig]);

  const loadReport = useCallback(
    async (force = false) => {
      if (!f.prefsLoaded) return;
      if (f.viewMode === "week" && !f.weekStart) return;
      if (!f.config?.chatbotUrl || !f.config?.hasToken) return;
      setError(null);

      const cached = force ? null : readReportCache<ReportWithRankings>(f.periodKey, f.deptIdsArr, f.attendantIdsArr);
      if (cached) {
        setReport(cached.report);
        setReportSavedAt(cached.savedAt);
        f.setPeriodAttendants(cached.report.periodAttendants ?? []);
        if (isFresh(cached.savedAt)) return; // cache ainda fresco, não busca de novo
      }

      if (cached) setRefreshing(true);
      else setLoading(true);
      try {
        const idsParam = f.deptIdsArr && f.deptIdsArr.length > 0 ? `&departmentIds=${f.deptIdsArr.join(",")}` : "";
        const attendantsParam = f.attendantIdsArr ? `&attendantIds=${f.attendantIdsArr.join(",")}` : "";
        const res = await fetch(`/api/report?${f.periodQuery}${idsParam}${attendantsParam}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Falha ao carregar relatório");
        setReport(json);
        f.setPeriodAttendants(json.periodAttendants ?? []);
        writeReportCache(f.periodKey, f.deptIdsArr, f.attendantIdsArr, json);
        setReportSavedAt(Date.now());
      } catch (e: any) {
        setError(e.message);
        if (!cached) setReport(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [f.prefsLoaded, f.viewMode, f.weekStart, f.config, f.periodKey, f.periodQuery, f.deptIdsArr, f.attendantIdsArr, f.setPeriodAttendants]
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
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel config={f.config} departments={f.departments} onConfigSaved={f.loadConfig} onDepartmentsChanged={f.loadDepartments} />
      </SettingsModal>

      <div className="wrap">
        <header>
          <div className="page-header-row">
            <h1>Termômetro Operacional</h1>
            <div className="page-header-actions">
              <button className="btn small" onClick={copyLink}>
                {linkCopied ? "Link copiado ✓" : "🔗 Copiar link"}
              </button>
              <button className="btn small" disabled={loading || refreshing} onClick={() => loadReport(true)}>
                {refreshing ? "Recarregando…" : "🔄 Recarregar"}
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
          activeDepartments={f.activeDepartments}
          periodAttendants={f.periodAttendants}
          selectedAttendantIds={f.selectedAttendantIds}
          onAttendantFilterChange={f.updateAttendantFilter}
          selectedDeptIds={f.selectedDeptIds}
          onSelectedDeptIdsChange={f.setSelectedDeptIds}
        />

        {!f.configured && (
          <div className="error-box">
            Configure a URL do chatbot e o token clicando no ícone de ajustes (⚙️) no topo da página para começar.
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        {loading && <div className="loading">Carregando relatório…</div>}

        {report && !loading && (
          <>
            {report.departments.map((d) => (
              <DepartmentCard
                key={d.departmentId}
                report={d}
                highlights={report.highlights.filter((h) => h.departmentId === d.departmentId)}
                attention={report.attention.filter((a) => a.departmentId === d.departmentId)}
              />
            ))}

            <WeeklySummary highlights={report.summary?.highlights ?? []} attention={report.summary?.attention ?? []} />

            {(report.departmentRankings ?? []).map((dr) => (
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
