import express from 'express';
import { getStatus, getQrCode, logoutDevice } from '../controllers/connectionController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de conexión
router.use(authMiddleware);

router.get('/status', getStatus);
router.get('/qr', getQrCode);
router.post('/logout', logoutDevice);

export default router;
