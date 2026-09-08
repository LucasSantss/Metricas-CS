import type { SuriAttendance } from "./suri";

export type PercentileStats = { p50: number | null; p75: number | null; p90: number | null; count: number };

export type P90Entry = {
  protocol: string;
  valueSeconds: number;
  attendantName: string | null;
  userId: string | null;
  userName: string | null;
};

/** Percentil por interpolação linear (método "linear" do numpy/Excel), sobre um array já ordenado ascendente. */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
}

export function computePercentileStats(values: number[]): PercentileStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    count: sorted.length,
  };
}

/**
 * Atendimentos no "bucket" do P90 de uma métrica (valor >= limiar do P90),
 * ordenados do maior pro menor tempo — usados no modal de detalhe por percentil.
 */
export function buildP90Entries(records: SuriAttendance[], valueOf: (r: SuriAttendance) => number, p90Threshold: number | null): P90Entry[] {
  if (p90Threshold == null) return [];
  return records
    .map((r) => ({ r, value: valueOf(r) }))
    .filter(({ value }) => value >= p90Threshold)
    .sort((a, b) => b.value - a.value)
    .map(({ r, value }) => ({
      protocol: r.protocol,
      valueSeconds: value,
      attendantName: r.attendantName,
      userId: r.user?.id ?? null,
      userName: r.user?.name ?? null,
    }));
}
