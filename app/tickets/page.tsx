import { Suspense } from "react";
import TicketsView from "@/components/TicketsView";

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Carregando…</div>}>
      <TicketsView />
    </Suspense>
  );
}
