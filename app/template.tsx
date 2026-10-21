"use client";

import { useState } from "react";
import { isNavigating } from "@/lib/pageTransition";

/**
 * Diferente do layout, o template remonta a cada troca de tela.
 * - Primeira abertura da plataforma: as seções entram em cascata (.page-enter no globals.css).
 * - Tela que chega por uma troca de tela (ícones do topo): quem anima é a "tela dividida"
 *   (lib/pageTransition.ts), então a cascata fica desligada de vez nessa montagem — se ela só
 *   ficasse pausada durante a troca, recomeçaria do zero ao fim dela e a tela "piscaria".
 * O valor é fixado na montagem (useState) pra não mudar depois que a transição termina.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const [viaNav] = useState(() => typeof window !== "undefined" && isNavigating());
  return <div className={viaNav ? "page-enter page-enter-nav" : "page-enter"}>{children}</div>;
}
