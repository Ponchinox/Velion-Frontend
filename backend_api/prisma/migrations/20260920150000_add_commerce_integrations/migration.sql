-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "normalizedSku" TEXT,
ADD COLUMN     "sku" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "externalCheckoutUrl" TEXT,
ADD COLUMN     "externalDraftOrderId" TEXT,
ADD COLUMN     "externalOrderId" TEXT,
ADD COLUMN     "externalOrderNumber" TEXT,
ADD COLUMN     "externalProvider" TEXT,
ADD COLUMN     "externalSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "externalSyncError" TEXT,
ADD COLUMN     "externalSyncStatus" TEXT,
ADD COLUMN     "externalSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "externalProductId" TEXT,
ADD COLUMN     "externalVariantId" TEXT,
ADD COLUMN     "sourceProvider" TEXT,
ADD COLUMN     "sourceSku" TEXT;

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "shopDomain" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "catalogMode" TEXT NOT NULL DEFAULT 'COMBINED',
    "priceSource" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "stockSource" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "externalOrderMode" TEXT NOT NULL DEFAULT 'SHOPIFY_DRAFT',
    "syncProducts" BOOLEAN NOT NULL DEFAULT true,
    "syncInventory" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" TEXT DEFAULT 'IDLE',
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageUrl" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalProductVariant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "externalVariantId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "sku" TEXT,
    "normalizedSku" TEXT,
    "title" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "compareAtPrice" DOUBLE PRECISION,
    "inventoryQuantity" INTEGER NOT NULL DEFAULT 0,
    "availableForSale" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Integration_tenantId_status_idx" ON "Integration"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_tenantId_provider_key" ON "Integration"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_shopDomain_key" ON "Integration"("provider", "shopDomain");

-- CreateIndex
CREATE INDEX "ExternalProduct_tenantId_provider_idx" ON "ExternalProduct"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "ExternalProduct_integrationId_idx" ON "ExternalProduct"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProduct_tenantId_provider_externalId_key" ON "ExternalProduct"("tenantId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "ExternalProductVariant_tenantId_provider_idx" ON "ExternalProductVariant"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "ExternalProductVariant_tenantId_provider_normalizedSku_idx" ON "ExternalProductVariant"("tenantId", "provider", "normalizedSku");

-- CreateIndex
CREATE INDEX "ExternalProductVariant_externalProductId_idx" ON "ExternalProductVariant"("externalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProductVariant_tenantId_provider_externalVariantId_key" ON "ExternalProductVariant"("tenantId", "provider", "externalVariantId");

-- CreateIndex
CREATE INDEX "Product_userId_normalizedSku_idx" ON "Product"("userId", "normalizedSku");

-- CreateIndex
CREATE INDEX "Order_tenantId_externalSyncStatus_idx" ON "Order"("tenantId", "externalSyncStatus");

-- CreateIndex
CREATE INDEX "Order_tenantId_externalDraftOrderId_idx" ON "Order"("tenantId", "externalDraftOrderId");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProduct" ADD CONSTRAINT "ExternalProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProduct" ADD CONSTRAINT "ExternalProduct_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProductVariant" ADD CONSTRAINT "ExternalProductVariant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProductVariant" ADD CONSTRAINT "ExternalProductVariant_externalProductId_fkey" FOREIGN KEY ("externalProductId") REFERENCES "ExternalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
