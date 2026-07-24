import express from 'express';
import { createCheckoutSession, handleWebhook } from '../controllers/stripeController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Ruta protegida para iniciar el flujo de Stripe Checkout
router.post('/create-checkout', authMiddleware, createCheckoutSession);

// Ruta pública para recibir notificaciones webhook (el body crudo se parsea en server.js)
router.post('/webhook', handleWebhook);

export default router;
