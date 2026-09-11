import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Imponer umask 0027 en tiempo de ejecución: directorios 2750, archivos 0640
try {
  process.umask(0o027);
} catch (e) {
  // Ignorar en plataformas que no soportan umask
}

// Raíz de almacenamiento privado de multimedia inbound (COMPLETAMENTE FUERA de /var/www/velion-media)
function resolvePrivateMediaRoot() {
  if (process.env.PRIVATE_MEDIA_ROOT) {
    return path.resolve(process.env.PRIVATE_MEDIA_ROOT);
  }
  const defaultLinuxPath = '/var/lib/velion-inbound-media';
  if (fs.existsSync(defaultLinuxPath) || process.platform === 'linux') {
    return path.resolve(defaultLinuxPath);
  }
  // Fallback local para desarrollo o entornos Windows
  return path.resolve(path.join(process.cwd(), 'private_inbound_media'));
}

export const PRIVATE_MEDIA_ROOT = resolvePrivateMediaRoot();

// Clave secreta para tokens de acceso multimedia de corta duración (independiente de sesión)
export function getMediaTokenSecret() {
  return process.env.MEDIA_TOKEN_SECRET || (
    process.env.JWT_SECRET ? `${process.env.JWT_SECRET}_media_scoped_v1` : 'velion_media_default_secret_scoped_v1'
  );
}

/**
 * Genera un Media Access Token de corta duración (2–5 minutos) scoped a un mensaje y tenant.
 * NO permite llamar a ninguna otra API del sistema.
 */
export function generateMediaAccessToken({ messageId, tenantId }) {
  if (!messageId || !tenantId) {
    throw new Error('messageId y tenantId son requeridos para generar el token multimedia.');
  }

  return jwt.sign(
    {
      purpose: 'chat_media',
      messageId: String(messageId),
      tenantId: String(tenantId)
    },
    getMediaTokenSecret(),
    { expiresIn: '5m' } // 5 minutos de validez estricta
  );
}

/**
 * Valida un Media Access Token verificando firma, purpose, tenantId y messageId específico.
 */
export function verifyMediaAccessToken(token, expectedMessageId) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token multimedia no proporcionado.' };
  }

  try {
    const decoded = jwt.verify(token, getMediaTokenSecret());

    if (decoded.purpose !== 'chat_media') {
      return { valid: false, error: 'Propósito de token inválido (no es chat_media).' };
    }

    if (!decoded.tenantId) {
      return { valid: false, error: 'Token multimedia sin tenantId válido.' };
    }

    if (expectedMessageId && decoded.messageId !== String(expectedMessageId)) {
      return { valid: false, error: 'Token no autorizado para este mensaje específico.' };
    }

    return { valid: true, payload: decoded };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token multimedia expirado.', expired: true };
    }
    return { valid: false, error: 'Token multimedia inválido o firma incorrecta.' };
  }
}

// Límites de tamaño en bytes por tipo de archivo
export const MEDIA_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,      // 10 MB
  video: 25 * 1024 * 1024,      // 25 MB
  audio: 10 * 1024 * 1024,      // 10 MB
  document: 20 * 1024 * 1024,   // 20 MB
  sticker: 2 * 1024 * 1024,     // 2 MB
  default: 20 * 1024 * 1024,    // 20 MB
};

// Allowlist explícita de tipos MIME y extensiones seguras asociadas
export const ALLOWED_MIME_MAP = {
  // Imágenes
  'image/jpeg': { ext: '.jpg', type: 'image' },
  'image/jpg': { ext: '.jpg', type: 'image' },
  'image/png': { ext: '.png', type: 'image' },
  'image/webp': { ext: '.webp', type: 'image' },
  'image/gif': { ext: '.gif', type: 'image' },

  // Video
  'video/mp4': { ext: '.mp4', type: 'video' },
  'video/webm': { ext: '.webm', type: 'video' },
  'video/quicktime': { ext: '.mov', type: 'video' },
  'video/3gpp': { ext: '.3gp', type: 'video' },

  // Audio
  'audio/ogg': { ext: '.ogg', type: 'audio' },
  'audio/mpeg': { ext: '.mp3', type: 'audio' },
  'audio/mp4': { ext: '.m4a', type: 'audio' },
  'audio/aac': { ext: '.aac', type: 'audio' },
  'audio/wav': { ext: '.wav', type: 'audio' },
  'audio/webm': { ext: '.weba', type: 'audio' },

  // Documentos
  'application/pdf': { ext: '.pdf', type: 'document' },
};

