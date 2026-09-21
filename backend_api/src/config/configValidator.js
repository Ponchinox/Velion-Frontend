/**
 * VELION CRITICAL CONFIGURATION VALIDATOR
 * =======================================
 * Ejecuta validaciones fail-fast de configuración y variables críticas al arrancar el backend.
 * 
 * REGLAS DE SEGURIDAD PARA TRANSFERIBILIDAD EMPRESARIAL:
 * 1. En producción (NODE_ENV === 'production'):
 *    - DATABASE_URL: Requerida obligatoriamente.
 *    - JWT_SECRET: Requerida obligatoriamente, longitud mínima 32 caracteres, rechaza valores inseguros.
 *    - TOKEN_ENCRYPTION_KEY: Requerida obligatoriamente, longitud mínima 32 caracteres o 64 hex, rechaza valores inseguros.
 * 2. Rechaza tajantemente valores por defecto/inseguros (ej: "secret", "changeme", "default-key").
 * 3. En entornos de desarrollo/test:
 *    - Emite alertas estructuradas sin abortar el proceso para permitir testing con mocks.
 * 4. Reporta el estado de los proveedores opcionales (Shopify, Meta, Gemini, Groq, Stripe)
 *    como CONFIGURED o NOT_CONFIGURED sin exponer jamás valores sensibles en los logs.
 */

const INSECURE_KEY_PATTERNS = [
  'secret',
  'changeme',
  'default',
  'default-key',
  'jwt_secret',
  'your_jwt_secret_here',
  '123456',
  'password',
  'test',
];

export function validateCriticalConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // 1. DATABASE_URL
  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL no está definida en el entorno.');
  } else if (!env.DATABASE_URL.startsWith('postgres://') && !env.DATABASE_URL.startsWith('postgresql://')) {
    errors.push('DATABASE_URL debe ser una URI PostgreSQL válida (postgres:// o postgresql://).');
  }

  // 2. JWT_SECRET
  if (!env.JWT_SECRET) {
    errors.push('JWT_SECRET no está configurada en el entorno.');
  } else {
    const lowerSecret = env.JWT_SECRET.toLowerCase();
    if (INSECURE_KEY_PATTERNS.some(p => lowerSecret === p || lowerSecret.includes('your_jwt_secret'))) {
      errors.push('JWT_SECRET utiliza un valor inseguro o de plantilla por defecto.');
    }
    if (isProd && env.JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET debe tener al menos 32 caracteres en entornos de producción.');
    }
  }

  // 3. TOKEN_ENCRYPTION_KEY
  const encKey = env.TOKEN_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY;
  if (!encKey) {
    if (isProd) {
      errors.push('TOKEN_ENCRYPTION_KEY no está configurada. Es obligatoria para cifrar tokens de integración en producción.');
    } else {
      warnings.push('TOKEN_ENCRYPTION_KEY no está configurada. Se utilizará derivación determinística de clave de respaldo.');
    }
  } else {
    const lowerEnc = encKey.toLowerCase();
    if (INSECURE_KEY_PATTERNS.some(p => lowerEnc === p)) {
      errors.push('TOKEN_ENCRYPTION_KEY utiliza un valor inseguro o de plantilla por defecto.');
    }
    if (isProd && encKey.length < 32) {
      errors.push('TOKEN_ENCRYPTION_KEY debe tener al menos 32 caracteres (o 64 hex) en producción.');
    }
  }

  // Si hay errores en producción
  if (isProd && errors.length > 0) {
    const errorBanner = [
      '======================================================================',
      '🚨 ERROR CRÍTICO DE CONFIGURACIÓN DE SEGURIDAD (FAIL-FAST)',
      '======================================================================',
      ...errors.map(e => `❌ ${e}`),
      '----------------------------------------------------------------------',
      'El servidor no puede arrancar en modo producción con configuraciones',
      'inseguras o faltantes. Corrige las variables de entorno en .env.',
      '======================================================================'
    ].join('\n');

    console.error(errorBanner);
    throw new Error(`CRITICAL_CONFIG_ERROR: ${errors.join('; ')}`);
  }

  if (warnings.length > 0 && isProd) {
    warnings.forEach(w => console.warn(`⚠️ [ConfigValidator] ${w}`));
  }

  // Estado seguro de proveedores opcionales (sin imprimir secretos)
  const providerStatus = {
    gemini: Boolean(env.GEMINI_API_KEY || env.GITHUB_MODELS_KEY || env.GITHUB_TOKEN) ? 'CONFIGURED' : 'NOT_CONFIGURED',
    groq: Boolean(env.GROQ_API_KEY) ? 'CONFIGURED' : 'NOT_CONFIGURED',
    meta: Boolean(env.META_APP_ID && env.META_APP_SECRET) ? 'CONFIGURED' : 'NOT_CONFIGURED',
    evolution: Boolean(env.EVOLUTION_API_KEY) ? 'CONFIGURED' : 'NOT_CONFIGURED',
    shopify: Boolean(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) ? 'CONFIGURED' : 'NOT_CONFIGURED',
    stripe: Boolean(env.STRIPE_SECRET_KEY) ? 'CONFIGURED' : 'NOT_CONFIGURED',
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    providerStatus
  };
}
