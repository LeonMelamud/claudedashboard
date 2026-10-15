/**
 * The coach spends tokens only on a click. 'cached' (the page-open read) must
 * never reach the model — whatever is or isn't stored — while 'generate' (the
 * button) does. The model client is a spy and the input assembly is stubbed;
 * the repos are in-memory fakes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendationInput } from '@dash/shared';
import { AiUpstreamError } from '../src/ai/foundryClient';
import type { AiConfig } from '../src/env';
import type { Repos } from '../src/repos';
import type { AiRecommendationRow } from '../src/repos/aiRecommendationsRepo';
import { guidanceHash } from '../src/services/coachPrompt';
import { buildRecommendationInputForUser } from '../src/services/recommendationInput';
import { NoMetricsError, NotGeneratedError, RecommendationService } from '../src/services/recommendations';

vi.mock('../src/services/recommendationInput', () => ({ buildRecommendationInputForUser: vi.fn() }));
const assemble = vi.mocked(buildRecommendationInputForUser);

const USER_ID = 7;
const RANGE = { from: '2026-09-01', to: '2026-09-14' };
const RANGE_KEY = `${RANGE.from}_${RANGE.to}`;
const CFG: AiConfig = {
  apiKey: 'test-key',
  baseUrl: 'http://127.0.0.1:9',
  resource: null,
  model: 'test-model',
  ttlHours: 24,
  isFoundry: false,
  providerLabel: 'Test model',
};

function inputWith(sessions: number) {
  return { input: { range: RANGE, activity: { sessions } } as unknown as RecommendationInput, hash: `numbers-${sessions}` };
}

function setup(stored?: Partial<AiRecommendationRow>) {
  const rows = new Map<string, AiRecommendationRow>();
  const repos = {
    sync: { getState: () => null },
    aiRecs: {
      get: (userId: number, rangeKey: string) => rows.get(`${userId}:${rangeKey}`),
      upsert: (row: AiRecommendationRow) => rows.set(`${row.user_id}:${row.range_key}`, row),
      pruneOlderThan: () => 0,
      logGeneration: () => undefined,
    },
  } as unknown as Repos;
  if (stored) {
    rows.set(`${USER_ID}:${RANGE_KEY}`, {
      user_id: USER_ID,
      range_key: RANGE_KEY,
      generated_at: new Date().toISOString(),
      model: 'test-model',
      input_hash: `numbers-5:${guidanceHash(repos)}`,
      input_json: JSON.stringify(inputWith(5).input),
      output_json: JSON.stringify({ summary: 'stored notes', strengths: [], recommendations: [], dataThin: false }),
      usage_json: null,
      ...stored,
    } as AiRecommendationRow);
  }
  const svc = new RecommendationService(repos, CFG);
  const generateJson = vi.fn(() => Promise.reject(new AiUpstreamError('upstream_error', 'model reached')));
  (svc as unknown as { coach: { generateJson: typeof generateJson } }).coach = { generateJson };
  return { svc, generateJson, rows };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeEach(() => {
  assemble.mockReset();
  assemble.mockReturnValue(inputWith(5) as never);
});

describe("'cached' mode — the page-open read never calls the model", () => {
  it('nothing stored → NotGeneratedError', async () => {
    const { svc, generateJson } = setup();
    await expect(svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' })).rejects.toBeInstanceOf(NotGeneratedError);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('fresh stored notes → served as-is, not stale', async () => {
    const { svc, generateJson } = setup({});
    const res = await svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' });
    expect(res.summary).toBe('stored notes');
    expect(res.cached).toBe(true);
    expect(res.staleReason).toBeNull();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('numbers moved past the soft TTL → still served, flagged stale', async () => {
    const { svc, generateJson } = setup({ generated_at: hoursAgo(7) });
    assemble.mockReturnValue(inputWith(9) as never);
    const res = await svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' });
    expect(res.summary).toBe('stored notes');
    expect(res.staleReason).toMatch(/numbers have moved/);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('past the TTL → still served, flagged stale', async () => {
    const { svc, generateJson } = setup({ generated_at: hoursAgo(30) });
    const res = await svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' });
    expect(res.staleReason).toMatch(/over 24h old/);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('guidance changed → still served, flagged stale', async () => {
    const { svc, generateJson } = setup({ input_hash: 'numbers-5:some-older-prompt' });
    const res = await svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' });
    expect(res.staleReason).toMatch(/guidance changed/);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('no sessions in the range → the free canned answer, stored', async () => {
    const { svc, generateJson, rows } = setup();
    assemble.mockReturnValue(inputWith(0) as never);
    const res = await svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' });
    expect(res.dataThin).toBe(true);
    expect(rows.size).toBe(1);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('no metrics at all → NoMetricsError', async () => {
    const { svc, generateJson } = setup();
    assemble.mockReturnValue(null as never);
    await expect(svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' })).rejects.toBeInstanceOf(NoMetricsError);
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("'generate' mode — the button", () => {
  it('nothing stored → calls the model exactly once', async () => {
    const { svc, generateJson } = setup();
    await expect(svc.getOrGenerate(USER_ID, RANGE, { mode: 'generate' })).rejects.toThrow('model reached');
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it('fresh stored notes → served without a model call', async () => {
    const { svc, generateJson } = setup({});
    const res = await svc.getOrGenerate(USER_ID, RANGE, { mode: 'generate' });
    expect(res.summary).toBe('stored notes');
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('a read that lands mid-generation joins it instead of answering "not generated"', async () => {
    const { svc, generateJson } = setup();
    let release!: () => void;
    generateJson.mockImplementationOnce(
      () => new Promise((_, reject) => (release = () => reject(new AiUpstreamError('upstream_error', 'joined')))),
    );
    const click = svc.getOrGenerate(USER_ID, RANGE, { mode: 'generate' });
    const read = svc.getOrGenerate(USER_ID, RANGE, { mode: 'cached' });
    release();
    await expect(click).rejects.toThrow('joined');
    await expect(read).rejects.toThrow('joined');
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});
