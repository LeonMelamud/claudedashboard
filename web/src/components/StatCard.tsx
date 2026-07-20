import type { ReactNode } from 'react';
import { CountUp } from '@/components/CountUp';
import { DeltaChip } from '@/components/DeltaChip';
import { Sparkline } from '@/components/Sparkline';
import { InfoPopover } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * KPI card: label + info icon / hero count-up number / delta chip vs previous
 * period / 30d sparkline footer.
 */
export function StatCard({
  label,
  value,
  format,
  display,
  prev,
  invertDelta = false,
  metricKey,
  sparkline,
  footer,
  hero = false,
  className,
  valueClassName,
}: {
  label: string;
  /** numeric value for count-up; omit and use `display` for non-numeric */
  value?: number;
  format?: (v: number) => string;
  /** static display when value is not animatable (e.g. "—") */
  display?: string;
  prev?: number;
  invertDelta?: boolean;
  metricKey?: string;
  sparkline?: number[];
  footer?: ReactNode;
  hero?: boolean;
  className?: string;
  /** extra classes on the hero number (e.g. status coloring) */
  valueClassName?: string;
}) {
  const fmt = format ?? ((v: number) => Math.round(v).toLocaleString('en-US'));
  return (
    <div className={cn('card flex flex-col p-4', className)}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        <InfoPopover {...(metricKey ? { metricKey } : {})} />
        {value !== undefined && prev !== undefined && (
          <span className="ml-auto">
            <DeltaChip current={value} prev={prev} invert={invertDelta} tooltip="vs previous period" />
          </span>
        )}
      </div>
      <div
        className={cn(
          'mt-1.5 font-semibold leading-none tracking-tight',
          hero ? 'hero-gradient text-[38px]' : 'text-[32px]',
          valueClassName,
        )}
      >
        {value !== undefined ? <CountUp value={value} format={fmt} /> : (display ?? '—')}
      </div>
      <div className="mt-auto pt-2">
        {sparkline && sparkline.length > 1 ? (
          <Sparkline data={sparkline} width={200} height={30} className="w-full" />
        ) : (
          footer && <div className="text-[11px] text-muted">{footer}</div>
        )}
        {sparkline && sparkline.length > 1 && footer && (
          <div className="mt-1 text-[11px] text-muted">{footer}</div>
        )}
      </div>
    </div>
  );
}
