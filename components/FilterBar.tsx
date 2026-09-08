"use client";

import type { Dispatch, SetStateAction } from "react";
import type { DepartmentDto, PeriodAttendantDto, WeekDto } from "@/lib/types";
import AttendantFilter from "./AttendantFilter";

const MONTHS = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

/** "YYYY-MM-DD" -> "DD/MM/YYYY", sem passar por Date/fuso do navegador. */
function formatBr(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

type Props = {
  year: number;
  onYearChange: (year: number) => void;
  month: number;
  onMonthChange: (month: number) => void;
  viewMode: "week" | "month";
  onViewModeChange: (mode: "week" | "month") => void;
  weeks: WeekDto[];
  weekStart: string;
  onWeekStartChange: (weekStart: string) => void;
  activeDepartments: DepartmentDto[];
  periodAttendants: PeriodAttendantDto[];
  selectedAttendantIds: string[];
  onAttendantFilterChange: (ids: string[]) => void;
  selectedDeptIds: Set<string> | null;
  onSelectedDeptIdsChange: Dispatch<SetStateAction<Set<string> | null>>;
};

export default function FilterBar({
  year,
  onYearChange,
  month,
  onMonthChange,
  viewMode,
  onViewModeChange,
  weeks,
  weekStart,
  onWeekStartChange,
  activeDepartments,
  periodAttendants,
  selectedAttendantIds,
  onAttendantFilterChange,
  selectedDeptIds,
  onSelectedDeptIdsChange,
}: Props) {
  function toggleDept(departmentId: string) {
    onSelectedDeptIdsChange((prev) => {
      const all = new Set(activeDepartments.map((x) => x.departmentId));
      const cur = prev ?? all;
      const next = new Set(cur);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next.size === all.size ? null : next;
    });
  }

  return (
    <div className="filter-bar">
      <div className="filter-bar-row">
        <div className="field">
          <label>Ano</label>
          <input type="number" className="field-year" value={year} onChange={(e) => onYearChange(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Mês</label>
          <select value={month} onChange={(e) => onMonthChange(Number(e.target.value))}>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Período</label>
          <div className="view-mode-toggle">
            <button type="button" className={viewMode === "week" ? "on" : ""} onClick={() => onViewModeChange("week")}>
              Semana
            </button>
            <button type="button" className={viewMode === "month" ? "on" : ""} onClick={() => onViewModeChange("month")}>
              Mês inteiro
            </button>
          </div>
        </div>
        {viewMode === "week" && (
          <div className="field grow">
            <label>Semana (seg–sáb)</label>
            <select value={weekStart} onChange={(e) => onWeekStartChange(e.target.value)}>
              {weeks.map((w) => (
                <option key={w.mondayDate} value={w.mondayDate}>
                  {w.label} · {formatBr(w.mondayDate)} a {formatBr(w.saturdayDate)}
                </option>
              ))}
            </select>
          </div>
        )}
        {activeDepartments.length > 0 && (
          <div className="field">
            <label>Atendente</label>
            <AttendantFilter attendants={periodAttendants} selected={selectedAttendantIds} onChange={onAttendantFilterChange} />
          </div>
        )}
      </div>

      {activeDepartments.length > 0 && (
        <div className="field grow">
          <label>Setores no relatório</label>
          <div className="dept-toggle-list">
            {activeDepartments.map((d) => {
              const isOn = !selectedDeptIds || selectedDeptIds.has(d.departmentId);
              return (
                <button
                  key={d.departmentId}
                  type="button"
                  className={`dept-toggle ${isOn ? "on" : "off"}`}
                  aria-pressed={isOn}
                  onClick={() => toggleDept(d.departmentId)}
                >
                  <span className="dept-toggle-check" />
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
