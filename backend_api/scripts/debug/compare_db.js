import { PrismaClient } from '@prisma/client';

const oldDbUrl = process.env.SOURCE_DATABASE_URL || process.env.OLD_DATABASE_URL;
const newDbUrl = process.env.TARGET_DATABASE_URL || process.env.NEW_DATABASE_URL || process.env.DATABASE_URL;

if (!oldDbUrl || !newDbUrl) {
  console.error('Error: SOURCE_DATABASE_URL and TARGET_DATABASE_URL environment variables must be provided.');
  process.exit(1);
}

const tables = [
  'Plan',
  'Message',
  'Chat',
  'Tenant',
  'Product',
  'AutomationFlow',
  'Alert',
  'Contact',
  'Customer',
  'Campaign',
  'SystemConfig',
  'User',
  'CampaignLog',
  'Flow',
  'RegisteredWhatsAppNumber'
];

async function countRows(prisma, table) {
  const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "public"."${table}"`);
  return Number(result[0].count);
}

async function main() {
  const prismaOld = new PrismaClient({ datasources: { db: { url: oldDbUrl } } });
  const prismaNew = new PrismaClient({ datasources: { db: { url: newDbUrl } } });

  console.log("=== COMPARACIÓN DE TABLAS ===");
  console.log("TABLA".padEnd(30), "VIEJA".padEnd(10), "NUEVA".padEnd(10), "ESTADO");
  console.log("-".repeat(60));

  let hasDifferences = false;

  for (const table of tables) {
    try {
      const countOld = await countRows(prismaOld, table);
      const countNew = await countRows(prismaNew, table);
      
      const status = countOld === countNew ? "✅ OK" : "❌ DIFERENCIA";
      if (countOld !== countNew) hasDifferences = true;

      console.log(table.padEnd(30), String(countOld).padEnd(10), String(countNew).padEnd(10), status);
    } catch (e) {
      console.log(table.padEnd(30), "ERROR".padEnd(10), "ERROR".padEnd(10), "❌ " + e.message.substring(0, 50));
      hasDifferences = true;
    }
  }

  await prismaOld.$disconnect();
  await prismaNew.$disconnect();

  if (hasDifferences) {
    console.log("\n⚠️ ATENCIÓN: Se encontraron diferencias en los datos.");
    process.exit(1);
  } else {
    console.log("\n🎉 ÉXITO: Todas las tablas coinciden perfectamente.");
    process.exit(0);
  }
}

main().catch(console.error);
