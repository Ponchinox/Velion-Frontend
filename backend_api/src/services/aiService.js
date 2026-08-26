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

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES DE CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout máximo por petición individual a Gemini (ms) */
const GEMINI_TIMEOUT_MS = 20_000;

/** Tiempo de cooldown al recibir un rate limit 429 (ms) */
const COOLDOWN_RATE_LIMIT_MS = 120_000; // 2 minutos

/** Tiempo de cooldown al recibir un error de servidor 5xx o timeout (ms) */
const COOLDOWN_SERVER_ERROR_MS = 60_000; // 1 minuto

/**
 * ThinkingLevel.LOW = "LOW" — nivel textual nativo soportado por @google/genai v2.x
 * para gemini-3.7-flash. No usar "minimal" (no soportado por Gemini 3.7).
 * Referencia: ThinkingConfig.thinkingLevel enum en genai.d.ts del SDK oficial.
 */
const THINKING_LEVEL = ThinkingLevel.LOW; // = "LOW"

/** Tokens máximos de salida por petición */
const MAX_OUTPUT_TOKENS = 1024;

/** Tamaño máximo del historial por usuario (turnos, no mensajes) */
const MAX_HISTORIAL = 10;

/** Máx. ítems multimedia por petición */
const MAX_MEDIA_ITEMS = 3;

// Estados posibles de una API Key
const KEY_STATUS = {
  ACTIVE:       'active',
  RATE_LIMITED: 'rate_limited',
  AUTH_FAILED:  'auth_failed',
  SERVER_ERROR: 'server_error',
  DISABLED:     'disabled',
};

// Clasificación de tipos de error
const ERR_TYPE = {
  TIMEOUT:       'TIMEOUT',
  RATE_LIMIT:    'RATE_LIMIT',
  AUTH:          'AUTH',
  BAD_REQUEST:   'BAD_REQUEST',
  NOT_FOUND:     'NOT_FOUND',
  SERVER_ERROR:  'SERVER_ERROR',
  NETWORK:       'NETWORK',
  UNKNOWN:       'UNKNOWN',
};

// Modelo principal y fallback
const MODELO_PRINCIPAL = 'gemini-3.6-flash';
const MODELO_FALLBACK  = 'gemini-3.5-flash-lite';

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

  return ERR_TYPE.UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI KEY POOL — Pool de claves con estado independiente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pool de API Keys de Gemini con:
 *  - Estado independiente por key (active / rate_limited / auth_failed / disabled)
 *  - Cooldown automático por key
 *  - Rotación round-robin entre keys disponibles
 *  - Selección inteligente: solo usa keys disponibles
 */
class GeminiKeyPool {
  constructor() {
    /** @type {Array<{rawKey: string, client: GoogleGenAI, index: number, status: string, cooldownUntil: Date|null, failCount: number, lastUsedAt: Date|null}>} */
    this.keys = [];
    this._roundRobinIdx = 0;
    this._initialized = false;
  }

  /**
   * Inicializa el pool con las claves del entorno (lazy, solo una vez).
   * Usa @google/genai (GoogleGenAI) — SDK oficial actual de Google.
   * Fuentes: GEMINI_API_KEY (principal) + GEMINI_KEY_1…GEMINI_KEY_15 (respaldo)
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    const rawKeys = [];
    const main = (process.env.GEMINI_API_KEY || '').trim();
    if (main) rawKeys.push(main);

    for (let i = 1; i <= 15; i++) {
      const k = (process.env[`GEMINI_KEY_${i}`] || '').trim();
      if (k) rawKeys.push(k);
    }

    if (rawKeys.length === 0) {
      throw new Error('[GEMINI] Falta GEMINI_API_KEY o GEMINI_KEY_N para inicializar el pool.');
    }

    // GoogleGenAI = SDK @google/genai (nuevo SDK oficial)
    this.keys = rawKeys.map((rawKey, idx) => ({
      rawKey,
      client: new GoogleGenAI({ apiKey: rawKey }),
      index: idx + 1,
      status: KEY_STATUS.ACTIVE,
      cooldownUntil: null,
      failCount: 0,
      lastUsedAt: null,
    }));

    geminiLog(`Pool inicializado con ${this.keys.length} key(s). SDK: @google/genai v${_GENAI_SDK_VERSION}`);
  }

  /** Devuelve solo las keys actualmente disponibles (activas y sin cooldown vigente) */
  getAvailableKeys() {
    const now = Date.now();
    return this.keys.filter(k => {
      if (k.status === KEY_STATUS.AUTH_FAILED || k.status === KEY_STATUS.DISABLED) return false;
      if (k.cooldownUntil && k.cooldownUntil.getTime() > now) return false;
      // Si estaba en rate_limited/server_error pero el cooldown ya expiró, volver a active
      if (k.status !== KEY_STATUS.ACTIVE && (!k.cooldownUntil || k.cooldownUntil.getTime() <= now)) {
        k.status = KEY_STATUS.ACTIVE;
      }
      return true;
    });
  }

