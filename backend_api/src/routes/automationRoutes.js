import express from 'express';
import { getFlow, saveFlow } from '../controllers/automationController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de automatización
router.use(authMiddleware);

router.get('/flow', getFlow);
router.post('/flow', saveFlow);

export default router;
