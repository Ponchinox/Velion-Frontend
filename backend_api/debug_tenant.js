import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function debugTenant() {
  const tenant = await prisma.tenant.findFirst({
    where: { name: 'Velion Oficial' }
  });

  console.log("Tenant Plan Name:", tenant.plan);
  console.log("Tenant Plan ID:", tenant.planId);

  if (tenant.planId) {
    const planById = await prisma.plan.findUnique({ where: { id: tenant.planId }});
    console.log("Plan by ID:", planById?.name, "hasAdvancedMarketing:", planById?.hasAdvancedMarketing);
  }

  if (tenant.plan) {
    const planByName = await prisma.plan.findFirst({ where: { name: tenant.plan }});
    console.log("Plan by Name:", planByName?.name, "hasAdvancedMarketing:", planByName?.hasAdvancedMarketing);
  }
}

debugTenant().finally(() => prisma.$disconnect());