  /** Selecciona la siguiente key disponible en orden round-robin */
  selectNext() {
    const available = this.getAvailableKeys();
    if (available.length === 0) return null;

    // Avanzar el índice round-robin entre las disponibles
    const idx = this._roundRobinIdx % available.length;
    this._roundRobinIdx = (this._roundRobinIdx + 1) % available.length;

    return available[idx];
  }

  /**
   * Aplica consecuencias a una key según el tipo de error que devolvió.
   * @param {object} keyEntry - Entrada del pool
   * @param {string} errType  - Tipo de error (ERR_TYPE)
   */
  penalize(keyEntry, errType) {
    keyEntry.failCount++;

    switch (errType) {
      case ERR_TYPE.TIMEOUT:
      case ERR_TYPE.NETWORK:
        keyEntry.status = KEY_STATUS.SERVER_ERROR;
        keyEntry.cooldownUntil = new Date(Date.now() + COOLDOWN_SERVER_ERROR_MS);
        geminiWarn(`Key #${keyEntry.index} (${maskKey(keyEntry.rawKey)}) → cooldown ${COOLDOWN_SERVER_ERROR_MS / 1000}s por ${errType}`);
        break;

      case ERR_TYPE.RATE_LIMIT:
        keyEntry.status = KEY_STATUS.RATE_LIMITED;
        keyEntry.cooldownUntil = new Date(Date.now() + COOLDOWN_RATE_LIMIT_MS);
        geminiWarn(`Key #${keyEntry.index} (${maskKey(keyEntry.rawKey)}) → cooldown ${COOLDOWN_RATE_LIMIT_MS / 1000}s por RATE_LIMIT`);
        break;

      case ERR_TYPE.AUTH:
        keyEntry.status = KEY_STATUS.AUTH_FAILED;
        keyEntry.cooldownUntil = null;
        geminiError(`Key #${keyEntry.index} (${maskKey(keyEntry.rawKey)}) → AUTH_FAILED — desactivada permanentemente`);
        break;

      case ERR_TYPE.SERVER_ERROR:
        keyEntry.status = KEY_STATUS.SERVER_ERROR;
        keyEntry.cooldownUntil = new Date(Date.now() + COOLDOWN_SERVER_ERROR_MS);
        geminiWarn(`Key #${keyEntry.index} (${maskKey(keyEntry.rawKey)}) → cooldown ${COOLDOWN_SERVER_ERROR_MS / 1000}s por SERVER_ERROR`);
        break;

      case ERR_TYPE.BAD_REQUEST:
        // No es culpa de la key — no penalizar
        break;

      default:
        keyEntry.status = KEY_STATUS.SERVER_ERROR;
        keyEntry.cooldownUntil = new Date(Date.now() + COOLDOWN_SERVER_ERROR_MS);
        geminiWarn(`Key #${keyEntry.index} (${maskKey(keyEntry.rawKey)}) → cooldown ${COOLDOWN_SERVER_ERROR_MS / 1000}s por error desconocido`);
    }
  }

  /** Registra uso exitoso de una key */
  markSuccess(keyEntry) {
    keyEntry.status = KEY_STATUS.ACTIVE;
    keyEntry.failCount = 0;
    keyEntry.cooldownUntil = null;
    keyEntry.lastUsedAt = new Date();
  }

  /** Devuelve estadísticas resumidas para logs */
  stats() {
    const available = this.getAvailableKeys().length;
    return `${available}/${this.keys.length} disponibles`;
  }
}

