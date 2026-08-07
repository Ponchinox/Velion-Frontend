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
async function handleAiError(error, providerName = 'GitHub/Groq') {
  const status = error?.status || error?.response?.status;
  const message = error?.message || String(error);
  const is429 = status === 429 || message.includes('429') || message.toLowerCase().includes('quota') || message.toLowerCase().includes('rate limit');

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

let openRouterClient = null;

/**
 * Inicializa y retorna el cliente de OpenRouter de forma perezosa
 */
function getOpenRouterClient() {
  if (!openRouterClient) {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Falta la variable de entorno OPENROUTER_API_KEY u OPENAI_API_KEY para inicializar OpenRouter.');
    }
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

let openaiClient = null;

/**
 * Inicializa y retorna el cliente de OpenAI / GitHub Models de forma perezosa
 */
function getOpenAIClient() {
  if (!openaiClient) {
    const githubToken = process.env.GITHUB_MODELS_KEY || process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error('Falta la variable de entorno GITHUB_MODELS_KEY o GITHUB_TOKEN para inicializar GPT-4o-mini.');
    }
    openaiClient = new OpenAI({
      baseURL: 'https://models.inference.ai.azure.com',
      apiKey: githubToken,
    });
  }
  return openaiClient;
}

// Cliente OpenAI dedicado para Groq (Visión / Transcripciones)
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || '',
  baseURL: 'https://api.groq.com/openai/v1',
});

// Memoria a corto plazo (Dieta de Tokens)
const userMemories = new Map();
const MAX_HISTORIAL = 10;

/**
 * Cascadas de resiliencia (Fallback Chain / Auto-Failover)
 * Si el proveedor primario falla (ej. Error 429 Límite de Cuota o Caída), conmuta automáticamente al siguiente.
 */
