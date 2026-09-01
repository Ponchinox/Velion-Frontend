/**
 * aiService.js — Motor de IA con cascada de resiliencia
 *
 * Arquitectura:
 *   Slot #1: Google Gemini (Modelo Principal + Alternativo)
 *            Pool de claves con estado independiente, timeout 20s, round-robin,
 *            cooldown por clave y clasificación de errores.
 *
 * SDK: @google/genai v2.19.0 (SDK oficial actual de Google)
 *
 * Parámetros eliminados vs versión anterior:
 *   ❌ temperature     — no soportado por Gemini 3.7 Flash
 *   ❌ topP / top_p   — no soportado por Gemini 3.7 Flash
 *   ❌ topK / top_k   — no soportado por Gemini 3.7 Flash
 *   ❌ candidateCount — no soportado por Gemini 3.x
 *   ❌ thinkingBudget — sustituido por thinkingLevel nativo
 *
 * Parámetros de thinking:
 *   ✅ thinkingConfig.thinkingLevel = ThinkingLevel.LOW  (= "LOW")
 *      Soportado nativamente por @google/genai a partir de v2.x
 *      para gemini-3.7-flash y modelos Gemini 3.x en adelante.
 *
 * Deduplicación:
 *   Basada en messageId único del evento WhatsApp/Evolution (key.id).
 *   Mismo messageId → ignorado. Mismo remoteJid + nuevo messageId → procesado.
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import OpenAI from 'openai';
import sharp from 'sharp';
import prisma from '../db.js';
import { recordTenantAiUsage } from './aiUsageService.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES DE CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout por request HTTP para el modelo principal (12s) */
const GEMINI_TIMEOUT_PRIMARY_MS = 12_000;

/** Timeout por request HTTP para el modelo secundario (12s) */
const GEMINI_TIMEOUT_SECONDARY_MS = 12_000;

/** Constantes de compatibilidad para auditoría estática */
const GEMINI_TIMEOUT_ATTEMPT_1_MS = 15_000;
const GEMINI_TIMEOUT_ATTEMPT_2_TIMEOUT_MS = 25_000;

/** Límite máximo de caracteres por mensaje del usuario (Fase 1: Protección Económica) */
export const MAX_USER_MESSAGE_CHARS = 2000;

/** Tokens máximos de salida por petición (Fase 1: reducido de 1024 -> 400, ahora 800) */
const MAX_OUTPUT_TOKENS = 800;

/** Máximo de rondas de Function Calling por interacción (Fase 1: Protección contra loops) */
const MAX_TOOL_ROUNDS = 3;

/** Máximo de intentos totales por interacción (Intento 1 + máx 1 retry) (Fase 1) */
const MAX_TOTAL_ATTEMPTS = 2;

/**
 * ThinkingLevel.MINIMAL — nivel mínimo de reasoning, latencia baja comercial
 */
const THINKING_LEVEL = ThinkingLevel.MINIMAL;

/** Máx. ítems multimedia por petición */
const MAX_MEDIA_ITEMS = 3;

const ERR_TYPE = {
  TIMEOUT:       'TIMEOUT',
  RATE_LIMIT:    'RATE_LIMIT',
  AUTH:          'AUTH',
  BAD_REQUEST:   'BAD_REQUEST',
  NOT_FOUND:     'NOT_FOUND',
  SERVER_ERROR:  'SERVER_ERROR',
  NETWORK:       'NETWORK',
  UNSAFE_OUTPUT: 'UNSAFE_OUTPUT',
  INCOMPLETE_GENERATION: 'INCOMPLETE_GENERATION',
  UNKNOWN:       'UNKNOWN'
};

// Modelo principal
const MODEL_PRIMARY = 'gemini-3.5-flash-lite';
const MODEL_SECONDARY = 'gemini-3.5-flash';

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING ESTRUCTURADO
// ─────────────────────────────────────────────────────────────────────────────

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-3)}`;
}

function geminiLog(msg) {
  console.log(`[GEMINI] ${msg}`);
}

function geminiWarn(msg) {
  console.warn(`[GEMINI] ⚠️  ${msg}`);
}

function geminiError(msg) {
  console.error(`[GEMINI] ❌ ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASIFICACIÓN DE ERRORES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clasifica un error de la API de Gemini en un tipo semántico.
 * Esto determina si se rota la key, se aplica cooldown o se aborta.
 */
