import { generateAIResponse } from './aiService.js';
import prisma from '../db.js';
import axios from 'axios';

let openaiClient = null;

/**
 * Inicializa y retorna el cliente de OpenAI de forma perezosa
 */
function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('Falta la variable de entorno GITHUB_TOKEN para inicializar GPT-4o-mini.');
    }
    openaiClient = new OpenAI({
      baseURL: 'https://models.inference.ai.azure.com',
      apiKey: process.env.GITHUB_TOKEN,
    });
  }
  return openaiClient;
}

/**
 * Worker en segundo plano que recorre los contactos, reescribe el mensaje con IA,
 * realiza el envío masivo y aplica pausas aleatorias para evitar bloqueos.
 */
export async function processCampaign(campaignId, targetContacts, instance) {
  console.log(`🚀 [Campaign Service] Iniciando procesamiento de campaña ID: ${campaignId}`);
  
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
      console.error(`❌ [Campaign Service] Campaña no encontrada: ${campaignId}`);
      return;
    }

    const client = getOpenAIClient();
    const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    const evoKey = process.env.EVOLUTION_API_KEY || 'A59F9002-9FFF-41CF-8EA6-58AEEB06ED7B';

    const tenant = await prisma.tenant.findUnique({
      where: { id: campaign.tenantId }
    });

    for (const contact of targetContacts) {
      // Re-verificar si la campaña ha sido cancelada o si el status cambió
      const currentCampaign = await prisma.campaign.findUnique({
        where: { id: campaignId }
      });
      if (!currentCampaign || currentCampaign.status === 'failed') {
        console.log(`⏹️ [Campaign Service] Campaña abortada o fallida.`);
        return;
      }

      // --- ESCUDO DE SEGURIDAD DE GRUPOS EN CAMPAÑAS MASIVAS ---
      const isGroupContact = contact.phone.includes('@g.us') || contact.phone.endsWith('@g.us');
      if (isGroupContact && !tenant?.respondInGroups) {
        console.warn(`🛡️ [Campaign Service] Envío a grupo omitido para ${contact.phone} por seguridad (respondInGroups: false).`);
        await prisma.campaignLog.create({
          data: {
            campaignId: campaign.id,
            customerPhone: contact.phone,
            status: 'failed',
            sentMessage: campaign.baseMessage,
            errorMessage: 'Envío a grupos deshabilitado por seguridad'
          }
        });
        continue;
      }

      // --- ESCUDO ANTI-BANEOS: Validar que el número esté registrado en WhatsApp ---
      const cleanPhone = contact.phone.replace(/\D/g, '');
      let numberExists = false;
      
      try {
        console.log(`📡 [Escudo Anti-Baneos] Validando si +${cleanPhone} tiene WhatsApp...`);
        const checkRes = await axios.post(
          `${evoUrl}/instance/onWhatsApp/${instance}`,
          {
            numbers: [cleanPhone]
          },
          {
            headers: {
              apikey: evoKey,
              'Content-Type': 'application/json'
            }
          }
        );

        const result = checkRes.data?.[0];
        if (result && result.exists === true) {
          numberExists = true;
        } else {
          console.warn(`🛡️ [Escudo Anti-Baneos] El número +${cleanPhone} no está registrado en WhatsApp. Omitiendo envío.`);
        }
      } catch (checkErr) {
        console.error(`⚠️ [Escudo Anti-Baneos] Error al consultar onWhatsApp para +${cleanPhone}:`, checkErr.message);
        // Fallback de contingencia: si la API falla o da timeout, permitimos continuar
        numberExists = true; 
      }

      if (!numberExists) {
        // Registrar log de campaña como fallido directamente y saltar
        await prisma.campaignLog.create({
          data: {
            campaignId: campaign.id,
            customerPhone: contact.phone,
            status: 'failed',
            sentMessage: campaign.baseMessage,
            errorMessage: 'Número no registrado en WhatsApp (Verificación onWhatsApp fallida).'
          }
        });
        continue;
      }

      let personalizedMessage = campaign.baseMessage;

      // Generar variación de texto personalizada con IA (Anti-Ban con Failover Cascade)
      try {
        const sysPrompt = 'Eres un redactor de marketing persuasivo y natural. Responde únicamente con el mensaje reescrito final, sin comentarios, saludos adicionales ni etiquetas.';
        const userPrompt = `Reescribe este mensaje promocional de forma natural, manteniendo la intención exacta pero variando ligeramente el saludo y las palabras. Usa el nombre del cliente si es posible: ${contact.name}. Mensaje base: ${campaign.baseMessage}`;
        
        const rewrittenText = await generateAIResponse(sysPrompt, [{ role: 'user', content: userPrompt }]);
        if (rewrittenText) {
          personalizedMessage = rewrittenText;
        }
      } catch (aiError) {
        console.error(`⚠️ [Campaign Service] Error reescribiendo mensaje con IA para +${contact.phone}:`, aiError.message);
        // Fallback de personalización manual básica
        personalizedMessage = campaign.baseMessage
          .replace(/\[Nombre\]/gi, contact.name)
          .replace(/\{Nombre\}/gi, contact.name);
      }

      // Enviar a través de Evolution API
      let success = false;
      let errorMsg = null;

      try {
        if (campaign.media) {
          await axios.post(
            `${evoUrl}/message/sendMedia/${instance}`,
            {
              number: contact.phone,
              mediatype: 'image',
              media: campaign.media,
              caption: personalizedMessage
            },
            {
              headers: {
                apikey: evoKey,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          const cleanPhone = contact.phone.replace(/\D/g, '');
          await axios.post(
            `${evoUrl}/message/sendText/${instance}`,
            {
              number: cleanPhone,
              text: personalizedMessage,
              options: {
                delay: 0
              }
            },
            {
              headers: {
                apikey: evoKey,
                'Content-Type': 'application/json'
              }
            }
          );
        }
        success = true;
        console.log(`✅ [Campaign Service] Mensaje enviado a +${contact.phone}`);
      } catch (evoError) {
        success = false;
        errorMsg = evoError.response?.data?.message || evoError.message;
        console.error(`❌ [Campaign Service] Error al enviar a +${contact.phone}:`, errorMsg);
      }

      // Registrar log de campaña
      await prisma.campaignLog.create({
        data: {
          campaignId: campaign.id,
          customerPhone: contact.phone,
          status: success ? 'sent' : 'failed',
          sentMessage: personalizedMessage,
          errorMessage: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)
        }
      });

      // Calcular retraso aleatorio entre delayMin y delayMax (segundos)
      const delay = Math.floor(Math.random() * (campaign.delayMax - campaign.delayMin + 1) + campaign.delayMin) * 1000;
      console.log(`⏱️ [Campaign Service] Esperando ${delay / 1000}s para evitar footprint de spam...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Marcar campaña como completada
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'completed' }
    });
    console.log(`🎉 [Campaign Service] Campaña finalizada exitosamente: ${campaign.name}`);

  } catch (error) {
    console.error(`❌ [Campaign Service] Error crítico procesando la campaña ${campaignId}:`, error);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'failed' }
    }).catch(() => {});
  }
}
