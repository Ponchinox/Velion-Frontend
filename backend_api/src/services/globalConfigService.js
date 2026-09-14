import prisma from '../db.js';

let cachedSystemPrompt = null;
let cacheExpiry = 0;
const PROMPT_CACHE_TTL_MS = 30 * 1000; // 30 segundos de TTL para garantizar actualización viva sin saturar BD

/**
 * Obtiene el Prompt del Sistema Global configurado desde Administración Central (SuperAdmin).
 * Usa caché en memoria con TTL corto e invalidación inmediata al editar.
 * Retorna string limpio o null si no está configurado.
 *
 * @param {object} [prismaClient=prisma]
 * @returns {Promise<string|null>}
 */
export async function getGlobalSystemPrompt(prismaClient = prisma) {
  const now = Date.now();
  if (cachedSystemPrompt !== null && now < cacheExpiry) {
    return cachedSystemPrompt;
  }

  try {
    const config = await prismaClient.systemConfig.findUnique({
      where: { key: 'systemPrompt' }
    });

    const val = config?.value ? config.value.trim() : null;
    cachedSystemPrompt = val && val.length > 0 ? val : null;
    cacheExpiry = now + PROMPT_CACHE_TTL_MS;
    return cachedSystemPrompt;
  } catch (err) {
    console.warn('⚠️ [GlobalConfigService] No se pudo leer systemPrompt desde SystemConfig:', err.message);
    if (cachedSystemPrompt !== null) return cachedSystemPrompt;
    return null;
  }
}

/**
 * Invalida inmediatamente la caché en memoria del Prompt Global del Sistema.
 * Debe invocarse cuando el SuperAdmin actualiza la configuración en adminController.
 */
export function invalidateGlobalPromptCache() {
  cachedSystemPrompt = null;
  cacheExpiry = 0;
}
