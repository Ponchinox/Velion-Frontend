import express from 'express';
import { launchCampaign, getCampaigns, getCampaignDetail } from '../controllers/campaignController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de campañas masivas
router.use(authMiddleware);

router.get('/', getCampaigns);
router.post('/launch', launchCampaign);
router.get('/:campaignId', getCampaignDetail);

export default router;
