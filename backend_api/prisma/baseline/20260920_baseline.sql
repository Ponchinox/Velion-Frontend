-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT DEFAULT 'Sin Plan',
    "planId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "msgLimit" INTEGER NOT NULL DEFAULT 0,
    "connLimit" INTEGER NOT NULL DEFAULT 0,
    "logoUrl" TEXT,
    "companyName" TEXT DEFAULT '',
    "taxId" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "businessSector" TEXT,
    "bankAccounts" TEXT,
    "businessHours" TEXT,
    "termsAndPolicies" TEXT,
    "customPrompt" TEXT,
    "botRole" TEXT,
    "multiMessageMode" BOOLEAN NOT NULL DEFAULT true,
    "respondInGroups" BOOLEAN NOT NULL DEFAULT false,
    "notificationPhone" TEXT,
    "notifySalesWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "marketingModeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiDisabledAt" TIMESTAMP(3),
    "sessionInactivityHours" INTEGER NOT NULL DEFAULT 6,
    "dailyTokenBudget" INTEGER DEFAULT 100000,
    "monthlyTokenBudget" INTEGER DEFAULT 2000000,
    "aiBudgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "followUpDecisionMode" TEXT DEFAULT 'OFF',
    "timezone" TEXT,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'client',
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'Nuevos Leads',
    "lastInteraction" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "tags" TEXT[],
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderRole" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "mediaType" TEXT,
    "mediaPath" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "caption" TEXT,
    "mediaSize" INTEGER,
    "mediaStatus" TEXT,
    "mediaGroupId" TEXT,
    "mediaGroupIndex" INTEGER,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationFlow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" TEXT NOT NULL DEFAULT 'PHYSICAL_PRODUCT',
    "price" DOUBLE PRECISION NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "promotionalPrice" DOUBLE PRECISION,
    "promoStartDate" TIMESTAMP(3),
    "promoEndDate" TIMESTAMP(3),
    "sku" TEXT,
    "normalizedSku" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoUrl" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "connLimit" INTEGER NOT NULL DEFAULT 1,
    "msgLimit" INTEGER NOT NULL DEFAULT 1000,
    "features" JSONB NOT NULL,
    "flowBuilder" BOOLEAN NOT NULL DEFAULT false,
    "aiBrain" BOOLEAN NOT NULL DEFAULT false,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hasAdvancedMarketing" BOOLEAN NOT NULL DEFAULT false,
    "hasAutomations" BOOLEAN NOT NULL DEFAULT false,
    "hasCampaigns" BOOLEAN NOT NULL DEFAULT false,
    "maxProducts" INTEGER NOT NULL DEFAULT 10,
    "dailyTokenBudget" INTEGER DEFAULT 130000,
    "monthlyTokenBudget" INTEGER DEFAULT 2000000,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "preferences" TEXT,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "currentFlowId" TEXT,
    "currentNodeId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isBotPaused" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT NOT NULL,
    "commercialState" JSONB,
    "persistentProfile" JSONB,
    "sessionUpdatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "followUpSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "followUpOptOutAt" TIMESTAMP(3),
    "followUpSuppressionReason" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseMessage" TEXT NOT NULL,
    "media" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "delayMin" INTEGER NOT NULL DEFAULT 5,
    "delayMax" INTEGER NOT NULL DEFAULT 15,
    "tenantId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "recurrenceType" TEXT NOT NULL DEFAULT 'NONE',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "anchorDay" INTEGER,
    "audienceType" TEXT NOT NULL DEFAULT 'all',
    "targetContactIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentMessage" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT,
    "occurrenceKey" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerKeyword" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisteredWhatsAppNumber" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metaAccessToken" TEXT,
    "metaPhoneNumberId" TEXT,
    "metaWabaId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'EVOLUTION',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "instanceName" TEXT,
    "connectionState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "connectionStateUpdatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisteredWhatsAppNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentMethod" TEXT,
    "shippingCity" TEXT,
    "shippingAddress" TEXT,
    "customerNeeds" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "externalProvider" TEXT,
    "externalDraftOrderId" TEXT,
    "externalOrderId" TEXT,
    "externalOrderNumber" TEXT,
    "externalCheckoutUrl" TEXT,
    "externalSyncStatus" TEXT,
    "externalSyncAttempts" INTEGER NOT NULL DEFAULT 0,
    "externalSyncError" TEXT,
    "externalSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "variant" TEXT,
    "sourceProvider" TEXT,
    "externalProductId" TEXT,
    "externalVariantId" TEXT,
    "sourceSku" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAIUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalItem" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpSequence" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpAttempt" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryStatus" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "dispatchStartedAt" TIMESTAMP(3),
    "sentMessage" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpAttempt_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Message_chatId_mediaGroupId_idx" ON "Message"("chatId", "mediaGroupId");

