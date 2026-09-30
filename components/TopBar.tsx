"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", icon: "📋", title: "Termômetro operacional" },
  { href: "/percentis", icon: "📊", title: "Percentis (P50/P75/P90)" },
  { href: "/tickets", icon: "🎫", title: "Painel de tickets" },
];

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

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-breadcrumb">{breadcrumb}</div>
        <div className="topbar-title">{title}</div>
      </div>
      <div className="topbar-right">
        {NAV.map((n) => {
          const on = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`topbar-icon-btn ${on ? "on" : ""}`} title={n.title} aria-current={on ? "page" : undefined}>
              {n.icon}
            </Link>
          );
        })}
        <button
          className="topbar-icon-btn"
          title={configured ? "Ajustes (conectado)" : "Ajustes (conecte a API)"}
          onClick={onOpenSettings}
        >
          <span className={`status-dot ${configured ? "ok" : "bad"}`} style={{ position: "absolute", top: 6, right: 6 }} />
          ⚙️
        </button>
        {onToggleGroupedByDept && (
          <button
            className={`topbar-icon-btn ${groupedByDept ? "on" : ""}`}
            title={groupedByDept ? "Ver layout padrão" : "Agrupar clientes recorrentes e motivos por setor"}
            onClick={onToggleGroupedByDept}
          >
            🗂️
          </button>
        )}
        <button className="topbar-avatar" title="Perfil (em breve)" disabled>
          <span className="topbar-avatar-circle">?</span>
        </button>
      </div>
    </div>
  );
}
