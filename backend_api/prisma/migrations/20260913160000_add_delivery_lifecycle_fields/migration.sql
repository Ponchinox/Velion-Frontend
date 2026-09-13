-- AlterTable: Add delivery lifecycle fields to FollowUpAttempt
-- These fields are SEPARATE from the operational status (SENT/FAILED_SAFE/etc.)
-- deliveryStatus tracks provider delivery receipt state monotonically
-- deliveredAt/readAt record exact timestamps from delivery receipts

ALTER TABLE "FollowUpAttempt" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
ALTER TABLE "FollowUpAttempt" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "FollowUpAttempt" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

-- Index on providerMessageId for efficient delivery receipt reconciliation
CREATE INDEX IF NOT EXISTS "FollowUpAttempt_providerMessageId_idx" ON "FollowUpAttempt"("providerMessageId");