-- CreateIndex
CREATE INDEX "Product_userId_normalizedSku_idx" ON "Product"("userId", "normalizedSku");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_phone_key" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "Campaign_status_nextRunAt_idx" ON "Campaign"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_idx" ON "Campaign"("tenantId");

-- CreateIndex
CREATE INDEX "CampaignLog_campaignId_idx" ON "CampaignLog"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignLog_campaignId_status_idx" ON "CampaignLog"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLog_campaignId_customerPhone_occurrenceKey_key" ON "CampaignLog"("campaignId", "customerPhone", "occurrenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredWhatsAppNumber_phoneNumber_key" ON "RegisteredWhatsAppNumber"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredWhatsAppNumber_instanceName_key" ON "RegisteredWhatsAppNumber"("instanceName");

-- CreateIndex
CREATE INDEX "Order_tenantId_externalSyncStatus_idx" ON "Order"("tenantId", "externalSyncStatus");

-- CreateIndex
CREATE INDEX "Order_tenantId_externalDraftOrderId_idx" ON "Order"("tenantId", "externalDraftOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAIUsage_tenantId_date_key" ON "TenantAIUsage"("tenantId", "date");

-- CreateIndex
CREATE INDEX "OperationalItem_tenantId_type_status_idx" ON "OperationalItem"("tenantId", "type", "status");

-- CreateIndex
CREATE INDEX "OperationalItem_tenantId_chatId_idx" ON "OperationalItem"("tenantId", "chatId");

-- CreateIndex
CREATE INDEX "OperationalItem_tenantId_customerId_idx" ON "OperationalItem"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "OperationalItem_tenantId_dueDateLocal_idx" ON "OperationalItem"("tenantId", "dueDateLocal");

-- CreateIndex
CREATE INDEX "OperationalItem_tenantId_dueAt_idx" ON "OperationalItem"("tenantId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalItem_tenantId_dedupeKey_key" ON "OperationalItem"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "FollowUpSequence_status_nextRunAt_idx" ON "FollowUpSequence"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "FollowUpSequence_tenantId_customerId_idx" ON "FollowUpSequence"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "FollowUpSequence_tenantId_status_idx" ON "FollowUpSequence"("tenantId", "status");

-- CreateIndex
CREATE INDEX "FollowUpSequence_tenantId_nextRunAt_idx" ON "FollowUpSequence"("tenantId", "nextRunAt");

-- CreateIndex
CREATE INDEX "FollowUpAttempt_sequenceId_idx" ON "FollowUpAttempt"("sequenceId");

-- CreateIndex
CREATE INDEX "FollowUpAttempt_status_idx" ON "FollowUpAttempt"("status");

-- CreateIndex
CREATE INDEX "FollowUpAttempt_providerMessageId_idx" ON "FollowUpAttempt"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpAttempt_sequenceId_attemptNumber_key" ON "FollowUpAttempt"("sequenceId", "attemptNumber");

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

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationFlow" ADD CONSTRAINT "AutomationFlow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredWhatsAppNumber" ADD CONSTRAINT "RegisteredWhatsAppNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAIUsage" ADD CONSTRAINT "TenantAIUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalItem" ADD CONSTRAINT "OperationalItem_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpAttempt" ADD CONSTRAINT "FollowUpAttempt_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

