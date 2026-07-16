import express from 'express';
import { getFlows, saveFlow } from '../controllers/flowController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas del Flow Builder
router.use(authMiddleware);

router.get('/', getFlows);
router.post('/', saveFlow);

export default router;
