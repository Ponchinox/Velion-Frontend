import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import prisma from '../db.js';

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Registra una alerta de caída global si se detecta un error HTTP 429 (Límite Excedido)
 */
async function handleAiError(error, providerName = 'Google Gemini') {
  const status = error?.status || error?.response?.status;
  const message = error?.message || String(error);
  const is429 = status === 429 || message.includes('429') || message.toLowerCase().includes('quota') || message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('resource_exhausted');

  if (is429) {
    console.error(`🚨 [ALERTA GLOBAL IA] Error 429 Límite de Cuota Excedido en ${providerName}:`, message);
    try {
      await prisma.systemConfig.upsert({
        where: { key: 'aiStatus' },
        update: { value: 'DOWN_429' },
        create: { key: 'aiStatus', value: 'DOWN_429' }
      });
      await prisma.alert.create({
        data: {
          type: 'QUOTA_EXCEEDED',
          severity: 'CRITICAL',
          message: `¡ALERTA GLOBAL! Límite de cuota alcanzado en ${providerName}. Los bots no están respondiendo.`
        }
      });
    } catch (dbErr) {
      console.error('Error registrando alerta de caída de IA en DB:', dbErr);
    }
  }
}

let genAI = null;

/**
 * Inicializa y retorna el cliente de Google Gemini de forma perezosa
 */
function getGeminiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Falta la variable de entorno GEMINI_API_KEY para inicializar Google Gemini.');
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

let openRouterClient = null;

/**
 * Inicializa y retorna el cliente de OpenRouter de forma perezosa
 */
function getOpenRouterClient() {
  if (!openRouterClient) {
    const apiKey = (process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN || 'dummy-key-to-prevent-crash').trim();
    openRouterClient = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://velionsaas.com',
        'X-Title': 'Velion SaaS',
      }
    });
  }
  return openRouterClient;
}

let groqClient = null;

/**
 * Inicializa y retorna el cliente de Groq de forma perezosa y segura
 */
function getGroqClient() {
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: (process.env.GROQ_API_KEY || 'dummy-key-to-prevent-crash').trim(),
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return groqClient;
}

// Memoria a corto plazo (Dieta de Tokens)
const userMemories = new Map();
const MAX_HISTORIAL = 10;

/**
 * Extrae y limpia el string Base64 y su MIME type
 */
function extractMimeAndBase64(rawBase64) {
  let clean = (rawBase64 || '').replace(/\s/g, '');
  let mimeType = 'image/jpeg';

  if (clean.startsWith('data:')) {
    const match = clean.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      clean = match[2];
    } else if (clean.includes(';base64,')) {
      const parts = clean.split(';base64,');
      mimeType = parts[0].replace('data:', '') || 'image/jpeg';
      clean = parts[1];
    }
  }

  // Normalizar mimetypes comunes
  if (mimeType.includes('png')) mimeType = 'image/png';
  else if (mimeType.includes('webp')) mimeType = 'image/webp';
  else if (mimeType.includes('gif')) mimeType = 'image/gif';
  else mimeType = 'image/jpeg';

  return { data: clean, mimeType };
}

/**
 * Ejecuta la llamada al motor principal: Google Gemini Gen 3
 * Soporta texto e imágenes multimodales de forma nativa en alta velocidad.
 */
async function callGemini(systemPrompt, messages, imageBase64 = null) {
  const client = getGeminiClient();
  const GEMINI_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-pro',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash'
  ];

  // Estructurar el historial y contenido para el SDK de Google Generative AI
  const contents = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Gemini roles: 'user' o 'model'
    const isUser = msg.role === 'user';
    const role = isUser ? 'user' : 'model';

    let textContent = '';
    if (typeof msg.content === 'string') {
      textContent = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textPart = msg.content.find(p => p.type === 'text');
      textContent = textPart ? textPart.text : '';
    }

    const parts = [{ text: textContent || 'Analiza esta información' }];

    // Si es el último mensaje del usuario y hay imagen adjunta, incorporar inlineData
    if (isUser && imageBase64 && i === messages.length - 1) {
      const { data, mimeType } = extractMimeAndBase64(imageBase64);
      parts.push({
        inlineData: {
          data,
          mimeType,
        },
      });
    }

    contents.push({ role, parts });
  }

  // Si no había ningún mensaje, crear uno por defecto
  if (contents.length === 0) {
    const parts = [{ text: 'Hola' }];
    if (imageBase64) {
      const { data, mimeType } = extractMimeAndBase64(imageBase64);
      parts.push({
        inlineData: {
          data,
          mimeType,
        },
      });
    }
    contents.push({ role: 'user', parts });
  }

  let lastErr = null;
  for (const modelSlug of GEMINI_MODELS) {
    try {
      const model = client.getGenerativeModel({
        model: modelSlug,
        systemInstruction: systemPrompt,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });

      const result = await model.generateContent({ contents });
      const response = await result.response;
      const rawAiText = response.text() || '';

      const aiText = rawAiText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^\s*\.{3,}\s*/m, '')
        .trim();

      if (aiText) {
        return aiText;
      }
    } catch (err) {
      const errMsg = err?.message || String(err);
      console.warn(`⚡ [Google Gemini] Slug '${modelSlug}' devolvió error (${errMsg.slice(0, 100)}). Probando variante...`);
      lastErr = err;
    }
  }

  throw lastErr || new Error('Todos los slugs de Google Gemini fallaron.');
}

