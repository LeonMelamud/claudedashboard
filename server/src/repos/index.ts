import type { Db } from '../db/connection';
import { ApiKeyRepo } from './apiKeyRepo';
import { CostRepo } from './costRepo';
import { DimensionsRepo } from './dimensionsRepo';
import { OrgSummaryRepo } from './orgSummaryRepo';
import { OtelPacksRepo } from './otelPacksRepo';
import { OtelRepo } from './otelRepo';
import { SettingsRepo } from './settingsRepo';
import { SyncRepo } from './syncRepo';
import { TeamRepo } from './teamRepo';
import { UsageRepo } from './usageRepo';
import { UserRepo } from './userRepo';

export interface Repos {
  users: UserRepo;
  teams: TeamRepo;
  usage: UsageRepo;
  sync: SyncRepo;
  settings: SettingsRepo;
  cost: CostRepo;
  apiKeys: ApiKeyRepo;
  dimensions: DimensionsRepo;
  orgSummaries: OrgSummaryRepo;
  otel: OtelRepo;
  otelPacks: OtelPacksRepo;
}

export function createRepos(db: Db): Repos {
  return {
    users: new UserRepo(db),
    teams: new TeamRepo(db),
    usage: new UsageRepo(db),
    sync: new SyncRepo(db),
    settings: new SettingsRepo(db),
    cost: new CostRepo(db),
    apiKeys: new ApiKeyRepo(db),
    dimensions: new DimensionsRepo(db),
    orgSummaries: new OrgSummaryRepo(db),
    otel: new OtelRepo(db),
    otelPacks: new OtelPacksRepo(db),
  };
}

export {
  ApiKeyRepo,
  CostRepo,
  DimensionsRepo,
  OrgSummaryRepo,
  OtelPacksRepo,
  OtelRepo,
  SettingsRepo,
  SyncRepo,
  TeamRepo,
  UsageRepo,
  UserRepo,
};
