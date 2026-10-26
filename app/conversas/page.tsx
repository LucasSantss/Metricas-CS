import { Suspense } from "react";
import { redirect } from "next/navigation";
import ConversationsView from "@/components/ConversationsView";
import { currentAdmin } from "@/lib/admin";

// aba só de administradores (lib/admin.ts): quem não é volta pra tela inicial
export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await currentAdmin())) redirect("/");
  return (
    <Suspense fallback={<div className="loading">Carregando…</div>}>
      <ConversationsView />
    </Suspense>
  );
}
