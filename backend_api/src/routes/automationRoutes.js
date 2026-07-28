import express from 'express';
import { getFlow, saveFlow } from '../controllers/automationController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { planFeatureMiddleware } from '../middlewares/planFeatureMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de automatización
router.use(authMiddleware);

// Verificar que el plan del Tenant incluya Automatizaciones (bloquea peticiones directas a la API)
router.use(planFeatureMiddleware('hasAutomations'));

router.get('/flow', getFlow);
router.post('/flow', saveFlow);

export default router;

