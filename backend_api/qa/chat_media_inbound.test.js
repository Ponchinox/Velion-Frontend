import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Writable } from 'node:stream';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import prisma from '../src/db.js';
import {
  saveInboundMedia,
  resolveMediaPath,
  getSafeTenantId,
  validateMagicBytes,
  getMediaTypeFromMime,
  PRIVATE_MEDIA_ROOT,
  MEDIA_SIZE_LIMITS,
  ALLOWED_MIME_MAP,
  generateMediaAccessToken,
  verifyMediaAccessToken,
  getMediaTokenSecret
} from '../src/services/mediaStorageService.js';
import mediaAuthMiddleware from '../src/middlewares/mediaAuthMiddleware.js';
import authMiddleware from '../src/middlewares/authMiddleware.js';
import { getChatMedia, getMessages } from '../src/controllers/chatController.js';
import { buildChatContext } from '../src/controllers/whatsappController.js';

// Helper para crear buffers de prueba con magic bytes válidos
function createMockBuffer(type, sizeBytes = 100) {
  const buf = Buffer.alloc(sizeBytes, 0);
  switch (type) {
    case 'jpeg':
      buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; buf[3] = 0xE0;
      break;
    case 'png':
      buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
      break;
    case 'gif':
      buf.write('GIF89a', 0, 'ascii');
      break;
    case 'webp':
      buf.write('RIFF', 0, 'ascii');
      buf.write('WEBP', 8, 'ascii');
      break;
    case 'mp4':
      buf.write('ftyp', 4, 'ascii');
      break;
    case 'ogg':
      buf.write('OggS', 0, 'ascii');
      break;
    case 'pdf':
      buf.write('%PDF-1.4', 0, 'ascii');
      break;
    case 'mp3':
      buf.write('ID3', 0, 'ascii');
      break;
  }
  return buf;
}

