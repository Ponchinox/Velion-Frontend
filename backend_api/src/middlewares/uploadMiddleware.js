import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

// Configurar el almacenamiento en la nube en Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'saas_products',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

// Inicializar y exportar el middleware de Multer para interceptar archivos en las peticiones
export const upload = multer({ storage });
