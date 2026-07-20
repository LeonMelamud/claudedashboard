import type { TelemetryPolicyResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { policyFor } from '../otel/privacy';

/**
 * Transparency endpoint: the EXACT policy object the ingest choke point
 * executes (otel/privacy.ts) — what this returns is what happens to the data.
 */
export function registerTelemetryPolicyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/telemetry-policy', async (): Promise<TelemetryPolicyResponse> => policyFor(ctx.env.privacyMode));
}
