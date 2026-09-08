"use client";

import { useEffect, useState } from "react";
import { useFilterState } from "./useFilterState";
import SettingsPanel from "./SettingsPanel";
import SettingsModal from "./SettingsModal";
import TopBar from "./TopBar";
import FilterBar from "./FilterBar";
import PercentileDeptCard from "./PercentileDeptCard";
import PercentileDetailModal, { type P90Entry } from "./PercentileDetailModal";
import type { PeriodAttendantDto } from "@/lib/types";

type Stats = { p50: number | null; p75: number | null; p90: number | null; count: number };
type GoalStats = { p50: number; p75: number; p90: number };
type PercentileDept = {
  departmentId: string;
  name: string;
  tme: Stats;
  tma: Stats;
  tmr: Stats;
  tmeP90: P90Entry[];
  tmaP90: P90Entry[];
  tmrP90: P90Entry[];
  goals: { tme: GoalStats; tma: GoalStats; tmr: GoalStats };
  pctAboveGoalP90: { tme: number | null; tma: number | null; tmr: number | null };
};
type PercentileResponse = {
  period: { label: string; mondayDate: string; saturdayDate: string };
  chatbotId: string | null;
  departments: PercentileDept[];
  periodAttendants: PeriodAttendantDto[];
};

const METRIC_LABELS: Record<"tme" | "tma" | "tmr", string> = {
  tme: "TME — tempo médio de espera",
  tma: "TMA — tempo médio de atendimento",
  tmr: "TMR — tempo médio de resposta",
};

export default function PercentilesView() {
  const f = useFilterState();
  const [data, setData] = useState<PercentileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detail, setDetail] = useState<{ dept: PercentileDept; metric: "tme" | "tma" | "tmr" } | null>(null);

  const deptIdsKey = f.deptIdsArr?.join(",") ?? "";
  const attendantIdsKey = f.attendantIdsArr?.join(",") ?? "";

  useEffect(() => {
    if (!f.prefsLoaded || !f.configured) return;
    if (f.viewMode === "week" && !f.weekStart) return;

    setError(null);
    setLoading(true);
    const idsParam = deptIdsKey ? `&departmentIds=${deptIdsKey}` : "";
    const attendantsParam = attendantIdsKey ? `&attendantIds=${attendantIdsKey}` : "";
    fetch(`/api/percentiles?${f.periodQuery}${idsParam}${attendantsParam}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Falha ao carregar percentis");
        setData(json);
        f.setPeriodAttendants(json.periodAttendants ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [f.prefsLoaded, f.configured, f.viewMode, f.weekStart, f.periodQuery, deptIdsKey, attendantIdsKey, f.setPeriodAttendants]);

  return (
    <>
      <TopBar breadcrumb="Relatórios / Suporte" title="Percentis operacionais" configured={f.configured} onOpenSettings={() => setSettingsOpen(true)} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel config={f.config} departments={f.departments} onConfigSaved={f.loadConfig} onDepartmentsChanged={f.loadDepartments} />
      </SettingsModal>

      <div className="wrap">
        <header>
          <div className="page-header-row">
            <h1>Percentis operacionais</h1>
          </div>
          {data && (
            <div className="subtitle">
              {data.period.label} · distribuição de TME, TMA e TMR (P50/P75/P90) por setor
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
        {loading && <div className="loading">Carregando percentis…</div>}

        {data && !loading && (
          <div className="percentile-grid">
            {data.departments.map((d) => (
              <PercentileDeptCard
                key={d.departmentId}
                name={d.name}
                tme={d.tme}
                tma={d.tma}
                tmr={d.tmr}
                goals={d.goals}
                pctAboveGoalP90={d.pctAboveGoalP90}
                onOpenMetric={(metric) => setDetail({ dept: d, metric })}
              />
            ))}
            {data.departments.length === 0 && <div className="hint">Nenhum setor para exibir.</div>}
          </div>
        )}
      </div>

      <PercentileDetailModal
        open={detail != null}
        onClose={() => setDetail(null)}
        metricLabel={detail ? METRIC_LABELS[detail.metric] : ""}
        deptName={detail?.dept.name ?? ""}
        entries={detail ? detail.dept[`${detail.metric}P90`] : []}
        chatbotId={data?.chatbotId ?? null}
      />
    </>
  );
}
