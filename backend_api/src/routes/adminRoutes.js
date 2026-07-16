import express from 'express';
import {
  getTenants,
  createTenant,
  updateTenantStatus,
  updateTenantLimits,
  getPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getGlobalConfig,
  saveGlobalConfig,
  getGlobalStats,
  getRecentActivity,
  checkGatewayHealth,
  getAlerts,
  resolveAlert,
  getBackups,
  generateBackup,
  downloadBackup
} from '../controllers/adminController.js';
import authMiddleware from '../middlewares/authMiddleware.js';
import adminMiddleware from '../middlewares/adminMiddleware.js';

const router = express.Router();

// Asegurar que las peticiones vengan de un usuario autenticado con rol de SuperAdmin
router.use(authMiddleware);
router.use(adminMiddleware);

// Stats
router.get('/stats', getGlobalStats);
router.get('/activity', getRecentActivity);
router.get('/health/gateway/:gateway', checkGatewayHealth);

// Alerts
router.get('/alerts', getAlerts);
router.put('/alerts/:id/resolve', resolveAlert);

// Backups
router.get('/backups', getBackups);
router.post('/backups/generate', generateBackup);
router.get('/backups/download/:filename', downloadBackup);

// Tenants
router.get('/tenants', getTenants);
router.post('/tenants', createTenant);
router.patch('/tenants/:id/status', updateTenantStatus);
router.patch('/tenants/:id/limits', updateTenantLimits);

// Plans
router.get('/plans', getPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);

// Settings
router.get('/settings', getGlobalConfig);
router.put('/settings', saveGlobalConfig);

export default router;
