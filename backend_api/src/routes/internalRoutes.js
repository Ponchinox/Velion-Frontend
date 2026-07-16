import express from 'express';
import { getBotInventory } from '../controllers/internalController.js';

const router = express.Router();

// Ruta de consumo interno para el bot
router.get('/bot/inventory/:tenantId', getBotInventory);

export default router;
