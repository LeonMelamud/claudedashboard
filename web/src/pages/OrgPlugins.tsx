import { useState } from 'react';
import { useRangeParams } from '@/hooks/useRangeParams';
import { usePlugins } from '@/lib/queries';
import { ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { ErrorCard } from '@/components/ErrorCard';
import { BreakdownDrawer, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { PluginKpis, PluginRankingCard } from '@/components/PluginCards';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';

export default function OrgPlugins() {
  const { from, to, teamId } = useRangeParams();
  const pluginsQ = usePlugins({ from, to, teamId });
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);

  const data = pluginsQ.data;
  const noData = !!data && !data.hasData;

  return (
    <ChartPage pageId="plugins">
      <div className="grid grid-cols-12 gap-4">
        {pluginsQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={pluginsQ.error} onRetry={() => void pluginsQ.refetch()} />
          </div>
        ) : (
          <>
            {noData && (
              <TelemetrySetupCard blurb="This view is powered by Claude Code’s OpenTelemetry events — every plugin your org loads and every plugin skill people run." />
            )}

            <PluginKpis data={data} loading={pluginsQ.isLoading} noData={noData} />

            <PluginRankingCard
              rows={data?.plugins ?? []}
              isLoading={pluginsQ.isLoading}
              noData={noData}
              onDrill={setDrill}
            />

            <div className="col-span-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <WhatsCollectedLink />
            </div>
          </>
        )}

        <HiddenChartChips />
      </div>
      <BreakdownDrawer target={drill} onClose={() => setDrill(null)} range={{ from, to, teamId }} />
    </ChartPage>
  );
}
