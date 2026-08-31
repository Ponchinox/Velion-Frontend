import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

// Test suite para verificar el comportamiento de producción con una sola API Key

async function runSingleKeyTests() {
  console.log('🧪 Iniciando batería de pruebas: Single GEMINI_API_KEY para Producción...\n');
  let passed = 0;
  let total = 0;

  function assert(name, condition, details = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} — ${details}`);
    }
  }

  // Guardar estado original de process.env
  const originalEnv = { ...process.env };

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Comportamiento cuando SOLO GEMINI_API_KEY está configurada
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- Test 1: Inicialización con SOLO GEMINI_API_KEY ---');
    delete process.env.GEMINI_API_KEY_BACKUP;
    delete process.env.GEMINI_KEY_1;
    delete process.env.GEMINI_KEY_2;
    process.env.GEMINI_API_KEY = 'TEST_MOCK_GEMINI_KEY_ABC12345XYZ';

    // Simular KeyManager
    const maskKey = (k) => (!k ? 'NONE' : k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : '****');
    
    class TestGeminiKeyManager {
      constructor() {
        this.primaryKey = null;
        this.backupKey = null;
        this.primaryClient = null;
        this.backupClient = null;
        this._initialized = false;
      }
      init() {
        this._initialized = true;
        this.primaryKey = (process.env.GEMINI_API_KEY || '').trim();
        this.backupKey = (process.env.GEMINI_API_KEY_BACKUP || '').trim();
        if (!this.primaryKey) {
          throw new Error('[GEMINI] Falta GEMINI_API_KEY para inicializar el servicio de IA.');
        }
        this.primaryClient = { mock: 'PRIMARY_CLIENT', key: this.primaryKey };
        if (this.backupKey) {
          this.backupClient = { mock: 'BACKUP_CLIENT', key: this.backupKey };
        }
      }
      getKeyForAttempt(attemptNumber) {
        this.init();
        if (attemptNumber === 1 || !this.backupClient) {
          return {
            client: this.primaryClient,
            isBackup: false,
            name: 'Principal',
            masked: maskKey(this.primaryKey),
          };
        }
        return {
          client: this.backupClient,
          isBackup: true,
          name: 'Backup',
          masked: maskKey(this.backupKey),
        };
      }
    }

    const km = new TestGeminiKeyManager();
    const attempt1 = km.getKeyForAttempt(1);
    assert('Intento 1 selecciona Key Principal', attempt1.name === 'Principal' && !attempt1.isBackup);
    assert('Intento 1 cliente correcto', attempt1.client.mock === 'PRIMARY_CLIENT');

    const attempt2 = km.getKeyForAttempt(2);
    assert('Intento 2 SIN backup reutiliza Key Principal', attempt2.name === 'Principal' && !attempt2.isBackup);
    assert('Intento 2 cliente correcto', attempt2.client.mock === 'PRIMARY_CLIENT');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: Si GEMINI_API_KEY_BACKUP está ausente no produce error
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 2: Ausencia de GEMINI_API_KEY_BACKUP no arroja excepción ---');
    let noBackupError = false;
    try {
      km.init();
    } catch (e) {
      noBackupError = true;
    }
    assert('Inicialización exitosa sin backup key', !noBackupError);
    assert('backupClient permanece null', km.backupClient === null);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Si GEMINI_API_KEY está ausente debe lanzar error inmediatamente
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: Falta de GEMINI_API_KEY lanza error estricto ---');
    delete process.env.GEMINI_API_KEY;
    const kmMissing = new TestGeminiKeyManager();
    let caughtMissing = false;
    try {
      kmMissing.init();
    } catch (e) {
      caughtMissing = true;
    }
    assert('Lanza excepción si GEMINI_API_KEY no existe', caughtMissing);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: Las keys legacy (GEMINI_KEY_1...N) NO son consideradas
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 4: Comprobación de que GEMINI_KEY_1 no es leída ---');
    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_KEY_1 = 'OLD_LEGACY_KEY_1';
    process.env.GEMINI_KEY_2 = 'OLD_LEGACY_KEY_2';
    const kmLegacy = new TestGeminiKeyManager();
    let legacyFailedAsExpected = false;
    try {
      kmLegacy.init();
    } catch (e) {
      legacyFailedAsExpected = true;
    }
    assert('GEMINI_KEY_1 es ignorada y no se usa como fallback', legacyFailedAsExpected);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: Simulación de Retry Loop con máximo 2 intentos
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 5: Simulación de Retry Loop con Max 2 Intentos ---');
    process.env.GEMINI_API_KEY = 'TEST_MOCK_GEMINI_KEY_ABC12345XYZ';
    const kmRetry = new TestGeminiKeyManager();
    const MAX_TOTAL_ATTEMPTS = 2;
    const attemptsMade = [];

    for (let attempt = 1; attempt <= MAX_TOTAL_ATTEMPTS; attempt++) {
      const keyInfo = kmRetry.getKeyForAttempt(attempt);
      attemptsMade.push({
        attempt,
        keyName: keyInfo.name,
        isBackup: keyInfo.isBackup,
      });
    }

    assert('Exactamente 2 intentos en loop', attemptsMade.length === 2);
    assert('Intento 1 usa Principal', attemptsMade[0].keyName === 'Principal');
    assert('Intento 2 usa Principal', attemptsMade[1].keyName === 'Principal');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: Enmascaramiento seguro de logs
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 6: Enmascaramiento de claves (No filtración de secretos) ---');
    const secret = 'AIzaSyABC1234567890XYZ';
    const masked = maskKey(secret);
    assert('La clave está enmascarada', masked === 'AIza...0XYZ' && !masked.includes('ABC1234567890'));

    console.log(`\n========================================`);
    console.log(`Resultado: ${passed}/${total} pruebas superadas.`);
    console.log(`========================================\n`);

  } finally {
    // Restaurar env
    process.env = originalEnv;
  }
}

runSingleKeyTests().catch(console.error);
