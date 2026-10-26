"use client";

import { useEffect, useState } from "react";
import { CACHE_TTL, cachedJson } from "@/lib/clientCache";

export type Me = { email: string | null; isAdmin: boolean; isSuperAdmin: boolean };

/**
 * Se o usuário logado é administrador (lib/admin.ts) — decide se a barra mostra Ajustes e Conversas.
 * null enquanto carrega. É só pra interface: quem barra de verdade são as rotas de API e a página.
 */
export function useAdmin(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    cachedJson<Me>("/api/me", CACHE_TTL.config).then((r) => setMe(r.ok ? r.data : { email: null, isAdmin: false, isSuperAdmin: false }));
  }, []);
  return me;
}
