import express from 'express';
import { getContacts, createContact, deleteContact } from '../controllers/contactController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas del CRM
router.use(authMiddleware);

router.get('/', getContacts);
router.post('/', createContact);
router.delete('/:id', deleteContact);

export default router;
