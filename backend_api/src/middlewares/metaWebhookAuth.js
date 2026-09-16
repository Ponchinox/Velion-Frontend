import crypto from 'crypto';

/**
 * Middleware para validar la autenticidad criptográfica de los webhooks de Meta Cloud API.
 *
 * Requisitos de Meta:
 * - Encabezado: X-Hub-Signature-256
 * - Formato: sha256=<hex_hash>
 * - Algoritmo: HMAC-SHA256(rawBody, META_APP_SECRET)
 *
 * Reglas de seguridad:
 * - Fail closed: rechaza inmediatamente si falta secret, header, rawBody o si la firma no coincide.
 * - Comparación segura en tiempo constante: crypto.timingSafeEqual.
 * - No loggear secretos, firmas completas ni datos sensibles del payload.
 */
export function verifyMetaSignature(req, res, next) {
  const appSecret = (process.env.META_APP_SECRET || '').trim();
  if (!appSecret) {
    console.error('🚨 [Meta Webhook Security] META_APP_SECRET no está configurado en el servidor. Webhook rechazado.');
    return res.status(401).json({ error: 'Unauthorized: META_APP_SECRET not configured' });
  }

  const rawBody = req.rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    console.error('🚨 [Meta Webhook Security] rawBody no disponible como Buffer para verificar firma.');
    return res.status(400).json({ error: 'Bad Request: rawBody unavailable for signature verification' });
  }

  const signatureHeader = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    console.error('🚨 [Meta Webhook Security] Encabezado X-Hub-Signature-256 ausente.');
    return res.status(401).json({ error: 'Unauthorized: missing X-Hub-Signature-256 header' });
  }

  const parts = signatureHeader.trim().split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256' || !/^[0-9a-fA-F]{64}$/.test(parts[1])) {
    console.error('🚨 [Meta Webhook Security] Formato de X-Hub-Signature-256 inválido.');
    return res.status(401).json({ error: 'Unauthorized: invalid signature format' });
  }

  const receivedHash = parts[1].toLowerCase();
  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')
    .toLowerCase();

  const receivedBuffer = Buffer.from(receivedHash, 'utf8');
  const expectedBuffer = Buffer.from(expectedHash, 'utf8');

  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    console.error('🚨 [Meta Webhook Security] Firma HMAC de Meta inválida. Petición rechazada.');
    return res.status(401).json({ error: 'Unauthorized: signature mismatch' });
  }

  next();
}
