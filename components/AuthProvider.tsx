"use client";

import { SessionProvider } from "next-auth/react";

/** Deixa a sessão (usuário logado) disponível pros componentes do cliente via useSession. */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
