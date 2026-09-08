export function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0 ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
}

/** "4min" / "36seg" / "1min18seg" / "1h30min40seg" — h/min/seg compactos, sem casa decimal. */
export function fmtMinSec(seconds: number | null): string {
  if (seconds == null) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (min > 0 || (h > 0 && sec > 0)) parts.push(`${min}min`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}seg`);
  return parts.join(" ");
}

/** "+1min18seg" / "−36seg" / "0seg" — diferença em h/min/seg, com sinal explícito. */
export function fmtMinSecDelta(diffSeconds: number): string {
  const sign = diffSeconds > 0 ? "+" : diffSeconds < 0 ? "−" : "";
  return `${sign}${fmtMinSec(Math.abs(diffSeconds))}`;
}

/** "34%" — percentual inteiro (sem casa decimal), formato pt-BR. */
export function fmtPct0(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}

/** "+24,3" / "−24,3" / "0" — diferença percentual (pontos) com 1 casa, com sinal explícito. */
export function fmtPctDelta1(diff: number): string {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const abs = Math.abs(diff).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${sign}${abs}`;
}
