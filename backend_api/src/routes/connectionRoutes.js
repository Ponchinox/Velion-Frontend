import express from 'express';
import { getStatus, getQrCode, logoutDevice, saveMeta, getProvider } from '../controllers/connectionController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de conexión
router.use(authMiddleware);

router.get('/status', getStatus);
router.get('/qr', getQrCode);
router.post('/logout', logoutDevice);

// ─── GATEWAY: Nuevas rutas para Meta Cloud API ───
router.post('/meta', saveMeta);        // Guardar credenciales Meta
router.get('/provider', getProvider);  // Consultar proveedor activo

export default router;
