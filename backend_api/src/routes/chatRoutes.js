import express from 'express';
import {
  getChats,
  getMessages,
  sendMessage,
  sendDirectMessage,
  resumeBot,
  getChatMedia,
  getChatMediaToken
} from '../controllers/chatController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import mediaAuthMiddleware from '../middlewares/mediaAuthMiddleware.js';

const router = express.Router();

// ── RUTA DE STREAMING MULTIMEDIA SCOPED (NO pasa por authMiddleware de sesión general) ──
router.get('/media/:messageId', mediaAuthMiddleware, getChatMedia);

// ── RUTAS REST DEL LIVE CHAT (Protegidas por authMiddleware de sesión estándar) ──
router.use(authMiddleware);

router.get('/media-token/:messageId', getChatMediaToken);
router.get('/', getChats);
router.post('/send', sendDirectMessage);
router.post('/:customerId/resume-bot', resumeBot);
router.get('/:chatId/messages', getMessages);
router.post('/:chatId/messages', sendMessage);

export default router;
