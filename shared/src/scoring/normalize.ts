/** Log-normalized relative score: compresses whales so mid-tier users still see movement. */
export function normalize(value: number, orgMax: number): number {
  if (orgMax <= 0 || value <= 0) return 0;
  const score = (Math.log1p(value) / Math.log1p(orgMax)) * 100;
  return Math.min(100, Math.max(0, score));
}

/** Linear-interpolated percentile over an unsorted sample. p in [0,100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? loVal;
  return loVal + (hiVal - loVal) * (idx - lo);
}

export function median(values: number[]): number {
  return percentile(values, 50);
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
