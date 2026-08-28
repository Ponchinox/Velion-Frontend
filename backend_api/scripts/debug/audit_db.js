import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const schemas = await prisma.$queryRaw`SELECT schema_name FROM information_schema.schemata`;
    console.log('--- Schemas ---');
    console.log(schemas.map(s => s.schema_name));
    
    const publicTables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
    console.log('\n--- Public Tables ---');
    console.log(publicTables.map(t => t.table_name));

    const evoTables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='evolution_api'`;
    console.log('\n--- Evolution Tables ---');
    console.log(evoTables.map(t => t.table_name));
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}
main();
