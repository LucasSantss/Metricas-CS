// Últimas configurações de visualização (ano, mês, semana, setores selecionados)
// salvas só no navegador (localStorage) — cada pessoa mantém a própria preferência,
// nada disso vai para o banco.

const KEY = "termo:dashboardPrefs";

export type DashboardPrefs = {
  year?: number;
  month?: number;
  weekStart?: string;
  dayDate?: string;
  /** "day" = comparar dia atual x anterior; "week" = comparar semana atual x anterior; "month" = mês inteiro atual x anterior */
  viewMode?: "day" | "week" | "month";
  /** null = todos os setores; array = ids selecionados */
  deptIds?: string[] | null;
};

export function readDashboardPrefs(): DashboardPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeDashboardPrefs(prefs: DashboardPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // localStorage cheio, desabilitado ou navegação privada — ignora silenciosamente
  }
}
