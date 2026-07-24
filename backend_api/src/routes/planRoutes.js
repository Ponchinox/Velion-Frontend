import express from 'express';
import prisma from '../db.js';

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
    return res.status(500).json({ error: 'Error interno al consultar la lista de planes.' });
  }
});

export default router;
