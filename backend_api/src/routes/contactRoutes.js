import express from 'express';
import {
  getContacts,
  createContact,
  updateContact,
  deleteContact,
  toggleBotPause,
} from '../controllers/contactController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas del CRM
router.use(authMiddleware);

router.get('/',                  getContacts);
router.post('/',                 createContact);
router.put('/:id',               updateContact);
router.delete('/:id',            deleteContact);
router.put('/:id/toggle-bot',    toggleBotPause);

export default router;
