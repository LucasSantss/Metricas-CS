"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { preloadAll } from "@/lib/preload";
import { SPLASH_KEY } from "@/lib/splash";
const SPLASH_MS = 1000;
const FADE_MS = 420;

// roda uma vez por carregamento da página (o StrictMode do desenvolvimento monta duas vezes)
let preloadStarted = false;

/**
 * Tela inicial (logo + barra de 1 s) no primeiro acesso da sessão, enquanto as abas são
 * pré-carregadas em segundo plano (lib/preload.ts). Quem decide se ela aparece é o script
 * no <head> do app/layout.tsx (classe "splash" no <html>), antes da primeira pintura —
 * assim ela não "pisca" depois da tela. Nos acessos seguintes, só o pré-carregamento roda.
 */
export default function SplashScreen() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    const html = document.documentElement;
    const showing = html.classList.contains("splash");

    if (!preloadStarted) {
      preloadStarted = true;
      // com a tela inicial, começa na hora; sem ela, espera a tela atual carregar o que precisa
      window.setTimeout(() => preloadAll(router, pathname), showing ? 0 : 1200);
    }
    if (!showing) return;

    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {}
    // 1 s contado desde que a tela inicial apareceu (anotado pelo script do <head>), não desde
    // aqui: o JavaScript da página pode demorar pra carregar. Se o 1 s já passou, sai agora.
    const shownAt = (window as Window & { __splashAt?: number }).__splashAt ?? performance.now();
    const wait = Math.max(0, SPLASH_MS - (performance.now() - shownAt));
    const t1 = window.setTimeout(() => html.classList.add("splash-out"), wait);
    const t2 = window.setTimeout(() => html.classList.remove("splash", "splash-out"), wait + FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // só na montagem: a tela inicial e o pré-carregamento acontecem uma vez por carregamento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="splash-screen" aria-hidden="true">
      <div className="splash-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.jpg" alt="" className="splash-logo" width={112} height={112} />
        <div className="splash-title">CS Suporte</div>
        <div className="splash-sub">Métricas, percentis e tickets</div>
        <div className="splash-bar">
          <i />
        </div>
      </div>
    </div>
  );
}
