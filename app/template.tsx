"use client";

/**
 * Diferente do layout, o template remonta a cada troca de tela: é o que dispara a
 * entrada em cascata das seções (.page-enter no globals.css).
 * (O aviso de "tela nova no lugar" pra transição entre telas sai do TopBar, que só
 * monta junto com o conteúdo real — ver lib/pageTransition.ts.)
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
