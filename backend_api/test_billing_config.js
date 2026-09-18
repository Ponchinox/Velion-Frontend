/**
 * TEST SUITE: BILLING CONFIG & PERSONAL DATA SANITIZATION
 * ========================================================
 * Verifica:
 * - NO_PERSONAL_PAYMENT_DATA_IN_FRONTEND_SOURCE = PASS
 * - BILLING_CONFIG_LOAD = PASS
 * - MISSING_BILLING_CONFIG_SAFE = PASS
 *
 * Cero llamadas de red (Network Guard activo).
 */

import './qa/networkGuard.js';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getBillingConfig,
  setBillingConfigMock
} from './src/services/billingConfigService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runBillingTests() {
  console.log('💳 ========================================================');
  console.log('💳 TEST SUITE: BILLING CONFIG & PERSONAL DATA SANITIZATION');
  console.log('💳 ========================================================');

  // ── 1. NO_PERSONAL_PAYMENT_DATA_IN_FRONTEND_SOURCE = PASS ──
  {
    const srcDir = path.join(rootDir, 'src');
    const sensitiveTokens = ['953789363', '984363997', '51926246740', 'César'];

    function scanDirectory(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDirectory(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.jsx') || entry.name.endsWith('.js'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const token of sensitiveTokens) {
            if (content.includes(token)) {
              assert.fail(`Token sensible encontrado en archivo frontend: ${fullPath} -> "${token}"`);
            }
          }
        }
      }
    }

    scanDirectory(srcDir);
    console.log('  ✅ PASS: NO_PERSONAL_PAYMENT_DATA_IN_FRONTEND_SOURCE');
  }

  // ── 2. BILLING_CONFIG_LOAD = PASS ──
  {
    // Simular carga de configuración desde SystemConfig
    const mockDb = {
      systemConfig: {
        findMany: async () => [
          { key: 'paymentMethod', value: 'Yape Oficial' },
          { key: 'paymentRecipient', value: 'Velion SAC - 900111222' },
          { key: 'paymentContact', value: '51900111222' }
        ]
      }
    };

    const config = await getBillingConfig(mockDb);
    assert.strictEqual(config.paymentMethod, 'Yape Oficial');
    assert.strictEqual(config.paymentRecipient, 'Velion SAC - 900111222');
    assert.strictEqual(config.paymentContact, '51900111222');
    console.log('  ✅ PASS: BILLING_CONFIG_LOAD');
  }

  // ── 3. MISSING_BILLING_CONFIG_SAFE = PASS ──
  {
    // Limpiar variables de entorno temporales para probar ausencia completa
    const prevMethod = process.env.BILLING_PAYMENT_METHOD;
    const prevRecipient = process.env.BILLING_PAYMENT_RECIPIENT;
    const prevContact = process.env.BILLING_PAYMENT_CONTACT;
    delete process.env.BILLING_PAYMENT_METHOD;
    delete process.env.BILLING_PAYMENT_RECIPIENT;
    delete process.env.BILLING_PAYMENT_CONTACT;

    try {
      const emptyDb = {
        systemConfig: {
          findMany: async () => []
        }
      };

      const emptyConfig = await getBillingConfig(emptyDb);
      assert.strictEqual(emptyConfig.paymentMethod, null);
      assert.strictEqual(emptyConfig.paymentRecipient, null);
      assert.strictEqual(emptyConfig.paymentContact, null);

      // Verificar que los campos devueltos no sean undefined o cadenas rotas
      assert.ok('paymentMethod' in emptyConfig);
      assert.ok('paymentRecipient' in emptyConfig);
      assert.ok('paymentContact' in emptyConfig);

      console.log('  ✅ PASS: MISSING_BILLING_CONFIG_SAFE');
    } finally {
      if (prevMethod) process.env.BILLING_PAYMENT_METHOD = prevMethod;
      if (prevRecipient) process.env.BILLING_PAYMENT_RECIPIENT = prevRecipient;
      if (prevContact) process.env.BILLING_PAYMENT_CONTACT = prevContact;
    }
  }

  console.log('========================================================');
  console.log('🎉 3/3 TESTS DE BILLING CONFIG PASARON EXITOSAMENTE');
  console.log('========================================================');
}

runBillingTests().catch((err) => {
  console.error('❌ Error en test_billing_config.js:', err);
  process.exit(1);
});
