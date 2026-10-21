/**
 * Pré-carregamento das abas: busca em segundo plano os dados de cada tela (respeitando o
 * cache de cada uma) e o código das rotas, pra que a troca de tela já encontre tudo pronto.
 * Roda uma vez por carregamento da página (components/SplashScreen.tsx), pulando a aba que
 * já está aberta (ela mesma carrega os seus dados).
 *
 * As URLs são montadas igual às telas montam (useFilterState + Dashboard/PercentilesView),
 * senão o cache não seria reaproveitado.
 */
import { readDashboardPrefs } from "./dashboardPrefs";
import { readAttendantFilter } from "./attendantFilter";
import { isFresh, readReportCache, writeReportCache } from "./reportCache";
import { CACHE_TTL, cachedJson } from "./clientCache";

const ROUTES = ["/", "/percentis", "/tickets", "/relatorio-tickets"] as const;
type Router = { prefetch: (href: string) => void };

const pad = (n: number) => String(n).padStart(2, "0");

/** Mesmo período que useFilterState restauraria do cache do navegador (última visita). */
async function savedPeriod() {
  const now = new Date();
  const prefs = readDashboardPrefs();
  const year = prefs.year ?? now.getFullYear();
  const month = prefs.month ?? now.getMonth() + 1;
  const viewMode = prefs.viewMode ?? "week";
  const dayDate = prefs.dayDate ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let weekStart = prefs.weekStart ?? "";
  if (viewMode === "week") {
    // useFilterState troca a semana salva pela última do mês quando ela não pertence a ele
    const r = await cachedJson<{ weeks?: { mondayDate: string }[] }>(`/api/weeks?year=${year}&month=${month}`, CACHE_TTL.config);
    const weeks = r.data?.weeks ?? [];
    if (weeks.length && !weeks.some((w) => w.mondayDate === weekStart)) weekStart = weeks[weeks.length - 1].mondayDate;
    if (!weekStart) return null;
  }
  const periodKey = viewMode === "month" ? `month:${year}-${pad(month)}` : viewMode === "day" ? `day:${dayDate}` : weekStart;
  const periodQuery =
    viewMode === "month" ? `mode=month&year=${year}&month=${month}` : viewMode === "day" ? `mode=day&date=${dayDate}` : `weekStart=${weekStart}`;
  const deptIdsArr = prefs.deptIds ?? null;
  const attendants = readAttendantFilter();
  const attendantIdsArr = attendants.length > 0 ? attendants : null;
  const idsParam = deptIdsArr && deptIdsArr.length > 0 ? `&departmentIds=${deptIdsArr.join(",")}` : "";
  const attendantsParam = attendantIdsArr ? `&attendantIds=${attendantIdsArr.join(",")}` : "";
  return { periodKey, periodQuery, deptIdsArr, attendantIdsArr, suffix: `${idsParam}${attendantsParam}` };
}

const quiet = (p: Promise<unknown>) => p.catch(() => undefined);

export async function preloadAll(router: Router, currentPath: string) {
  // código das telas (no modo de desenvolvimento o Next ignora; em produção deixa a troca instantânea)
  ROUTES.filter((r) => r !== currentPath).forEach((r) => router.prefetch(r));

  const skip = (route: (typeof ROUTES)[number]) => route === currentPath;
  const tasks: Promise<unknown>[] = [];

  // dados usados por todas as telas
  const config = cachedJson<{ chatbotUrl?: string | null; hasToken?: boolean }>("/api/config", CACHE_TTL.config);
  tasks.push(cachedJson("/api/departments", CACHE_TTL.config));

  // Painel e Relatório de tickets não dependem da conexão com a Suri
  if (!skip("/tickets")) tasks.push(cachedJson("/api/tickets/softcs", CACHE_TTL.tickets));
  if (!skip("/relatorio-tickets")) {
    tasks.push(
      cachedJson<{ reports?: { weekStart: string }[]; lastCompleteWeek?: string }>("/api/ticket-reports", CACHE_TTL.ticketReports).then((r) => {
        const week = r.data?.reports?.[0]?.weekStart ?? r.data?.lastCompleteWeek;
        return week ? cachedJson(`/api/ticket-reports?week=${week}`, CACHE_TTL.ticketReports) : undefined;
      })
    );
  }

  // Termômetro e Percentis: só com a Suri configurada, no período/setores/atendentes da última visita
  tasks.push(
    config.then(async (c) => {
      if (!c.data?.chatbotUrl || !c.data?.hasToken) return;
      const p = await savedPeriod();
      if (!p) return;
      const jobs: Promise<unknown>[] = [];
      if (!skip("/")) {
        const cached = readReportCache(p.periodKey, p.deptIdsArr, p.attendantIdsArr);
        if (!cached || !isFresh(cached.savedAt)) {
          jobs.push(
            fetch(`/api/report?${p.periodQuery}${p.suffix}`).then(async (res) => {
              if (res.ok) writeReportCache(p.periodKey, p.deptIdsArr, p.attendantIdsArr, await res.json());
            })
          );
        }
      }
      if (!skip("/percentis")) jobs.push(cachedJson(`/api/percentiles?${p.periodQuery}${p.suffix}`, CACHE_TTL.percentiles));
      await Promise.all(jobs.map(quiet));
    })
  );

  await Promise.all(tasks.map(quiet));
}
