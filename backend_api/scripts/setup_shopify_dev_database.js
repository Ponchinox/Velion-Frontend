/**
 * SETUP SHOPIFY DEV DATABASE
 * ==========================
 * Prepara la base de datos PostgreSQL local desechable `velion_shopify_dev`
 * aplicando el baseline reproducible y creando el tenant sintético de desarrollo.
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { bootstrapFreshDatabase } from './bootstrap_fresh_database.js';

const { Client } = pg;

const ADMIN_URL = 'postgresql://disposable_user:disposable_pass_123@127.0.0.1:54333/postgres';
const DEV_DB_NAME = 'velion_shopify_dev';
const DEV_DB_URL = `postgresql://disposable_user:disposable_pass_123@127.0.0.1:54333/${DEV_DB_NAME}?schema=public`;

async function main() {
  console.log('======================================================================');
  console.log('🛠️ PREPARANDO POSTGRESQL LOCAL PARA FASE 3B SHOPIFY DEV');
  console.log('======================================================================\n');

  // 1. Crear base de datos limpia en PostgreSQL local
  const adminClient = new Client({ connectionString: ADMIN_URL });
  await adminClient.connect();

  try {
    await adminClient.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${DEV_DB_NAME}'
        AND pid <> pg_backend_pid();
    `);
    await adminClient.query(`DROP DATABASE IF EXISTS ${DEV_DB_NAME};`);
    await adminClient.query(`CREATE DATABASE ${DEV_DB_NAME};`);
    console.log(`✅ Base de datos ${DEV_DB_NAME} creada limpia.`);
  } finally {
    await adminClient.end();
  }

  // 2. Ejecutar bootstrap de baseline reproducible
  console.log('⏳ Aplicando baseline reproducible (DDL + 17 migraciones)...');
  const bootstrapRes = await bootstrapFreshDatabase(DEV_DB_URL);
  console.log(`✅ Baseline aplicado: ${bootstrapRes.tablesCreated} tablas, ${bootstrapRes.migrationsResolved} migraciones resueltas.`);

  // 3. Crear tenant y usuario sintético de desarrollo
  const prismaDev = new PrismaClient({
    datasources: {
      db: { url: DEV_DB_URL },
    },
  });

  try {
    const tenant = await prismaDev.tenant.create({
      data: {
        name: 'Shopify Dev Tenant',
        plan: 'Elite',
        active: true,
        msgLimit: 999999,
        connLimit: 99,
      },
    });

    const hashedPassword = await bcrypt.hash('DevPassword2026!', 10);
    const user = await prismaDev.user.create({
      data: {
        email: 'shopify_dev@velion.local',
        password: hashedPassword,
        role: 'client',
        tenantId: tenant.id,
      },
    });

    const jwtSecret = process.env.JWT_SECRET || 'test_secret_key_for_jwt_which_is_at_least_32_characters_long_123';
    const devToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: tenant.id,
      },
      jwtSecret,
      { expiresIn: '30d' }
    );

    console.log('\n======================================================================');
    console.log('🎉 ENTORNO LOCAL SHOPIFY DEV LISTO');
    console.log('======================================================================');
    console.log('DB_HOST     = 127.0.0.1');
    console.log('DB_PORT     = 54333');
    console.log(`DB_NAME     = ${DEV_DB_NAME}`);
    console.log('ENVIRONMENT = LOCAL_SHOPIFY_DEV');
    console.log(`TENANT_ID   = ${tenant.id}`);
    console.log(`USER_ID     = ${user.id}`);
    console.log(`USER_EMAIL  = ${user.email}`);
    console.log('DEV_JWT     = [GENERATED_LOCALLY]');
    console.log('======================================================================\n');
  } finally {
    await prismaDev.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Error preparando entorno local:', err);
  process.exit(1);
});
