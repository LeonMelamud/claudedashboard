import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

/** Chart-shaped shimmer: fake bars of varying height. */
export function ChartSkeleton({ className }: { className?: string }) {
  const heights = [38, 62, 45, 78, 55, 88, 40, 70, 52, 82, 60, 47];
  return (
    <div className={cn('flex h-64 w-full items-end gap-2 px-2 pb-2', className)}>
      {heights.map((h, i) => (
        <div key={i} className="skeleton flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full space-y-2 p-1">
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          <Skeleton className="size-7 rounded-full" />
          {Array.from({ length: cols - 1 }).map((_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="card space-y-3 p-4">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-6 w-full" />
    </div>
  );
}
