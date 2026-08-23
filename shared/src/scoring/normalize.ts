/**
 * Score against a fixed target: sqrt curve, capped at 100. A pure function of
 * the user's own value — nobody else's volume appears in the denominator
 * (replaces the old log-vs-org-max `normalize`, where one whale rescaled the
 * whole org). sqrt keeps early progress rewarding (half the target = 70.7)
 * and — unlike log — grades every metric on the same curve regardless of the
 * target's magnitude. Values past the target are worth nothing: inflation
 * doesn't pay.
 */
export function score(value: number, target: number): number {
  if (target <= 0 || value <= 0) return 0;
  return Math.min(100, Math.sqrt(value / target) * 100);
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
