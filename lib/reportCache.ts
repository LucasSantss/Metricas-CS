import type { ReportResult } from "./metrics";

// Versionar o prefixo invalida automaticamente qualquer cache salvo por uma
// versão anterior do app cujo formato do relatório mudou (ex.: campos novos
// como topRecurrentClients/overallRanking que um cache velho não tem).
const PREFIX = "termo:report:v2:";
const TTL_MS = 15 * 60 * 1000; // 15 minutos — depois disso o cache é considerado velho

type CacheEntry<T> = { savedAt: number; report: T };

function cacheKey(periodKey: string, deptIds: string[] | null, attendantIds: string[] | null): string {
  const ids = deptIds && deptIds.length > 0 ? [...deptIds].sort().join(",") : "all";
  const attendants = attendantIds && attendantIds.length > 0 ? [...attendantIds].sort().join(",") : "all";
  return `${PREFIX}${periodKey}:${ids}:${attendants}`;
}

/**
 * Lê o relatório salvo no navegador para esse período (semana "YYYY-MM-DD" ou
 * mês "month:YYYY-MM") + seleção de setores/atendentes, se houver.
 */
export function readReportCache<T extends ReportResult = ReportResult>(
  periodKey: string,
  deptIds: string[] | null,
  attendantIds: string[] | null
): { report: T; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(periodKey, deptIds, attendantIds));
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (!entry?.report || !entry?.savedAt) return null;
    return { report: entry.report, savedAt: entry.savedAt };
  } catch {
    return null;
  }
}

export function isFresh(savedAt: number): boolean {
  return Date.now() - savedAt < TTL_MS;
}

export function writeReportCache<T extends ReportResult>(periodKey: string, deptIds: string[] | null, attendantIds: string[] | null, report: T) {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry<T> = { savedAt: Date.now(), report };
    window.localStorage.setItem(cacheKey(periodKey, deptIds, attendantIds), JSON.stringify(entry));
  } catch {
    // localStorage cheio, desabilitado ou navegação privada — ignora silenciosamente
  }
}

/** Limpa todo o cache de relatórios salvo (usado pelo botão "Recarregar tudo", se precisar). */
export function clearReportCache() {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // ignora
  }
}
