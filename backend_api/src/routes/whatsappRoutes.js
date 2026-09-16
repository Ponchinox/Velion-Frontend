import express from 'express';
import {
  getStatus,
  connectDevice,
  disconnectDevice,
  sendMessage,
  receiveEvolutionWebhook,
  receiveMetaWebhook,
  receiveWebhook,
  receiveMetaVerification
} from '../controllers/whatsappController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { verifyMetaSignature } from '../middlewares/metaWebhookAuth.js';

const router = express.Router();

// ─── GATEWAY: Webhooks separados por Proveedor ───

// Evolution API: Autenticación obligatoria por API Key (EVOLUTION_API_KEY)
router.post('/webhook', receiveEvolutionWebhook);

// Meta Cloud API: Autenticación obligatoria por firma HMAC-SHA256 (X-Hub-Signature-256)
router.post('/meta/webhook', verifyMetaSignature, receiveMetaWebhook);

// Handshake de verificación de Meta Cloud API (GET)
router.get('/meta/webhook', receiveMetaVerification);
router.get('/webhook', receiveMetaVerification); // Alias por compatibilidad


// Proteger todas las rutas de WhatsApp
router.use(authMiddleware);

router.get('/status', getStatus);
router.post('/connect', connectDevice);
router.post('/disconnect', disconnectDevice);
router.post('/send', sendMessage);

export default router;
