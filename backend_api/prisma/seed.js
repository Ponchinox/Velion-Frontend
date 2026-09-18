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
  const superAdminEmail = process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@velion.pe';
  const superAdminPassword = process.env.INITIAL_SUPERADMIN_PASSWORD || 'AdminSecure2026!';
  const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

  // 3. Crear el usuario SuperAdmin asociado a ese Tenant
  const user = await prisma.user.create({
    data: {
      email: superAdminEmail,
      password: hashedPassword,
      role: 'superadmin',
      tenantId: tenant.id,
    },
  });

  console.log('🚀 Base de datos sembrada con éxito.');
  console.log(`👤 SuperAdmin creado: email: ${user.email} (contraseña configurada vía entorno)`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante el proceso de Seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
