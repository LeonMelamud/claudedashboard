import {
  createContext,
  useContext,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { Download, EyeOff, Plus } from 'lucide-react';
import { usePrefsStore } from '@/state/prefs';
import { readChartTheme } from '@/lib/chartTheme';
import type { EChartsInstance } from '@/components/EChart';
import { ChartSkeleton } from '@/components/Skeleton';
import { ErrorCard, EmptyState } from '@/components/ErrorCard';
import { InfoPopover, Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

const PageIdContext = createContext<string>('global');

export function ChartPage({ pageId, children }: { pageId: string; children: ReactNode }) {
  return <PageIdContext.Provider value={pageId}>{children}</PageIdContext.Provider>;
}

const EMPTY_HIDDEN: ReadonlyArray<{ id: string; title: string }> = [];

/** Chip row restoring charts hidden on this page. Render once at page bottom. */
export function HiddenChartChips() {
  const pageId = useContext(PageIdContext);
  const hidden = usePrefsStore((s) => s.hidden[pageId] ?? EMPTY_HIDDEN);
  const showChart = usePrefsStore((s) => s.showChart);
  if (hidden.length === 0) return null;
  return (
    <div className="col-span-12 flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted">Hidden charts</span>
      {hidden.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => showChart(pageId, c.id)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted transition-colors hover:text-fg"
        >
          <Plus size={11} /> {c.title}
        </button>
      ))}
    </div>
  );
}

type ChartChildren = ReactNode | ((ref: MutableRefObject<EChartsInstance | null>) => ReactNode);

interface ChartCardProps {
  title: string;
  chartId: string;
  /** key into METRIC_GUIDE for the info popover */
  metricKey?: string;
  infoExtra?: ReactNode;
  subtitle?: ReactNode;
  /** extra header controls (toggles, selectors) */
  actions?: ReactNode;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyText?: string;
  className?: string;
  /** disables the PNG export button for non-echarts content */
  noExport?: boolean;
  children: ChartChildren;
}

export function ChartCard({
  title,
  chartId,
  metricKey,
  infoExtra,
  subtitle,
  actions,
  isLoading,
  error,
  onRetry,
  isEmpty,
  emptyText,
  className,
  noExport,
  children,
}: ChartCardProps) {
  const pageId = useContext(PageIdContext);
  const hidden = usePrefsStore((s) => (s.hidden[pageId] ?? []).some((c) => c.id === chartId));
  const hideChart = usePrefsStore((s) => s.hideChart);
  const chartRef = useRef<EChartsInstance | null>(null);

  if (hidden) return null;

  const exportPng = () => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    const url = chart.getDataURL({
      pixelRatio: 2,
      backgroundColor: readChartTheme().card,
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chartId}.png`;
    a.click();
  };

  const body = isLoading ? (
    <ChartSkeleton />
  ) : error ? (
    <ErrorCard error={error} {...(onRetry ? { onRetry } : {})} compact className="min-h-56" />
  ) : isEmpty ? (
    <EmptyState {...(emptyText ? { text: emptyText } : {})} className="min-h-56" />
  ) : typeof children === 'function' ? (
    children(chartRef)
  ) : (
    children
  );

  return (
    <section className={cn('card flex flex-col p-4', className)}>
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            <InfoPopover {...(metricKey ? { metricKey } : {})} {...(infoExtra ? { extra: infoExtra } : {})} />
          </div>
          {subtitle && <div className="mt-0.5 text-[11px] text-muted">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          {!noExport && !isLoading && !error && !isEmpty && (
            <Tip content="Export as PNG">
              <button
                type="button"
                onClick={exportPng}
                aria-label="Export chart as PNG"
                className="text-muted transition-colors hover:text-fg"
              >
                <Download size={13} />
              </button>
            </Tip>
          )}
          <Tip content="Hide this chart (restore from the chip row below)">
            <button
              type="button"
              onClick={() => hideChart(pageId, { id: chartId, title })}
              aria-label={`Hide ${title}`}
              className="text-muted transition-colors hover:text-fg"
            >
              <EyeOff size={13} />
            </button>
          </Tip>
        </div>
      </header>
      <div className="min-h-0 flex-1">{body}</div>
    </section>
  );
}
