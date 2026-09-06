-- CreateTable
CREATE TABLE IF NOT EXISTS "OperationalItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "contactId" TEXT,
    "chatId" TEXT,
    "sourceMessageId" TEXT,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "title" TEXT,
    "summary" TEXT NOT NULL,
    "subjectName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdByType" TEXT NOT NULL DEFAULT 'AI',
    "createdByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "dueDateLocal" TEXT,
    "dueTimeLocal" TEXT,
    "dueAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "OperationalItem_tenantId_type_status_idx" ON "OperationalItem"("tenantId", "type", "status");
CREATE INDEX IF NOT EXISTS "OperationalItem_tenantId_chatId_idx" ON "OperationalItem"("tenantId", "chatId");
CREATE INDEX IF NOT EXISTS "OperationalItem_tenantId_customerId_idx" ON "OperationalItem"("tenantId", "customerId");
CREATE INDEX IF NOT EXISTS "OperationalItem_tenantId_dueDateLocal_idx" ON "OperationalItem"("tenantId", "dueDateLocal");
CREATE INDEX IF NOT EXISTS "OperationalItem_tenantId_dueAt_idx" ON "OperationalItem"("tenantId", "dueAt");
CREATE UNIQUE INDEX IF NOT EXISTS "OperationalItem_tenantId_dedupeKey_key" ON "OperationalItem"("tenantId", "dedupeKey");

-- AddForeignKeys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_tenantId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_customerId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_contactId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_chatId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_sourceMessageId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_orderId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_createdByUserId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationalItem_completedByUserId_fkey') THEN
    ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