// Singleton del pool
const geminiPool = new GeminiKeyPool();

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
async function callGemini(systemPrompt, messages, mediaItems = [], tools = [], toolsHandler = null) {
  geminiPool.init();

  const modelos = [MODELO_PRINCIPAL, MODELO_FALLBACK];
  let lastErr = null;

  // Construir el historial una sola vez (operación async con Sharp)
  const contents = await buildGeminiContents(messages, mediaItems);

  for (const modelSlug of modelos) {
    const isMainModel = modelSlug === MODELO_PRINCIPAL;

    // Configuración base — sin temperature, topP, topK, candidateCount
    const config = {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      systemInstruction: systemPrompt,
    };

    if (tools && tools.length > 0) {
      config.tools = tools;
    }

    // thinkingConfig con ThinkingLevel.LOW nativo — solo para modelos que lo soporten
    // ThinkingLevel.LOW = "LOW" está definido en el enum del SDK @google/genai v2.x
    // gemini-3.7-flash soporta thinkingLevel; gemini-2.5-flash usa thinkingBudget (legacy)
    if (isMainModel) {
      config.thinkingConfig = {
        thinkingLevel: THINKING_LEVEL, // ThinkingLevel.LOW = "LOW"
      };
    } else {
      // gemini-2.5-flash: usa thinkingBudget numérico (API anterior)
      config.thinkingConfig = {
        thinkingBudget: 1024,
      };
    }

    // Intentar con cada key disponible para este modelo
    let modelAttempts = 0;
    const maxAttemptsPerModel = Math.max(geminiPool.keys.length, 1);

    while (modelAttempts < maxAttemptsPerModel) {
      modelAttempts++;

      const keyEntry = geminiPool.selectNext();
      if (!keyEntry) {
        geminiError(`No hay keys disponibles para el modelo ${modelSlug}.`);
        break;
      }

      const maskedKey = maskKey(keyEntry.rawKey);
      const availableStats = geminiPool.stats();

      geminiLog('═'.repeat(60));
      geminiLog(`NUEVA PETICIÓN`);
      geminiLog(`Modelo: ${modelSlug} | Thinking: ${isMainModel ? 'LOW (ThinkingLevel.LOW)' : 'budget=1024'} | Timeout: ${GEMINI_TIMEOUT_MS / 1000}s`);
      geminiLog(`Keys disponibles: ${availableStats}`);
      geminiLog(`Key #${keyEntry.index} (${maskedKey}) → iniciando petición`);

      const startTime = Date.now();

      // AbortController para el timeout — el nuevo SDK soporta abortSignal en config
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        // API del nuevo SDK: ai.models.generateContent({ model, contents, config })
        // AbortSignal se pasa directamente en config.abortSignal
        let response = await keyEntry.client.models.generateContent({
          model:    modelSlug,
          contents,
          config:   { ...config, abortSignal: controller.signal },
        });

        // Revisar Function Calling (Uso de Herramientas)
        if (response.functionCalls && response.functionCalls.length > 0 && toolsHandler) {
          const call = response.functionCalls[0];
          geminiLog(`Herramienta invocada por la IA: ${call.name}`);
          
          try {
            const apiResponse = await toolsHandler(call.name, call.args);
            
            // Adjuntar el content completo devuelto por el modelo (preserva thought_signature, functionCall, etc.)
            const modelContent = response.candidates && response.candidates.length > 0 
                ? response.candidates[0].content 
                : { role: 'model', parts: [{ functionCall: call }] };
            contents.push(modelContent);
            
            contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: apiResponse } }] });

            geminiLog(`Ejecución de herramienta completada. Generando respuesta final...`);
            // Volver a llamar a Gemini con los resultados de la función
            response = await keyEntry.client.models.generateContent({
              model:    modelSlug,
              contents,
              config:   { ...config, abortSignal: controller.signal },
            });
          } catch (funcErr) {
            geminiWarn(`Error en toolsHandler para ${call.name}: ${funcErr.message}`);
          }
        }

        clearTimeout(timeoutHandle);

        const latencyMs = Date.now() - startTime;

        // En @google/genai, el texto está en response.text (getter)
        const rawText = response.text || '';

        // Limpiar etiquetas de thinking si las hubiera en el texto de salida
        const aiText = rawText
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^\s*\.{3,}\s*/m, '')
          .trim();

        if (!aiText) {
          geminiWarn(`Key #${keyEntry.index} → respuesta vacía. Intentando siguiente key.`);
          continue;
        }

        // Log de éxito con métricas
        const usageMeta    = response.usageMetadata || {};
        const inputTokens  = usageMeta.promptTokenCount      || '?';
        const outputTokens = usageMeta.candidatesTokenCount  || '?';
        const totalTokens  = usageMeta.totalTokenCount       || '?';
        const finishReason = response.candidates?.[0]?.finishReason || 'STOP';

        geminiLog(`Key #${keyEntry.index} → ✅ OK`);
        geminiLog(`Latencia: ${(latencyMs / 1000).toFixed(2)}s | input=${inputTokens} output=${outputTokens} total=${totalTokens} | FinishReason: ${finishReason}`);

        geminiPool.markSuccess(keyEntry);
        return aiText;

      } catch (err) {
        clearTimeout(timeoutHandle);
        lastErr = err;

        const latencyMs = Date.now() - startTime;
        const errType   = classifyError(err);
        const errMsg    = (err?.message || String(err)).slice(0, 120);

        if (errType === ERR_TYPE.TIMEOUT) {
          geminiError(`Key #${keyEntry.index} → TIMEOUT (${GEMINI_TIMEOUT_MS / 1000}s)`);
        } else {
          geminiError(`Key #${keyEntry.index} → ${errType} después de ${(latencyMs / 1000).toFixed(2)}s — ${errMsg}`);
        }

        // ── REGLA CRÍTICA: BAD_REQUEST (400) no rota keys ──────────────────
        // Un error 400 indica petición mal formada. Cambiar de key no lo soluciona.
        // Abortar inmediatamente sin probar Key #2, Key #3, etc.
        if (errType === ERR_TYPE.BAD_REQUEST) {
          geminiError(`Error 400 BAD_REQUEST — Abortando sin rotar más keys. El problema es la petición.`);
          throw err;
        }

        // NOT_FOUND (404): este modelo slug no existe → pasar al siguiente modelo
        if (errType === ERR_TYPE.NOT_FOUND) {
          geminiWarn(`Modelo '${modelSlug}' no encontrado (404). Pasando al modelo fallback.`);
          break; // salir del while de keys y probar el siguiente modelo
        }

        // Todos los demás errores (AUTH, RATE_LIMIT, SERVER_ERROR, TIMEOUT, NETWORK):
        // penalizar la key y pasar a la siguiente
        geminiPool.penalize(keyEntry, errType);

        if (geminiPool.getAvailableKeys().length === 0) {
          geminiError(`Todas las keys fallaron para el modelo '${modelSlug}'.`);
          break;
        }

        geminiLog(`Intentando siguiente key disponible...`);
      }
    }
  }

  geminiError('Todas las API Keys y modelos de Google Gemini fallaron. Ejecutando fallback.');
  throw lastErr || new Error('Todos los modelos y claves de Google Gemini fallaron.');
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
async function callAiProviderCascade(systemPrompt, messages, mediaItems = [], tools = [], toolsHandler = null) {
  let lastError = null;

  // ── Slot #1: Google Gemini ──────────────────────────────────────────────────
  if (process.env.GEMINI_API_KEY || process.env.GEMINI_KEY_1) {
    try {
      const text = await callGemini(systemPrompt, messages, mediaItems, tools, toolsHandler);
      if (text) return text;
    } catch (err) {
      geminiWarn(`Gemini falló completamente (${err.message?.slice(0, 80)}).`);
      lastError = err;
      await handleAiError(err, 'Google Gemini');
    }
  } else {
    geminiWarn('No hay GEMINI_API_KEY configurada.');
    throw new Error('API Key de Gemini no configurada.');
  }

  throw lastError || new Error('Todos los proveedores de IA configurados fallaron.');
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORIA A CORTO PLAZO (HISTORIAL POR USUARIO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapa de historial en memoria por remoteJid.
 * Almacena roles como 'user' y 'model' para compatibilidad nativa con Gemini.
 * El rol 'model' es el equivalente de 'assistant' en la API de Gemini.
 */
const userMemories = new Map();

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
 * Genera una respuesta de IA con cascada de resiliencia y memoria conversacional.
 *
 * @param {string}   prompt      - Instrucción del sistema
 * @param {Array}    context     - Contexto/historial [{role, content}]
 * @param {string[]} mediaItems  - Multimedia en Base64 (opcional)
 * @param {string}   remoteJid   - ID único del usuario para memoria FIFO (opcional)
 * @param {string}   messageId   - ID único del mensaje WhatsApp/Evolution para deduplicación
 *                                 (key.id de Evolution o wamid de Meta). Si se provee,
 *                                 mensajes con el mismo ID se ignoran automáticamente.
 * @returns {Promise<string>}
 */
export async function generateAIResponse(prompt, context = [], mediaItems = [], remoteJid = null, messageId = null, tools = [], toolsHandler = null) {
  // ── Deduplicación por messageId ────────────────────────────────────────────
  // Se deduplica por el ID único del mensaje.
  if (messageId) {
    if (processedMessageIds.has(messageId)) {
      console.warn(`⚠️ [AI] Mensaje duplicado detectado (messageId: ${messageId}). Ignorando.`);
      return '';
    }
    markMessageId(messageId); // registrar inmediatamente para bloquear reentrada
  }

  if (!remoteJid) {
    return _processAIRequest(prompt, context, mediaItems, null, tools, toolsHandler);
  }

  // ── Cola de procesamiento secuencial por remoteJid ───────────────────────
  // Si llegan varios mensajes legítimos (diferente messageId) del mismo usuario
  // mientras la IA procesa, se encolan para procesarse en orden.
  const prevTask = userQueues.get(remoteJid) || Promise.resolve();
  
  const nextTask = (async () => {
    await prevTask.catch(() => {});
    return _processAIRequest(prompt, context, mediaItems, remoteJid, tools, toolsHandler);
  })();

  userQueues.set(remoteJid, nextTask);

  // Limpieza para no saturar memoria
  nextTask.finally(() => {
    if (userQueues.get(remoteJid) === nextTask) {
      userQueues.delete(remoteJid);
    }
  });

  return nextTask;
}

/**
 * Función interna que ejecuta la petición real.
 */
async function _processAIRequest(prompt, context, mediaItems, remoteJid, tools, toolsHandler) {
  try {
    // ── Historial FIFO en memoria ───────────────────────────────────────────
    // Se obtiene el historial JUSTO ANTES de procesar este mensaje (así incluye los anteriores)
    const history     = remoteJid ? (userMemories.get(remoteJid) || []) : [];
    const fullContext = [...history, ...context];

    // ── Llamada a la cascada ────────────────────────────────────────────────
    const aiText = await callAiProviderCascade(prompt, fullContext, mediaItems, tools, toolsHandler);

    // ── Guardar en memoria (sin Base64 para ahorrar tokens) ─────────────────
    if (remoteJid && aiText) {
      const lastUserMsg    = context.find(m => m.role === 'user') || { content: '' };
      let savedUserContent = '';

      if (typeof lastUserMsg.content === 'string') {
        savedUserContent = lastUserMsg.content;
      } else if (Array.isArray(lastUserMsg.content)) {
        const textPart   = lastUserMsg.content.find(p => p.type === 'text');
        savedUserContent = textPart ? textPart.text : 'Analiza esta multimedia';
      }

      if (mediaItems && mediaItems.length > 0) {
        savedUserContent = `[El usuario envió ${mediaItems.length} archivo(s) multimedia con el texto: "${savedUserContent}"]`;
      }

      const userHistory = userMemories.get(remoteJid) || [];
      // Usar 'model' (no 'assistant') para compatibilidad nativa con Gemini
      userHistory.push({ role: 'user',  content: savedUserContent });
      userHistory.push({ role: 'model', content: aiText });

      while (userHistory.length > MAX_HISTORIAL) {
        userHistory.shift();
      }

      userMemories.set(remoteJid, userHistory);
    }

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
export const MODELOS_GEMINI = [MODELO_PRINCIPAL, MODELO_FALLBACK];

/**
 * Expone el estado del pool de keys para diagnóstico / dashboard.
 * @returns {Array<{index: number, maskedKey: string, status: string, cooldownUntil: Date|null, failCount: number}>}
 */
export function getGeminiPoolStatus() {
  try {
    geminiPool.init();
  } catch {
    return [];
  }
  return geminiPool.keys.map(k => ({
    index:        k.index,
    maskedKey:    maskKey(k.rawKey),
    status:       k.status,
    cooldownUntil: k.cooldownUntil,
    failCount:    k.failCount,
    lastUsedAt:   k.lastUsedAt,
  }));
}
