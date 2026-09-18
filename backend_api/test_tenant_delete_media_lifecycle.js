/**
 * TEST SUITE: TENANT DELETE MEDIA LIFECYCLE
 * ==========================================
 * Verifica:
 * - TENANT_DELETE_MEDIA_QUARANTINE = PASS
 * - TENANT_DELETE_NO_PUBLIC_MEDIA = PASS
 * - PATH_TRAVERSAL_BLOCKED = PASS
 * - OTHER_TENANT_MEDIA_UNCHANGED = PASS
 * - DELETE_FAILURE_HANDLED = PASS
 *
 * Cero llamadas de red. Utiliza directorios temporales aislados para no tocar datos reales.
 */

import './qa/networkGuard.js';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  quarantineTenantMedia,
  isValidTenantIdentifier
} from './src/services/tenantMediaLifecycleService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testSandboxDir = path.join(__dirname, 'qa', 'sandbox_media_test');

function cleanupSandbox() {
  if (fs.existsSync(testSandboxDir)) {
    fs.rmSync(testSandboxDir, { recursive: true, force: true });
  }
}

async function runMediaLifecycleTests() {
  console.log('📦 ========================================================');
  console.log('📦 TEST SUITE: CICLO DE VIDA DE MEDIA AL ELIMINAR TENANT');
  console.log('📦 ========================================================');

  cleanupSandbox();
  fs.mkdirSync(testSandboxDir, { recursive: true });

  const mockWebroot = path.join(testSandboxDir, 'webroot_tenants');
  const mockQuarantine = path.join(testSandboxDir, 'quarantine_tenants');

  fs.mkdirSync(mockWebroot, { recursive: true });
  fs.mkdirSync(mockQuarantine, { recursive: true });

  const targetTenantId = 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c';
  const otherTenantId = 'f9e8d7c6-b5a4-4321-8765-43210fedcba9';

  // Crear media de prueba para el tenant objetivo
  const targetMediaDir = path.join(mockWebroot, targetTenantId);
  fs.mkdirSync(targetMediaDir, { recursive: true });
  fs.writeFileSync(path.join(targetMediaDir, 'product_smartwatch.png'), 'FAKE_IMAGE_DATA_TARGET');

  // Crear media de prueba para otro tenant (no debe ser tocado)
  const otherMediaDir = path.join(mockWebroot, otherTenantId);
  fs.mkdirSync(otherMediaDir, { recursive: true });
  fs.writeFileSync(path.join(otherMediaDir, 'product_other.jpg'), 'FAKE_IMAGE_DATA_OTHER');

  try {
    // ── 1. TENANT_DELETE_MEDIA_QUARANTINE = PASS ──
    const result = await quarantineTenantMedia(targetTenantId, {
      mediaRoot: mockWebroot,
      quarantineRoot: mockQuarantine
    });

    assert.strictEqual(result.success, true, 'Cuarentena debe reportar éxito');
    assert.strictEqual(result.quarantined, true, 'Debe reportar que la media fue puesta en cuarentena');
    assert.ok(result.quarantinePath, 'Debe contener la ruta de destino');
    assert.ok(fs.existsSync(result.quarantinePath), 'El directorio de cuarentena debe existir físicamente');
    assert.ok(
      fs.existsSync(path.join(result.quarantinePath, 'product_smartwatch.png')),
      'El archivo debe encontrarse dentro de la carpeta de cuarentena'
    );
    console.log('  ✅ PASS: TENANT_DELETE_MEDIA_QUARANTINE');

    // ── 2. TENANT_DELETE_NO_PUBLIC_MEDIA = PASS ──
    const stillInWebroot = fs.existsSync(targetMediaDir);
    assert.strictEqual(stillInWebroot, false, 'El directorio público original en el webroot no debe existir');
    console.log('  ✅ PASS: TENANT_DELETE_NO_PUBLIC_MEDIA');

    // ── 3. PATH_TRAVERSAL_BLOCKED = PASS ──
    const maliciousIds = [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      'tenant/subfolder',
      'e1a2b3c4/../escape',
      '; rm -rf /',
      '../../../var/www/velion-media/tenants'
    ];

    for (const maliciousId of maliciousIds) {
      assert.strictEqual(
        isValidTenantIdentifier(maliciousId),
        false,
        `Identificador malicioso "${maliciousId}" debe ser rechazado por el validador`
      );

      let threw = false;
      try {
        await quarantineTenantMedia(maliciousId, {
          mediaRoot: mockWebroot,
          quarantineRoot: mockQuarantine
        });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'ERR_PATH_TRAVERSAL_DETECTED');
      }
      assert.strictEqual(threw, true, `quarantineTenantMedia debe lanzar error ante "${maliciousId}"`);
    }
    console.log('  ✅ PASS: PATH_TRAVERSAL_BLOCKED');

    // ── 4. OTHER_TENANT_MEDIA_UNCHANGED = PASS ──
    assert.ok(fs.existsSync(otherMediaDir), 'El directorio del otro tenant no debe haber sido tocado');
    const otherContent = fs.readFileSync(path.join(otherMediaDir, 'product_other.jpg'), 'utf8');
    assert.strictEqual(otherContent, 'FAKE_IMAGE_DATA_OTHER', 'El contenido del otro tenant debe permanecer íntegro');
    console.log('  ✅ PASS: OTHER_TENANT_MEDIA_UNCHANGED');

    // ── 5. DELETE_FAILURE_HANDLED = PASS ──
    // Simular fallo real cuando la ruta de cuarentena es inválida o no se puede crear
    let failureHandled = false;
    const fileBlocker = path.join(testSandboxDir, 'file_blocker.txt');
    fs.writeFileSync(fileBlocker, 'BLOCKED');

    try {
      // Intentar crear un directorio hijo de un archivo existente lanza ENOTDIR o EEXIST
      await quarantineTenantMedia(otherTenantId, {
        mediaRoot: mockWebroot,
        quarantineRoot: path.join(fileBlocker, 'subfolder')
      });
    } catch (err) {
      failureHandled = true;
      assert.ok(
        err.message.includes('Fallo en el sistema de archivos') || err.code === 'ERR_QUARANTINE_FS_FAILURE',
        `Error esperado debe reportar fallo de filesystem: ${err.message}`
      );
    }
    assert.strictEqual(failureHandled, true, 'El fallo de filesystem debe ser reportado sin ocultar el error');
    console.log('  ✅ PASS: DELETE_FAILURE_HANDLED');

    console.log('========================================================');
    console.log('🎉 5/5 TESTS DE CICLO DE VIDA DE MEDIA PASARON EXITOSAMENTE');
    console.log('========================================================');
  } finally {
    cleanupSandbox();
  }
}

runMediaLifecycleTests().catch((err) => {
  console.error('❌ Error en test_tenant_delete_media_lifecycle.js:', err);
  process.exit(1);
});
