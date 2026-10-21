/**
 * Cache em memória (no navegador) das leituras GET das abas, com validade por tipo de dado.
 * Vive enquanto a aba do navegador estiver aberta — a navegação entre telas não recarrega a
 * página, então o que foi pré-carregado (lib/preload.ts) já está aqui quando a tela abre.
 * Duas chamadas iguais ao mesmo tempo viram uma só. Só guarda respostas de sucesso.
 */

/** Validade de cada tipo de dado (alinhada com o ritmo de atualização de cada aba). */
export const CACHE_TTL = {
  /** Painel de tickets: mesmo intervalo da atualização automática (AUTO_REFRESH_MS) */
  tickets: 2 * 60 * 1000,
  /** Percentis: mesma validade do cache do Termômetro (lib/reportCache.ts) */
  percentiles: 15 * 60 * 1000,
  /** Relatório de tickets: lista de semanas e relatório salvo (gerado 1x por dia) */
  ticketReports: 5 * 60 * 1000,
  /** Ajustes e setores, usados por todas as telas */
  config: 5 * 60 * 1000,
} as const;

export type CachedResponse<T = any> = { ok: boolean; status: number; data: T; at: number };

const store = new Map<string, CachedResponse>();
const inflight = new Map<string, Promise<CachedResponse>>();

async function load(url: string): Promise<CachedResponse> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  const entry = { ok: res.ok, status: res.status, data, at: Date.now() };
  if (res.ok) store.set(url, entry);
  return entry;
}

/**
 * GET em JSON com cache: devolve o guardado se ainda estiver dentro de `ttlMs`; senão busca.
 * `force` ignora o guardado (botões de atualizar, atualização automática, depois de salvar).
 */
export function cachedJson<T = any>(url: string, ttlMs: number, { force = false } = {}): Promise<CachedResponse<T>> {
  const hit = store.get(url);
  if (!force && hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit as CachedResponse<T>);
  const running = inflight.get(url);
  if (running && !force) return running as Promise<CachedResponse<T>>;
  const p = load(url).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p as Promise<CachedResponse<T>>;
}

/** Descarta o que estiver guardado pra URLs que começam com `prefix` (ex.: depois de salvar). */
export function invalidateCached(prefix: string) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
