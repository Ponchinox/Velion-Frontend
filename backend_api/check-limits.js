import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany();
  console.log("Tenants:");
  for (const t of tenants) {
    const regCount = await prisma.registeredWhatsAppNumber.count({ where: { tenantId: t.id }});
    console.log(`- ${t.name} (ID: ${t.id}) | connLimit: ${t.connLimit} | Actual connections: ${regCount}`);
  }
}

main().finally(() => prisma.$disconnect());
