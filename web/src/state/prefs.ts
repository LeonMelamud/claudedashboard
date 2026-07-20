import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings } from '@dash/shared';

export interface RoiAssumptions {
  linesPerMinute: number;
  hourlyRateUsd: number;
  seatCostUsdMonthly: number;
}

export interface HiddenChart {
  id: string;
  title: string;
}

interface PrefsState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** ROI assumptions, locally overridable; seeded once from /api/settings */
  roi: RoiAssumptions;
  roiSeeded: boolean;
  setRoi: (r: Partial<RoiAssumptions>) => void;
  seedRoi: (s: AppSettings) => void;
  resetRoi: (s: AppSettings | undefined) => void;
  /** hidden charts per page */
  hidden: Record<string, HiddenChart[]>;
  hideChart: (pageId: string, chart: HiddenChart) => void;
  showChart: (pageId: string, chartId: string) => void;
}

const DEFAULT_ROI: RoiAssumptions = { linesPerMinute: 2, hourlyRateUsd: 60, seatCostUsdMonthly: 60 };

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      roi: DEFAULT_ROI,
      roiSeeded: false,
      setRoi: (r) => set({ roi: { ...get().roi, ...r } }),
      seedRoi: (s) => {
        if (get().roiSeeded) return;
        set({
          roiSeeded: true,
          roi: {
            linesPerMinute: s.linesPerMinute,
            hourlyRateUsd: s.hourlyRateUsd,
            seatCostUsdMonthly: s.seatCostUsdMonthly,
          },
        });
      },
      resetRoi: (s) =>
        set({
          roi: s
            ? {
                linesPerMinute: s.linesPerMinute,
                hourlyRateUsd: s.hourlyRateUsd,
                seatCostUsdMonthly: s.seatCostUsdMonthly,
              }
            : DEFAULT_ROI,
        }),
      hidden: {},
      hideChart: (pageId, chart) => {
        const cur = get().hidden[pageId] ?? [];
        if (cur.some((c) => c.id === chart.id)) return;
        set({ hidden: { ...get().hidden, [pageId]: [...cur, chart] } });
      },
      showChart: (pageId, chartId) => {
        const cur = get().hidden[pageId] ?? [];
        set({ hidden: { ...get().hidden, [pageId]: cur.filter((c) => c.id !== chartId) } });
      },
    }),
    { name: 'dash-prefs' },
  ),
);
