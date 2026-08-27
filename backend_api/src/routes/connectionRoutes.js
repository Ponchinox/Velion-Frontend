import express from 'express';
import { getStatus, getQrCode, logoutDevice, createMetaInstance, getProvider } from '../controllers/connectionController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de conexión
router.use(authMiddleware);

router.get('/status',       getStatus);
router.get('/qr',           getQrCode);
router.post('/logout',      logoutDevice);
router.get('/provider',     getProvider);

// ─── Meta Cloud API vía Evolution API nativa ───────────────────────────────
// Crea una instancia WHATSAPP-BUSINESS en Evolution e inyecta los 3 credenciales.
router.post('/meta/connect', createMetaInstance);

export default router;
