-- AlterTable: Add followUpDecisionMode to Tenant
-- Purely additive: allows tenant-by-tenant gradual rollout (OFF | SHADOW | ENFORCE)
-- Default is 'OFF', so existing tenants and new tenants operate exactly as before.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "followUpDecisionMode" TEXT DEFAULT 'OFF';
