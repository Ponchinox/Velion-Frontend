import express from 'express';
import { getBotInventory } from '../controllers/internalController.js';

const router = express.Router();

// Middleware de API Key interno
const internalAuth = (req, res, next) => {
  const clientSecret = req.headers['x-bot-secret'];
  const botSecret = process.env.BOT_SECRET || 'super_bot_secret_2026';
  
  if (!clientSecret || clientSecret !== botSecret) {
    return res.status(401).json({ error: 'No autorizado. Se requiere un x-bot-secret válido.' });
  }
  next();
};

// Ruta de consumo interno para el bot
router.get('/bot/inventory/:tenantId', internalAuth, getBotInventory);

export default router;
