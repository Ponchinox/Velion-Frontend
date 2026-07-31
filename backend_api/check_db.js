import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkDb() {
  const tenants = await prisma.tenant.findMany({
    include: {
      registeredNumbers: true,
      users: true
    }
  });

  for (const t of tenants) {
    console.log(`Tenant: ${t.name} (Plan: ${t.plan}) - ID: ${t.id}`);
    console.log(`  Users: ${t.users.map(u => u.email).join(', ')}`);
    console.log(`  Registered Numbers: ${t.registeredNumbers.length}`);
    for (const rn of t.registeredNumbers) {
      console.log(`    - ${rn.phoneNumber}`);
    }
  }
}

checkDb()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
