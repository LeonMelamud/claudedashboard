import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export function ErrorCard({
  error,
  onRetry,
  className,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 text-center',
        compact ? 'py-6' : 'card min-h-48 p-6',
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-full bg-risk/10 text-risk">
        <AlertTriangle size={17} />
      </div>
      <div>
        <div className="text-sm font-medium">Couldn't load data</div>
        <div className="mt-0.5 max-w-sm text-xs text-muted">{message}</div>
      </div>
      {onRetry && (
        <Button onClick={onRetry} variant="default">
          <RotateCw size={12} /> Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ text = 'No data in this range', className }: { text?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-40 w-full flex-col items-center justify-center gap-1.5 text-center', className)}>
      <div className="text-2xl opacity-60">🌵</div>
      <div className="text-xs text-muted">{text}</div>
    </div>
  );
}
