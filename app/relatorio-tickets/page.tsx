import { Suspense } from "react";
import TicketReportView from "@/components/TicketReportView";

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Carregando…</div>}>
      <TicketReportView />
    </Suspense>
  );
}
