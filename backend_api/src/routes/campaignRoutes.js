import express from 'express';
import { launchCampaign, getCampaigns, getCampaignDetail } from '../controllers/campaignController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import { planFeatureMiddleware } from '../middlewares/planFeatureMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de campañas masivas
router.use(authMiddleware);

// Verificar que el plan del Tenant incluya Campañas (bloquea peticiones directas a la API)
router.use(planFeatureMiddleware('hasCampaigns'));

router.get('/', getCampaigns);
router.post('/launch', launchCampaign);
router.get('/:campaignId', getCampaignDetail);

export default router;

