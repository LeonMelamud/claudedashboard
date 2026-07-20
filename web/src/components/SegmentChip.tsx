import { SEGMENT_CATALOG, type SegmentTier } from '@dash/shared';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

export function SegmentChip({
  tier,
  size = 'sm',
  className,
}: {
  tier: SegmentTier;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const meta = SEGMENT_CATALOG[tier];
  return (
    <Tip
      wide
      content={
        <div className="space-y-1">
          <div className="font-semibold">
            {meta.emoji} {meta.name}
          </div>
          <div className="text-muted">{meta.description}</div>
          <div className="text-[11px] text-muted/80">Rule: {meta.rule}</div>
        </div>
      }
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border font-medium',
          size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
          tier === 'champion' && 'champion-glow',
          className,
        )}
        style={{
          color: `var(${meta.cssVar})`,
          borderColor: `color-mix(in srgb, var(${meta.cssVar}) 40%, transparent)`,
          background: `color-mix(in srgb, var(${meta.cssVar}) 12%, transparent)`,
        }}
      >
        <span aria-hidden="true">{meta.emoji}</span>
        {meta.name}
      </span>
    </Tip>
  );
}
