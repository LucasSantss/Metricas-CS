"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon from "./Icon";
import { markNavigated, navigateWithTransition } from "@/lib/pageTransition";

// Ícones: UIcons da Flaticon (regular rounded) — ver components/Icon.tsx
const NAV = [
  { href: "/", icon: "temperature-high", title: "Termômetro operacional" },
  { href: "/percentis", icon: "chart-histogram", title: "Percentis (P50/P75/P90)" },
  { href: "/tickets", icon: "ticket", title: "Painel de tickets" },
  { href: "/relatorio-tickets", icon: "file-chart-line", title: "Relatório semanal de tickets" },
];

// useLayoutEffect avisa a transição antes de a tela nova ser pintada (sem "piscar" no lugar final);
// no servidor ele não existe, então cai pro useEffect só pra não gerar aviso no render do servidor.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const navIndex = (pathname: string) =>
  NAV.findIndex((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)));

type Props = {
  breadcrumb: string;
  title: string;
  configured: boolean;
  onOpenSettings: () => void;
  groupedByDept?: boolean;
  onToggleGroupedByDept?: () => void;
};

export default function TopBar({ breadcrumb, title, configured, onOpenSettings, groupedByDept, onToggleGroupedByDept }: Props) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const current = navIndex(pathname);
  // ícone clicado acende na hora, antes da tela nova terminar de carregar
  const [clicked, setClicked] = useState<number | null>(null);
  const active = clicked ?? current;

  // A barra monta junto com o conteúdo de verdade da tela (não com o "Carregando…" do
  // Suspense): é a hora de o fantasma sair e a tela nova entrar (lib/pageTransition.ts).
  useIsoLayoutEffect(() => {
    markNavigated();
  }, []);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-breadcrumb">{breadcrumb}</div>
        <div className="topbar-title">{title}</div>
      </div>
      <div className="topbar-right">
        {NAV.map((n, i) => {
          const on = i === active;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`topbar-icon-btn ${on ? "on" : ""}`}
              title={n.title}
              aria-label={n.title}
              aria-current={on ? "page" : undefined}
              onClick={(e) => {
                // Ctrl/Cmd/Shift/botão do meio: deixa o navegador abrir em outra aba normalmente
                if (on || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                  if (on) e.preventDefault();
                  return;
                }
                e.preventDefault();
                setClicked(i);
                navigateWithTransition(router, n.href, i > active ? "forward" : "back");
              }}
            >
              <Icon name={n.icon} />
            </Link>
          );
        })}
        <button
          className="topbar-icon-btn"
          title={configured ? "Ajustes (conectado)" : "Ajustes (conecte a API)"}
          aria-label="Ajustes"
          onClick={onOpenSettings}
        >
          <span className={`status-dot ${configured ? "ok" : "bad"}`} style={{ position: "absolute", top: 6, right: 6 }} />
          <Icon name="settings" />
        </button>
        {onToggleGroupedByDept && (
          <button
            className={`topbar-icon-btn ${groupedByDept ? "on" : ""}`}
            title={groupedByDept ? "Ver layout padrão" : "Agrupar clientes recorrentes e motivos por setor"}
            aria-label="Agrupar por setor"
            onClick={onToggleGroupedByDept}
          >
            <Icon name="layers" />
          </button>
        )}
        <button className="topbar-avatar" title="Perfil (em breve)" disabled>
          <span className="topbar-avatar-circle">?</span>
        </button>
      </div>
    </div>
  );
}
