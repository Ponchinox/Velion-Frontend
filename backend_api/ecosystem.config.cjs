/**
 * VELION BACKEND — PM2 ECOSYSTEM CONFIGURATION
 * ============================================
 * Configuración para el gestor de procesos en producción (VPS).
 * 
 * REGLA DE ARQUITECTURA CRÍTICA:
 * - `instances: 1` (exec_mode: 'fork'):
 *   Los background workers (Campaign Worker V2, Follow-Up Sequences, Backup Scheduler)
 *   operan como singletons. Si se requiere escalar instancias HTTP horizontalmente,
 *   las réplicas adicionales deben configurarse con `BACKGROUND_JOBS_ENABLED: 'false'`.
 * 
 * SEGURIDAD:
 * - Cero credenciales ni secretos hardcodeados en este archivo.
 * - Las variables sensibles se leen exclusivamente desde .env vía dotenv en el backend.
 */

module.exports = {
  apps: [
    {
      name: 'velion-backend',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
        BACKGROUND_JOBS_ENABLED: 'true',
      },
    },
  ],
};
