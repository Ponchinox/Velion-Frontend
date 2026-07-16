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
  const hashedPassword = await bcrypt.hash('admin123', 10);

  // 3. Crear el usuario SuperAdmin asociado a ese Tenant
  const user = await prisma.user.create({
    data: {
      email: 'admin@velion.com',
      password: hashedPassword,
      role: 'superadmin',
      tenantId: tenant.id,
    },
  });

  // 4. Inyectar Alertas de Prueba
  await prisma.alert.createMany({
    data: [
      {
        type: 'QUOTA_EXCEEDED',
        severity: 'HIGH',
        message: 'La empresa superó el límite de mensajes del plan básico.',
        tenantId: tenant.id,
        resolved: false,
      },
      {
        type: 'SESSION_FAILED',
        severity: 'CRITICAL',
        message: 'La conexión de WhatsApp en la instancia central falló debido a credenciales inválidas.',
        tenantId: tenant.id,
        resolved: false,
      },
      {
        type: 'SYSTEM_ERROR',
        severity: 'MEDIUM',
        message: 'Fallo temporal en el servidor de correos al enviar facturación.',
        tenantId: null,
        resolved: false,
      }
    ],
  });

  console.log('🚀 Base de datos sembrada con éxito.');
  console.log(`👤 SuperAdmin creado: email: ${user.email} | password: admin123`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante el proceso de Seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
