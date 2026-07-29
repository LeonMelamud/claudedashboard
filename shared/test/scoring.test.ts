import { describe, expect, it } from 'vitest';
import { normalize, percentile } from '../src/scoring/normalize.js';
import {
  GUARDS,
  computeAxes,
  computeBaselines,
  segmentFor,
  significantModelCount,
  type ScoringInput,
} from '../src/scoring/scores.js';
import { computeBadges } from '../src/scoring/badges.js';
import {
  bestWorkdayStreak,
  ilDateOfIso,
  currentWorkdayStreak,
  isWorkday,
  workdaysBetween,
} from '../src/time/workweek.js';

function makeInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    userId: 1,
    sessions: 40,
    activeDays: 15,
    workdays: 22,
    toolAccepted: 80,
    toolRejected: 20,
    linesAdded: 5000,
    commits: 20,
    pullRequests: 6,
    costCents: 10_000,
    inputTokens: 1_000_000,
    cacheReadTokens: 3_000_000,
    modelTokens: { 'claude-fable-5': 3_500_000, 'claude-haiku-4-5': 500_000 },
    nightShare: 0.05,
    earlyShare: 0.1,
    currentStreak: 6,
    bestStreak: 6,
    ...overrides,
  };
}

describe('normalize', () => {
  it('is 0 at zero and 100 at the max', () => {
    expect(normalize(0, 100)).toBe(0);
    expect(normalize(100, 100)).toBe(100);
  });
  it('clamps above the max instead of exceeding 100', () => {
    expect(normalize(500, 100)).toBe(100);
  });
  it('handles a zero max without NaN', () => {
    expect(normalize(10, 0)).toBe(0);
  });
  it('compresses whales (log curve)', () => {
    // half the max should score well above 50 on a log scale
    expect(normalize(50, 100)).toBeGreaterThan(80);
  });
});

