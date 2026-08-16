import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

// Configurar el almacenamiento en la nube en Cloudinary adaptativo para imágenes y videos
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype && file.mimetype.startsWith('video/');
    if (isVideo) {
      return {
        folder: 'saas_products/videos',
        resource_type: 'video',
        allowed_formats: ['mp4', 'mov', 'webm', 'm4v'],
      };
    }
    return {
      folder: 'saas_products/images',
      resource_type: 'image',
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    };
  },
});

// Middleware de Multer con límite de 20 MB
export const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB límite general
  },
});

// Middleware específico para la creación y edición de productos multimedia
export const uploadProductMedia = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'images', maxCount: 4 },
  { name: 'video', maxCount: 1 },
]);
