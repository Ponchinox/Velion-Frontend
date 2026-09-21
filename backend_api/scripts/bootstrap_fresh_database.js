/**
 * VELION FRESH DATABASE BOOTSTRAP RUNNER
 * =======================================
 * Inicializa de forma reproducible una base de datos PostgreSQL completamente VACÍA
 * aplicando el snapshot congelado de baseline (20260920_baseline.sql) y registrando
 * formalmente las migraciones 01 a 17 mediante `prisma migrate resolve --applied`.
 *
 * REGLAS FAIL-CLOSED:
 * - Requiere que DATABASE_URL apunte estrictamente a localhost o 127.0.0.1.
 * - Solo se ejecuta sobre una base de datos 100% vacía (0 tablas).
 * - Aborta inmediatamente ante bases existentes, parciales o remotas.
 * - NO sobrescribe datos ni altera checksums de migraciones.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendApiDir = path.resolve(__dirname, '..');

export async function bootstrapFreshDatabase(customDatabaseUrl = null) {
  const rawUrl = customDatabaseUrl || process.env.DATABASE_URL;

  if (!rawUrl) {
    throw new Error('❌ [BOOTSTRAP GUARD] Variable DATABASE_URL no definida en el entorno.');
  }

  // 1. Hostname Security Guard (FAIL-CLOSED)
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (err) {
    throw new Error(`❌ [BOOTSTRAP GUARD] URL de base de datos malformada: ${err.message}`);
  }

  const hostname = parsedUrl.hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error(
      `❌ [BOOTSTRAP GUARD] Host "${hostname}" RECHAZADO. Por seguridad estricta, el bootstrap de baseline solo está autorizado en entornos locales (localhost / 127.0.0.1).`
    );
  }

  console.log('======================================================================');
  console.log('🚀 VELION FRESH DATABASE BOOTSTRAP');
  console.log('======================================================================');
  console.log(`DB_HOST     = ${hostname}`);
  console.log(`DB_PORT     = ${parsedUrl.port || '5432'}`);
  console.log(`DB_NAME     = ${parsedUrl.pathname.replace('/', '')}`);
  console.log('ENVIRONMENT = LOCAL_FRESH_DATABASE\n');

  // 2. Conexión y evaluación del estado inicial de la base de datos
  const client = new Client({ connectionString: rawUrl });
  await client.connect();

  try {
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);

    const existingTables = tableRes.rows.map(r => r.table_name);

    if (existingTables.length > 0) {
      const isVelionDb = existingTables.includes('Tenant') || existingTables.includes('Product') || existingTables.includes('User');
      if (isVelionDb) {
        throw new Error(
          `❌ [BOOTSTRAP ABORT: EXISTING_VELION_DATABASE] La base de datos ya contiene un esquema Velion (${existingTables.length} tablas encontradas). ` +
          `Para aplicar nuevas migraciones en una base existente ejecute 'npx prisma migrate deploy', NO use db:bootstrap.`
        );
      } else {
        throw new Error(
          `❌ [BOOTSTRAP ABORT: PARTIAL_DATABASE] La base de datos no está vacía (${existingTables.length} tablas encontradas: ${existingTables.slice(0, 5).join(', ')}...). ` +
          `El bootstrap solo opera sobre bases de datos completamente limpias.`
        );
      }
    }

    console.log('  ✅ Verificación de estado: Base de datos 100% limpia (0 tablas detectadas).');

    // 3. Cargar y validar artefactos de baseline
    const baselineDir = path.join(backendApiDir, 'prisma', 'baseline');
    const manifestPath = path.join(baselineDir, '20260920_baseline_manifest.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`❌ [BOOTSTRAP ERROR] Manifiesto de baseline no encontrado en: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sqlPath = path.join(baselineDir, manifest.baselineSqlFile || '20260920_baseline.sql');

    if (!fs.existsSync(sqlPath)) {
      throw new Error(`❌ [BOOTSTRAP ERROR] Archivo SQL de baseline no encontrado en: ${sqlPath}`);
    }

    const baselineSql = fs.readFileSync(sqlPath, 'utf8').replace(/^\uFEFF/, '');

    // 4. Aplicar el snapshot DDL congelado
    console.log(`  ⏳ Aplicando DDL congelado (${manifest.baselineVersion})...`);
    await client.query(baselineSql);

    // Verificar que las tablas fueron creadas físicamente
    const postRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const createdTables = postRes.rows.map(r => r.table_name);
    console.log(`  ✅ DDL aplicado exitosamente: ${createdTables.length} tablas creadas.`);

    // 5. Reconciliar el historial de migraciones de Prisma
    console.log(`  ⏳ Reconciliando historial de Prisma para ${manifest.includedMigrations.length} migraciones representadas...`);

    for (const migration of manifest.includedMigrations) {
      try {
        execSync(`npx prisma migrate resolve --applied ${migration}`, {
          cwd: backendApiDir,
          env: { ...process.env, DATABASE_URL: rawUrl },
          stdio: 'pipe'
        });
      } catch (err) {
        throw new Error(`❌ Error al registrar migración "${migration}" mediante prisma migrate resolve: ${err.stderr?.toString() || err.message}`);
      }
    }

    console.log(`  ✅ ${manifest.includedMigrations.length} migraciones marcadas oficialmente como aplicadas.`);

    // 6. Si existen migraciones posteriores al baseline, ejecutarlas vía migrate deploy
    console.log('  ⏳ Verificando si existen migraciones incrementales posteriores al baseline...');
    const deployOutput = execSync('npx prisma migrate deploy', {
      cwd: backendApiDir,
      env: { ...process.env, DATABASE_URL: rawUrl },
      stdio: 'pipe'
    }).toString();

    console.log('  ✅ Estado final de migraciones:');
    console.log(deployOutput.split('\n').filter(l => l.trim()).map(l => `     ${l}`).join('\n'));

    console.log('\n======================================================================');
    console.log('🎉 BASELINE BOOTSTRAP COMPLETADO CON ÉXITO');
    console.log('======================================================================\n');
    return { success: true, tablesCreated: createdTables.length, migrationsResolved: manifest.includedMigrations.length };
  } finally {
    await client.end();
  }
}

// Ejecución directa desde CLI si se invoca como script
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  bootstrapFreshDatabase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
