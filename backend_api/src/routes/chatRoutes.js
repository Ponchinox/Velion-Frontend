import express from 'express';
import { getChats, getMessages, sendMessage, sendDirectMessage, resumeBot } from '../controllers/chatController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas del Live Chat
router.use(authMiddleware);

router.get('/', getChats);
router.post('/send', sendDirectMessage);
router.post('/:customerId/resume-bot', resumeBot);
router.get('/:chatId/messages', getMessages);
router.post('/:chatId/messages', sendMessage);

export default router;
