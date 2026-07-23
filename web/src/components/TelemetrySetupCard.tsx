import { Copy } from 'lucide-react';
import { toast } from '@/state/toast';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';

/**
 * Telemetry onboarding card, shown when a telemetry-backed page has no data
 * yet. Single source of truth for the managed-settings.json snippet — used by
 * the Skills, Activity, and Health pages.
 */

const SETTINGS_SNIPPET = `{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "delta",
    "OTEL_METRICS_INCLUDE_VERSION": "true",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://<dashboard-host>:8080/otel",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}`;

export function TelemetrySetupCard({
  blurb = 'This view is powered by Claude Code’s OpenTelemetry feed — engagement, reliability, and governance signals the Admin API doesn’t report.',
}: {
  /** page-specific first sentence; the rollout instructions are shared */
  blurb?: string;
}) {
  const copySnippet = () => {
    void navigator.clipboard
      .writeText(SETTINGS_SNIPPET)
      .then(() => toast('Snippet copied to clipboard', 'success'))
      .catch(() => toast('Could not copy — select the snippet manually', 'error'));
  };
  return (
    <div className="card col-span-12 p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="max-w-xl">
          <div className="text-3xl opacity-60">📡</div>
          <h2 className="mt-2 text-sm font-semibold">No telemetry yet</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            {blurb} Roll it out by deploying a{' '}
            <code className="rounded bg-fg/10 px-1 font-mono text-[11px]">managed-settings.json</code> with
            the snippet on the right to each developer machine. Data appears here as soon as the first
            machine ships an event.
          </p>
          <p className="mt-2 text-xs text-muted">
            See <span className="font-medium text-fg/80">README → Telemetry rollout</span> for the
            step-by-step guide.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            <span className="font-medium text-fg/80">Coverage:</span> CLI, IDE extensions
            (VS&nbsp;Code/JetBrains), and SDK/CI sessions export telemetry. The Claude Desktop app and
            claude.ai web sessions don’t run the exporter, so they never appear here.
          </p>
          <div className="mt-3">
            <WhatsCollectedLink />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted">managed-settings.json</span>
            <button
              type="button"
              onClick={copySnippet}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-fg"
            >
              <Copy size={11} /> Copy
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">
            {SETTINGS_SNIPPET}
          </pre>
        </div>
      </div>
    </div>
  );
}
