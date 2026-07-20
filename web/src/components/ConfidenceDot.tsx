import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

export function ConfidenceDot({ reason, className }: { reason: string; className?: string }) {
  return (
    <Tip content={<span>Low confidence: {reason}</span>}>
      <span
        className={cn('inline-block size-1.5 rounded-full bg-muted/70 align-middle', className)}
        aria-label={`Low confidence: ${reason}`}
      />
    </Tip>
  );
}
