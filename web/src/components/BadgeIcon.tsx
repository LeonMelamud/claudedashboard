import { BADGE_CATALOG, type BadgeStatus } from '@dash/shared';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

export function BadgeIcon({
  badge,
  size = 'sm',
  className,
}: {
  badge: BadgeStatus;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const meta = BADGE_CATALOG[badge.id];
  return (
    <Tip
      wide
      content={
        <div className="space-y-1.5">
          <div className="font-semibold">
            {meta.emoji} {meta.name}
            {!badge.earned && <span className="ml-1 font-normal text-muted">(not earned)</span>}
          </div>
          <div className="text-muted">{meta.description}</div>
          <div className="text-[11px] text-muted/80">Rule: {meta.rule}</div>
          <div className="text-[11px]">{badge.detail}</div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10">
            <div
              className={cn('h-full rounded-full', badge.earned ? 'bg-good' : 'bg-accent')}
              style={{ width: `${Math.round(badge.progress * 100)}%` }}
            />
          </div>
        </div>
      }
    >
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full border',
          size === 'sm' ? 'size-6 text-[13px]' : 'size-10 text-xl',
          badge.earned
            ? 'border-accent/40 bg-accent/10'
            : 'border-border bg-fg/5 opacity-45 grayscale',
          className,
        )}
      >
        <span aria-hidden="true">{meta.emoji}</span>
      </span>
    </Tip>
  );
}
