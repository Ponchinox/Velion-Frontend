import express from 'express';
import { getProfile, updateProfile, updatePassword } from '../controllers/userController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de usuario
router.use(authMiddleware);

router.get('/me', getProfile);
router.put('/profile', updateProfile);
router.put('/password', updatePassword);

export default router;
