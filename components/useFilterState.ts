"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ConfigResponse, DepartmentDto, PeriodAttendantDto, WeekDto } from "@/lib/types";
import { readAttendantFilter, writeAttendantFilter } from "@/lib/attendantFilter";
import { readDashboardPrefs, writeDashboardPrefs } from "@/lib/dashboardPrefs";

/**
 * Estado de filtros (ano/mês/semana/período/setores/atendente) compartilhado
 * entre o relatório principal e a tela de percentis. Restaura da URL (link
 * compartilhável) se presente, senão do cache do navegador (última visita), e
 * mantém a URL sempre sincronizada com a seleção atual pra dar pra copiar e
 * mandar pra alguém.
 */
export function useFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [now]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [weeks, setWeeks] = useState<WeekDto[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [dayDate, setDayDate] = useState(todayStr);
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [selectedDeptIds, setSelectedDeptIds] = useState<Set<string> | null>(null); // null = todos
  const [selectedAttendantIds, setSelectedAttendantIds] = useState<string[]>([]);
  // atendentes que aparecem nos resultados da busca atual — preenchido pela tela
  // (Dashboard/Percentis) a partir da resposta de /api/report ou /api/percentiles,
  // que já traz quem de fato atendeu no período/setores filtrados.
  const [periodAttendants, setPeriodAttendants] = useState<PeriodAttendantDto[]>([]);

  const [prefsLoaded, setPrefsLoaded] = useState(false);

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

  // restaura da URL (prioridade — é o que faz o link compartilhável funcionar) ou do cache local
  useEffect(() => {
    const spYear = Number(searchParams.get("year"));
    const spMonth = Number(searchParams.get("month"));
    const spMode = searchParams.get("mode");
    const spWeek = searchParams.get("week");
    const spDay = searchParams.get("day");
    const spDepts = searchParams.get("depts");
    const hasUrlState = Boolean(spYear || spMonth || spMode || spWeek || spDay || spDepts || searchParams.has("attendants"));

    if (hasUrlState) {
      if (spYear) setYear(spYear);
      if (spMonth) setMonth(spMonth);
      if (spMode === "week" || spMode === "month" || spMode === "day") setViewMode(spMode);
      if (spWeek) setWeekStart(spWeek);
      if (spDay) setDayDate(spDay);
      if (spDepts) setSelectedDeptIds(spDepts === "all" ? null : new Set(spDepts.split(",").filter(Boolean)));
      if (searchParams.has("attendants")) {
        const ids = (searchParams.get("attendants") ?? "").split(",").filter(Boolean);
        setSelectedAttendantIds(ids);
        writeAttendantFilter(ids);
      } else {
        setSelectedAttendantIds(readAttendantFilter());
      }
    } else {
      const prefs = readDashboardPrefs();
      if (prefs.year) setYear(prefs.year);
      if (prefs.month) setMonth(prefs.month);
      if (prefs.weekStart) setWeekStart(prefs.weekStart);
      if (prefs.dayDate) setDayDate(prefs.dayDate);
      if (prefs.viewMode) setViewMode(prefs.viewMode);
      if (prefs.deptIds !== undefined) setSelectedDeptIds(prefs.deptIds ? new Set(prefs.deptIds) : null);
      setSelectedAttendantIds(readAttendantFilter());
    }
    setPrefsLoaded(true);
    // roda só uma vez, na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // guarda a última visita no cache do navegador
  useEffect(() => {
    if (!prefsLoaded) return;
    writeDashboardPrefs({
      year,
      month,
      weekStart,
      dayDate,
      viewMode,
      deptIds: selectedDeptIds ? Array.from(selectedDeptIds) : null,
    });
  }, [prefsLoaded, year, month, weekStart, dayDate, viewMode, selectedDeptIds]);

  // mantém a URL sincronizada — é isso que torna o link copiável/compartilhável
  useEffect(() => {
    if (!prefsLoaded) return;
    const params = new URLSearchParams();
    params.set("year", String(year));
    params.set("month", String(month));
    params.set("mode", viewMode);
    if (viewMode === "week" && weekStart) params.set("week", weekStart);
    if (viewMode === "day" && dayDate) params.set("day", dayDate);
    params.set("depts", selectedDeptIds && selectedDeptIds.size > 0 ? Array.from(selectedDeptIds).join(",") : "all");
    params.set("attendants", selectedAttendantIds.join(","));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [prefsLoaded, year, month, viewMode, weekStart, dayDate, selectedDeptIds, selectedAttendantIds, pathname, router]);

  useEffect(() => {
    if (!prefsLoaded || viewMode !== "week") return;
    (async () => {
      const res = await fetch(`/api/weeks?year=${year}&month=${month}`);
      const json = await res.json();
      const list: WeekDto[] = json.weeks ?? [];
      setWeeks(list);
      if (list.length > 0 && !list.find((w) => w.mondayDate === weekStart)) {
        setWeekStart(list[list.length - 1].mondayDate);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [year, month, prefsLoaded, viewMode]);

  const updateAttendantFilter = useCallback((ids: string[]) => {
    setSelectedAttendantIds(ids);
    writeAttendantFilter(ids);
  }, []);

  const activeDepartments = useMemo(() => departments.filter((d) => d.active), [departments]);
  const configured = Boolean(config?.chatbotUrl && config?.hasToken);

  // Precisa ser memoizado: sem isso, Array.from(selectedDeptIds) cria uma
  // referência nova a cada render, o que muda a identidade de qualquer
  // useCallback/useEffect que dependa dele — e como o efeito que carrega o
  // relatório depende de deptIdsArr, isso causava um loop infinito de novas
  // buscas (a cada resposta, o componente renderizava de novo, gerando um
  // array novo, disparando outra busca, sem parar).
  const deptIdsArr = useMemo(() => (selectedDeptIds ? Array.from(selectedDeptIds) : null), [selectedDeptIds]);
  const attendantIdsArr = selectedAttendantIds.length > 0 ? selectedAttendantIds : null;
  const periodKey =
    viewMode === "month" ? `month:${year}-${String(month).padStart(2, "0")}` : viewMode === "day" ? `day:${dayDate}` : weekStart;
  const periodQuery =
    viewMode === "month"
      ? `mode=month&year=${year}&month=${month}`
      : viewMode === "day"
      ? `mode=day&date=${dayDate}`
      : `weekStart=${weekStart}`;

  return {
    year,
    setYear,
    month,
    setMonth,
    weeks,
    weekStart,
    setWeekStart,
    dayDate,
    setDayDate,
    viewMode,
    setViewMode,
    config,
    loadConfig,
    departments,
    loadDepartments,
    activeDepartments,
    configured,
    selectedDeptIds,
    setSelectedDeptIds,
    selectedAttendantIds,
    updateAttendantFilter,
    periodAttendants,
    setPeriodAttendants,
    prefsLoaded,
    periodKey,
    periodQuery,
    deptIdsArr,
    attendantIdsArr,
  };
}
