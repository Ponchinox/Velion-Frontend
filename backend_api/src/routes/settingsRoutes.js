import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de ajustes de empresa
router.use(authMiddleware);

router.get('/', getSettings);
router.put('/', updateSettings);

export default router;
