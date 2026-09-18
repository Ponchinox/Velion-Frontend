import express from 'express';
import prisma from '../db.js';
import { getBillingConfig } from '../services/billingConfigService.js';

const router = express.Router();

/**
 * Endpoint público para obtener todos los planes comerciales activos
 * ordenados de menor a mayor precio.
 */
router.get('/', async (req, res) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { price: 'asc' }
    });
    return res.json(plans);
  } catch (error) {
    console.error('❌ [Plan Routes] Error al obtener planes:', error);
    try {
      const fallback = await prisma.plan.findMany({ where: { active: true } });
      return res.json(fallback);
    } catch (err2) {
      return res.status(500).json({ error: 'Error interno al consultar la lista de planes.' });
    }
  }
});

/**
 * Endpoint público para obtener la configuración comercial de pagos (Yape/WhatsApp/etc.)
 * sin exponer datos personales hardcodeados en el frontend.
 */
router.get('/billing-config', async (req, res) => {
  try {
    const config = await getBillingConfig(prisma);
    return res.json(config);
  } catch (error) {
    console.error('❌ [Plan Routes] Error al obtener billing-config:', error);
    return res.json({
      paymentMethod: null,
      paymentRecipient: null,
      paymentContact: null
    });
  }
});

export default router;
