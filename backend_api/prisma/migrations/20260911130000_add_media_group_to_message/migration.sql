-- AlterTable Message (Multi-Image Batch / Album support: Additive nullable fields)
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "mediaGroupId" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaGroupIndex" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_chatId_mediaGroupId_idx" ON "Message"("chatId", "mediaGroupId");
