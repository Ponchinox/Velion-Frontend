import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkApiLogic() {
  const tenant = await prisma.tenant.findFirst({
    where: { name: 'Velion Oficial' }
  });

  let hasAdvancedMarketing = false;
  let planName = tenant.plan || 'Sin Plan';

  if (tenant.planId) {
    const plan = await prisma.plan.findUnique({
      where: { id: tenant.planId },
      select: { hasAdvancedMarketing: true, name: true },
    });
    if (plan) {
      hasAdvancedMarketing = Boolean(plan.hasAdvancedMarketing);
      planName = plan.name;
    }
  } else if (tenant.plan && tenant.plan !== 'Sin Plan') {
    const plan = await prisma.plan.findFirst({
      where: { name: { equals: tenant.plan, mode: 'insensitive' } },
      select: { hasAdvancedMarketing: true, name: true },
    });
    if (plan) {
      hasAdvancedMarketing = Boolean(plan.hasAdvancedMarketing);
      planName = plan.name;
    }
  }

  // Fallback
  if (!hasAdvancedMarketing && tenant.plan) {
    const norm = tenant.plan.toLowerCase();
    if (norm.includes('pro') || norm.includes('elite') || norm.includes('empresarial')) {
      hasAdvancedMarketing = true;
    }
  }

  console.log("hasAdvancedMarketing after logic:", hasAdvancedMarketing);
  console.log("planName after logic:", planName);
}

checkApiLogic().finally(() => prisma.$disconnect());
