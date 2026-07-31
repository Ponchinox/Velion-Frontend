import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function syncAllTenants() {
  const plans = await prisma.plan.findMany();
  console.log(`Encontrados ${plans.length} planes en la base de datos.`);

  for (const plan of plans) {
    const updated = await prisma.tenant.updateMany({
      where: {
        OR: [
          { planId: plan.id },
          { plan: { equals: plan.name, mode: 'insensitive' } }
        ]
      },
      data: {
        planId: plan.id,
        plan: plan.name,
        connLimit: plan.connLimit,
        msgLimit: plan.msgLimit
      }
    });
    console.log(`Sincronizados ${updated.count} tenants para el plan "${plan.name}" (connLimit: ${plan.connLimit}, msgLimit: ${plan.msgLimit})`);
  }
}

syncAllTenants().finally(() => prisma.$disconnect());
