-- AlterTable Message (CHAT-MEDIA-01: Additive nullable media fields without default for mediaStatus)
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "mediaType" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaPath" TEXT,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "fileName" TEXT,
  ADD COLUMN IF NOT EXISTS "caption" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "mediaStatus" TEXT;
