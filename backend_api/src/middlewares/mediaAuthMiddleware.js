import { verifyMediaAccessToken } from '../services/mediaStorageService.js';
import jwt from 'jsonwebtoken';

/**
 * Middleware de autenticación específico para acceso a multimedia de clientes (CHAT-MEDIA-01).
 *
 * Principios de Hardening:
 * 1. El JWT principal de sesión está CATEGÓRICAMENTE PROHIBIDO en query string (?token=...).
 * 2. Para elementos HTML nativos (img, video, audio, download links), se debe proporcionar
 *    un Media Access Token de corta duración (2–5 minutos) en el parámetro ?mt=.
 * 3. Dicho token valida explícitamente:
 *    - purpose === 'chat_media'
 *    - messageId === req.params.messageId (un token de mensaje A no abre mensaje B)
 *    - tenantId correspondiente
 *    - expiración <= 5 minutos
 * 4. Alternativamente, acepta cabecera estándar 'Authorization: Bearer <token>' para
 *    llamadas API directas desde el CRM o herramientas autorizadas.
 */
export default async function mediaAuthMiddleware(req, res, next) {
  const messageId = req.params.messageId;

  // ── BLOCKER 1 HARDENING: Rechazar categóricamente JWT de sesión en query string ──
  if (req.query?.token) {
    return res.status(401).json({
      error: 'Acceso denegado: El JWT de sesión principal no está permitido en query string. Use token multimedia scoped (?mt=).'
    });
  }

  // ── CASO A: Media Access Token Scoped (?mt=...) ──
  const mediaToken = req.query?.mt ? String(req.query.mt).trim() : null;

  if (mediaToken) {
    const verification = verifyMediaAccessToken(mediaToken, messageId);
    if (!verification.valid) {
      return res.status(401).json({ error: verification.error });
    }

    req.mediaAuth = {
      tenantId: verification.payload.tenantId,
      messageId: verification.payload.messageId,
      isScopedToken: true
    };
    return next();
  }

  // ── CASO B: Cabecera Authorization: Bearer (API clients / fetch interno) ──
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const sessionToken = authHeader.split(' ')[1];
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET no configurada en el servidor.');
      }
      const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);

      const impersonatedTenantId = req.headers['x-tenant-id'];
      const effectiveTenantId = (decoded.role === 'superadmin' && impersonatedTenantId)
        ? impersonatedTenantId
        : decoded.tenantId;

      req.mediaAuth = {
        tenantId: effectiveTenantId,
        role: decoded.role,
        userId: decoded.userId || decoded.id,
        isSuperAdmin: decoded.role === 'superadmin',
        isScopedToken: false
      };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Token de sesión inválido o expirado.' });
    }
  }

  return res.status(401).json({ error: 'Acceso denegado. Token multimedia no proporcionado.' });
}
