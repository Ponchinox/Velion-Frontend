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
import crypto from 'crypto';
import authMiddleware from '../middlewares/authMiddleware.js';
import {
  getShopifyStatus,
  connectShopify,
  handleShopifyCallback,
  disconnectShopify,
  triggerShopifySync,
  updateShopifySettings,
} from '../controllers/shopifyController.js';
import {
  OAUTH_COOKIE_NAME,
  resolveOAuthCookieSecure,
} from '../services/integrations/shopify/shopifyOAuthService.js';

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

// Endpoints temporales de diagnóstico seguro (Sección 5 Auditoría)
router.get('/diag/set-cookie', (req, res) => {
  const nonce = crypto.randomBytes(32).toString('hex');
  const secure = resolveOAuthCookieSecure();
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 600000,
  };
  res.cookie(OAUTH_COOKIE_NAME, nonce, cookieOptions);
  return res.redirect('/api/integrations/shopify/diag/check-cookie');
});

router.get('/diag/check-cookie', (req, res) => {
  const raw = req.headers?.cookie;
  const match = raw ? raw.match(new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE_NAME}=([^;]*)`)) : null;
  const cookie = match ? match[1] : null;
  return res.json({
    cookiePresent: Boolean(cookie),
    cookieLength: cookie ? cookie.length : 0,
    host: req.headers.host,
    referer: req.headers.referer || null,
    cookieHeaderRawPresent: Boolean(raw),
  });
});

export default router;
