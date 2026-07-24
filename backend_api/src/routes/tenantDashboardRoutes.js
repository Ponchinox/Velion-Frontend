import express from 'express';
import { getTenantMetrics, assignPlan } from '../controllers/tenantDashboardController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas del dashboard del inquilino
router.use(authMiddleware);

router.get('/', getTenantMetrics);
router.post('/assign-plan', assignPlan);

export default router;
