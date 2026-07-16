import express from 'express';
import { createProduct, getProducts, createBulkProducts, deleteProduct, updateProduct } from '../controllers/productController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { upload } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

router.post('/', authMiddleware, upload.single('image'), createProduct);
router.post('/bulk', authMiddleware, createBulkProducts);
router.get('/', authMiddleware, getProducts);
router.put('/:id', authMiddleware, upload.single('image'), updateProduct);
router.delete('/:id', authMiddleware, deleteProduct);

export default router;