describe('percentile', () => {
  it('interpolates linearly', () => {
    expect(percentile([0, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 80)).toBeCloseTo(4.2);
  });
  it('handles empty and single-value samples', () => {
    expect(percentile([], 80)).toBe(0);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe('workweek (Israel, Sun–Thu)', () => {
  it('buckets days in Israel local time, not UTC', () => {
    // 2026-07-28 22:30 UTC = 2026-07-29 01:30 in Jerusalem (UTC+3) — late-night
    // work belongs to the NEW day, or the new day looks empty and streaks break.
    expect(ilDateOfIso('2026-07-28T22:30:00Z')).toBe('2026-07-29');
    expect(ilDateOfIso('2026-07-28T20:59:00Z')).toBe('2026-07-28');
    // winter: UTC+2
    expect(ilDateOfIso('2026-01-14T22:30:00Z')).toBe('2026-01-15');
    expect(ilDateOfIso('2026-01-14T21:30:00Z')).toBe('2026-01-14');
  });
  it('classifies weekdays: Fri/Sat are weekend', () => {
    expect(isWorkday('2026-07-05')).toBe(true); // Sunday
    expect(isWorkday('2026-07-09')).toBe(true); // Thursday
    expect(isWorkday('2026-07-10')).toBe(false); // Friday
    expect(isWorkday('2026-07-11')).toBe(false); // Saturday
  });
  it('counts workdays in a range', () => {
    // Sun 2026-07-05 .. Sat 2026-07-11 = Sun,Mon,Tue,Wed,Thu = 5
    expect(workdaysBetween('2026-07-05', '2026-07-11')).toBe(5);
  });
  it('streak survives the Fri/Sat weekend', () => {
    // active Wed, Thu, then Sun — Fri/Sat skipped
    const active = new Set(['2026-07-08', '2026-07-09', '2026-07-12']);
    expect(currentWorkdayStreak(active, '2026-07-12')).toBe(3);
  });
  it('streak breaks on a missed workday', () => {
    // active Wed, Thu, missed Sun, active Mon
    const active = new Set(['2026-07-08', '2026-07-09', '2026-07-13']);
    expect(currentWorkdayStreak(active, '2026-07-13')).toBe(1);
  });
  it('grants grace for asOf itself (today not yet active)', () => {
    const active = new Set(['2026-07-07', '2026-07-08']);
    expect(currentWorkdayStreak(active, '2026-07-09')).toBe(2);
  });
  it('grace does not bridge an older gap', () => {
    // asOf active, day before missing → streak 1, not resumed further back
    const active = new Set(['2026-07-06', '2026-07-09']);
    expect(currentWorkdayStreak(active, '2026-07-09')).toBe(1);
  });
  it('best streak spans weekends too', () => {
    const active = new Set(['2026-07-08', '2026-07-09', '2026-07-12', '2026-07-13']);
    expect(bestWorkdayStreak(active)).toBe(4);
  });
  it('an active Fri/Sat counts as a streak day', () => {
    // Mon..Sat active, asOf Sat — the weekend was worked, so it counts
    const active = new Set([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25',
    ]);
    expect(currentWorkdayStreak(active, '2026-07-25')).toBe(6);
    expect(bestWorkdayStreak(active)).toBe(6);
    // ...and an idle Sunday after it still breaks the current run
    active.add('2026-07-27');
    expect(currentWorkdayStreak(active, '2026-07-27')).toBe(1);
    expect(bestWorkdayStreak(active)).toBe(6);
  });
});

describe('baselines', () => {
  it('excludes zero-usage users from the population', () => {
    const b = computeBaselines([
      makeInput({ sessions: 0, linesAdded: 999_999 }),
      makeInput({ sessions: 10, linesAdded: 100 }),
    ]);
    expect(b.sampleSize).toBe(1);
    expect(b.maxLinesAdded).toBe(100);
  });
});

describe('axis scores and guards', () => {
  const population = [
    makeInput({ userId: 1 }),
    makeInput({ userId: 2, sessions: 80, linesAdded: 20_000, commits: 60, pullRequests: 15 }),
    makeInput({ userId: 3, sessions: 5, linesAdded: 200, commits: 1, pullRequests: 0, activeDays: 4 }),
  ];
  const baselines = computeBaselines(population);

  it('scores are within 0..100', () => {
    for (const input of population) {
      const axes = computeAxes(input, baselines);
      for (const v of [axes.adoption, axes.impact, axes.efficiency, axes.trust]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('trust is halved below the tool-event guard', () => {
    const confident = computeAxes(makeInput({ toolAccepted: 60, toolRejected: 40 }), baselines);
    const sparse = computeAxes(makeInput({ toolAccepted: 6, toolRejected: 4 }), baselines);
    // identical 60% rate, sparse has < 20 events
    expect(sparse.trustLowConfidence).toBe(true);
    expect(sparse.trust).toBeCloseTo(confident.trust / 2, 0);
  });

  it('efficiency is halved below the session guard', () => {
    const sparse = computeAxes(makeInput({ sessions: 5 }), baselines);
    expect(sparse.efficiencyLowConfidence).toBe(true);
  });

  it('composite is withheld under 3 active days', () => {
    const axes = computeAxes(makeInput({ activeDays: 2 }), baselines);
    expect(axes.composite).toBeNull();
  });

  it('trust treats 60% acceptance as perfect', () => {
    const axes = computeAxes(makeInput({ toolAccepted: 60, toolRejected: 40 }), baselines);
    expect(axes.trust).toBe(100);
  });
});

describe('non-GitHub org adaptation', () => {
  it('redistributes the PR weight when the org has zero PRs', () => {
    const noPrOrg = [
      makeInput({ userId: 1, pullRequests: 0 }),
      makeInput({ userId: 2, pullRequests: 0, sessions: 80, linesAdded: 20_000, commits: 60 }),
    ];
    const b = computeBaselines(noPrOrg);
    // top user on both remaining components should be able to reach 100 impact
    const axes = computeAxes(noPrOrg[1]!, b);
    expect(axes.impact).toBe(100);
  });

  it('keeps Champion attainable without PRs', () => {
    const noPrOrg = [
      makeInput({ userId: 1, pullRequests: 0, sessions: 20, linesAdded: 1000, commits: 5, activeDays: 8 }),
      makeInput({ userId: 2, pullRequests: 0, sessions: 80, linesAdded: 20_000, commits: 60, activeDays: 21 }),
    ];
    const b = computeBaselines(noPrOrg);
    const axes = computeAxes(noPrOrg[1]!, b);
    expect(segmentFor(axes)).toBe('champion');
  });

  it('marks PR Machine not-applicable instead of unearnable', () => {
    const noPrOrg = [makeInput({ pullRequests: 0 }), makeInput({ userId: 2, pullRequests: 0 })];
    const b = computeBaselines(noPrOrg);
    const axes = computeAxes(noPrOrg[0]!, b);
    const badge = computeBadges(noPrOrg[0]!, b, axes).find((x) => x.id === 'pr_machine')!;
    expect(badge.earned).toBe(false);
    expect(badge.progress).toBe(0);
    expect(badge.detail).toMatch(/not applicable/i);
  });
});

describe('segments', () => {
  it('maps the four tiers by adoption x impact', () => {
    expect(segmentFor({ adoption: 75, impact: 80 })).toBe('champion');
    expect(segmentFor({ adoption: 55, impact: 45 })).toBe('producer');
    expect(segmentFor({ adoption: 10, impact: 5 })).toBe('starter');
    expect(segmentFor({ adoption: 30, impact: 90 })).toBe('explorer');
  });
  it('champion requires BOTH axes', () => {
    expect(segmentFor({ adoption: 90, impact: 60 })).toBe('producer');
  });
});

describe('badges', () => {
  const population = [
    makeInput({ userId: 1 }),
    makeInput({ userId: 2, sessions: 80, linesAdded: 20_000, commits: 60, pullRequests: 15 }),
    makeInput({ userId: 3, sessions: 12, linesAdded: 300, commits: 2, pullRequests: 0 }),
  ];
  const baselines = computeBaselines(population);

  function badgesFor(input: ScoringInput) {
    const axes = computeAxes(input, baselines);
    return new Map(computeBadges(input, baselines, axes).map((b) => [b.id, b]));
  }

  it('cache master needs ratio AND volume', () => {
    const highRatioLowVolume = badgesFor(
      makeInput({ inputTokens: 100, cacheReadTokens: 900 }),
    ).get('cache_master')!;
    expect(highRatioLowVolume.earned).toBe(false);
    const both = badgesFor(
      makeInput({ inputTokens: 500_000, cacheReadTokens: 2_000_000 }),
    ).get('cache_master')!;
    expect(both.earned).toBe(true);
  });

  it('night owl and early bird are mutually exclusive', () => {
    const map = badgesFor(makeInput({ nightShare: 0.45, earlyShare: 0.35, activeDays: 15 }));
    expect(map.get('night_owl')!.earned).toBe(true);
    expect(map.get('early_bird')!.earned).toBe(false);
  });

  it('time badges require 10 active days', () => {
    const map = badgesFor(makeInput({ nightShare: 0.5, activeDays: 5 }));
    expect(map.get('night_owl')!.earned).toBe(false);
  });

  it('keeps a streak badge earned after the run breaks', () => {
    const map = badgesFor(makeInput({ currentStreak: 1, bestStreak: 6 }));
    expect(map.get('streak_bronze')!.earned).toBe(true);
    expect(map.get('streak_silver')!.earned).toBe(false);
  });
  it('streak tiers at 5/10/20', () => {
    const map = badgesFor(makeInput({ currentStreak: 11 }));
    expect(map.get('streak_bronze')!.earned).toBe(true);
    expect(map.get('streak_silver')!.earned).toBe(true);
    expect(map.get('streak_gold')!.earned).toBe(false);
    expect(map.get('streak_gold')!.progress).toBeCloseTo(0.55);
  });

  it('polyglot needs 3 models at >=5% share', () => {
    expect(significantModelCount({ a: 50, b: 30, c: 20 })).toBe(3);
    expect(significantModelCount({ a: 96, b: 2, c: 2 })).toBe(1);
    const map = badgesFor(makeInput({ modelTokens: { a: 50, b: 30, c: 20 } }));
    expect(map.get('polyglot')!.earned).toBe(true);
  });

  it('high acceptance follows the reference rule (40% over 20 events)', () => {
    const yes = badgesFor(makeInput({ toolAccepted: 10, toolRejected: 10 }));
    expect(yes.get('high_acceptance')!.earned).toBe(true);
    const tooFew = badgesFor(makeInput({ toolAccepted: 9, toolRejected: 1 }));
    expect(tooFew.get('high_acceptance')!.earned).toBe(false);
  });

  it('progress is clamped to 1 and reported earned at 1', () => {
    for (const badge of badgesFor(makeInput()).values()) {
      expect(badge.progress).toBeGreaterThanOrEqual(0);
      expect(badge.progress).toBeLessThanOrEqual(1);
      if (badge.earned) expect(badge.progress).toBe(1);
    }
  });

  it('guards expose their documented thresholds', () => {
    expect(GUARDS.minToolEvents).toBe(20);
    expect(GUARDS.minSessions).toBe(10);
    expect(GUARDS.minActiveDays).toBe(3);
  });
});
