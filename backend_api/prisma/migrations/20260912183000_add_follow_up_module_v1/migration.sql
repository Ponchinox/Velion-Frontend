-- Migration: 20260912183000_add_follow_up_module_v1
-- Module: Follow-Ups V1 (Automated Commercial Follow-ups)

-- 1. AlterTable Tenant: Add followUpEnabled and timezone (nullable, fail-closed)
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "timezone" TEXT;

-- 2. AlterTable Customer: Add follow-up suppression and opt-out metadata
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "followUpSuppressed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "followUpOptOutAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "followUpSuppressionReason" TEXT;

-- 3. CreateTable FollowUpSequence
CREATE TABLE IF NOT EXISTS "FollowUpSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "chatId" TEXT,
    "orderId" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "stageAtCreation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "currentAttempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "recoveredAt" TIMESTAMP(3),
    "recoveredOrderId" TEXT,
    "contextSnapshot" JSONB,
    "explicitTimingIso" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

-- 4. CreateTable FollowUpAttempt
CREATE TABLE IF NOT EXISTS "FollowUpAttempt" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "dispatchStartedAt" TIMESTAMP(3),
    "sentMessage" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpAttempt_pkey" PRIMARY KEY ("id")
);

-- 5. Create Standard Indexes
CREATE INDEX IF NOT EXISTS "FollowUpSequence_status_nextRunAt_idx" ON "FollowUpSequence"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "FollowUpSequence_tenantId_customerId_idx" ON "FollowUpSequence"("tenantId", "customerId");
CREATE INDEX IF NOT EXISTS "FollowUpSequence_tenantId_status_idx" ON "FollowUpSequence"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "FollowUpSequence_tenantId_nextRunAt_idx" ON "FollowUpSequence"("tenantId", "nextRunAt");

CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpAttempt_sequenceId_attemptNumber_key" ON "FollowUpAttempt"("sequenceId", "attemptNumber");
CREATE INDEX IF NOT EXISTS "FollowUpAttempt_sequenceId_idx" ON "FollowUpAttempt"("sequenceId");
CREATE INDEX IF NOT EXISTS "FollowUpAttempt_status_idx" ON "FollowUpAttempt"("status");

-- 6. Partial Unique Index (PostgreSQL): At most ONE active sequence per (tenantId, customerId)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_followup_per_customer"
ON "FollowUpSequence" ("tenantId", "customerId")
WHERE status IN ('SCHEDULED', 'PROCESSING', 'NEUTRALIZED_INBOUND', 'WAITING_NEXT');

-- 7. Add Foreign Keys safely
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpSequence_tenantId_fkey') THEN
    ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpSequence_customerId_fkey') THEN
    ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpSequence_chatId_fkey') THEN
    ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpSequence_orderId_fkey') THEN
    ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUpAttempt_sequenceId_fkey') THEN
    ALTER TABLE "FollowUpAttempt" ADD CONSTRAINT "FollowUpAttempt_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
