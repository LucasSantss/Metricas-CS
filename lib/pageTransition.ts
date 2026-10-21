/**
 * Transição entre as telas (Termômetro → Percentis → Tickets → Relatório), no estilo
 * "tela dividida": a tela atual sai pela lateral enquanto a nova entra pelo outro lado,
 * lado a lado, na direção da ordem dos ícones (ícone à direita = sai pra esquerda e a
 * nova vem da direita; ícone à esquerda = o contrário).
 *
 * Começa no instante do clique: a tela atual é copiada pra uma camada fixa ("fantasma")
 * que já reage na hora, enquanto o Next carrega a tela nova. Quando a tela nova monta
 * (markNavigated, chamado pelo TopBar), o fantasma sai e a tela nova entra juntos.
 * Estilos em globals.css ("TRANSIÇÃO ENTRE TELAS").
 */

export type NavDirection = "forward" | "back";
type Router = { push: (href: string) => void };

const SLIDE_MS = 560; // igual à duração de .nav-ghost-out / navWrapIn no CSS
const FALLBACK_MS = 3000; // se a tela nova não avisar, a transição termina sozinha

let pendingDir: NavDirection | null = null;
let ghost: HTMLElement | null = null;
let fallbackTimer: number | undefined;

/** true enquanto uma troca de tela está em andamento (usado pelo app/template.tsx). */
export const isNavigating = () => pendingDir !== null;

/** Copia a tela atual (com os valores dos campos) pra uma camada fixa no mesmo lugar. */
function makeGhost(wrap: HTMLElement, dir: NavDirection) {
  const rect = wrap.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = `nav-ghost nav-ghost-${dir}`;
  layer.setAttribute("aria-hidden", "true");
  layer.style.top = `${rect.top}px`;
  layer.style.left = `${rect.left}px`;
  layer.style.width = `${rect.width}px`;

  const clone = wrap.cloneNode(true) as HTMLElement;
  clone.classList.add("nav-ghost-wrap");
  // cloneNode não leva o valor atual de selects/inputs: copia pra cópia ficar igual à tela
  const src = wrap.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  const dst = clone.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  src.forEach((el, i) => {
    const c = dst[i];
    if (!c) return;
    if (el instanceof HTMLSelectElement) (c as HTMLSelectElement).selectedIndex = el.selectedIndex;
    else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) (c as HTMLInputElement).checked = el.checked;
    else c.value = el.value;
  });
  clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

  layer.appendChild(clone);
  document.body.appendChild(layer);
  // próximo quadro: o "empurrãozinho" imediato do clique
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("nav-ghost-nudge")));
  return layer;
}

function finishImmediately() {
  window.clearTimeout(fallbackTimer);
  ghost?.remove();
  ghost = null;
  pendingDir = null;
  delete document.documentElement.dataset.navLeaving;
  delete document.documentElement.dataset.navEnter;
}

export function navigateWithTransition(router: Router, href: string, dir: NavDirection) {
  finishImmediately(); // um clique novo no meio de uma transição recomeça do zero
  const wrap = document.querySelector<HTMLElement>(".wrap:not(.nav-ghost-wrap)");
  if (wrap) ghost = makeGhost(wrap, dir);
  pendingDir = dir;
  // esconde a tela real (o fantasma está por cima, igual a ela) até a nova chegar
  document.documentElement.dataset.navLeaving = dir;
  router.push(href);
  fallbackTimer = window.setTimeout(markNavigated, FALLBACK_MS);
}

/** Chamado quando a tela nova monta (antes de pintar): fantasma sai e tela nova entra, juntos. */
export function markNavigated() {
  if (!pendingDir) return;
  const dir = pendingDir;
  const g = ghost;
  pendingDir = null;
  ghost = null;
  window.clearTimeout(fallbackTimer);

  const html = document.documentElement;
  delete html.dataset.navLeaving;
  html.dataset.navEnter = dir;
  g?.classList.add("nav-ghost-out");
  window.setTimeout(() => {
    g?.remove();
    if (html.dataset.navEnter === dir) delete html.dataset.navEnter;
  }, SLIDE_MS + 80);
}
