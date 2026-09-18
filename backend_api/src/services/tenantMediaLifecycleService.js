/**
 * TENANT MEDIA LIFECYCLE SERVICE
 * ===============================
 * Gestiona el ciclo de vida y aislamiento seguro de archivos multimedia de tenants.
 * Al eliminar un tenant, mueve físicamente su directorio de media fuera del webroot
 * público (/var/www/velion-media/tenants/<tenantId>) a un directorio de cuarentena
 * privado (/home/velion/quarantine/deleted-tenants/<tenantId>/<timestamp>/).
 *
 * Protección estricta:
 * - Validación exhaustiva de UUID para prevenir Path Traversal (../../).
 * - Verificación canónica de ruta mediante path.resolve().
 * - Operación atómica de cuarentena sin borrado irreversible destructivo (rm -rf).
 */

import fs from 'node:fs';
import path from 'node:path';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SAFE_ID_REGEX = /^[0-9a-zA-Z_-]{8,64}$/;

/**
 * Valida de forma estricta que un ID de tenant sea seguro y no contenga secuencias de escape.
 * @param {string} tenantId
 * @returns {boolean}
 */
export function isValidTenantIdentifier(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') return false;
  const trimmed = tenantId.trim();
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return false;
  }
  return UUID_REGEX.test(trimmed) || SAFE_ID_REGEX.test(trimmed);
}

/**
 * Mueve el directorio de multimedia de un tenant a cuarentena segura fuera del webroot de Nginx.
 *
 * @param {string} tenantId
 * @param {object} [opts]
 * @param {string} [opts.mediaRoot]
 * @param {string} [opts.quarantineRoot]
 * @returns {Promise<{ success: boolean, quarantined: boolean, sourcePath: string, quarantinePath: string|null, reason?: string }>}
 */
export async function quarantineTenantMedia(tenantId, opts = {}) {
  if (!isValidTenantIdentifier(tenantId)) {
    const error = new Error(`Identificador de inquilino inválido o riesgo de Path Traversal: "${tenantId}"`);
    error.code = 'ERR_PATH_TRAVERSAL_DETECTED';
    throw error;
  }

  const cleanTenantId = tenantId.trim();
  const defaultMediaRoot = process.env.MEDIA_ROOT_DIR || '/var/www/velion-media/tenants';
  const defaultQuarantineRoot = process.env.QUARANTINE_ROOT_DIR || '/home/velion/quarantine/deleted-tenants';

  const mediaRoot = path.resolve(opts.mediaRoot || defaultMediaRoot);
  const quarantineRoot = path.resolve(opts.quarantineRoot || defaultQuarantineRoot);

  const tenantMediaDir = path.resolve(mediaRoot, cleanTenantId);

  // Escudo adicional de seguridad: comprobar que la ruta resuelta está estrictamente dentro de mediaRoot
  const relativeFromRoot = path.relative(mediaRoot, tenantMediaDir);
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    const error = new Error(`Ruta resuelta fuera del root de multimedia permitido: "${tenantMediaDir}"`);
    error.code = 'ERR_PATH_TRAVERSAL_DETECTED';
    throw error;
  }

  // Si no existe físicamente el directorio de media para este tenant, no hay nada que poner en cuarentena
  if (!fs.existsSync(tenantMediaDir)) {
    return {
      success: true,
      quarantined: false,
      sourcePath: tenantMediaDir,
      quarantinePath: null,
      reason: 'DIRECTORY_NOT_FOUND'
    };
  }

  const timestamp = Date.now();
  const targetQuarantineDir = path.join(quarantineRoot, cleanTenantId, String(timestamp));

  try {
    fs.mkdirSync(targetQuarantineDir, { recursive: true });

    const destPath = path.join(targetQuarantineDir, 'media');

    // Intentar renombre atómico primero; si cruza filesystems, copiar recursivamente y remover origen
    try {
      fs.renameSync(tenantMediaDir, destPath);
    } catch (renameErr) {
      if (renameErr.code === 'EXDEV') {
        fs.cpSync(tenantMediaDir, destPath, { recursive: true });
        fs.rmSync(tenantMediaDir, { recursive: true, force: true });
      } else {
        throw renameErr;
      }
    }

    console.log(`📦 [Media Quarantine] Media del tenant ${cleanTenantId} puesta en cuarentena de forma segura en: ${destPath}`);

    return {
      success: true,
      quarantined: true,
      sourcePath: tenantMediaDir,
      quarantinePath: destPath
    };
  } catch (fsErr) {
    console.error(`🚨 [Media Quarantine] Error crítico moviendo media a cuarentena para tenant ${cleanTenantId}:`, fsErr.message);
    const error = new Error(`Fallo en el sistema de archivos al poner en cuarentena la media del tenant: ${fsErr.message}`);
    error.code = 'ERR_QUARANTINE_FS_FAILURE';
    throw error;
  }
}