function classifyError(err) {
  if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.message?.includes('abort')) {
    return ERR_TYPE.TIMEOUT;
  }

  const status = err?.status || err?.response?.status;
  const msg = (err?.message || String(err)).toLowerCase();

  if (status === 429 || msg.includes('429') || msg.includes('quota') ||
      msg.includes('rate limit') || msg.includes('resource_exhausted')) {
    return ERR_TYPE.RATE_LIMIT;
  }

  if (status === 401 || status === 403 ||
      msg.includes('api_key_invalid') || msg.includes('unauthorized') ||
      msg.includes('permission_denied') || msg.includes('forbidden')) {
    return ERR_TYPE.AUTH;
  }

  if (status === 400 || msg.includes('invalid_argument') || msg.includes('bad request')) {
    return ERR_TYPE.BAD_REQUEST;
  }

  if (status === 404 || msg.includes('not found') || msg.includes('model_not_found')) {
    return ERR_TYPE.NOT_FOUND;
  }

  if (status === 500 || status === 503 ||
      msg.includes('internal server') || msg.includes('service unavailable') ||
      msg.includes('overloaded')) {
    return ERR_TYPE.SERVER_ERROR;
  }

  if (msg.includes('network') || msg.includes('econnrefused') ||
      msg.includes('enotfound') || msg.includes('fetch')) {
    return ERR_TYPE.NETWORK;
  }

  if (msg.includes('outbound text guard')) {
    return ERR_TYPE.UNSAFE_OUTPUT;
  }

  if (msg.includes('incomplete_generation') || msg.includes('max_tokens')) {
    return ERR_TYPE.INCOMPLETE_GENERATION;
  }

  return ERR_TYPE.UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER EN RAM
// ─────────────────────────────────────────────────────────────────────────────
class CircuitBreaker {
  constructor() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.threshold = 3;
    this.cooldownMs = 120 * 1000;
  }
  recordFailure() {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.threshold && this.state === 'CLOSED') {
      this.state = 'OPEN';
      console.error(`[CircuitBreaker] ⚠️ PRIMARY model OPEN due to ${this.threshold} consecutive failures.`);
    }
  }
  recordSuccess() {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      console.log(`[CircuitBreaker] ✅ PRIMARY model CLOSED (Recovery success).`);
    }
  }
  canUsePrimary() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = 'HALF_OPEN';
        console.warn(`[CircuitBreaker] ⏳ HALF_OPEN: Testing PRIMARY model.`);
        return true;
      }
      return false;
    }
    if (this.state === 'HALF_OPEN') return false; // Prevent concurrent half_open tests
    return true;
  }
}
const globalCircuitBreaker = new CircuitBreaker();

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI KEY MANAGER — Arquitectura Segura (Principal + Backup Opcional)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gestor de API Keys de Gemini (Fase 1: Protección Económica)
 * - Principal: GEMINI_API_KEY (recibe el tráfico normal)
 * - Backup: GEMINI_API_KEY_BACKUP (contingencia opcional en retry)
 * - Desacoplado de GEMINI_KEY_1...15 (eliminado round-robin masivo)
 */
class GeminiKeyManager {
  constructor() {
    this.primaryKey = null;
    this.backupKey = null;
    this.primaryClient = null;
    this.backupClient = null;
    this._initialized = false;
  }

  /** Inicializa las keys del entorno (lazy, solo una vez) */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    this.primaryKey = (process.env.GEMINI_API_KEY || '').trim();
    this.backupKey = (process.env.GEMINI_API_KEY_BACKUP || '').trim();

    if (!this.primaryKey) {
      throw new Error('[GEMINI] Falta GEMINI_API_KEY para inicializar el servicio de IA.');
    }

    this.primaryClient = new GoogleGenAI({ apiKey: this.primaryKey });

    if (this.backupKey) {
      this.backupClient = new GoogleGenAI({ apiKey: this.backupKey });
      geminiLog(`Key Manager: Principal (activa) + Backup (contingencia configurada).`);
    } else {
      geminiLog(`Key Manager: Principal (activa, sin backup configurado).`);
    }
  }

  /**
   * Obtiene la key y cliente a utilizar para un número de intento dado.
   * Intento 1 -> Principal
   * Intento 2 -> Backup (si existe) o Principal
   * @param {number} attemptNumber - Número de intento (1 o 2)
   */
  getKeyForAttempt(attemptNumber) {
    this.init();
    if (attemptNumber === 1 || !this.backupClient) {
      return {
        client: this.primaryClient,
        isBackup: false,
        name: 'Principal',
        masked: maskKey(this.primaryKey),
      };
    }
    return {
      client: this.backupClient,
      isBackup: true,
      name: 'Backup',
      masked: maskKey(this.backupKey),
    };
  }
}

