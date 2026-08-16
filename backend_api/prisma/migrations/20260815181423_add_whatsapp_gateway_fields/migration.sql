ALTER TABLE "RegisteredWhatsAppNumber"
  ADD COLUMN "provider"          TEXT NOT NULL DEFAULT 'EVOLUTION',
  ADD COLUMN "metaPhoneNumberId" TEXT,
  ADD COLUMN "metaWabaId"         TEXT,
  ADD COLUMN "metaAccessToken"    TEXT,
  ADD COLUMN "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
