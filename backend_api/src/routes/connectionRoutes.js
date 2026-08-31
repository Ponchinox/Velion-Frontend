import express from 'express';
import { getStatus, getQrCode, logoutDevice, createMetaInstance, getProvider } from '../controllers/connectionController.js';
import {
  getMetaOnboardingConfig,
  handleMetaOnboardingCallback,
  handleMetaLegacyConnect,
} from '../controllers/metaOnboardingController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Proteger todas las rutas de conexión
router.use(authMiddleware);

router.get('/status',       getStatus);
router.get('/qr',           getQrCode);
router.post('/logout',      logoutDevice);
router.get('/provider',     getProvider);

// ─── Meta Cloud API: Embedded Signup (nuevo flujo oficial) ──────────────────
// Devuelve configuración pública (app_id, config_id) para inicializar el SDK de Facebook
router.get('/meta/onboarding/config',    getMetaOnboardingConfig);
// Recibe el code del SDK, hace token exchange, guarda en BD (sin exponer token)
router.post('/meta/onboarding/callback', handleMetaOnboardingCallback);
// Formulario manual (fallback legacy) — sin eliminar para backward-compatibility
router.post('/meta/onboarding/legacy',   handleMetaLegacyConnect);

// ─── Meta Cloud API vía Evolution API (endpoint anterior — backward compat) ───
// Crea una instancia WHATSAPP-BUSINESS en Evolution e inyecta los credenciales.
// Mantenido por compatibilidad; el flujo nuevo usa /meta/onboarding/callback
router.post('/meta/connect', createMetaInstance);

export default router;

