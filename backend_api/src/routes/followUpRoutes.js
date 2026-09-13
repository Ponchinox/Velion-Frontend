import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {
  getFollowUps,
  getFollowUpSummary,
  cancelFollowUp,
  updateSettings
} from '../controllers/followUpController.js';

const router = express.Router();

// Todas las rutas de Follow-ups requieren sesión autenticada JWT y scoping por tenant
router.use(authMiddleware);

router.get('/', getFollowUps);
router.get('/summary', getFollowUpSummary);
router.patch('/settings', updateSettings);
router.patch('/:id/cancel', cancelFollowUp);

export default router;
