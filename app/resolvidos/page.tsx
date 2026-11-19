import { Suspense } from "react";
import ResolvedView from "@/components/ResolvedView";

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Carregando…</div>}>
      <ResolvedView />
    </Suspense>
  );
}
