import {
  BADGE_CATALOG,
  METRIC_GUIDE,
  SEGMENT_CATALOG,
  SEGMENT_ORDER,
  GUARDS,
} from '@dash/shared';
import { Sheet } from '@/components/ui';

const SCORE_KEYS = [
  'composite',
  'adoption',
  'impact',
  'efficiency',
  'trust',
  'acceptanceRate',
  'cacheRatio',
  'timeSaved',
  'costSavings',
  'roi',
  'activeUsers',
] as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted first:mt-0">
      {children}
    </h4>
  );
}

export function GuideDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="How to read this dashboard">
      <div className="space-y-1 text-sm">
        <SectionTitle>Scores</SectionTitle>
        <div className="space-y-3">
          {SCORE_KEYS.map((key) => {
            const g = METRIC_GUIDE[key];
            if (!g) return null;
            return (
              <div key={key} className="rounded-lg border border-border bg-bg/50 p-3">
                <div className="text-xs font-semibold">{g.name}</div>
                <div className="mt-1 rounded bg-fg/5 px-2 py-1 font-mono text-[10.5px] text-muted">
                  {g.formula}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{g.explanation}</p>
              </div>
            );
          })}
        </div>

        <SectionTitle>Segments</SectionTitle>
        <div className="space-y-2">
          {SEGMENT_ORDER.map((tier) => {
            const meta = SEGMENT_CATALOG[tier];
            return (
              <div key={tier} className="flex items-start gap-2.5 rounded-lg border border-border bg-bg/50 p-3">
                <span className="text-lg" aria-hidden="true">
                  {meta.emoji}
                </span>
                <div>
                  <div className="text-xs font-semibold" style={{ color: `var(${meta.cssVar})` }}>
                    {meta.name}
                  </div>
                  <div className="text-xs text-muted">{meta.description}</div>
                  <div className="mt-0.5 text-[11px] text-muted/80">Rule: {meta.rule}</div>
                </div>
              </div>
            );
          })}
        </div>

        <SectionTitle>Badges</SectionTitle>
        <div className="space-y-2">
          {Object.values(BADGE_CATALOG).map((b) => (
            <div key={b.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-bg/50 p-3">
              <span className="text-lg" aria-hidden="true">
                {b.emoji}
              </span>
              <div>
                <div className="text-xs font-semibold">{b.name}</div>
                <div className="text-xs text-muted">{b.description}</div>
                <div className="mt-0.5 text-[11px] text-muted/80">Rule: {b.rule}</div>
              </div>
            </div>
          ))}
        </div>

        <SectionTitle>Data notes</SectionTitle>
        <div className="space-y-2 pb-6">
          <div className="rounded-lg border border-border bg-bg/50 p-3 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-fg">Partial days.</span>{' '}
            {METRIC_GUIDE['partialDay']?.explanation ?? 'Today (UTC) is incomplete; numbers will still grow.'}
          </div>
          <div className="rounded-lg border border-border bg-bg/50 p-3 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-fg">Heatmap coverage.</span> The hour-of-day heatmaps
            cover OAuth-authenticated Claude Code traffic only — API-key usage has no hourly
            attribution, so heatmaps can undercount relative to daily totals.
          </div>
          <div className="rounded-lg border border-border bg-bg/50 p-3 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-fg">Confidence guards.</span> Trust is halved below{' '}
            {GUARDS.minToolEvents} tool decisions, efficiency below {GUARDS.minSessions} sessions, and
            the composite is withheld entirely below {GUARDS.minActiveDays} active days — the grey dot
            marks low-confidence values.
          </div>
        </div>
      </div>
    </Sheet>
  );
}