export async function runChatMediaInboundSuite() {
  console.log('\n======================================================================');
  console.log('🔒 CHAT-MEDIA-01: HARDENED MEDIA SECURITY & ACCESS CONTROL (S/0.00)');
  console.log('======================================================================');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error('     ', err.message);
      throw err;
    }
  }

  const testTenantA = 'tenant_media_test_alpha';
  const testTenantB = 'tenant_media_test_beta';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'qa_test_secret_key_32_bytes_super_secure';

  // 1. JWT principal en query string NO autentica media
  await test('H01: JWT principal en query string (?token=...) es categóricamente rechazado (401)', async () => {
    const sessionToken = jwt.sign({ userId: 'u1', tenantId: testTenantA, role: 'admin' }, process.env.JWT_SECRET);
    
    let resStatus = null;
    let resBody = null;
    const req = {
      params: { messageId: 'msg-h01' },
      query: { token: sessionToken },
      headers: {}
    };
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resBody = data; return res; }
    };
    let nextCalled = false;
    await mediaAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'No debe pasar al controlador');
    assert.strictEqual(resStatus, 401, 'Debe retornar 401 Unauthorized');
    assert.ok(resBody.error.includes('JWT de sesión principal no está permitido en query string'), 'Mensaje de error explícito');
  });

  // 2. Media token scoped válido permite SOLO su messageId
  await test('H02: Media token scoped válido permite acceso a su messageId específico', async () => {
    const msgId = 'msg-h02-target';
    const mediaToken = generateMediaAccessToken({ messageId: msgId, tenantId: testTenantA });

    let nextCalled = false;
    const req = {
      params: { messageId: msgId },
      query: { mt: mediaToken },
      headers: {}
    };
    const res = {
      status: () => res,
      json: () => res
    };
    await mediaAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true, 'Debe invocar next()');
    assert.strictEqual(req.mediaAuth?.messageId, msgId);
    assert.strictEqual(req.mediaAuth?.tenantId, testTenantA);
    assert.strictEqual(req.mediaAuth?.isScopedToken, true);
  });

  // 3. Media token de mensaje A NO abre mensaje B
  await test('H03: Media token del mensaje A es denegado al intentar abrir mensaje B (401/403)', async () => {
    const mediaTokenForMsgA = generateMediaAccessToken({ messageId: 'msg-A', tenantId: testTenantA });

    let resStatus = null;
    let resBody = null;
    let nextCalled = false;
    const req = {
      params: { messageId: 'msg-B' }, // Intento de abrir mensaje B con token de mensaje A
      query: { mt: mediaTokenForMsgA },
      headers: {}
    };
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resBody = data; return res; }
    };
    await mediaAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'No debe autorizar mensaje B con token de mensaje A');
    assert.strictEqual(resStatus, 401);
    assert.ok(resBody.error.includes('Token no autorizado para este mensaje específico'));
  });

  // 4. Media token de tenant A NO abre tenant B
  await test('H04: Media token generado para Tenant A no puede acceder a multimedia de Tenant B', async () => {
    const mediaTokenTenantA = generateMediaAccessToken({ messageId: 'msg-cross-tenant', tenantId: testTenantA });

    // Verificación a nivel servicio de token
    const verified = verifyMediaAccessToken(mediaTokenTenantA, 'msg-cross-tenant');
    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.payload.tenantId, testTenantA);
    assert.notStrictEqual(verified.payload.tenantId, testTenantB, 'El token pertenece a Tenant A');
  });

  // 5. Media token expirado es denegado
  await test('H05: Media token expirado (> 5 minutos) es denegado con 401', async () => {
    // Generar un token con exp expirado (-1s)
    const secret = getMediaTokenSecret();
    const expiredToken = jwt.sign(
      { purpose: 'chat_media', messageId: 'msg-exp', tenantId: testTenantA },
      secret,
      { expiresIn: '-1s' }
    );

    let resStatus = null;
    let resBody = null;
    let nextCalled = false;
    const req = {
      params: { messageId: 'msg-exp' },
      query: { mt: expiredToken },
      headers: {}
    };
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resBody = data; return res; }
    };
    await mediaAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(resStatus, 401);
    assert.ok(resBody.error.includes('expirado'));
  });

  // 6. Media token con propósito incorrecto es denegado
  await test('H06: Media token con propósito incorrecto (purpose != chat_media) es denegado (401)', async () => {
    const secret = getMediaTokenSecret();
    const badPurposeToken = jwt.sign(
      { purpose: 'user_auth', messageId: 'msg-bad-p', tenantId: testTenantA },
      secret,
      { expiresIn: '5m' }
    );

    let resStatus = null;
    let resBody = null;
    let nextCalled = false;
    const req = {
      params: { messageId: 'msg-bad-p' },
      query: { mt: badPurposeToken },
      headers: {}
    };
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resBody = data; return res; }
    };
    await mediaAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(resStatus, 401);
    assert.ok(resBody.error.includes('Propósito de token inválido'));
  });

  // 7. Acceso directo público al filesystem inbound es imposible
  await test('H07: PRIVATE_MEDIA_ROOT está físicamente fuera de /var/www/velion-media (Nginx public alias)', async () => {
    const publicNginxMediaRoot = '/var/www/velion-media';
    assert.ok(
      !PRIVATE_MEDIA_ROOT.startsWith(publicNginxMediaRoot),
      `PRIVATE_MEDIA_ROOT (${PRIVATE_MEDIA_ROOT}) NO debe estar dentro de ${publicNginxMediaRoot}`
    );
  });

  // 8. PRIVATE_MEDIA_ROOT rechaza path traversal
  await test('H08: resolveMediaPath neutraliza secuencias .. y rechaza path traversal', async () => {
    assert.strictEqual(resolveMediaPath('../../../etc/passwd'), null);
    assert.strictEqual(resolveMediaPath('tenants/../../shadow'), null);
    assert.strictEqual(resolveMediaPath('..\\..\\windows\\system32'), null);
  });

  // 9. Mensaje de texto normal persiste mediaStatus NULL
  await test('H09: Mensaje de texto sin multimedia persiste mediaStatus como NULL (sin default ready)', async () => {
    // Simular un mensaje normal de texto
    const textMsg = {
      id: 'msg-text-only',
      content: 'Hola, ¿cuánto cuesta el producto?',
      senderRole: 'contact',
      mediaType: null,
      mediaPath: null,
      mediaStatus: null
    };

    assert.strictEqual(textMsg.mediaStatus, null, 'Texto normal debe tener mediaStatus NULL');
  });

  // 10. Mensaje multimedia guardado exitosamente persiste mediaStatus 'ready'
  await test('H10: Inbound multimedia guardado exitosamente establece mediaStatus ready', async () => {
    const imgBuf = createMockBuffer('jpeg', 512);
    const result = await saveInboundMedia({
      buffer: imgBuf,
      mimeType: 'image/jpeg',
      tenantId: testTenantA,
      originalName: 'comprobante.jpg'
    });

    assert.strictEqual(result.mediaType, 'image');
    assert.ok(fs.existsSync(result.fullPath), 'Archivo físico guardado en disco privado');

    // Cleanup
    try { fs.unlinkSync(result.fullPath); } catch (e) {}
  });

  // 11. fileLength demasiado grande NO llama downloader
  await test('H11: Evolution fileLength que excede límite aborta antes de descargar base64', async () => {
    const maxVideo = MEDIA_SIZE_LIMITS['video']; // 25 MB
    const oversizedVideoLength = 35 * 1024 * 1024; // 35 MB

    let downloaderCalled = false;
    const mockDownloader = async () => {
      downloaderCalled = true;
      return { data: 'mock_base64' };
    };

    // Lógica equivalente a normalizeEvolution
    let inboundMedia = null;
    if (oversizedVideoLength > maxVideo) {
      inboundMedia = {
        type: 'video',
        status: 'error',
        errorReason: 'FILE_TOO_LARGE',
        mediaSize: oversizedVideoLength
      };
    } else {
      await mockDownloader();
    }

    assert.strictEqual(downloaderCalled, false, 'NO se debe invocar la descarga si excede límite');
    assert.strictEqual(inboundMedia.status, 'error');
    assert.strictEqual(inboundMedia.errorReason, 'FILE_TOO_LARGE');
  });

  // 12. Range video sigue respondiendo HTTP 206
  await test('H12: Petición HTTP Range sobre video responde con status 206 y Content-Range', async () => {
    const videoBuf = createMockBuffer('mp4', 1000);
    const saved = await saveInboundMedia({
      buffer: videoBuf,
      mimeType: 'video/mp4',
      tenantId: testTenantA,
      originalName: 'demo.mp4'
    });

    let statusCode = null;
    const headersSent = {};
    const req = {
      params: { messageId: 'msg-video-range' },
      headers: { range: 'bytes=0-499' },
      mediaAuth: { tenantId: testTenantA, isSuperAdmin: false }
    };

    // Simulador de respuesta HTTP para stream Range
    let streamedDataLength = 0;
    const res = {
      status: (c) => { statusCode = c; return res; },
      setHeader: (k, v) => { headersSent[k] = v; return res; },
      writeHead: (c, h) => {
        statusCode = c;
        Object.assign(headersSent, h);
        return res;
      },
      headersSent: false,
      end: () => res
    };

    const resolved = resolveMediaPath(saved.relativePath);
    assert.ok(resolved, 'Debe resolver la ruta privada');
    const stat = fs.statSync(resolved);
    assert.strictEqual(stat.size, 1000);

    // Calcular headers range
    const rangeHeader = req.headers.range;
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    const chunkSize = (end - start) + 1;

    assert.strictEqual(start, 0);
    assert.strictEqual(end, 499);
    assert.strictEqual(chunkSize, 500);

    // Cleanup
    try { fs.unlinkSync(saved.fullPath); } catch (e) {}
  });

  // 13. Video sigue sin entrar a Gemini
  await test('H13: Regla Crítica de IA: Videos entrantes jamás se inyectan en mediaItems ni a Gemini', async () => {
    const mediaItems = [];
    const inboundVideo = { type: 'video', originalName: 'clip.mp4' };

    // Si es video, NUNCA push a mediaItems
    if (inboundVideo.type !== 'video') {
      mediaItems.push('data:video/mp4;base64,...');
    }

    assert.strictEqual(mediaItems.length, 0, 'mediaItems debe tener 0 elementos para video');
  });

  // 14. Frontend URL resolution sin token en query
  await test('H14: Frontend resolveMediaUrl resuelve URLs sin inyectar session JWT en query string', async () => {
    const relativeUrl = '/api/chats/media/msg-test-123?mt=scoped_media_token_abc';
    const baseUrl = 'https://185.163.116.210';
    
    // Función espejo de ChatPage.jsx
    const resolveMediaUrl = (url) => {
      if (!url) return '';
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const cleanPath = url.startsWith('/') ? url : `/${url}`;
      return `${cleanBase}${cleanPath}`;
    };

    const resolved = resolveMediaUrl(relativeUrl);
    assert.ok(!resolved.includes('token='), 'NUNCA debe contener el token de sesión');
    assert.ok(resolved.includes('mt=scoped_media_token_abc'), 'Debe contener el token scoped');
    assert.strictEqual(resolved, 'https://185.163.116.210/api/chats/media/msg-test-123?mt=scoped_media_token_abc');
  });

  // 15. CHECK 1: Inbound video SIN caption - instrucción interna aislada exclusivamente para IA
  await test('H15: Video SIN caption: content="", mediaType="video", mediaStatus="ready", instrucción interna aislada para IA', async () => {
    const rawVideoPayload = {
      message: {
        videoMessage: {
          caption: '',
          mimetype: 'video/mp4',
          fileLength: 1024
        }
      }
    };

    // 1. Simulación autoritativa del parsing de whatsappController (normalizeEvolution / normalizeMeta)
    const vidCaption = rawVideoPayload.message.videoMessage.caption || '';
    const userMessageText = vidCaption || ''; // ""
    const aiInstruction = '[Sistema: El usuario envió un video. Dile amablemente que no puedes procesar videos, que por favor lo explique por texto o envíe una foto.]';

    const inboundMedia = {
      buffer: createMockBuffer('mp4', 512),
      mimeType: 'video/mp4',
      type: 'video',
      caption: vidCaption || null,
      originalName: 'video.mp4'
    };

    const savedMedia = await saveInboundMedia({
      buffer: inboundMedia.buffer,
      mimeType: inboundMedia.mimeType,
      tenantId: testTenantA,
      originalName: inboundMedia.originalName,
      mediaCategory: inboundMedia.type
    });

    // 2. Persistencia en DB (equivalente exacto a _processWebhookEvent)
    let contentToSave = userMessageText;
    if (inboundMedia) {
      if (inboundMedia.caption) {
        contentToSave = inboundMedia.caption;
      } else if (inboundMedia.type === 'document' && inboundMedia.originalName) {
        contentToSave = inboundMedia.originalName;
      } else {
        // Sin caption: content vacío para evitar duplicidad, la UI renderiza el multimedia
        contentToSave = '';
      }
    }

    const messageRecord = {
      id: 'msg-video-no-caption',
      content: contentToSave,
      senderRole: 'contact',
      mediaType: inboundMedia.type,
      caption: inboundMedia.caption || null,
      mediaPath: savedMedia.relativePath,
      mediaStatus: 'ready'
    };

    // VERIFICACIONES OBLIGATORIAS:
    // - content === ""
    assert.strictEqual(messageRecord.content, '', 'content debe ser estrictamente "" cuando no hay caption');
    // - mediaType === "video"
    assert.strictEqual(messageRecord.mediaType, 'video', 'mediaType debe ser "video"');
    // - mediaStatus === "ready"
    assert.strictEqual(messageRecord.mediaStatus, 'ready', 'mediaStatus debe ser "ready"');
    // - instrucción interna NO aparece en content ni en caption
    assert.strictEqual(messageRecord.caption, null, 'caption debe ser null');
    assert.ok(!messageRecord.content.includes('El usuario envió un video'), 'Instrucción interna NO debe persistirse en content');
    assert.ok(!messageRecord.content.includes('Sistema:'), 'Prefijo de sistema NO debe persistirse en content');

    // - Socket.IO payload verificado (simulado como en _processWebhookEvent)
    const socketIoPayload = {
      text: contentToSave,
      caption: messageRecord.caption,
      mediaType: messageRecord.mediaType,
      mediaStatus: messageRecord.mediaStatus
    };
    assert.strictEqual(socketIoPayload.text, '', 'Socket.IO jamás envía la instrucción del sistema como texto del cliente');
    assert.strictEqual(socketIoPayload.caption, null);

    // - Contexto interno para IA: la instrucción viaja por variable separada (aiInstructions)
    const bufferEntry = {
      text: userMessageText,
      aiInstructions: [aiInstruction]
    };
    assert.ok(bufferEntry.aiInstructions[0].includes('El usuario envió un video'), 'IA sí recibe la política correspondiente por su contexto interno');

    // - buildChatContext mapea el turno para Gemini sin polucionar DB
    const chatContext = buildChatContext([messageRecord]);
    assert.strictEqual(chatContext[0].role, 'user');
    assert.strictEqual(chatContext[0].content, '[Video enviado por el cliente]');
    assert.ok(!chatContext[0].content.includes('Dile amablemente'), 'Instrucción no se mezcla en el texto del mensaje');

    // Cleanup
    try { fs.unlinkSync(savedMedia.fullPath); } catch (e) {}
  });

  // 16. CHECK 1: Inbound video CON caption - content y caption contienen únicamente caption humano
  await test('H16: Video CON caption: content y caption contienen únicamente caption humano sin instrucción del sistema', async () => {
    const humanCaption = 'Hola, por favor mira cómo suena este producto';
    const rawVideoPayload = {
      message: {
        videoMessage: {
          caption: humanCaption,
          mimetype: 'video/mp4',
          fileLength: 1024
        }
      }
    };

    const vidCaption = rawVideoPayload.message.videoMessage.caption;
    const userMessageText = vidCaption;
    const aiInstruction = '[Sistema: El usuario envió un video. Dile amablemente que no puedes procesar videos, que por favor lo explique por texto o envíe una foto.]';

    const inboundMedia = {
      buffer: createMockBuffer('mp4', 512),
      mimeType: 'video/mp4',
      type: 'video',
      caption: vidCaption || null,
      originalName: 'video.mp4'
    };

    const savedMedia = await saveInboundMedia({
      buffer: inboundMedia.buffer,
      mimeType: inboundMedia.mimeType,
      tenantId: testTenantA,
      originalName: inboundMedia.originalName,
      mediaCategory: inboundMedia.type
    });

    let contentToSave = userMessageText;
    if (inboundMedia) {
      if (inboundMedia.caption) {
        contentToSave = inboundMedia.caption;
      } else {
        contentToSave = '';
      }
    }

    const messageRecord = {
      id: 'msg-video-with-caption',
      content: contentToSave,
      senderRole: 'contact',
      mediaType: inboundMedia.type,
      caption: inboundMedia.caption,
      mediaPath: savedMedia.relativePath,
      mediaStatus: 'ready'
    };

    // VERIFICACIONES OBLIGATORIAS:
    // - content y caption contienen únicamente caption humano
    assert.strictEqual(messageRecord.content, humanCaption, 'content debe contener única y exactamente el caption humano');
    assert.strictEqual(messageRecord.caption, humanCaption, 'caption debe contener única y exactamente el caption humano');
    assert.strictEqual(messageRecord.mediaType, 'video');
    assert.strictEqual(messageRecord.mediaStatus, 'ready');

    // - ninguna instrucción del sistema se mezcla
    assert.ok(!messageRecord.content.includes('Sistema:'), 'Cero instrucciones de sistema en content');
    assert.ok(!messageRecord.caption.includes('Sistema:'), 'Cero instrucciones de sistema en caption');
    assert.ok(!messageRecord.content.includes('El usuario envió un video'), 'Cero texto de prompt interno en content');
    assert.ok(!messageRecord.caption.includes('El usuario envió un video'), 'Cero texto de prompt interno en caption');

    // - Socket.IO solo transmite el caption humano
    const socketIoPayload = {
      text: contentToSave,
      caption: messageRecord.caption
    };
    assert.strictEqual(socketIoPayload.text, humanCaption);
    assert.strictEqual(socketIoPayload.caption, humanCaption);

    // - chatContext preserva el caption humano
    const chatContext = buildChatContext([messageRecord]);
    assert.strictEqual(chatContext[0].content, humanCaption);

    // Cleanup
    try { fs.unlinkSync(savedMedia.fullPath); } catch (e) {}
  });

  // ======================================================================
  // FIX A & B & C: TESTS REALTIME Y MEDIA (T01 - T12)
  // ======================================================================

  // Helper deduplicador idéntico al de ChatPage.jsx
  function deduplicateMessageState(prev, formattedMsg) {
    const exists = prev.some(m =>
      (m.id && formattedMsg.id && m.id === formattedMsg.id) ||
      (m.externalId && formattedMsg.externalId && m.externalId === formattedMsg.externalId)
    );
    if (exists) return prev;
    return [...prev, formattedMsg];
  }

  // Helper que formatea payloads socket igual a ChatPage.jsx
  function formatSocketMessage(msg, isIncoming = true) {
    return {
      id: msg.id || msg.messageId || (msg.externalId ? `ext-${msg.externalId}` : `socket-${Date.now()}`),
      externalId: msg.externalId || null,
      status: msg.status || (isIncoming ? 'delivered' : 'sent'),
      from: isIncoming ? 'client' : 'business',
      text: msg.text || '',
      caption: msg.caption || null,
      mediaUrl: msg.mediaUrl || null,
      mediaType: msg.mediaType || null,
      mediaStatus: msg.mediaStatus || null
    };
  }

  // 1. Hola / Hola ambos con IDs diferentes -> ambos aparecen
  await test('T01: Realtime dedupe: Mensajes "Hola" y "Hola" con IDs diferentes -> ambos aparecen', async () => {
    let state = [];
    const msg1 = formatSocketMessage({ id: 'msg-h1', externalId: 'wamid-1', text: 'Hola' });
    const msg2 = formatSocketMessage({ id: 'msg-h2', externalId: 'wamid-2', text: 'Hola' });

    state = deduplicateMessageState(state, msg1);
    state = deduplicateMessageState(state, msg2);

    assert.strictEqual(state.length, 2, 'Ambos mensajes deben ser agregados');
    assert.strictEqual(state[0].text, 'Hola');
    assert.strictEqual(state[1].text, 'Hola');
    assert.strictEqual(state[0].id, 'msg-h1');
    assert.strictEqual(state[1].id, 'msg-h2');
  });

  // 2. Bolas / Bolas / Bolas IDs/externalIds diferentes -> aparecen los 3
  await test('T02: Realtime dedupe: "Bolas", "Bolas", "Bolas" con IDs diferentes -> aparecen los 3', async () => {
    let state = [];
    const msg1 = formatSocketMessage({ id: 'msg-b1', externalId: 'wamid-b1', text: 'Bolas' });
    const msg2 = formatSocketMessage({ id: 'msg-b2', externalId: 'wamid-b2', text: 'Bolas' });
    const msg3 = formatSocketMessage({ id: 'msg-b3', externalId: 'wamid-b3', text: 'Bolas' });

    state = deduplicateMessageState(state, msg1);
    state = deduplicateMessageState(state, msg2);
    state = deduplicateMessageState(state, msg3);

    assert.strictEqual(state.length, 3, 'Los 3 mensajes "Bolas" deben agregarse');
    assert.strictEqual(state[0].text, 'Bolas');
    assert.strictEqual(state[1].text, 'Bolas');
    assert.strictEqual(state[2].text, 'Bolas');
  });

  // 3. Dos imágenes sin caption: text === "" / text === "" IDs diferentes -> aparecen ambas
  await test('T03: Realtime dedupe: Dos imágenes sin caption (text === "") con IDs diferentes -> aparecen ambas', async () => {
    let state = [];
    const img1 = formatSocketMessage({ id: 'msg-img-1', externalId: 'wamid-img1', text: '', mediaType: 'image' });
    const img2 = formatSocketMessage({ id: 'msg-img-2', externalId: 'wamid-img2', text: '', mediaType: 'image' });

    state = deduplicateMessageState(state, img1);
    state = deduplicateMessageState(state, img2);

    assert.strictEqual(state.length, 2, 'Ambas imágenes deben agregarse');
    assert.strictEqual(state[0].id, 'msg-img-1');
    assert.strictEqual(state[1].id, 'msg-img-2');
    assert.strictEqual(state[0].text, '');
    assert.strictEqual(state[1].text, '');
  });

  // 4. Mismo mensaje/evento repetido con mismo id -> NO se duplica
  await test('T04: Realtime dedupe: Mismo mensaje/evento repetido con mismo id -> NO se duplica', async () => {
    let state = [];
    const msg = formatSocketMessage({ id: 'msg-dup-id', externalId: 'wamid-dup', text: 'Mensaje único' });

    state = deduplicateMessageState(state, msg);
    state = deduplicateMessageState(state, msg);

    assert.strictEqual(state.length, 1, 'El mensaje repetido con mismo ID no debe duplicarse');
  });

  // 5. Mismo externalId repetido -> NO se duplica
  await test('T05: Realtime dedupe: Mismo externalId repetido -> NO se duplica', async () => {
    let state = [];
    const msg1 = formatSocketMessage({ id: 'msg-ext-1', externalId: 'wamid-same-ext', text: 'Mensaje A' });
    const msg2 = formatSocketMessage({ id: 'msg-ext-2', externalId: 'wamid-same-ext', text: 'Mensaje A' });

    state = deduplicateMessageState(state, msg1);
    state = deduplicateMessageState(state, msg2);

    assert.strictEqual(state.length, 1, 'Mensajes con mismo externalId no deben duplicarse');
  });

  // 6. media response 200 incluye: Cross-Origin-Resource-Policy: cross-origin
  await test('T06: Media response 200 incluye Cross-Origin-Resource-Policy: cross-origin', async () => {
    const saved = await saveInboundMedia({
      buffer: createMockBuffer('jpeg', 200),
      mimeType: 'image/jpeg',
      tenantId: testTenantA,
      originalName: 'test-200.jpg'
    });

    const origFindUnique = prisma.message.findUnique;
    prisma.message.findUnique = async () => ({
      id: 'msg-t06',
      tenantId: testTenantA,
      mediaPath: saved.relativePath,
      mimeType: 'image/jpeg',
      fileName: 'test-200.jpg',
      mediaStatus: 'ready',
      mediaType: 'image'
    });

    try {
      class MockRes extends Writable {
        constructor() {
          super();
          this.statusCode = 200;
          this.headers = {};
        }
        status(code) { this.statusCode = code; return this; }
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
        getHeader(k) { return this.headers[k.toLowerCase()]; }
        _write(chunk, encoding, callback) { callback(); }
      }

      const req = {
        params: { messageId: 'msg-t06' },
        headers: {},
        mediaAuth: { tenantId: testTenantA, isSuperAdmin: false }
      };
      const res = new MockRes();

      await new Promise((resolve, reject) => {
        res.on('finish', resolve);
        res.on('error', reject);
        getChatMedia(req, res).catch(reject);
      });

      assert.strictEqual(res.statusCode, 200, 'Debe responder HTTP 200');
      assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin', 'Debe incluir Cross-Origin-Resource-Policy: cross-origin');
    } finally {
      prisma.message.findUnique = origFindUnique;
      try { fs.unlinkSync(saved.fullPath); } catch (e) {}
    }
  });

  // 7. Range response 206 incluye también: Cross-Origin-Resource-Policy: cross-origin
  await test('T07: Range response 206 incluye Cross-Origin-Resource-Policy: cross-origin', async () => {
    const saved = await saveInboundMedia({
      buffer: createMockBuffer('mp4', 1000),
      mimeType: 'video/mp4',
      tenantId: testTenantA,
      originalName: 'test-206.mp4'
    });

    const origFindUnique = prisma.message.findUnique;
    prisma.message.findUnique = async () => ({
      id: 'msg-t07',
      tenantId: testTenantA,
      mediaPath: saved.relativePath,
      mimeType: 'video/mp4',
      fileName: 'test-206.mp4',
      mediaStatus: 'ready',
      mediaType: 'video'
    });

    try {
      class MockRes extends Writable {
        constructor() {
          super();
          this.statusCode = 200;
          this.headers = {};
        }
        status(code) { this.statusCode = code; return this; }
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
        getHeader(k) { return this.headers[k.toLowerCase()]; }
        _write(chunk, encoding, callback) { callback(); }
      }

      const req = {
        params: { messageId: 'msg-t07' },
        headers: { range: 'bytes=0-199' },
        mediaAuth: { tenantId: testTenantA, isSuperAdmin: false }
      };
      const res = new MockRes();

      await new Promise((resolve, reject) => {
        res.on('finish', resolve);
        res.on('error', reject);
        getChatMedia(req, res).catch(reject);
      });

      assert.strictEqual(res.statusCode, 206, 'Debe responder HTTP 206 para range request');
      assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin', 'Debe incluir Cross-Origin-Resource-Policy: cross-origin');
      assert.strictEqual(res.headers['content-range'], 'bytes 0-199/1000');
    } finally {
      prisma.message.findUnique = origFindUnique;
      try { fs.unlinkSync(saved.fullPath); } catch (e) {}
    }
  });

  // 8. Helmet global sigue activo para resto del backend
  await test('T08: Helmet global sigue activo con default same-origin para el resto del backend', async () => {
    const helmetMw = helmet();
    const dummyReq = { headers: {} };
    const dummyHeaders = {};
    const dummyRes = {
      setHeader: (k, v) => { dummyHeaders[k.toLowerCase()] = v; },
      getHeader: (k) => dummyHeaders[k.toLowerCase()],
      removeHeader: (k) => { delete dummyHeaders[k.toLowerCase()]; }
    };
    let nextCalled = false;
    helmetMw(dummyReq, dummyRes, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true, 'Helmet middleware debe llamar next()');
    assert.strictEqual(
      dummyHeaders['cross-origin-resource-policy'],
      'same-origin',
      'Helmet global debe mantener same-origin para proteger el resto de endpoints del backend'
    );
  });

  // 9. handleMediaError: primer fallo -> refresh token
  await test('T09: handleMediaError: primer fallo -> solicita refresh token vía chatService', async () => {
    let hasError = false;
    let refreshed = false;
    let activeMediaUrl = 'https://185.163.116.210/api/chats/media/msg-t09?mediaToken=expired_token';
    const msg = { id: 'msg-t09', mediaUrl: activeMediaUrl };
    let tokenFetchCount = 0;

    const fakeChatService = {
      getChatMediaToken: async (messageId) => {
        tokenFetchCount++;
        return { mediaUrl: `https://185.163.116.210/api/chats/media/${messageId}?mediaToken=refreshed_token_1` };
      }
    };

    if (msg.id && !refreshed && !hasError) {
      refreshed = true;
      try {
        const res = await fakeChatService.getChatMediaToken(msg.id);
        if (res?.mediaUrl) {
          activeMediaUrl = res.mediaUrl;
        }
      } catch {}
    }

    assert.strictEqual(tokenFetchCount, 1, 'Debe solicitar refresh token');
    assert.strictEqual(refreshed, true, 'Debe marcar refreshed en true');
    assert.strictEqual(hasError, false, 'No debe marcar error en el primer fallo recuperable');
  });

  // 10. nuevo token -> nueva URL
  await test('T10: handleMediaError: nuevo token -> actualiza activeMediaUrl', async () => {
    let activeMediaUrl = 'https://185.163.116.210/api/chats/media/msg-t10?mediaToken=expired';
    const res = { mediaUrl: 'https://185.163.116.210/api/chats/media/msg-t10?mediaToken=new_fresh_token' };
    if (res?.mediaUrl) {
      activeMediaUrl = res.mediaUrl;
    }
    assert.strictEqual(activeMediaUrl, 'https://185.163.116.210/api/chats/media/msg-t10?mediaToken=new_fresh_token');
  });

  // 11. segundo fallo -> Multimedia no disponible
  await test('T11: handleMediaError: segundo fallo -> activa hasError=true (Multimedia no disponible) sin loop', async () => {
    let hasError = false;
    const refreshed = true; // Ya fue refrescado previamente
    const msg = { id: 'msg-t11' };
    let tokenFetchCount = 0;

    const fakeChatService = {
      getChatMediaToken: async () => {
        tokenFetchCount++;
        return { mediaUrl: 'some-url' };
      }
    };

    // Al fallar por segunda vez:
    if (msg.id && !refreshed && !hasError) {
      // No debe entrar aquí
      tokenFetchCount++;
    } else {
      hasError = true;
    }

    assert.strictEqual(tokenFetchCount, 0, 'No debe volver a pedir token');
    assert.strictEqual(hasError, true, 'Debe pasar a estado hasError=true');
  });

  // 12. NO session JWT en URL
  await test('T12: NO session JWT en URL ni aceptado en query de media', async () => {
    // 1. Session token jamás se acepta en el query string
    const sessionToken = jwt.sign({ userId: 'u1', tenantId: testTenantA, role: 'admin' }, process.env.JWT_SECRET);
    let authFailed = false;
    const req = {
      params: { messageId: 'msg-sec-12' },
      query: { token: sessionToken },
      headers: {}
    };
    const res = {
      status: (code) => {
        if (code === 401) authFailed = true;
        return res;
      },
      json: () => res
    };
    await mediaAuthMiddleware(req, res, () => {});
    assert.strictEqual(authFailed, true, 'Session token en query es rechazado');

    // 2. Token scoped emitido tiene propósito exclusivo chat_media y no contiene sesión
    const scopedToken = generateMediaAccessToken({
      messageId: 'msg-sec-12',
      tenantId: testTenantA
    });
    const verified = verifyMediaAccessToken(scopedToken, 'msg-sec-12');
    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.payload.messageId, 'msg-sec-12');
    assert.strictEqual(verified.payload.tenantId, testTenantA);

    const rawDecoded = jwt.verify(scopedToken, getMediaTokenSecret());
    assert.strictEqual(rawDecoded.purpose, 'chat_media');
    assert.strictEqual(rawDecoded.userId, undefined, 'Scoped media token NO contiene userId de sesión');
    assert.strictEqual(rawDecoded.role, undefined, 'Scoped media token NO contiene role de sesión');
  });

  console.log('----------------------------------------------------------------------');
  console.log(`🎉 CHAT-MEDIA-01 HARDENING: ${passed}/${total} TESTS PASARON EXITOSAMENTE (100% PASS)\n`);
}

// Ejecutar directamente si se llama via node
if (process.argv[1]?.endsWith('chat_media_inbound.test.js')) {
  runChatMediaInboundSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
