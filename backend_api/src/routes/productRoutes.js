import express from 'express';
import { createProduct, getProducts, createBulkProducts, deleteProduct, updateProduct } from '../controllers/productController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { uploadProductMedia } from '../middlewares/uploadMiddleware.js';
import { productLimitMiddleware } from '../middlewares/planFeatureMiddleware.js';

const router = express.Router();

// Rutas de escritura: verificar límite de productos del plan antes de crear
router.post('/', authMiddleware, productLimitMiddleware, uploadProductMedia, createProduct);
router.post('/bulk', authMiddleware, productLimitMiddleware, createBulkProducts);
router.get('/', authMiddleware, getProducts);
router.put('/:id', authMiddleware, uploadProductMedia, updateProduct);
router.delete('/:id', authMiddleware, deleteProduct);

export default router;

