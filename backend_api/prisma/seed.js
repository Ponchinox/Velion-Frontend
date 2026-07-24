import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando la siembra de base de datos (Seeding)...');

  // 1. Crear el Tenant de Administración
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Administración Central',
      plan: 'Elite',
      msgLimit: 999999,
      connLimit: 99,
    },
  });

  // 2. Hashear la contraseña del administrador
  const hashedPassword = await bcrypt.hash('Undertale.926246740', 10);

  // 3. Crear el usuario SuperAdmin asociado a ese Tenant
  const user = await prisma.user.create({
    data: {
      email: 'nehiseroblitas2001@gmail.com',
      password: hashedPassword,
      role: 'superadmin',
      tenantId: tenant.id,
    },
  });



  console.log('🚀 Base de datos sembrada con éxito.');
  console.log(`👤 SuperAdmin creado: email: ${user.email} | password: Undertale.926246740`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante el proceso de Seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
