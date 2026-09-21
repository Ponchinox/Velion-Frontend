import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Imponer umask 0027 en tiempo de ejecución: directorios 2750, archivos 0640
try {
  process.umask(0o027);
} catch (e) {
  console.warn('⚠️ [Upload Middleware] No se pudo configurar process.umask:', e.message);
}

export function resolveMediaRoot() {
  return path.resolve(process.env.LOCAL_MEDIA_ROOT || '/var/www/velion-media');
}

export const MEDIA_ROOT = resolveMediaRoot();
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Sanitizar tenantId para prevenir path traversal
function getSafeTenantId(tenantId) {
  if (!tenantId) return 'global';
  const clean = String(tenantId).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return clean.length > 0 ? clean : 'global';
}

/**
 * Garantiza determinísticamente que un directorio público y todos sus componentes
 * intermedios dentro de MEDIA_ROOT existan y tengan permisos 02755 (drwxr-sr-x),
 * independientemente del umask del proceso (ej. 0027).
 *
 * Rechaza estrictamente cualquier ruta fuera de MEDIA_ROOT (Path Traversal).
 * NUNCA otorga permisos 777 ni permisos de escritura a 'others'.
 */
export function ensurePublicMediaDir(targetDir, root = resolveMediaRoot()) {
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(targetDir);

  // Verificación estricta de seguridad: targetDir debe estar dentro de resolvedRoot o ser resolvedRoot
  if (resolvedDir !== resolvedRoot && !resolvedDir.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Violación de seguridad: Path traversal detectado fuera de MEDIA_ROOT (${resolvedDir})`);
  }

  // Segmentos intermedios desde resolvedRoot hasta resolvedDir
  const relative = path.relative(resolvedRoot, resolvedDir);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];

  // Garantizar modo 02755 en resolvedRoot si existe o al crearlo
  try {
    if (!fs.existsSync(resolvedRoot)) {
      fs.mkdirSync(resolvedRoot, { recursive: true, mode: 0o2755 });
    }
    fs.chmodSync(resolvedRoot, 0o2755);
  } catch {
    // Si resolvedRoot ya existe y pertenece a otro usuario o no permite chmod, continuar
  }

  // Crear y garantizar explícitamente 02755 en cada componente intermedio
  // Cubre: /tenants, /tenants/<tenantId>, /products, /images, /videos
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { mode: 0o2755 });
    }
    try {
      fs.chmodSync(current, 0o2755);
    } catch (chmodErr) {
      console.warn(`⚠️ [Upload Middleware] No se pudo hacer chmod 02755 en ${current}:`, chmodErr.message);
    }
  }

  return resolvedDir;
}

// Extensiones y Mimetypes permitidos
const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.m4v'];

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

// Configuración de almacenamiento en disco con aislamiento multi-tenant
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const isVideo = file.mimetype && file.mimetype.startsWith('video/');
      const safeTenantId = getSafeTenantId(req.user?.tenantId);
      const subFolder = isVideo ? path.join('products', 'videos') : path.join('products', 'images');
      const currentMediaRoot = resolveMediaRoot();
      const targetDir = path.join(currentMediaRoot, 'tenants', safeTenantId, subFolder);

      // Verificación de seguridad estricta: targetDir debe ser subdirectorio de MEDIA_ROOT
      const resolvedDir = path.resolve(targetDir);
      if (!resolvedDir.startsWith(currentMediaRoot + path.sep)) {
        return cb(new Error('Path traversal detected in destination directory'));
      }

      // Asegurar determinísticamente que el directorio y toda su cadena tengan 02755
      ensurePublicMediaDir(resolvedDir, currentMediaRoot);

      cb(null, resolvedDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    try {
      const isVideo = file.mimetype && file.mimetype.startsWith('video/');
      const rawExt = path.extname(file.originalname || '').toLowerCase();
      
      let safeExt = '.jpg';
      if (isVideo) {
        safeExt = ALLOWED_VIDEO_EXTS.includes(rawExt) ? rawExt : '.mp4';
      } else {
        safeExt = ALLOWED_IMAGE_EXTS.includes(rawExt) ? rawExt : '.jpg';
      }

      // Nombre seguro aleatorio UUID v4 (inmune a nombres arbitrarios del cliente)
      const safeFilename = `${crypto.randomUUID()}${safeExt}`;
      cb(null, safeFilename);
    } catch (err) {
      cb(err);
    }
  },
});

// Filtro MIME estricto por campo
const fileFilter = (req, file, cb) => {
  const isVideoField = file.fieldname === 'video';
  const isImageField = file.fieldname === 'image' || file.fieldname === 'images';

  if (isVideoField) {
    if (ALLOWED_VIDEO_MIMES.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Formato de video no válido. Se permiten MP4, MOV, WEBM, M4V.'));
  }

  if (isImageField) {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Formato de imagen no válido. Se permiten JPG, JPEG, PNG, WEBP.'));
  }

  return cb(new Error(`Campo de subida no reconocido: ${file.fieldname}`));
};

// Instancia Multer base con límite de 20 MB
const baseUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB límite general
  },
});

// Campos permitidos para productos
const uploadProductMediaFields = baseUpload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'images', maxCount: 4 },
  { name: 'video', maxCount: 1 },
]);

export const uploadProductMedia = (req, res, next) => {
  uploadProductMediaFields(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido de 20 MB.' });
        }
        return res.status(400).json({ error: `Error de subida: ${err.message}` });
      }
      return res.status(400).json({ error: err.message });
    }

    // Si hubo archivos subidos, asegurar permisos públicos 0644 y mapear .path a URL pública VPS
    const currentMediaRoot = resolveMediaRoot();
    const uploadedFiles = [];
    if (req.files) {
      for (const field of Object.keys(req.files)) {
        if (Array.isArray(req.files[field])) {
          uploadedFiles.push(...req.files[field]);
        }
      }
    }
    if (req.file) {
      uploadedFiles.push(req.file);
    }

    for (const file of uploadedFiles) {
      try {
        // Asignar permisos públicos estrictos 0644 (lectura para Nginx y backend, sin bits de ejecución)
        fs.chmodSync(file.path, 0o644);
      } catch (chmodErr) {
        console.warn(`⚠️ [Upload] No se pudo hacer chmod 0644 en ${file.path}:`, chmodErr.message);
      }

      // Guardar ruta de disco local por si se requiere cleanup ante errores
      file.localFullPath = file.path;

      // Construir URL pública servida por Nginx: /media/tenants/<tenantId>/products/.../<uuid>.<ext>
      const relativeToMedia = path.relative(currentMediaRoot, file.path).replace(/\\/g, '/');
      file.path = `${APP_URL}/media/${relativeToMedia}`;
      file.publicUrl = file.path;
    }

    next();
  });
};

