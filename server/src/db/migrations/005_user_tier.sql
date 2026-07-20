-- Program tier per member, observed from the claude_code usage report:
-- customer_type 'api' (Console org billing) vs 'subscription', and for
-- subscription users the plan (pro/max/team/enterprise). tier_as_of guards
-- updates so a backfill re-syncing old days never overwrites newer values.
ALTER TABLE users ADD COLUMN customer_type TEXT;
ALTER TABLE users ADD COLUMN subscription_type TEXT;
ALTER TABLE users ADD COLUMN tier_as_of TEXT;