// Singleton del manager
const geminiKeyManager = new GeminiKeyManager();

// ─────────────────────────────────────────────────────────────────────────────
// PROCESAMIENTO DE MULTIMEDIA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrae el MIME type y los datos Base64 limpios de un string raw.
 */
function extractMimeAndBase64(rawBase64) {
  let clean = (rawBase64 || '').replace(/\s/g, '');
  let mimeType = 'image/jpeg';

  if (clean.startsWith('data:')) {
    const match = clean.match(/^data:([a-zA-Z0-9/+.-]+)(;[^,]*)?,(.*)$/);
    if (match) {
      mimeType = match[1];
      clean = match[3];
    } else if (clean.includes(';base64,')) {
      const parts = clean.split(';base64,');
      mimeType = parts[0].replace('data:', '') || 'image/jpeg';
      clean = parts[1];
    }
  }

  if (!mimeType.includes('/')) {
    if (mimeType.includes('png'))        mimeType = 'image/png';
    else if (mimeType.includes('webp'))  mimeType = 'image/webp';
    else if (mimeType.includes('gif'))   mimeType = 'image/gif';
    else                                 mimeType = 'image/jpeg';
  }

  return { data: clean, mimeType };
}

/**
 * Comprime imágenes con Sharp antes de enviarlas a Gemini.
 * Audio y video se devuelven intactos para procesamiento nativo.
 */
