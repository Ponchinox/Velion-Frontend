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

const MEDIA_ROOT = path.resolve('/var/www/velion-media');
const APP_URL = (process.env.APP_URL || 'https://185.163.116.210').replace(/\/+$/, '');

// Sanitizar tenantId para prevenir path traversal
function getSafeTenantId(tenantId) {
  if (!tenantId) return 'global';
  const clean = String(tenantId).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return clean.length > 0 ? clean : 'global';
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
      const targetDir = path.join(MEDIA_ROOT, 'tenants', safeTenantId, subFolder);

      // Verificación de seguridad estricta: targetDir debe ser subdirectorio de MEDIA_ROOT
      const resolvedDir = path.resolve(targetDir);
      if (!resolvedDir.startsWith(MEDIA_ROOT + path.sep)) {
        return cb(new Error('Path traversal detected in destination directory'));
      }

      // Asegurar que el directorio exista con setgid 2750
      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o2750 });
        try { fs.chmodSync(resolvedDir, 0o2750); } catch (e) {}
      }

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

    // Si hubo archivos subidos, asegurar permisos 0640 y mapear .path a URL pública VPS
    if (req.files) {
      for (const field of Object.keys(req.files)) {
        for (const file of req.files[field]) {
          try {
            // Asignar permisos estrictos 0640
            fs.chmodSync(file.path, 0o640);
          } catch (chmodErr) {
            console.warn(`⚠️ [Upload] No se pudo hacer chmod 0640 en ${file.path}:`, chmodErr.message);
          }

          // Guardar ruta de disco local por si se requiere cleanup ante errores
          file.localFullPath = file.path;

          // Construir URL pública servida por Nginx: /media/tenants/<tenantId>/products/.../<uuid>.<ext>
          const relativeToMedia = path.relative(MEDIA_ROOT, file.path).replace(/\\/g, '/');
          file.path = `${APP_URL}/media/${relativeToMedia}`;
          file.publicUrl = file.path;
        }
      }
    }

    next();
  });
};

