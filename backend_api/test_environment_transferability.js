/**
 * TEST: ENVIRONMENT & TRANSFERABILITY HYGIENE SUITE
 * =================================================
 * Verifica que el repositorio esté 100% libre de credenciales y configuraciones
 * del entorno del desarrollador original, y que sea transferible a una empresa:
 * 
 * 1. validateCriticalConfig: fail-fast ante ausencia o valores inseguros en producción.
 * 2. .env.example: inventario exhaustivo de todas las variables process.env.* utilizadas en src/.
 * 3. .env.example: cero valores de producción reales.
 * 4. docker-compose.yml: cero credenciales hardcodeadas (Evolution API key parametrizada).
 * 5. CORS: ausencia de IPs del desarrollador y dominios de Vercel en la configuración por defecto.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateCriticalConfig } from './src/config/configValidator.js';
import { resolveAllowedOrigins } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

async function runSuite() {
  console.log('======================================================================');
  console.log('🚀 VELION TRANSFER HYGIENE & ENVIRONMENT AUDIT');
  console.log('======================================================================\n');

  // ---------------------------------------------------------------------------
  // TEST 1: validateCriticalConfig Fail-Fast Behavior
  // ---------------------------------------------------------------------------
  console.log('--- Test 1: Critical Config Fail-Fast in Production ---');

  // Caso 1.1: Falta DATABASE_URL
  try {
    validateCriticalConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32chars!',
      TOKEN_ENCRYPTION_KEY: 'a_very_long_and_secure_encryption_key_32c!'
    });
    assert(false, 'Debe fallar si falta DATABASE_URL en producción');
  } catch (err) {
    assert(err.message.includes('DATABASE_URL'), 'Fallo correcto ante falta de DATABASE_URL');
  }

  // Caso 1.2: Falta JWT_SECRET
  try {
    validateCriticalConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://usr:pwd@localhost:5432/db',
      TOKEN_ENCRYPTION_KEY: 'a_very_long_and_secure_encryption_key_32c!'
    });
    assert(false, 'Debe fallar si falta JWT_SECRET en producción');
  } catch (err) {
    assert(err.message.includes('JWT_SECRET'), 'Fallo correcto ante falta de JWT_SECRET');
  }

  // Caso 1.3: JWT_SECRET inseguro ("secret" o corto)
  try {
    validateCriticalConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://usr:pwd@localhost:5432/db',
      JWT_SECRET: 'secret',
      TOKEN_ENCRYPTION_KEY: 'a_very_long_and_secure_encryption_key_32c!'
    });
    assert(false, 'Debe fallar si JWT_SECRET es "secret"');
  } catch (err) {
    assert(err.message.includes('JWT_SECRET'), 'Fallo correcto ante JWT_SECRET inseguro');
  }

  // Caso 1.4: Falta TOKEN_ENCRYPTION_KEY en producción
  try {
    validateCriticalConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://usr:pwd@localhost:5432/db',
      JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32chars!'
    });
    assert(false, 'Debe fallar si falta TOKEN_ENCRYPTION_KEY en producción');
  } catch (err) {
    assert(err.message.includes('TOKEN_ENCRYPTION_KEY'), 'Fallo correcto ante falta de TOKEN_ENCRYPTION_KEY');
  }

  // Caso 1.5: Configuración válida en producción
  const validRes = validateCriticalConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://usr:pwd@localhost:5432/db',
    JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32chars!',
    TOKEN_ENCRYPTION_KEY: 'a_very_long_and_secure_encryption_key_32c!'
  });
  assert(validRes.valid === true, 'validateCriticalConfig debe validar exitosamente config válida');
  assert(validRes.providerStatus.shopify === 'NOT_CONFIGURED', 'Shopify reportado como NOT_CONFIGURED limpiamente sin credenciales');

  // ---------------------------------------------------------------------------
  // TEST 2: Exhaustividad de .env.example
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: .env.example Variable Inventory Completeness ---');

  // Escanear todas las variables process.env.* usadas en src/
  const usedEnvKeys = new Set();
  function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (f !== 'node_modules' && f !== '.git' && f !== 'dist') scanDir(full);
      } else if (f.endsWith('.js') || f.endsWith('.mjs')) {
        const content = fs.readFileSync(full, 'utf8');
        const matches = content.matchAll(/process\.env\.([A-Z0-9_]+)/g);
        for (const m of matches) {
          usedEnvKeys.add(m[1]);
        }
      }
    }
  }

  scanDir(path.join(__dirname, 'src'));

  const envExamplePath = path.join(__dirname, '.env.example');
  assert(fs.existsSync(envExamplePath), '.env.example debe existir en backend_api/');

  const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

  // Verificar que cada variable usada en src/ figure en .env.example
  const missingKeys = [];
  for (const key of usedEnvKeys) {
    // Buscar coincidencia de nombre de variable (ej: KEY= o KEY =)
    const regex = new RegExp(`^[#\\s]*${key}\\s*=`, 'm');
    if (!regex.test(envExampleContent)) {
      missingKeys.push(key);
    }
  }

  assert(
    missingKeys.length === 0,
    `.env.example debe contener todas las variables usadas en src/. Faltantes: ${missingKeys.join(', ')}`
  );

  // ---------------------------------------------------------------------------
  // TEST 3: Cero secretos de producción en .env.example
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: No Production Secrets in .env.example ---');

  assert(!envExampleContent.includes('sk_live_'), '.env.example no debe contener claves Stripe live');
  assert(!envExampleContent.includes('A59F9002-9FFF'), '.env.example no debe contener la clave histórica de Evolution');
  assert(!envExampleContent.includes('ghp_'), '.env.example no debe contener tokens de GitHub');
  assert(!envExampleContent.includes('AIzaSy'), '.env.example no debe contener claves Google API');

  // ---------------------------------------------------------------------------
  // TEST 4: docker-compose.yml transferible y parametrizado
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: docker-compose.yml Credential Hygiene ---');

  const rootComposePath = path.join(rootDir, 'docker-compose.yml');
  assert(fs.existsSync(rootComposePath), 'docker-compose.yml debe existir en la raíz');

  const composeContent = fs.readFileSync(rootComposePath, 'utf8');

  assert(
    !composeContent.includes('A59F9002-9FFF-41CF-8EA6-58AEEB06ED7B'),
    'docker-compose.yml no debe contener la clave de Evolution hardcodeada'
  );

  assert(
    composeContent.includes('${EVOLUTION_API_KEY'),
    'docker-compose.yml debe parametrizar AUTHENTICATION_API_KEY con ${EVOLUTION_API_KEY'
  );

  assert(
    composeContent.includes('postgres_data:'),
    'docker-compose.yml debe definir volumen persistente para la base de datos'
  );

  // ---------------------------------------------------------------------------
  // TEST 5: CORS Transferible (Sin IPs/dominios del desarrollador)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: CORS Transferability & Origin Sanitization ---');

  // Entorno por defecto (sin ALLOWED_ORIGINS ni FRONTEND_URL)
  const defaultOrigins = resolveAllowedOrigins({});

  assert(
    !defaultOrigins.some(o => o.includes('185.163.116.210')),
    'CORS por defecto no debe contener la IP de VPS del desarrollador original'
  );

  assert(
    !defaultOrigins.some(o => o.includes('velion-agent.vercel.app')),
    'CORS por defecto no debe contener el dominio de Vercel del desarrollador original'
  );

  assert(
    defaultOrigins.includes('http://localhost:5173') && defaultOrigins.includes('http://localhost:3000'),
    'CORS por defecto debe incluir orígenes de desarrollo local'
  );

  // Con ALLOWED_ORIGINS dinámico del comprador
  const customOrigins = resolveAllowedOrigins({
    ALLOWED_ORIGINS: 'https://app.buyer-enterprise.com, https://admin.buyer-enterprise.com, *'
  });

  assert(
    customOrigins.includes('https://app.buyer-enterprise.com'),
    'resolveAllowedOrigins debe incluir el dominio de la empresa compradora'
  );

  assert(
    customOrigins.includes('https://admin.buyer-enterprise.com'),
    'resolveAllowedOrigins debe incluir el dominio admin de la empresa compradora'
  );

  assert(
    !customOrigins.includes('*'),
    'resolveAllowedOrigins debe rechazar el comodín "*" para proteger credentials: true'
  );

  console.log('\n======================================================================');
  console.log(`🎉 TODOS LOS TESTS DE TRANSFERIBILIDAD PASARON: ${passedTests}/${totalTests}`);
  console.log('======================================================================\n');
}

runSuite().catch(err => {
  console.error('❌ Error fatal en la suite de transferibilidad:', err);
  process.exit(1);
});
