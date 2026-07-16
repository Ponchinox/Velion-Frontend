import express from 'express';
import { getStatus, connectDevice, disconnectDevice, sendMessage, receiveWebhook } from '../controllers/whatsappController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Webhook público para recibir eventos de Evolution API sin JWT
router.post('/webhook', receiveWebhook);

// Proteger todas las rutas de WhatsApp
router.use(authMiddleware);

router.get('/status', getStatus);
router.post('/connect', connectDevice);
router.post('/disconnect', disconnectDevice);
router.post('/send', sendMessage);

export default router;
