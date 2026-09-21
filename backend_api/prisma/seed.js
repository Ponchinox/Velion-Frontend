import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando la siembra inicial de SuperAdmin...');

  const superAdminEmail = (process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@velion.pe').trim().toLowerCase();
  const superAdminPassword = process.env.INITIAL_SUPERADMIN_PASSWORD || 'AdminSecure2026!';

  // 1. Verificar idempotencia: si ya existe un usuario con este email o con rol superadmin
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: superAdminEmail },
        { role: 'superadmin' },
      ],
    },
  });

  if (existingUser) {
    console.log(`ℹ️ [IDEMPOTENTE] SuperAdmin existente detectado (${existingUser.email}, ID: ${existingUser.id}). Se omite la creación.`);
    return;
  }

  // 2. Obtener o crear el Tenant de Administración
  let tenant = await prisma.tenant.findFirst({
    where: { name: 'Administración Central' },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Administración Central',
        plan: 'Elite',
        msgLimit: 999999,
        connLimit: 99,
      },
    });
  }

  // 3. Hashear la contraseña de forma segura con bcrypt
  const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

  // 4. Crear el usuario SuperAdmin
  const user = await prisma.user.create({
    data: {
      email: superAdminEmail,
      password: hashedPassword,
      role: 'superadmin',
      tenantId: tenant.id,
    },
  });

  console.log('🚀 SuperAdmin inicial aprovisionado con éxito.');
  console.log(`👤 SuperAdmin creado: email: ${user.email} (contraseña configurada vía entorno, nunca expuesta)`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante el proceso de Seeding:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
