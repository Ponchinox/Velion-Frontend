import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkRecentTenants() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  for (const tenant of tenants) {
    let hasAdvancedMarketing = false;
    let planName = tenant.plan || 'Sin Plan';

    if (tenant.planId) {
      const plan = await prisma.plan.findUnique({
        where: { id: tenant.planId }
      });
      if (plan) {
        hasAdvancedMarketing = Boolean(plan.hasAdvancedMarketing);
        planName = plan.name;
      }
    } else if (tenant.plan && tenant.plan !== 'Sin Plan') {
      const plan = await prisma.plan.findFirst({
        where: { name: { equals: tenant.plan, mode: 'insensitive' } }
      });
      if (plan) {
        hasAdvancedMarketing = Boolean(plan.hasAdvancedMarketing);
        planName = plan.name;
      }
    }

    console.log(`Tenant: ${tenant.name}`);
    console.log(`  planId: ${tenant.planId}`);
    console.log(`  plan: ${tenant.plan}`);
    console.log(`  hasAdvancedMarketing (DB): ${hasAdvancedMarketing}`);
  }
}

checkRecentTenants().finally(() => prisma.$disconnect());
