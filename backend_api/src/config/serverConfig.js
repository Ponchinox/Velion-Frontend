/**
 * Configuración de red y background jobs del servidor Velion Backend.
 * 
 * Permite despliegue paralelo seguro en VPS/staging compartiendo base de datos
 * sin duplicar workers en background (Campaign Worker V2, Backup Scheduler).
 */

/**
 * Resuelve el puerto de escucha del servidor HTTP.
 * Conserva compatibilidad total con process.env.PORT existente.
 * @param {string|number|undefined} val 
 * @returns {number}
 */
export function resolvePort(val = process.env.PORT) {
  if (val === undefined || val === null || val === '') {
    return 3000;
  }
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

/**
 * Resuelve la interfaz de red (HOST) para el binding de httpServer.listen().
 * - Render / producción default: '0.0.0.0' (permite tráfico del router/proxy de Render)
 * - VPS staging / producción local: '127.0.0.1' (solo accesible mediante Nginx local)
 * @param {string|undefined} val 
 * @returns {string}
 */
export function resolveHost(val = process.env.HOST) {
  if (val === undefined || val === null || val === '') {
    return '0.0.0.0';
  }
  const trimmed = String(val).trim();
  return trimmed || '0.0.0.0';
}

/**
 * Determina si los workers y tareas en background deben ejecutarse en este proceso.
 * 
 * Comportamiento requerido:
 * - undefined -> true  (preserva comportamiento existente de Render)
 * - '' / null  -> true  (preserva default)
 * - 'true'     -> true
 * - 'false'    -> false (deshabilita workers en VPS secundario/staging)
 * - '0'        -> false
 * 
 * @param {string|undefined} val 
 * @returns {boolean}
 */
export function areBackgroundJobsEnabled(val = process.env.BACKGROUND_JOBS_ENABLED) {
  if (val === undefined || val === null || val === '') {
    return true;
  }
  const normalized = String(val).trim().toLowerCase();
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return true;
}

/**
 * Inicializa de forma segura los background jobs si están habilitados.
 * Si están deshabilitados, registra un mensaje informativo sin datos sensibles.
 * 
 * @param {Object} options
 * @param {boolean} [options.backgroundJobsEnabled]
 * @param {Function} [options.initBackupScheduler]
 * @param {Function} [options.initCampaignWorkerV2]
 * @param {Function} [options.initFollowUpWorker]
 * @param {Object} [options.logger]
 * @returns {{ started: boolean, reason?: string }}
 */
export function startBackgroundJobsIfEnabled({
  backgroundJobsEnabled = areBackgroundJobsEnabled(),
  initBackupScheduler,
  initCampaignWorkerV2,
  initFollowUpWorker,
  logger = console
} = {}) {
  if (!backgroundJobsEnabled) {
    if (logger && typeof logger.log === 'function') {
      logger.log('ℹ️ Background jobs disabled for this process');
    }
    return { started: false, reason: 'disabled' };
  }

  if (typeof initBackupScheduler === 'function') {
    initBackupScheduler();
  }

  if (typeof initCampaignWorkerV2 === 'function') {
    const workerPromise = initCampaignWorkerV2();
    if (workerPromise && typeof workerPromise.catch === 'function') {
      workerPromise.catch((err) => {
        if (logger && typeof logger.error === 'function') {
          logger.error('❌ [Campaign Worker V2] Error al inicializar el motor de campañas:', err);
        }
      });
    }
  }

  if (typeof initFollowUpWorker === 'function') {
    try {
      initFollowUpWorker();
    } catch (err) {
      if (logger && typeof logger.error === 'function') {
        logger.error('❌ [FollowUp Worker] Error al inicializar el worker de seguimientos:', err);
      }
    }
  }

  return { started: true };
}
