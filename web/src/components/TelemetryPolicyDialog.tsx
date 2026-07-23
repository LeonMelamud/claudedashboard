import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AttrAction, EventPolicy, PrivacyMode } from '@dash/shared';
import { useTelemetryPolicy } from '@/lib/queries';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/Skeleton';
import { InfoPopover, Modal } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Transparency panel: renders the exact ingest policy the server executes —
 * privacy mode badge, plain-language notes, and per-event attribute→action
 * tables (keep / drop / redact). Fetched from GET /api/telemetry-policy only
 * while the dialog is open.
 */

const MODE_META: Record<PrivacyMode, { label: string; cls: string; blurb: string }> = {
  full: {
    label: 'Full',
    cls: 'border-warn/40 bg-warn/10 text-warn',
    blurb: 'Most attributes are kept — maximum insight, least redaction.',
  },
  balanced: {
    label: 'Balanced',
    cls: 'border-accent/40 bg-accent/10 text-accent',
    blurb: 'Sensitive attributes are dropped or redacted; aggregates are kept.',
  },
  minimal: {
    label: 'Minimal',
    cls: 'border-good/40 bg-good/10 text-good',
    blurb: 'Only counts and coarse aggregates are stored.',
  },
};

function ActionChip({ action }: { action: AttrAction }) {
  const cls =
    action === 'keep'
      ? 'border-good/40 bg-good/10 text-good'
      : action === 'redact'
        ? 'border-warn/40 bg-warn/10 text-warn'
        : 'border-border bg-fg/5 text-muted';
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide', cls)}>
      {action}
    </span>
  );
}

function EventPolicyTable({ policy }: { policy: EventPolicy }) {
  const attrs = Object.entries(policy.attrs);
  return (
    <section className="rounded-lg border border-border">
      <header className="border-b border-border bg-fg/[0.03] px-3 py-2">
        <div className="font-mono text-xs font-semibold">{policy.event}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{policy.description}</p>
      </header>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {attrs.map(([attr, action]) => (
            <tr key={attr} className="border-b border-border/60 last:border-0">
              <td
                className={cn(
                  'px-3 py-1.5 font-mono text-[11px]',
                  action === 'drop' ? 'text-muted line-through' : 'text-fg/90',
                )}
              >
                {attr}
              </td>
              <td className="w-20 px-3 py-1.5 text-right">
                <ActionChip action={action} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="px-3 py-1.5 text-[11px] italic text-muted">all other attributes</td>
            <td className="w-20 px-3 py-1.5 text-right">
              <ActionChip action={policy.defaultAction} />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function TelemetryPolicyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const policyQ = useTelemetryPolicy(open);
  const policy = policyQ.data;
  const mode = policy ? MODE_META[policy.mode] : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-good" />
          What&apos;s collected
          {mode && (
            <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-semibold', mode.cls)}>
              {mode.label} mode
            </span>
          )}
        </span>
      }
    >
      {policyQ.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : policyQ.error ? (
        <ErrorCard error={policyQ.error} onRetry={() => void policyQ.refetch()} compact />
      ) : policy ? (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-muted">
            This is the exact policy object the server applies to every incoming telemetry event —
            what you see here is exactly what gets stored. {mode?.blurb}
          </p>

          <p className="rounded-lg border border-border bg-fg/[0.03] p-3 text-[11.5px] leading-relaxed text-muted">
            <span className="font-medium text-fg/80">Coverage:</span> Claude Code exports telemetry
            from CLI, IDE-extension (VS&nbsp;Code/JetBrains), and SDK/CI sessions. The Claude Desktop
            app and claude.ai web sessions don&apos;t run the exporter, so numbers here reflect
            coding-surface usage only.
          </p>

          {policy.notes.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-border bg-fg/[0.03] p-3">
              {policy.notes.map((note) => (
                <li key={note} className="flex gap-1.5 text-[11.5px] leading-relaxed text-muted">
                  <span className="text-good">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3">
            {policy.events.map((ev) => (
              <EventPolicyTable key={ev.event} policy={ev} />
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * "What's collected" trigger link + info popover + the dialog itself.
 * Drop it into onboarding cards, page footers, and Admin → Settings.
 */
export function WhatsCollectedLink({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-accent transition-colors hover:underline"
      >
        <ShieldCheck size={11} /> What&apos;s collected
      </button>
      <InfoPopover metricKey="whatsCollected" />
      <TelemetryPolicyDialog open={open} onOpenChange={setOpen} />
    </span>
  );
}
