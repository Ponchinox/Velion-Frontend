-- AlterTable Campaign
ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recurrenceType" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastRunAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "anchorDay" INTEGER,
  ADD COLUMN IF NOT EXISTS "audienceType" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS "targetContactIds" JSONB;

-- AlterTable CampaignLog
ALTER TABLE "CampaignLog"
  ADD COLUMN IF NOT EXISTS "occurrenceKey" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Campaign_status_nextRunAt_idx" ON "Campaign"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "Campaign_tenantId_idx" ON "Campaign"("tenantId");
CREATE INDEX IF NOT EXISTS "CampaignLog_campaignId_idx" ON "CampaignLog"("campaignId");
CREATE INDEX IF NOT EXISTS "CampaignLog_campaignId_status_idx" ON "CampaignLog"("campaignId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignLog_campaignId_customerPhone_occurrenceKey_key" ON "CampaignLog"("campaignId", "customerPhone", "occurrenceKey");
