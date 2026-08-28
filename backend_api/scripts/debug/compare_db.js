import { PrismaClient } from '@prisma/client';

const oldDbUrl = "postgresql://neondb_owner:npg_A9fUF3PSjtyJ@ep-winter-mud-axg6ktxh.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require";
const newDbUrl = "postgresql://neondb_owner:npg_Flqncwf47Cbv@ep-morning-rain-ay9va843-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

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
