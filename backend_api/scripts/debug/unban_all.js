import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function unbanAll() {
  console.log('🔄 Iniciando desbaneo general de clientes...');

  // 1. Desbanear todos los clientes en la tabla Customer
  const result = await prisma.customer.updateMany({
    where: { isBanned: true },
    data: { isBanned: false }
  });

  console.log(`✅ ¡Éxito! Se han desbaneado ${result.count} cliente(s) en la base de datos.`);

  // 2. Verificar el número +51991535502 específicamente si existe
  const specificCustomer = await prisma.customer.findFirst({
    where: { phone: { contains: '51991535502' } }
  });

  if (specificCustomer) {
    console.log(`📱 Cliente +51991535502 encontrado:`);
    console.log(`   - ID: ${specificCustomer.id}`);
    console.log(`   - Nombre: ${specificCustomer.name || 'Sin nombre'}`);
    console.log(`   - isBanned: ${specificCustomer.isBanned}`);
    console.log(`   - isBotPaused: ${specificCustomer.isBotPaused}`);
  } else {
    console.log(`ℹ️ El número +51991535502 no tiene un registro de Customer específico actualmente.`);
  }
}

unbanAll()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
