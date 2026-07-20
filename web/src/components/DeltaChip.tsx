import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui';

/**
 * Delta chip vs previous period. Pass either a precomputed percent (deltaPct)
 * or current+prev raw values.
 */
export function DeltaChip({
  current,
  prev,
  deltaPct,
  invert = false,
  className,
  tooltip,
}: {
  current?: number;
  prev?: number;
  /** already-computed percent change, e.g. trendDeltaPct */
  deltaPct?: number | null;
  /** lower-is-better metrics (cost): flips the good/bad colors */
  invert?: boolean;
  className?: string;
  tooltip?: string;
}) {
  let pct: number | null = null;
  if (deltaPct !== undefined) {
    pct = deltaPct;
  } else if (current !== undefined && prev !== undefined) {
    pct = prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : current !== 0 ? null : 0;
  }

  let node: React.ReactNode;
  if (pct === null) {
    node = (
      <span className={cn('inline-flex items-center rounded-full bg-fg/5 px-1.5 py-0.5 text-[11px] font-medium text-muted', className)}>
        new
      </span>
    );
  } else {
    const up = pct > 0.5;
    const down = pct < -0.5;
    const good = invert ? down : up;
    const bad = invert ? up : down;
    node = (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
          good && 'bg-good/10 text-good',
          bad && 'bg-risk/10 text-risk',
          !good && !bad && 'bg-fg/5 text-muted',
          className,
        )}
      >
        {up ? '▲' : down ? '▼' : '—'}
        {Math.abs(pct) >= 1000 ? `${Math.round(Math.abs(pct) / 100)}x` : `${Math.abs(pct).toFixed(0)}%`}
      </span>
    );
  }

  return tooltip ? <Tip content={tooltip}>{node}</Tip> : node;
}
