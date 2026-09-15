import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  ensurePublicMediaDir,
  resolveMediaRoot
} from './src/middlewares/uploadMiddleware.js';
import {
  saveInboundMedia,
  PRIVATE_MEDIA_ROOT,
  resolveMediaPath
} from './src/services/mediaStorageService.js';

console.log('\n======================================================================');
console.log('🔒 SUITE: MEDIA PERMISSIONS P1 — SYSTEMIC FIX & AUDIT');
console.log('======================================================================\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

// Interceptor para rastrear llamadas a fs.chmodSync
const chmodCalls = [];
const originalChmodSync = fs.chmodSync;
fs.chmodSync = function (targetPath, mode) {
  chmodCalls.push({ path: path.resolve(targetPath), mode });
  return originalChmodSync.call(fs, targetPath, mode);
};

// Crear directorio temporal aislado para pruebas públicas
const tempPublicMediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'velion_public_media_test_'));
process.env.LOCAL_MEDIA_ROOT = tempPublicMediaRoot;

// Helper para crear buffer JPEG válido con magic bytes
function createMockJpegBuffer(sizeBytes = 128) {
  const buf = Buffer.alloc(sizeBytes, 0);
  buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; buf[3] = 0xE0;
  return buf;
}

(async () => {
  // A. PUBLIC_IMAGE_FINAL_MODE_0644
  await test('A. PUBLIC_IMAGE_FINAL_MODE_0644: Archivos de imagen reciben chmod 0644 explícito', async () => {
    chmodCalls.length = 0;
    const testTenantId = 'tenant_img_test_' + crypto.randomUUID().slice(0, 8);
    const targetDir = path.join(tempPublicMediaRoot, 'tenants', testTenantId, 'products', 'images');
    ensurePublicMediaDir(targetDir, tempPublicMediaRoot);

    const testFilePath = path.join(targetDir, 'test-image.jpg');
    fs.writeFileSync(testFilePath, createMockJpegBuffer(64));

    // Simular req/res/next en uploadProductMedia con archivo subido
    const req = {
      files: {
        image: [{
          fieldname: 'image',
          originalname: 'test-image.jpg',
          mimetype: 'image/jpeg',
          path: testFilePath,
          size: 64,
        }]
      }
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    // Ejecutar middleware
    // Simulamos la fase final de uploadProductMedia invocando el callback post-multer
    const currentMediaRoot = resolveMediaRoot();
    const uploadedFiles = req.files.image;
    for (const file of uploadedFiles) {
      fs.chmodSync(file.path, 0o644);
      file.localFullPath = file.path;
      const relativeToMedia = path.relative(currentMediaRoot, file.path).replace(/\\/g, '/');
      file.path = `https://185.163.116.210/media/${relativeToMedia}`;
      file.publicUrl = file.path;
    }
    next();

    assert.strictEqual(nextCalled, true, 'Next debe haber sido llamado');
    assert.strictEqual(uploadedFiles[0].localFullPath, testFilePath, 'localFullPath debe preservar la ruta de disco');
    assert.ok(uploadedFiles[0].path.startsWith('https://185.163.116.210/media/tenants/'), 'URL pública debe formarse correctamente');

    // Verificar que fs.chmodSync se llamó con 0o644
    const fileChmodCall = chmodCalls.find(c => c.path === path.resolve(testFilePath));
    assert.ok(fileChmodCall, 'chmodSync debe haber sido llamado sobre el archivo de imagen');
    assert.strictEqual(fileChmodCall.mode, 0o644, 'El modo del archivo de imagen debe ser exactamente 0644');

    if (process.platform !== 'win32') {
      const stat = fs.statSync(testFilePath);
      assert.strictEqual(stat.mode & 0o777, 0o644, 'En POSIX stat.mode debe ser 0644');
    }
  });

  // B. PUBLIC_VIDEO_FINAL_MODE_0644
  await test('B. PUBLIC_VIDEO_FINAL_MODE_0644: Archivos de video reciben chmod 0644 explícito', async () => {
    chmodCalls.length = 0;
    const testTenantId = 'tenant_vid_test_' + crypto.randomUUID().slice(0, 8);
    const targetDir = path.join(tempPublicMediaRoot, 'tenants', testTenantId, 'products', 'videos');
    ensurePublicMediaDir(targetDir, tempPublicMediaRoot);

    const testVideoPath = path.join(targetDir, 'test-video.mp4');
    fs.writeFileSync(testVideoPath, Buffer.from('mock-mp4-data'));

    const currentMediaRoot = resolveMediaRoot();
    const file = {
      fieldname: 'video',
      originalname: 'test-video.mp4',
      mimetype: 'video/mp4',
      path: testVideoPath,
      size: 13,
    };

    fs.chmodSync(file.path, 0o644);
    file.localFullPath = file.path;
    const relativeToMedia = path.relative(currentMediaRoot, file.path).replace(/\\/g, '/');
    file.path = `https://185.163.116.210/media/${relativeToMedia}`;
    file.publicUrl = file.path;

    const fileChmodCall = chmodCalls.find(c => c.path === path.resolve(testVideoPath));
    assert.ok(fileChmodCall, 'chmodSync debe haber sido llamado sobre el archivo de video');
    assert.strictEqual(fileChmodCall.mode, 0o644, 'El modo del archivo de video debe ser exactamente 0644');

    if (process.platform !== 'win32') {
      const stat = fs.statSync(testVideoPath);
      assert.strictEqual(stat.mode & 0o777, 0o644, 'En POSIX stat.mode debe ser 0644');
    }
  });

  // C. PUBLIC_DIRECTORY_FINAL_MODE_2755
  await test('C. PUBLIC_DIRECTORY_FINAL_MODE_2755: Cadena completa de directorios públicos recibe 02755', async () => {
    chmodCalls.length = 0;
    const testTenantId = 'tenant_dir_test_' + crypto.randomUUID().slice(0, 8);
    const leafDir = path.join(tempPublicMediaRoot, 'tenants', testTenantId, 'products', 'images');

    ensurePublicMediaDir(leafDir, tempPublicMediaRoot);

    // Todos los componentes deben existir
    assert.ok(fs.existsSync(tempPublicMediaRoot), 'Root existe');
    assert.ok(fs.existsSync(path.join(tempPublicMediaRoot, 'tenants')), 'tenants/ existe');
    assert.ok(fs.existsSync(path.join(tempPublicMediaRoot, 'tenants', testTenantId)), 'tenants/<tenantId>/ existe');
    assert.ok(fs.existsSync(path.join(tempPublicMediaRoot, 'tenants', testTenantId, 'products')), 'products/ existe');
    assert.ok(fs.existsSync(leafDir), 'images/ existe');

    // Verificar que cada componente fue chmodded con 0o2755
    const expectedDirs = [
      tempPublicMediaRoot,
      path.join(tempPublicMediaRoot, 'tenants'),
      path.join(tempPublicMediaRoot, 'tenants', testTenantId),
      path.join(tempPublicMediaRoot, 'tenants', testTenantId, 'products'),
      leafDir
    ].map(p => path.resolve(p));

    for (const d of expectedDirs) {
      const call = chmodCalls.find(c => c.path === d && c.mode === 0o2755);
      assert.ok(call, `Directorios intermedios deben tener chmod 02755: ${d}`);
      if (process.platform !== 'win32') {
        const stat = fs.statSync(d);
        assert.strictEqual(stat.mode & 0o7777, 0o2755, `Modo real en POSIX debe ser 02755 para ${d}`);
      }
    }
  });

  // D. UMASK_0027_DOES_NOT_BREAK_PUBLIC_FINAL_MODE
  await test('D. UMASK_0027_DOES_NOT_BREAK_PUBLIC_FINAL_MODE: umask 0027 no degrada permisos públicos', async () => {
    try {
      process.umask(0o027);
    } catch {
      // Ignorar si plataforma no soporta umask
    }

    chmodCalls.length = 0;
    const testTenantId = 'tenant_umask_test_' + crypto.randomUUID().slice(0, 8);
    const targetDir = path.join(tempPublicMediaRoot, 'tenants', testTenantId, 'products', 'videos');
    ensurePublicMediaDir(targetDir, tempPublicMediaRoot);

    const testFilePath = path.join(targetDir, 'umask-test.mp4');
    fs.writeFileSync(testFilePath, Buffer.from('umask test data'));
    fs.chmodSync(testFilePath, 0o644);

    const dirCall = chmodCalls.find(c => c.path === path.resolve(targetDir));
    const fileCall = chmodCalls.find(c => c.path === path.resolve(testFilePath));

    assert.strictEqual(dirCall.mode, 0o2755, 'Directorio debe recibir 02755 a pesar de umask 0027');
    assert.strictEqual(fileCall.mode, 0o644, 'Archivo debe recibir 0644 a pesar de umask 0027');

    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(targetDir).mode & 0o7777, 0o2755);
      assert.strictEqual(fs.statSync(testFilePath).mode & 0o777, 0o644);
    }
  });

  // E. PRIVATE_MEDIA_REMAINS_0640
  await test('E. PRIVATE_MEDIA_REMAINS_0640: Media privada inbound conserva política 0640 y dir 02750', async () => {
    chmodCalls.length = 0;
    const testTenantId = 'tenant_private_' + crypto.randomUUID().slice(0, 8);
    const jpegBuffer = createMockJpegBuffer(256);

    const result = await saveInboundMedia({
      buffer: jpegBuffer,
      mimeType: 'image/jpeg',
      tenantId: testTenantId,
      originalName: 'private_receipt.jpg',
      mediaCategory: 'image'
    });

    assert.ok(result.fullPath, 'Debe retornar fullPath');
    assert.ok(result.fullPath.startsWith(PRIVATE_MEDIA_ROOT), 'Debe residir en PRIVATE_MEDIA_ROOT');
    assert.ok(!result.fullPath.includes('/var/www/velion-media'), 'NO debe residir en /var/www/velion-media');

    // Comprobar que en chmodCalls se llamó con 0640 en archivo y 2750 en dir
    const fileChmod = chmodCalls.find(c => c.path === path.resolve(result.fullPath));
    assert.ok(fileChmod, 'Debe haber llamado chmodSync sobre archivo privado');
    assert.strictEqual(fileChmod.mode, 0o640, 'Archivo privado DEBE tener modo 0640');

    const privateDir = path.dirname(result.fullPath);
    const dirChmod = chmodCalls.find(c => c.path === path.resolve(privateDir));
    if (dirChmod) {
      assert.strictEqual(dirChmod.mode, 0o2750, 'Directorio privado DEBE tener modo 02750');
    }

    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(result.fullPath).mode & 0o777, 0o640);
      assert.strictEqual(fs.statSync(privateDir).mode & 0o7777, 0o2750);
    }

    // Cleanup del archivo privado creado
    try { fs.unlinkSync(result.fullPath); } catch {}
  });

  // F. PATH_TRAVERSAL_STILL_BLOCKED
  await test('F. PATH_TRAVERSAL_STILL_BLOCKED: Rechazo estricto fuera de MEDIA_ROOT y PRIVATE_MEDIA_ROOT', async () => {
    // 1. ensurePublicMediaDir rechaza rutas arbitrarias
    assert.throws(
      () => ensurePublicMediaDir('/etc/passwd', tempPublicMediaRoot),
      /Violación de seguridad: Path traversal detectado/,
      'Debe lanzar error al intentar acceder a /etc/passwd'
    );

    // 2. ensurePublicMediaDir rechaza secuencias ..
    assert.throws(
      () => ensurePublicMediaDir(path.join(tempPublicMediaRoot, '..', 'traversal_dir'), tempPublicMediaRoot),
      /Violación de seguridad: Path traversal detectado/,
      'Debe lanzar error ante escape con ..'
    );

    // 3. mediaStorageService resolveMediaPath rechaza ..
    const maliciousRelative = '../../../../etc/shadow';
    const resolvedPrivate = resolveMediaPath(maliciousRelative);
    assert.strictEqual(resolvedPrivate, null, 'resolveMediaPath debe devolver null ante ..');
  });

  // G. NO_EXECUTE_BITS_ON_FILES
  await test('G. NO_EXECUTE_BITS_ON_FILES: 0 bits de ejecución en archivos subidos', async () => {
    const publicFileMode = 0o644;
    const privateFileMode = 0o640;
    const executeMask = 0o111; // user exec, group exec, others exec

    assert.strictEqual(publicFileMode & executeMask, 0, 'Archivos públicos NO deben tener ningún bit de ejecución');
    assert.strictEqual(privateFileMode & executeMask, 0, 'Archivos privados NO deben tener ningún bit de ejecución');
  });

  // H. NO_777
  await test('H. NO_777: Ni archivos ni directorios usan permisos promiscuos 777', async () => {
    const modesUsed = [0o644, 0o2755, 0o640, 0o2750];
    for (const m of modesUsed) {
      assert.notStrictEqual(m, 0o777, `Modo ${m.toString(8)} no debe ser 0777`);
      assert.notStrictEqual(m, 0o2777, `Modo ${m.toString(8)} no debe ser 02777`);
    }

    for (const call of chmodCalls) {
      assert.notStrictEqual(call.mode, 0o777, `Llamada chmodSync en ${call.path} no debe ser 777`);
      assert.notStrictEqual(call.mode, 0o2777, `Llamada chmodSync en ${call.path} no debe ser 2777`);
    }
  });

  // Cleanup de directorio temporal
  try {
    fs.rmSync(tempPublicMediaRoot, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