/**
 * Ejecuta la llamada de respaldo secundario: OpenRouter con modelos gratuitos de roca sólida
 * Usado exclusivamente como fallback de texto si Gemini no está disponible.
 */
async function callOpenRouter(systemPrompt, messages) {
  const client = getOpenRouterClient();
  const models = [
    'meta-llama/llama-3.1-8b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      console.log(`🤖 [OpenRouter Fallback] Intentando modelo activo: ${model}...`);
      const formattedMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(msg => ({
          role: msg.role === 'assistant' || msg.role === 'model' ? 'assistant' : 'user',
          content: typeof msg.content === 'string' ? msg.content : (msg.content?.find?.(p => p.type === 'text')?.text || 'Consulta')
        }))
      ];

      const response = await client.chat.completions.create({
        model,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 512,
      });

      const rawAiText = response.choices[0]?.message?.content?.trim() || '';
      const aiText = rawAiText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^\s*\.{3,}\s*/m, '')
        .trim();

      if (aiText) {
        console.log(`✅ [OpenRouter Fallback] Respuesta obtenida exitosamente desde: ${model}`);
        return aiText;
      }
    } catch (err) {
      const errStatus = err?.status || err?.response?.status;
      const errMsg = err?.message || String(err);
      if (errStatus === 404 || errStatus === 503 || errMsg.includes('404') || errMsg.includes('No endpoints')) {
        console.warn(`⚡ [OpenRouter Fallback] Modelo '${model}' devolvió ${errStatus || 'error de cuota'}. Saltando al siguiente...`);
      } else {
        console.warn(`⚠️ [OpenRouter Fallback] Modelo '${model}' falló (${errMsg}). Saltando...`);
      }
      lastError = err;
    }
  }

  throw lastError || new Error('Todos los modelos de OpenRouter en fallback fallaron.');
}

/**
 * Cascada de resiliencia (Failover Chain)
 * 1. Slot #1: Google Gemini (gemini-1.5-flash) - Motor Principal (Texto + Visión Multimodal)
 * 2. Slot #2: OpenRouter (DeepSeek Chat Free) - Fallback Secundario para texto
 */
async function callAiProviderCascade(systemPrompt, messages, imageBase64 = null) {
  let lastError = null;

  // #1: Google Gemini (Motor Principal)
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('🤖 [Google Gemini] Ejecutando petición con gemini-1.5-flash (Texto + Visión)...');
      const text = await callGemini(systemPrompt, messages, imageBase64);
      if (text) {
        console.log('✅ [Google Gemini] Respuesta generada exitosamente.');
        return text;
      }
    } catch (err) {
      console.warn(`⚠️ [Google Gemini] Falló (${err.message}). Conmutando al siguiente proveedor de respaldo...`);
      lastError = err;
      await handleAiError(err, 'Google Gemini');
    }
  } else {
    console.warn('⚠️ GEMINI_API_KEY no configurada en entorno. Saltando a OpenRouter...');
  }

  // #2: OpenRouter (Fallback Secundario para texto)
  const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (openRouterKey) {
    try {
      console.log('🤖 [OpenRouter Fallback] Conmutando a modelos gratuitos de OpenRouter...');
      const text = await callOpenRouter(systemPrompt, messages);
      if (text) {
        console.log('✅ [OpenRouter Fallback] Respuesta obtenida con éxito.');
        return text;
      }
    } catch (err) {
      console.warn(`⚠️ [OpenRouter Fallback] Falló (${err.message}).`);
      lastError = err;
      await handleAiError(err, 'OpenRouter');
    }
  }

  throw lastError || new Error('Todos los proveedores de IA configurados fallaron o no hay claves API válidas.');
}

