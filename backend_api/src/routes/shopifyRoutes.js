/**
 * SHOPIFY INTEGRATION ROUTES
 * ==========================
 * Rutas de la API para la integración con Shopify.
 *
 * Fronteras de seguridad:
 * - /status:      Requiere JWT de Velion (authMiddleware)
 * - /connect:     Requiere JWT de Velion (authMiddleware)
 * - /disconnect:  Requiere JWT de Velion (authMiddleware)
 * - /callback:    Público (se autentica vía HMAC de Shopify + State cifrado + Cookie nonce)
 */

import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {
  getShopifyStatus,
  connectShopify,
  handleShopifyCallback,
  disconnectShopify,
  triggerShopifySync,
  updateShopifySettings,
} from '../controllers/shopifyController.js';

const router = express.Router();

const optionalAuthMiddleware = async (req, res, next) => {
  if (req.headers.authorization) {
    return authMiddleware(req, res, next);
  }
  next();
};

router.get('/status', authMiddleware, getShopifyStatus);
router.post('/connect', authMiddleware, connectShopify);
router.get('/connect', optionalAuthMiddleware, connectShopify);
router.get('/callback', handleShopifyCallback);
router.post('/disconnect', authMiddleware, disconnectShopify);
router.post('/sync', authMiddleware, triggerShopifySync);
router.patch('/settings', authMiddleware, updateShopifySettings);

export default router;
