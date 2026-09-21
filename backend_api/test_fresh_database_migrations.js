/**
 * VELION FRESH DATABASE & MIGRATION BASELINE TEST SUITE
 * =====================================================
 * Valida de forma automatizada y 100% offline:
 * 1. Bootstrap limpio desde cero sobre una PostgreSQL virgen (velion_baseline_cleanroom).
 * 2. Cero schema drift (`prisma migrate diff` = 0).
 * 3. Consistencia total del historial de Prisma (`prisma migrate status`).
 * 4. Guards fail-closed (rechazo ante base con datos, parcial o remota).
 * 5. Compatibilidad estricta con migraciones futuras (18+ no son resueltas por el manifest).
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import assert from 'node:assert';
import pg from 'pg';
import { bootstrapFreshDatabase } from './scripts/bootstrap_fresh_database.js';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendApiDir = __dirname;

const ADMIN_URL = 'postgresql://disposable_user:disposable_pass_123@127.0.0.1:54333/postgres';
const CLEANROOM_DB = 'velion_baseline_cleanroom';
const CLEANROOM_URL = `postgresql://disposable_user:disposable_pass_123@127.0.0.1:54333/${CLEANROOM_DB}?schema=public`;

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

async function recreateCleanroomDatabase() {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    // Terminar conexiones previas si existieran
    await client.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${CLEANROOM_DB}'
        AND pid <> pg_backend_pid();
    `);
    await client.query(`DROP DATABASE IF EXISTS ${CLEANROOM_DB};`);
    await client.query(`CREATE DATABASE ${CLEANROOM_DB};`);
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('======================================================================');
  console.log('🧪 VELION FRESH DATABASE MIGRATIONS & BASELINE REPRODUCIBILITY SUITE');
  console.log('======================================================================\n');

  // ── TEST 1: Fail-Closed Remote URL Guard ──────────────────────────────────────
  await runTest('TEST 1: Guard de seguridad rechaza URLs remotas antes de conectar (Fail-Closed)', async () => {
    let threw = false;
    try {
      await bootstrapFreshDatabase('postgresql://user:pass@db.velion.render.internal:5432/prod_db');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('RECHAZADO'), `Debe rechazar host remoto: ${err.message}`);
    }
    assert.ok(threw, 'Debe fallar al intentar bootstrap contra host no-localhost');
  });

  // ── TEST 2: Preparar Cleanroom DB vacía ────────────────────────────────────────
  await runTest('TEST 2: Creación de PostgreSQL limpia desechable (0 tablas iniciales)', async () => {
    await recreateCleanroomDatabase();
    const client = new Client({ connectionString: CLEANROOM_URL });
    await client.connect();
    try {
      const res = await client.query(`
        SELECT count(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
      `);
      assert.strictEqual(parseInt(res.rows[0].count, 10), 0, 'La base de datos debe iniciar con 0 tablas');
    } finally {
      await client.end();
    }
  });

  // ── TEST 3: Ejecutar Bootstrap Fresh Database ─────────────────────────────────
  let bootstrapResult;
  await runTest('TEST 3: Ejecución de bootstrap_fresh_database sobre cleanroom -> SUCCESS', async () => {
    bootstrapResult = await bootstrapFreshDatabase(CLEANROOM_URL);
    assert.ok(bootstrapResult.success);
    assert.strictEqual(bootstrapResult.migrationsResolved, 17, 'Debe reconciliar exactamente las 17 migraciones');
    assert.ok(bootstrapResult.tablesCreated >= 20, `Debe crear al menos 20 tablas, creó ${bootstrapResult.tablesCreated}`);
  });

  // ── TEST 4: Prisma Migrate Status reconoce estado limpio ───────────────────────
  await runTest('TEST 4: npx prisma migrate status reconoce las 18 migraciones aplicadas (Up to date)', async () => {
    const statusOut = execSync('npx prisma migrate status', {
      cwd: backendApiDir,
      env: { ...process.env, DATABASE_URL: CLEANROOM_URL },
      stdio: 'pipe'
    }).toString();

    assert.ok(statusOut.includes('18 migrations found in prisma/migrations'), 'Debe detectar 18 migraciones');
    assert.ok(statusOut.includes('Database schema is up to date!'), 'Debe indicar que la base de datos está al día');
  });

  // ── TEST 5: Schema Drift es CERO contra schema.prisma ──────────────────────────
  await runTest('TEST 5: Zero Schema Drift — Comparación física de la BD contra schema.prisma da 0 diferencias', async () => {
    // Diff entre la base de datos real cleanroom y el schema.prisma
    const diffOut = execSync(
      'npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url "' + CLEANROOM_URL + '" --script',
      {
        cwd: backendApiDir,
        env: { ...process.env, DATABASE_URL: CLEANROOM_URL },
        stdio: 'pipe'
      }
    ).toString().trim();

    // Si el diff está vacío o no contiene sentencias DDL, el drift es 0
    const ddlCommands = diffOut.split('\n').filter(l => l.trim() && !l.startsWith('--'));
    assert.strictEqual(ddlCommands.length, 0, `Schema drift detectado: ${diffOut}`);
  });

  // ── TEST 6: Fail-Closed en Base Existente (EXISTING_VELION_DATABASE) ───────────
  await runTest('TEST 6: Bootstrap SE NIEGA a ejecutarse sobre una base ya poblada (EXISTING_VELION_DATABASE)', async () => {
    let threw = false;
    try {
      await bootstrapFreshDatabase(CLEANROOM_URL);
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('EXISTING_VELION_DATABASE'), `Debe abortar con EXISTING_VELION_DATABASE: ${err.message}`);
    }
    assert.ok(threw, 'Bootstrap debe negarse a correr sobre base ya inicializada');
  });

  // ── TEST 7: Fail-Closed en Base Parcial (PARTIAL_DATABASE) ─────────────────────
  await runTest('TEST 7: Bootstrap SE NIEGA a ejecutarse sobre una base parcialmente construida o desconocida', async () => {
    await recreateCleanroomDatabase();
    // Crear una tabla huérfana arbitraria
    const client = new Client({ connectionString: CLEANROOM_URL });
    await client.connect();
    await client.query('CREATE TABLE random_orphaned_table (id serial primary key);');
    await client.end();

    let threw = false;
    try {
      await bootstrapFreshDatabase(CLEANROOM_URL);
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('PARTIAL_DATABASE'), `Debe abortar con PARTIAL_DATABASE: ${err.message}`);
    }
    assert.ok(threw, 'Bootstrap debe negarse a correr sobre base parcial');
  });

  // ── TEST 8: Compatibilidad con Migraciones Futuras (Migración 18+) ─────────────
  await runTest('TEST 8: Manifiesto congelado solo incluye 01-17; futuras migraciones (18+) quedan pendientes para migrate deploy', async () => {
    const manifestPath = path.join(backendApiDir, 'prisma', 'baseline', '20260920_baseline_manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(manifest.includedMigrations.length, 17);
    assert.strictEqual(manifest.throughMigration, '20260920150000_add_commerce_integrations');
    assert.ok(manifest.includedMigrations.includes('20260920150000_add_commerce_integrations'));
    assert.ok(!manifest.includedMigrations.includes('20261001000000_future_migration_18'), 'Migraciones futuras no deben estar pre-resueltas');
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE FRESH DATABASE & BASELINE: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Suite Fresh Database falló:', err);
  process.exit(1);
});
