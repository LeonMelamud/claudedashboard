import { addDays, type AdoptionResponse, type CalendarDay } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { todayUtc } from '../util/time';
import { parseRangeQuery } from './shared';

const WAU_DAYS = 7;
const MAU_DAYS = 30;
const CALENDAR_DAYS = 365;

export function registerAdoptionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/adoption', async (req): Promise<AdoptionResponse> => {
    // NOTE: teamId is accepted by the shared range parser but deliberately
    // ignored — adoption is an org-level metric (the rostered denominator and
    // rolling actives only make sense org-wide).
    const q = parseRangeQuery(req.query);
    const { from, to } = q;

    // Load per-day active user sets once (window reaches back MAU_DAYS-1
    // before `from`), then compute rolling unions in JS — the data is small.
    const loadFrom = addDays(from, -(MAU_DAYS - 1));
    const activeByDate = new Map<string, Set<number>>();
    for (const row of ctx.repos.usage.userActiveDays(loadFrom, to)) {
      let set = activeByDate.get(row.date);
      if (!set) {
        set = new Set<number>();
        activeByDate.set(row.date, set);
      }
      set.add(row.user_id);
    }

    const distinctOverWindow = (endDate: string, days: number): number => {
      const union = new Set<number>();
      for (let i = 0; i < days; i++) {
        const set = activeByDate.get(addDays(endDate, -i));
        if (!set) continue;
        for (const userId of set) union.add(userId);
      }
      return union.size;
    };

    // Enterprise mode: analytics/summaries is authoritative for actives and
    // the seat denominator — prefer it whenever rows exist for the range
    // (console/demo never write org_summaries, so they are unaffected).
    const summaryByDate = new Map(ctx.repos.orgSummaries.getRange(from, to).map((r) => [r.date, r]));

    const series: AdoptionResponse['series'] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const summary = summaryByDate.get(date);
      series.push(
        summary
          ? { date, dau: summary.dau, wau: summary.wau, mau: summary.mau }
          : {
              date,
              dau: activeByDate.get(date)?.size ?? 0,
              wau: distinctOverWindow(date, WAU_DAYS),
              mau: distinctOverWindow(date, MAU_DAYS),
            },
      );
    }

    // --- org-wide trailing 365-day calendar (profile calendar, no user filter) ---
    const today = todayUtc();
    const calFrom = addDays(today, -(CALENDAR_DAYS - 1));
    const coreByDate = new Map(ctx.repos.usage.orgCalendarCore(calFrom, today).map((r) => [r.date, r]));
    const costByDate = new Map(ctx.repos.usage.orgCalendarCost(calFrom, today).map((r) => [r.date, r.cost_cents]));
    const calendar: CalendarDay[] = [];
    for (let date = calFrom; date <= today; date = addDays(date, 1)) {
      const core = coreByDate.get(date);
      calendar.push({
        date,
        sessions: core?.sessions ?? 0,
        netLines: core?.net_lines ?? 0,
        costCents: costByDate.get(date) ?? 0,
      });
    }

    // Seat denominator: the latest assigned_seat_count beats the local roster
    // count when summaries exist (enterprise has no seat-list endpoint, so the
    // local roster only contains users who were ever active).
    const seatCount = summaryByDate.size > 0 ? ctx.repos.orgSummaries.latestSeatCount() : null;

    return {
      range: { from, to },
      series,
      rosteredUsers: seatCount ?? ctx.repos.users.rosteredUserCount(),
      calendar,
    };
  });
}