async function callAiProviderCascade(formattedMessages, imageBase64 = null) {
  const providers = [];
  const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  const githubToken = process.env.GITHUB_MODELS_KEY || process.env.GITHUB_TOKEN;

  // #1: Groq Cloud — Proveedor PRIMARIO (confiable, sin límites de 404 de cuota gratuita de terceros)
  // Se posiciona primero para evitar la demora acumulada de múltiples 404s de OpenRouter free tier.
  // MODELO VISUAL: llama-3.2-11b-vision-instruct (reemplaza al deprecado llama-3.2-11b-vision-preview)
  // Si el de 11b tampoco estuviera disponible, usar: llama-3.2-90b-vision-preview
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: 'Groq Cloud (Llama-3.3-70b)',
      getClient: () => groqClient,
      model: imageBase64 ? 'llama-3.2-11b-vision-instruct' : 'llama-3.3-70b-versatile',
    });
  }

  // #2: OpenRouter — Modelos conversacionales puros (sin Chain-of-Thought)
  // NOTA: Se usa deepseek/deepseek-chat:free en lugar de openrouter/free para evitar que el
  // enrutador automático seleccione modelos de razonamiento (ej. DeepSeek-R1) que filtran
  // su cadena de pensamiento (<think>...</think>) en las respuestas al usuario.
  // ADVERTENCIA: Los modelos :free de OpenRouter pueden devolver 404 por límite de cuota.
  // La detección rápida de 404 en el loop los saltará sin demora al siguiente slot.
  if (openRouterKey) {
    providers.push({
      name: 'OpenRouter (DeepSeek Chat Free)',
      getClient: () => getOpenRouterClient(),
      model: 'deepseek/deepseek-chat:free',
    });
    providers.push({
      name: 'OpenRouter (DeepSeek Chat V3 Free)',
      getClient: () => getOpenRouterClient(),
      model: 'deepseek/deepseek-chat-v3-0324:free',
    });
    providers.push({
      name: 'OpenRouter (GPT OSS 120B Free)',
      getClient: () => getOpenRouterClient(),
      model: 'openai/gpt-oss-120b:free',
    });
  }

  // #3: GitHub Models (gpt-4o-mini) como respaldo adicional de último recurso
  if (githubToken) {
    providers.push({
      name: 'GitHub Models (gpt-4o-mini)',
      getClient: () => getOpenAIClient(),
      model: 'gpt-4o-mini',
    });
  }

  if (providers.length === 0) {
    throw new Error('No hay proveedores de IA configurados en el archivo de entorno (.env).');
  }

  let lastError = null;

  for (const provider of providers) {
    try {
      console.log(`🤖 [AI Failover Cascade] Ejecutando petición con proveedor: ${provider.name}...`);
      const client = provider.getClient();

      // Ajustar formato de mensaje si el proveedor no soporta arrays multimodales en texto plano
      let messagesForProvider = formattedMessages;
      if (provider.name.includes('Groq') && !imageBase64) {
        messagesForProvider = formattedMessages.map(msg => {
          if (Array.isArray(msg.content)) {
            const textPart = msg.content.find(p => p.type === 'text');
            return { role: msg.role, content: textPart ? textPart.text : 'Analiza esta información' };
          }
          return msg;
        });
      }

      const response = await client.chat.completions.create({
        model: provider.model,
        messages: messagesForProvider,
        temperature: 0.7,
        max_tokens: 512,
      });

      const rawAiText = response.choices[0]?.message?.content?.trim() || '';
      // ─── FILTRO ANTI-CHAIN-OF-THOUGHT ───
      // Elimina bloques <think>...</think> residuales que algunos modelos de razonamiento
      // pueden filtrar en el output aunque sean supuestamente conversacionales.
      const aiText = rawAiText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^\s*\.{3,}\s*/m, '')
        .trim();
      if (aiText) {
        console.log(`✅ [AI Failover Cascade] Respuesta obtenida exitosamente desde: ${provider.name}`);
        return aiText;
      }
    } catch (err) {
      // Detección rápida de errores conocidos para skip inmediato sin crashear la cascada:
      // - 404/503: modelo free sin cuota (OpenRouter)
      // - 400 + 'decommissioned': modelo dado de baja por el proveedor (ej. Groq vision-preview)
      const errStatus = err?.status || err?.response?.status;
      const errMsg = err?.message || String(err);
      const isDeprecated = errStatus === 400 && (errMsg.includes('decommissioned') || errMsg.includes('no longer supported') || errMsg.includes('deprecated'));
      const isQuotaError = errStatus === 404 || errStatus === 503 || errMsg.includes('404') || errMsg.includes('No endpoints');

      if (isDeprecated) {
        console.warn(`🚨 [AI Failover Cascade] Proveedor '${provider.name}' usa un modelo DEPRECADO (${errMsg.slice(0, 120)}). Saltando al siguiente...`);
      } else if (isQuotaError) {
        console.warn(`⚡ [AI Failover Cascade] Proveedor '${provider.name}' devolveró ${errStatus || 'error de disponibilidad'} (modelo free sin cuota). Saltando al siguiente...`);
      } else {
        console.warn(`⚠️ [AI Failover Cascade] Proveedor '${provider.name}' falló (${errMsg}). Conmutando al siguiente modelo de respaldo...`);
      }
      lastError = err;
      await handleAiError(err, provider.name);
    }
  }

  throw lastError || new Error('Todos los modelos de IA en la cascada de fallos fallaron.');
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

    let formattedMessages = [
      { role: 'system', content: systemContent },
    ];

    // Obtener historial de la memoria FIFO
    let history = [];
    if (remoteJid) {
      history = userMemories.get(remoteJid) || [];
    }

    // Unir el historial de memoria con el mensaje actual
    const fullContext = [...history, ...context];

    if (imageBase64) {
      // Limpiar espacios y saltos de línea del base64
      let cleanBase64 = imageBase64.replace(/\s/g, '');
      if (cleanBase64.startsWith('data:image/')) {
        const match = cleanBase64.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
        if (match) {
          cleanBase64 = match[1];
        }
      }

      // Buscar el último mensaje del usuario en el contexto completo
      const userMessageIndex = fullContext.findLastIndex(m => m.role === 'user');
      
      const visionContent = [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanBase64}` } }
      ];

      // Mapear el contexto completo para inyectar visión en el último mensaje de usuario
      const mappedContext = fullContext.map((msg, index) => {
        if (index === userMessageIndex) {
          const textContent = typeof msg.content === 'string' ? msg.content : 'Analiza esta imagen';
          return {
            role: 'user',
            content: [
              { type: 'text', text: textContent },
              ...visionContent
            ]
          };
        }
        return msg;
      });

      // Si no había ningún mensaje del usuario en el contexto completo, creamos uno nuevo al final
      if (userMessageIndex === -1) {
        mappedContext.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Analiza esta imagen' },
            ...visionContent
          ]
        });
      }

      formattedMessages.push(...mappedContext);
    } else {
      formattedMessages.push(...fullContext);
    }

    // Ejecutar llamada a la cascada de proveedores (Failover automático)
    const aiText = await callAiProviderCascade(formattedMessages, imageBase64);

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
    const transcription = await groqClient.audio.transcriptions.create({
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

