import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
import { getOrders, getOrderById } from '../controllers/orderController.js';

const router = express.Router();

router.get('/', authMiddleware, getOrders);
router.get('/:id', authMiddleware, getOrderById);

export default router;