/**
 * Genera una respuesta de IA utilizando cascada de resiliencia (Failover automático)
 * @param {string} prompt - Prompt de sistema o instrucciones base
 * @param {Array} context - Historial o contexto de la conversación [{ role, content }]
 * @param {string} imageBase64 - Imagen en Base64 para el flujo de visión (opcional)
 * @param {string} remoteJid - ID de usuario único para memoria FIFO (opcional)
 * @param {string} customerPreferences - Resumen de preferencias históricas del cliente en el CRM (opcional)
 * @returns {Promise<string>}
 */
export async function generateAIResponse(prompt, context = [], imageBase64 = null, remoteJid = null, customerPreferences = null) {
  try {
    // visionRules: solo contiene reglas ÚNICAS de esta capa.
    // Las reglas de formato, tono y concisión viven en globalGuardrails (whatsappController)
    // para evitar duplicación de tokens en cada llamada.
    const visionRules = `
REGLA DE VISIÓN Y CULTURA GENERAL:
Si el usuario envía una imagen, usa tu amplio conocimiento general para identificar al personaje, objeto o estilo que aparece en ella ANTES de revisar el inventario. Muestra empatía y reconoce lo que el usuario envió (ej. '¡Genial, es Light Yagami de Death Note!'). Luego revisa el inventario: si tienes ese producto o algo muy relacionado, ofrécelo. Si no, dile amablemente que no contamos con ese artículo e invítalo a ver otras opciones.

REGLA MULTIMEDIA (ETIQUETA [MEDIA: url]):
Está PROHIBIDO usar Markdown para imágenes (![alt](url)) o mostrar URLs visibles en el texto. Si necesitas enviar una imagen por URL directa (no de catálogo), usa SOLO la etiqueta oculta al final: [MEDIA: https://url.jpg]. Esta etiqueta es distinta de [SEND_IMAGE:] que es para productos del catálogo.

REGLA DE SEGURIDAD Y RESPETO:
Si el usuario envía contenido sexual explícito, groserías o actúa de forma agresiva/troll, NO respondas con agresión. Despídete amablemente e incluye al final: [HUMAN_HANDOFF: Lenguaje inapropiado o groserías].

REGLA DE MEMORIA PERMANENTE:
Si el cliente revela información útil para futuras ventas (nombre, talla, preferencias, productos favoritos), incluye al final: [SAVE_MEM: resumen breve]. Ej: [SAVE_MEM: Se llama Carlos, le gustan las skins blancas].`;

    let systemContent = `${prompt}\n\n${visionRules}`;
    if (customerPreferences) {
      systemContent += `\n\nINFORMACIÓN DEL CLIENTE (Memoria a largo plazo): ${customerPreferences}`;
    }

    // Obtener historial de la memoria FIFO
    let history = [];
    if (remoteJid) {
      history = userMemories.get(remoteJid) || [];
    }

    // Unir el historial de memoria con el mensaje actual
    const fullContext = [...history, ...context];

    // Ejecutar llamada a la cascada de proveedores (Google Gemini como Slot #1)
    const aiText = await callAiProviderCascade(systemContent, fullContext, imageBase64);

    // Guardar en el historial de forma optimizada (dieta de tokens sin Base64)
    if (remoteJid && aiText) {
      const lastUserMsg = context.find(m => m.role === 'user') || { content: '' };
      let savedUserContent = '';
      if (typeof lastUserMsg.content === 'string') {
        savedUserContent = lastUserMsg.content;
      } else if (Array.isArray(lastUserMsg.content)) {
        const textPart = lastUserMsg.content.find(p => p.type === 'text');
        savedUserContent = textPart ? textPart.text : 'Analiza esta imagen';
      }

      if (imageBase64) {
        savedUserContent = `[El usuario envió multimedia con el texto: "${savedUserContent}"]`;
      }

      const userHistory = userMemories.get(remoteJid) || [];
      userHistory.push({ role: 'user', content: savedUserContent });
      userHistory.push({ role: 'assistant', content: aiText });

      while (userHistory.length > MAX_HISTORIAL) {
        userHistory.shift();
      }

      userMemories.set(remoteJid, userHistory);
    }

    return aiText;
  } catch (error) {
    console.error('❌ Error final en generateAIResponse tras agotar cascada:', error);
    throw new Error('Fallo al procesar la respuesta de la IA en todos los proveedores.');
  }
}

/**
 * Transcribe un archivo de audio en Base64 utilizando Groq Whisper
 */
