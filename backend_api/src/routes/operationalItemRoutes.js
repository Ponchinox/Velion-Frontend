import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import {
  getItems,
  getItemById,
  createItem,
  updateItem,
  completeItem,
  archiveItem,
  cancelItem
} from '../controllers/operationalItemController.js';

const router = express.Router();

// Todas las rutas de operational-items requieren autenticación estricta
router.use(authMiddleware);

router.get('/', getItems);
router.get('/:id', getItemById);
router.post('/', createItem);
router.patch('/:id', updateItem);
router.post('/:id/complete', completeItem);
router.post('/:id/archive', archiveItem);
router.post('/:id/cancel', cancelItem);

export default router;
