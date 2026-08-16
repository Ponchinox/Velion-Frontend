import express from 'express';
import { getStatus, connectDevice, disconnectDevice, sendMessage, receiveWebhook, receiveMetaVerification } from '../controllers/whatsappController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// ─── GATEWAY: Webhook unificado (Evolution API POST + Meta Cloud API POST) ───
router.post('/webhook', receiveWebhook);

// ─── GATEWAY: Verificación de webhook de Meta Cloud API (GET handshake) ───
router.get('/webhook', receiveMetaVerification);

// Proteger todas las rutas de WhatsApp
router.use(authMiddleware);

router.get('/status', getStatus);
router.post('/connect', connectDevice);
router.post('/disconnect', disconnectDevice);
router.post('/send', sendMessage);

export default router;
