import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkPlans() {
  const plans = await prisma.plan.findMany();
  for (const p of plans) {
    console.log(`Plan ID: ${p.id} | Name: ${p.name} | connLimit: ${p.connLimit} | maxProducts: ${p.maxProducts} | hasAdvancedMarketing: ${p.hasAdvancedMarketing}`);
  }

  const tenants = await prisma.tenant.findMany({ select: { name: true, plan: true, planId: true, connLimit: true, msgLimit: true } });
  for (const t of tenants) {
    console.log(`Tenant: ${t.name} | PlanName: ${t.plan} | PlanId: ${t.planId} | connLimit: ${t.connLimit}`);
  }
}

checkPlans().finally(() => prisma.$disconnect());
