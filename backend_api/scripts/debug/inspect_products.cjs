const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const prods = await prisma.product.findMany({
    where: {
      user: {
        tenantId: 'dfe020e6-5e08-404c-9b89-ef3f08f2b150'
      }
    },
    select: {
      id: true,
      name: true,
      category: true,
      tags: true
    }
  });

  console.log(`=== TENANT PRODUCTS: ${prods.length} ===`);
  for (const p of prods) {
    console.log(`- [${p.id}] "${p.name}" (category: ${p.category})`);
  }
}

main().finally(() => prisma.$disconnect());
