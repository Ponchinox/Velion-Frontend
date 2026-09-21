-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'PEN';

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "shopCurrencyCode" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "currencyCode" TEXT;