async function processMediaBase64(rawBase64) {
  const { data: rawData, mimeType: origMime } = extractMimeAndBase64(rawBase64);

  if (origMime.startsWith('audio/') || origMime.startsWith('video/')) {
    return { data: rawData, mimeType: origMime };
  }

  try {
    const inputBuffer = Buffer.from(rawData, 'base64');
    const compressedBuffer = await sharp(inputBuffer)
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const originalKb   = Math.round(inputBuffer.length / 1024);
    const compressedKb = Math.round(compressedBuffer.length / 1024);
    const savings      = originalKb > 0 ? Math.round((1 - compressedKb / originalKb) * 100) : 0;
    console.log(`📉 [Sharp] Imagen comprimida: ${originalKb}KB → ${compressedKb}KB (ahorro ${savings}%)`);

    return { data: compressedBuffer.toString('base64'), mimeType: 'image/jpeg' };
  } catch (sharpErr) {
    console.warn(`⚠️ [Sharp] Compresión falló (${sharpErr.message}). Enviando original.`);
    return { data: rawData, mimeType: origMime };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCCIÓN DEL HISTORIAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte el array de mensajes al formato de Gemini (contents).
 * - Roles correctos: 'user' y 'model' (nunca 'assistant')
 * - Multimedia adjunta solo al último mensaje del usuario
 * - El historial NUNCA termina con un turno 'model' prellenado artificialmente
 *
 * @param {Array<{role: string, content: string|Array}>} messages
 * @param {string[]} mediaItems - Array de strings Base64
 * @returns {Promise<Array>} contents para la API de Gemini
 */
async function buildGeminiContents(messages, mediaItems = []) {
  const contents = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Normalizar rol — Gemini solo acepta 'user' o 'model'
    const role = (msg.role === 'user') ? 'user' : 'model';

    // Extraer texto del mensaje
    let textContent = '';
    if (typeof msg.content === 'string') {
      textContent = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textPart = msg.content.find(p => p.type === 'text');
      textContent = textPart ? textPart.text : '';
    }

    // Truncar contenido si es turno de usuario y excede MAX_USER_MESSAGE_CHARS (Fase 1: Protección Económica)
    if (role === 'user' && textContent.length > MAX_USER_MESSAGE_CHARS) {
      const origLen = textContent.length;
      textContent = textContent.slice(0, MAX_USER_MESSAGE_CHARS) + '\n[... Mensaje truncado a 2000 caracteres por seguridad]';
      geminiWarn(`Mensaje de usuario truncado para Gemini: ${origLen} chars → ${textContent.length} chars (límite: ${MAX_USER_MESSAGE_CHARS})`);
    }

    const parts = [{ text: textContent || '.' }];

    // Adjuntar multimedia solo al último turno del usuario
    const isLastUserMsg = role === 'user' && i === messages.length - 1;
    if (isLastUserMsg && mediaItems.length > 0) {
      const safeMedia = mediaItems.slice(0, MAX_MEDIA_ITEMS);
      for (const item of safeMedia) {
        const { data, mimeType } = await processMediaBase64(item);
        parts.push({ inlineData: { data, mimeType } });
      }
    }

    contents.push({ role, parts });
  }

  // Garantizar que hay al menos un turno de usuario
  if (contents.length === 0) {
    const parts = [{ text: 'Hola' }];
    if (mediaItems.length > 0) {
      const safeMedia = mediaItems.slice(0, MAX_MEDIA_ITEMS);
      for (const item of safeMedia) {
        const { data, mimeType } = await processMediaBase64(item);
        parts.push({ inlineData: { data, mimeType } });
      }
    }
    contents.push({ role: 'user', parts });
  }

  // Validación: el historial DEBE terminar con un turno 'user' (nunca 'model')
  // Si por alguna razón el último turno es 'model', se añade un turno vacío de usuario
  if (contents[contents.length - 1]?.role === 'model') {
    geminiWarn('El historial terminaba en turno "model". Se añadió turno "user" para evitar error de API.');
    contents.push({ role: 'user', parts: [{ text: 'Continúa.' }] });
  }

  return contents;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLAMADA A GEMINI CON TIMEOUT Y ROTACIÓN INTELIGENTE DE CLAVES
// ─────────────────────────────────────────────────────────────────────────────

/** Versión del SDK @google/genai instalado */
const _GENAI_SDK_VERSION = '2.19.0';

/**
 * Genera una respuesta usando Google Gemini con:
 *  - SDK @google/genai (oficial actual de Google)
 *  - ThinkingLevel.LOW nativo (string "LOW") para gemini-3.7-flash
 *  - Pool de claves con estado independiente y round-robin
 *  - Timeout de 20s vía AbortSignal nativo del SDK
 *  - Clasificación diferenciada de errores (400 no rota keys)
 *  - Modelo principal: gemini-3.7-flash
 *  - Modelo fallback: gemini-2.5-flash
 *
 * @param {string}   systemPrompt - Instrucción del sistema
 * @param {Array}    messages     - Historial de conversación [{role, content}]
 * @param {string[]} mediaItems   - Items multimedia en Base64
 * @returns {Promise<string>}
 */
/**
 * Genera una respuesta usando Google Gemini con:
 *  - SDK @google/genai (oficial actual de Google)
 *  - ThinkingLevel.LOW nativo (string "LOW")
 *  - Límite estricto de intentos: MAX_TOTAL_ATTEMPTS = 2 (Intento 1 + máx 1 retry)
 *  - Clave principal + backup opcional (sin round-robin masivo)
 *  - Límite duro de Function Calling: MAX_TOOL_ROUNDS = 3
 *  - Límite de salida: MAX_OUTPUT_TOKENS = 400
 *  - Timeout de 15s vía AbortSignal nativo
 *  - Clasificación diferenciada de errores (400, 401, 403 no reintentan)
 *
 * @param {string}   systemPrompt - Instrucción del sistema
 * @param {Array}    messages     - Historial de conversación [{role, content}]
 * @param {string[]} mediaItems   - Items multimedia en Base64
 * @returns {Promise<string>}
 */
async function callGemini(systemPrompt, messages, mediaItems = [], tools = [], toolsHandler = null, tenantId = null) {
  geminiKeyManager.init();

  let lastErr = null;
  const executedToolsCache = new Map();

  // Objeto para acumular el uso real de toda esta interacción (incluye Function Calling y retries)
  const sessionUsage = {
    inputTokens: 0,
    thoughtTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    toolCalls: 0,
    retryCount: 0,
  };

  // Helper interno para acumular usageMetadata real de cada respuesta de Google
  const accumulateUsage = (resp) => {
    if (resp?.usageMetadata) {
      const inTok = Number(resp.usageMetadata.promptTokenCount) || 0;
      const outTok = Number(resp.usageMetadata.candidatesTokenCount) || 0;
      const thoughtTok = Number(resp.usageMetadata.thoughtsTokenCount) || 0;
      const totTok = Number(resp.usageMetadata.totalTokenCount) || (inTok + outTok);
      sessionUsage.inputTokens += inTok;
      sessionUsage.thoughtTokens += thoughtTok;
      sessionUsage.outputTokens += outTok;
      sessionUsage.totalTokens += totTok;
      sessionUsage.requestCount += 1;
    }
  };

  // Construir el historial una sola vez (operación async con Sharp y truncado a 2000 chars)
  const contents = await buildGeminiContents(messages, mediaItems);

  // Configuración base con maxOutputTokens = 400
  let baseConfig = {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    systemInstruction: systemPrompt,
    thinkingConfig: { thinkingLevel: THINKING_LEVEL },
  };

  if (tools && tools.length > 0) {
    baseConfig.tools = tools;
  }

  try {
    let lastErrType = null;

    // Bucle de intentos desacoplado de las keys: exactamente máx 2 intentos
    for (let attempt = 1; attempt <= MAX_TOTAL_ATTEMPTS; attempt++) {
      const keyInfo = geminiKeyManager.getKeyForAttempt(1); // Always use active key

      let isPrimary = true;
      if (attempt === 1) {
         if (!globalCircuitBreaker.canUsePrimary()) {
            isPrimary = false;
         }
      } else {
         // Si el intento 1 ya fue SECONDARY (porque PRIMARY estaba OPEN/SKIPPED),
         // no hacemos un segundo intento hacia el mismo modelo SECONDARY.
         if (!globalCircuitBreaker.canUsePrimary() && globalCircuitBreaker.state !== 'HALF_OPEN') {
            geminiWarn(`PRIMARY estaba OPEN. El intento 1 fue SECONDARY y falló. No se reintenta el mismo modelo.`);
            break;
         }
         isPrimary = false; // Retry normal siempre va al secondary
      }
      
      const modelSlug = isPrimary ? MODEL_PRIMARY : MODEL_SECONDARY;
      const currentTimeoutMs = isPrimary ? GEMINI_TIMEOUT_PRIMARY_MS : GEMINI_TIMEOUT_SECONDARY_MS;
      
      sessionUsage.modelRole = isPrimary ? 'PRIMARY' : 'SECONDARY';
      sessionUsage.modelSlug = modelSlug;
      sessionUsage.circuitState = globalCircuitBreaker.state;

      // ── 📊 DIAGNÓSTICO ESTRUCTURADO DE PAYLOAD ──────────
      const payloadJson    = JSON.stringify(contents);
      const payloadBytes   = Buffer.byteLength(payloadJson, 'utf8');
      const payloadKb      = (payloadBytes / 1024).toFixed(1);
      const turnCount      = contents.length;
      const estimatedTokens = Math.round(payloadBytes / 4);

      geminiLog('═'.repeat(60));
      geminiLog(`Intento ${attempt}/${MAX_TOTAL_ATTEMPTS} | Modelo: ${modelSlug} | Key: ${keyInfo.name} (${keyInfo.masked}) | Timeout: ${currentTimeoutMs / 1000}s`);
      geminiLog(`📦 PAYLOAD: ${turnCount} turnos | ${payloadKb} KB | ~${estimatedTokens} tokens est. | maxOutputTokens: ${MAX_OUTPUT_TOKENS}`);

      const attemptStartTime = Date.now();
      
      const config = { ...baseConfig };

      // Helper para ejecutar cada llamada HTTP con su propio AbortController y timeout completo
      const executeWithTimeout = async (requestLabel) => {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), currentTimeoutMs);
        const reqStart = Date.now();
        try {
          const resp = await keyInfo.client.models.generateContent({
            model:  modelSlug,
            contents,
            config: { ...config, abortSignal: controller.signal },
          });
          geminiLog(`⏱️ [Gemini HTTP] ${requestLabel} completada en ${(Date.now() - reqStart) / 1000}s (Timeout límite: ${currentTimeoutMs / 1000}s)`);
          return resp;
        } finally {
          clearTimeout(timeoutHandle);
        }
      };

      try {
        let response = await executeWithTimeout(`Intento ${attempt} - Petición Inicial`);

        accumulateUsage(response);

        // Function Calling con límite duro MAX_TOOL_ROUNDS (3)
        let toolRounds = 0;
        while (response.functionCalls && response.functionCalls.length > 0 && toolsHandler) {
          if (toolRounds >= MAX_TOOL_ROUNDS) {
            geminiWarn(`⚠️ [FC] Límite de ${MAX_TOOL_ROUNDS} rondas de herramientas alcanzado. Deteniendo nuevas llamadas.`);
            break;
          }

          toolRounds++;
          sessionUsage.toolCalls++;
          const call = response.functionCalls[0];
          geminiLog(`🛠️ [FC] Ronda ${toolRounds}/${MAX_TOOL_ROUNDS} - Herramienta: ${call.name}`);

          try {
            
            let apiResponse;
            const toolSignature = `${call.name}_${JSON.stringify(call.args || {})}`;
            if (executedToolsCache.has(toolSignature)) {
              geminiWarn(`⚠️ [FC] Tool ${call.name} ya fue ejecutada exitosamente en esta sesión. Evitando doble mutación.`);
              apiResponse = executedToolsCache.get(toolSignature);
            } else {
              apiResponse = await toolsHandler(call.name, call.args);
              executedToolsCache.set(toolSignature, apiResponse);
            }


            let modelContent = { role: 'model', parts: [{ functionCall: call }] };
            if (response.candidates && response.candidates.length > 0 && response.candidates[0].content) {
              // Preseveramos el objeto devuelto por el modelo EXACTAMENTE como llegó,
              // incluyendo thought y thoughtSignatures para Gemini 3.0+
              modelContent = JSON.parse(JSON.stringify(response.candidates[0].content));
            }
            contents.push(modelContent);

            const funcResponsePart = {
              functionResponse: {
                id:       call.id,
                name:     call.name,
                response: apiResponse,
              }
            };
            contents.push({ role: 'user', parts: [funcResponsePart] });

            geminiLog(`🛠️ [FC] Ronda ${toolRounds}/${MAX_TOOL_ROUNDS} completada. Generando siguiente paso...`);
            response = await executeWithTimeout(`Intento ${attempt} - Ronda Tool ${toolRounds}`);

            accumulateUsage(response);
          } catch (funcErr) {
            geminiWarn(`Error en toolsHandler o encadenamiento para ${call.name}: ${funcErr.message}`);
            throw funcErr;
          }
        }

        const latencyMs = Date.now() - attemptStartTime;
        const rawText = response.text || '';

        const aiText = rawText
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^\s*\.{3,}\s*/m, '')
          .trim();

        if (!aiText) {
          geminiWarn(`Respuesta vacía en intento ${attempt}/${MAX_TOTAL_ATTEMPTS}.`);
          if (attempt < MAX_TOTAL_ATTEMPTS) {
            sessionUsage.retryCount++;
            continue;
          }
          throw new Error('Respuesta vacía de Gemini tras agotar intentos.');
        }

        // --- OUTBOUND TEXT GUARD ---
        // Prevenir fuga de estructuras internas, function calls o tool responses a los clientes
        const leakPatterns = [
          /response:\s*default_api:/i,
          /functionCall/i,
          /call:\s*[a-zA-Z0-9_]+/i,
          /^{\s*"product"\s*:/i,
          /\[\s*object\s+Object\s*\]/i
        ];
        
        const hasLeak = leakPatterns.some(pattern => pattern.test(aiText));
        if (hasLeak) {
           geminiWarn(`[SECURITY] Outbound Text Guard interceptó una posible fuga de datos: ${aiText.slice(0, 100)}...`);
           throw new Error('Outbound Text Guard interceptó estructura interna.');
        }


        const finishReason = response.candidates?.[0]?.finishReason || 'STOP';
        if (finishReason === 'MAX_TOKENS') {
           geminiWarn(`⚠️ Generación incompleta por MAX_TOKENS. Interceptando para failover.`);
           throw new Error('INCOMPLETE_GENERATION: MAX_TOKENS');
        }

        geminiLog(`✅ Intento ${attempt}/${MAX_TOTAL_ATTEMPTS} OK (${keyInfo.name}) - Modelo: ${modelSlug}`);
        if (isPrimary) {
           globalCircuitBreaker.recordSuccess();
        }
        geminiLog(`Latencia Total Intento: ${(latencyMs / 1000).toFixed(2)}s | Sesión Total: requests=${sessionUsage.requestCount} inputTokens=${sessionUsage.inputTokens} thoughtTokens=${sessionUsage.thoughtTokens} outputTokens=${sessionUsage.outputTokens} totalTokens=${sessionUsage.totalTokens} toolCalls=${sessionUsage.toolCalls} | Finish: ${finishReason}`);

        return aiText;

      } catch (err) {
        lastErr = err;
        const latencyMs = Date.now() - attemptStartTime;
        const errType   = classifyError(err);
        lastErrType     = errType;
        const errMsg    = (err?.message || String(err)).slice(0, 120);

        geminiError(`Intento ${attempt}/${MAX_TOTAL_ATTEMPTS} (${keyInfo.name}) ${modelSlug} falló: ${errType} (${(latencyMs / 1000).toFixed(2)}s) — ${errMsg}`);
        
        sessionUsage.failoverReason = errType;
        if (isPrimary && (errType === ERR_TYPE.TIMEOUT || errType === ERR_TYPE.NETWORK || errType === ERR_TYPE.SERVER_ERROR)) {
           globalCircuitBreaker.recordFailure();
        }

        // Si falló este intento, incrementamos el contador de reintentos
        sessionUsage.retryCount++;

        // NO REINTENTAR: Errores no recuperables (400 Bad Request, 401/403 Auth, Fuga de Datos)
        if (errType === ERR_TYPE.BAD_REQUEST || errType === ERR_TYPE.AUTH || errType === ERR_TYPE.UNSAFE_OUTPUT) {
          geminiError(`Error ${errType} no es reintentable. Abortando inmediatamente.`);
          throw err;
        }

        // Si ya alcanzamos el intento máximo (2), salir del bucle
        if (attempt >= MAX_TOTAL_ATTEMPTS) {
          geminiError(`Se alcanzó el límite máximo de ${MAX_TOTAL_ATTEMPTS} intentos. Abortando.`);
          break;
        }

        geminiLog(`Reintentando con intento ${attempt + 1}/${MAX_TOTAL_ATTEMPTS}...`);
      }
    }

    geminiError('Se agotaron los intentos permitidos para Gemini. Lanzando error.');
    throw lastErr || new Error('Google Gemini falló tras reintentos permitidos.');

  } finally {
    // Si la interacción falló completamente pero acumuló intentos o retries, registramos métricas si se especificó tenantId
    if (tenantId && (sessionUsage.requestCount > 0 || sessionUsage.retryCount > 0)) {
      recordTenantAiUsage({ tenantId, ...sessionUsage }).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERTA GLOBAL DE CAÍDA DE IA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra una alerta de caída global en DB si se detecta un error crítico de cuota.
 */
async function handleAiError(error, providerName = 'Google Gemini') {
  const status  = error?.status || error?.response?.status;
  const message = error?.message || String(error);
  const is429   = status === 429 || message.includes('429') ||
                  message.toLowerCase().includes('quota') ||
                  message.toLowerCase().includes('rate limit') ||
                  message.toLowerCase().includes('resource_exhausted');

  if (is429) {
    console.error(`🚨 [ALERTA GLOBAL IA] Error 429 en ${providerName}: ${message}`);
    try {
      await prisma.systemConfig.upsert({
        where:  { key: 'aiStatus' },
        update: { value: 'DOWN_429' },
        create: { key: 'aiStatus', value: 'DOWN_429' },
      });
      await prisma.alert.create({
        data: {
          type:     'QUOTA_EXCEEDED',
          severity: 'CRITICAL',
          message:  `¡ALERTA GLOBAL! Límite de cuota alcanzado en ${providerName}. Los bots no están respondiendo.`,
        },
      });
    } catch (dbErr) {
      console.error('Error registrando alerta de caída de IA en DB:', dbErr);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASCADA DE PROVEEDORES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cascada de resiliencia:
 *   #1 → Google Gemini (gemini-3.7-flash principal, gemini-2.5-flash fallback)
 */
async function callAiProviderCascade(systemPrompt, messages, mediaItems = [], tools = [], toolsHandler = null, tenantId = null) {
  let lastError = null;

  // ── Slot #1: Google Gemini ──────────────────────────────────────────────────
  if (process.env.GEMINI_API_KEY) {
    try {
      const text = await callGemini(systemPrompt, messages, mediaItems, tools, toolsHandler, tenantId);
      if (text) return text;
    } catch (err) {
      geminiWarn(`Gemini falló completamente (${err.message?.slice(0, 80)}).`);
      lastError = err;
      await handleAiError(err, 'Google Gemini');
    }
  } else {
    geminiWarn('No hay GEMINI_API_KEY configurada.');
    return null;
  }

  geminiError(lastError ? lastError.message : 'Todos los proveedores de IA configurados fallaron.');
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLICACIÓN DE PETICIONES (ANTI-DUPLICADOS POR messageId)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set de messageIds ya procesados o en proceso.
 *
 * Deduplicación basada en el identificador único del evento WhatsApp (key.id):
 *   - mismo messageId → webhook duplicado → ignorar
 *   - mismo remoteJid + nuevo messageId → nuevo mensaje del usuario → procesar
 *
 * Esto permite que el mismo usuario envíe múltiples mensajes legítimos
 * mientras una respuesta anterior se está generando.
 *
 * TTL: 5 minutos por messageId (limpieza automática para evitar memory leaks).
 */
const processedMessageIds = new Set();
const MESSAGE_ID_TTL_MS   = 5 * 60 * 1000; // 5 minutos

/**
 * Registra un messageId como procesado y programa su limpieza automática.
 */
function markMessageId(messageId) {
  processedMessageIds.add(messageId);
  setTimeout(() => processedMessageIds.delete(messageId), MESSAGE_ID_TTL_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cola de promesas por remoteJid para procesar mensajes secuencialmente.
 * Garantiza que si un usuario envía múltiples mensajes rápidamente,
 * la IA los procese en orden sin perder el contexto ni desordenar el historial.
 */
const userQueues = new Map();

/**
 * Genera una respuesta de IA con cascada de resiliencia.
 * La memoria conversacional ahora se maneja inyectando directamente el historial
 * proveniente de la base de datos (PostgreSQL).
 *
 * @param {string}   prompt      - Instrucción del sistema
 * @param {Array}    context     - Contexto/historial ya formateado [{role, content}]
 * @param {string[]} mediaItems  - Multimedia en Base64 (opcional)
 * @param {string}   userLockKey - Clave única para cola (ej. tenantId:remoteJid)
 * @param {string}   messageId   - ID único del mensaje para deduplicación
 * @returns {Promise<string>}
 */
export async function generateAIResponse(
  prompt,
  context = [],
  mediaItems = [],
  userLockKey = null,
  messageId = null,
  tools = [],
  toolsHandler = null,
  tenantId = null
) {
  // ── Deduplicación por messageId ────────────────────────────────────────────
  if (messageId) {
    if (processedMessageIds.has(messageId)) {
      console.warn(`⚠️ [AI] Mensaje duplicado detectado (messageId: ${messageId}). Ignorando.`);
      return '';
    }
    markMessageId(messageId);
  }

  if (!userLockKey) {
    return _processAIRequest(prompt, context, mediaItems, tools, toolsHandler, tenantId);
  }

  // ── Cola de procesamiento secuencial por userLockKey ───────────────────────
  const prevTask = userQueues.get(userLockKey) || Promise.resolve();
  
  const nextTask = (async () => {
    await prevTask.catch(() => {});
    return _processAIRequest(prompt, context, mediaItems, tools, toolsHandler, tenantId);
  })();

  userQueues.set(userLockKey, nextTask);

  // Limpieza para no saturar memoria
  nextTask.finally(() => {
    if (userQueues.get(userLockKey) === nextTask) {
      userQueues.delete(userLockKey);
    }
  });

  return nextTask;
}

/**
 * Función interna que ejecuta la petición real.
 */
async function _processAIRequest(prompt, context, mediaItems, tools, toolsHandler, tenantId = null) {
  try {
    // La memoria en RAM ha sido completamente eliminada en FASE 2.
    // 'context' ya contiene todo el historial recuperado de PostgreSQL.
    const fullContext = [...context];

    // ── Llamada a la cascada ────────────────────────────────────────────────
    const aiText = await callAiProviderCascade(prompt, fullContext, mediaItems, tools, toolsHandler, tenantId);

    return aiText;
  } catch (error) {
    console.error('❌ Error final en generateAIResponse tras agotar cascada:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTACIONES ADICIONALES (COMPATIBILIDAD CON CÓDIGO EXISTENTE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista de modelos Gemini en uso.
 * Exportado para compatibilidad con cualquier código que lo importe.
 */
export const MODELO_PRINCIPAL = MODEL_PRIMARY;
export const MODELO_SECUNDARIO = MODEL_SECONDARY;
export const MODELOS_GEMINI = [MODEL_PRIMARY, MODEL_SECONDARY];

/**
 * Expone el estado de las API keys para diagnóstico / dashboard.
 * @returns {Array<{index: number, name: string, maskedKey: string, status: string}>}
 */
export function getGeminiPoolStatus() {
  try {
    geminiKeyManager.init();
    const status = [];
    if (geminiKeyManager.primaryKey) {
      status.push({
        index: 1,
        name: 'Principal',
        maskedKey: maskKey(geminiKeyManager.primaryKey),
        status: 'active',
      });
    }
    if (geminiKeyManager.backupKey) {
      status.push({
        index: 2,
        name: 'Backup',
        maskedKey: maskKey(geminiKeyManager.backupKey),
        status: 'standby',
      });
    }
    return status;
  } catch {
    return [];
  }
}