export async function transcribeAudio(base64Audio) {
  let tempFilePath = null;
  try {
    // 1. Limpiar prefijo data:audio/... o similar si existe
    let cleanBase64 = base64Audio.replace(/\s/g, '');
    if (cleanBase64.includes(';base64,')) {
      cleanBase64 = cleanBase64.split(';base64,')[1];
    }

    // 2. Convertir el base64 a un buffer
    const audioBuffer = Buffer.from(cleanBase64, 'base64');

    // 3. Crear una ruta temporal dentro de la carpeta segura del proyecto
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    tempFilePath = path.join(tempDir, `audio_${Date.now()}.ogg`);

    // 4. Guardar temporalmente en el disco
    fs.writeFileSync(tempFilePath, audioBuffer);

    console.log(`🎙️ [Whisper Groq] Enviando archivo temporal para transcripción: ${tempFilePath}`);

    // 5. Enviar a la API de Groq Whisper usando el cliente groqClient
    const client = getGroqClient();
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
    });

    return transcription.text || '';
  } catch (error) {
    console.error('❌ Error en transcribeAudio (Whisper Groq):', error);
    await handleAiError(error, 'Groq Cloud');
    throw new Error('Fallo al transcribir el audio con la API de Groq.');
  } finally {
    // 6. Eliminar el archivo temporal del disco
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`🧹 [Whisper Groq] Archivo temporal eliminado: ${tempFilePath}`);
      } catch (unlinkError) {
        console.error('⚠️ No se pudo eliminar el archivo temporal de audio:', unlinkError.message);
      }
    }
  }
}

/**
 * Extrae un fotograma de un video en Base64 en un segundo específico y lo devuelve en Base64
 * @param {string} base64Video - Video codificado en Base64
 * @param {string} captionText - Texto de descripción enviado por el usuario
 * @returns {Promise<string>}
 */
export async function extractFrameFromVideo(base64Video, captionText = '') {
  // 1. Determinar el segundo objetivo utilizando regex
  let targetSecond = null;
  if (captionText) {
    const match = captionText.match(/segundo\s+(\d+)/i);
    if (match && match[1]) {
      targetSecond = parseInt(match[1], 10);
    }
  }

  // Escudo Anti-Saturación: Si no se especificó un segundo explícito, retornar REQUIRE_SECOND de inmediato
  if (targetSecond === null) {
    console.log('🛡️ [Escudo Video] No se detectó palabra clave de segundo en el mensaje. Cancelando descarga/procesamiento.');
    return 'REQUIRE_SECOND';
  }

  let tempVideoPath = null;
  let tempImagePath = null;
  try {
    console.log(`🎬 [FFmpeg] Extrayendo fotograma al segundo: ${targetSecond}`);

    // 2. Limpiar prefijo data:video/... o similar si existe
    let cleanBase64 = base64Video.replace(/\s/g, '');
    if (cleanBase64.includes(';base64,')) {
      cleanBase64 = cleanBase64.split(';base64,')[1];
    }

    // 3. Convertir el base64 a un buffer
    const videoBuffer = Buffer.from(cleanBase64, 'base64');

    // 4. Crear archivos temporales en la carpeta segura del proyecto
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const timestamp = Date.now();
    tempVideoPath = path.join(tempDir, `video_${timestamp}.mp4`);
    tempImagePath = path.join(tempDir, `frame_${timestamp}.jpg`);

    // Guardar el video temporalmente en el disco
    fs.writeFileSync(tempVideoPath, videoBuffer);

    // 5. Ejecutar la extracción del fotograma usando fluent-ffmpeg encapsulado en una Promesa
    await new Promise((resolve, reject) => {
      ffmpeg(tempVideoPath)
        .seekInput(targetSecond)
        .frames(1)
        .output(tempImagePath)
        .on('end', () => {
          console.log('✅ [FFmpeg] Fotograma extraído correctamente.');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ [FFmpeg] Error al extraer fotograma:', err);
          reject(err);
        })
        .run();
    });

    // 6. Leer la imagen generada y convertirla a Base64
    if (!fs.existsSync(tempImagePath)) {
      throw new Error('No se generó la captura de pantalla del video.');
    }
    const imageBuffer = fs.readFileSync(tempImagePath);
    const imageBase64 = imageBuffer.toString('base64');

    return imageBase64;
  } catch (error) {
    console.error('❌ Error en extractFrameFromVideo:', error);
    throw new Error('Fallo al extraer fotograma del video.');
  } finally {
    // 7. Eliminar ambos archivos del disco
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try {
        fs.unlinkSync(tempVideoPath);
        console.log(`🧹 [FFmpeg] Video temporal eliminado: ${tempVideoPath}`);
      } catch (e) {
        console.error('⚠️ No se pudo eliminar el video temporal:', e.message);
      }
    }
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      try {
        fs.unlinkSync(tempImagePath);
        console.log(`🧹 [FFmpeg] Captura temporal eliminada: ${tempImagePath}`);
      } catch (e) {
        console.error('⚠️ No se pudo eliminar la captura temporal:', e.message);
      }
    }
  }
}