/**
 * Sanitiza tenantId para prevenir path traversal.
 */
export function getSafeTenantId(tenantId) {
  if (!tenantId) return 'unknown';
  const clean = String(tenantId).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return clean.length > 0 ? clean : 'unknown';
}

/**
 * Sanitiza nombre de archivo solo para display / descarga por el usuario.
 */
export function sanitizeDisplayFileName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'archivo';
  const base = path.basename(rawName).replace(/[\r\n\t\0]/g, '').trim();
  const safe = base.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  return safe.slice(0, 100) || 'archivo';
}

/**
 * Deduce la categoría general a partir del MIME.
 */
export function getMediaTypeFromMime(mimeType) {
  if (!mimeType) return 'document';
  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
  const found = ALLOWED_MIME_MAP[cleanMime];
  if (found) return found.type;
  if (cleanMime.startsWith('image/')) return 'image';
  if (cleanMime.startsWith('video/')) return 'video';
  if (cleanMime.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Valida los magic bytes de un buffer para comprobar concordancia con el MIME esperado.
 */
export function validateMagicBytes(buffer, mimeType) {
  if (!buffer || buffer.length < 4) return false;
  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();

  // JPEG: FF D8 FF
  if (cleanMime === 'image/jpeg' || cleanMime === 'image/jpg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }

  // PNG: 89 50 4E 47
  if (cleanMime === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }

  // GIF: GIF87a o GIF89a
  if (cleanMime === 'image/gif') {
    const sig = buffer.subarray(0, 3).toString('ascii');
    return sig === 'GIF';
  }

  // WEBP: RIFF....WEBP
  if (cleanMime === 'image/webp') {
    if (buffer.length < 12) return false;
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }

  // PDF: %PDF
  if (cleanMime === 'application/pdf') {
    const sig = buffer.subarray(0, 4).toString('ascii');
    return sig === '%PDF';
  }

  // MP4 / MOV: ftyp / moov
  if (cleanMime === 'video/mp4' || cleanMime === 'video/quicktime' || cleanMime === 'audio/mp4') {
    if (buffer.length < 8) return false;
    const box = buffer.subarray(4, 8).toString('ascii');
    return box === 'ftyp' || box === 'moov' || box === 'mdat';
  }

  // OGG: OggS
  if (cleanMime === 'audio/ogg') {
    const sig = buffer.subarray(0, 4).toString('ascii');
    return sig === 'OggS';
  }

  // MP3: ID3 o sync word 0xFF 0xFB/F3/F2
  if (cleanMime === 'audio/mpeg') {
    const id3 = buffer.subarray(0, 3).toString('ascii');
    if (id3 === 'ID3') return true;
    return buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0;
  }

  // WEBM: EBML header (1A 45 DF A3)
  if (cleanMime === 'video/webm' || cleanMime === 'audio/webm') {
    return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
  }

  // 3GP: ftyp3g
  if (cleanMime === 'video/3gpp') {
    if (buffer.length < 8) return false;
    const box = buffer.subarray(4, 8).toString('ascii');
    return box === 'ftyp';
  }

  // Por defecto, si no hay firma estricta conocida pero está en allowlist, se acepta
  return Boolean(ALLOWED_MIME_MAP[cleanMime]);
}

/**
 * Guarda un buffer entrante de forma durable en PRIVATE_MEDIA_ROOT bajo estructura tenant-isolated.
 *
 * @param {object} params
 * @param {Buffer} params.buffer - Datos binarios del archivo
 * @param {string} params.mimeType - MIME Type original
 * @param {string} params.tenantId - ID del tenant (aislamiento)
 * @param {string} [params.originalName] - Nombre original del archivo (opcional)
 * @param {string} [params.mediaCategory] - Categoría opcional ('image', 'video', 'audio', 'document', 'sticker')
 * @returns {Promise<{ relativePath: string, fullPath: string, safeFileName: string, size: number, mimeType: string, mediaType: string }>}
 */
export async function saveInboundMedia({ buffer, mimeType, tenantId, originalName, mediaCategory }) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Buffer binario inválido o vacío.');
  }

  const cleanMime = (mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const mimeConfig = ALLOWED_MIME_MAP[cleanMime];

  if (!mimeConfig) {
    throw new Error(`Tipo MIME no permitido: ${cleanMime}`);
  }

  const determinedType = mediaCategory || mimeConfig.type;
  const maxLimit = MEDIA_SIZE_LIMITS[determinedType] || MEDIA_SIZE_LIMITS.default;

  if (buffer.length > maxLimit) {
    const limitMb = Math.round(maxLimit / (1024 * 1024));
    throw new Error(`El archivo excede el tamaño máximo permitido de ${limitMb} MB para ${determinedType}.`);
  }

  // Validación de magic bytes
  const isSignatureValid = validateMagicBytes(buffer, cleanMime);
  if (!isSignatureValid) {
    throw new Error(`Firma binaria corrupta o no coincide con el tipo MIME declarado (${cleanMime}).`);
  }

  const safeTenant = getSafeTenantId(tenantId);
  // Estructura privada: /var/lib/velion-inbound-media/tenants/<tenantId>/
  const targetDir = path.join(PRIVATE_MEDIA_ROOT, 'tenants', safeTenant);

  // Guardia estricta de Path Traversal
  const resolvedDir = path.resolve(targetDir);
  if (!resolvedDir.startsWith(PRIVATE_MEDIA_ROOT + path.sep) && resolvedDir !== PRIVATE_MEDIA_ROOT) {
    throw new Error('Violación de seguridad: Path traversal detectado en el directorio de destino.');
  }

  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o2750 });
    try { fs.chmodSync(resolvedDir, 0o2750); } catch (e) {}
  }

  // Nombre de archivo seguro UUID aleatorio
  const fileUuid = crypto.randomUUID();
  const safeExt = mimeConfig.ext;
  const diskFileName = `${fileUuid}${safeExt}`;
  const fullPath = path.join(resolvedDir, diskFileName);

  // Escribir archivo a disco con permisos restrictivos 0640
  fs.writeFileSync(fullPath, buffer, { mode: 0o640 });
  try { fs.chmodSync(fullPath, 0o640); } catch (e) {}

  // Ruta relativa normalizada para almacenamiento en la BD (portable e independiente del SO)
  const relativePath = path.relative(PRIVATE_MEDIA_ROOT, fullPath).replace(/\\/g, '/');
  const safeFileName = sanitizeDisplayFileName(originalName || diskFileName);

  return {
    relativePath,
    fullPath,
    safeFileName,
    size: buffer.length,
    mimeType: cleanMime,
    mediaType: determinedType
  };
}

/**
 * Resuelve una ruta relativa de BD a una ruta absoluta segura en PRIVATE_MEDIA_ROOT.
 * Rechaza inmediatamente cualquier intento de path traversal o secuencias '..'.
 */
export function resolveMediaPath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return null;
  // Rechazo estricto si contiene secuencias de retroceso '..'
  if (relativePath.includes('..')) {
    return null;
  }
  const resolved = path.resolve(PRIVATE_MEDIA_ROOT, relativePath);
  if (!resolved.startsWith(PRIVATE_MEDIA_ROOT + path.sep)) {
    return null; // Path traversal detectado
  }
  return resolved;
}
