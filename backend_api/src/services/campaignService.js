import OpenAI from 'openai';
import { generateAIResponse } from './aiService.js';
import prisma from '../db.js';
import axios from 'axios';
import { sendText as gatewaySendText, sendMedia as gatewaySendMedia, resolveGatewayCtx } from './whatsappGateway.js';
import { evaluateAiBudgetGuard } from './aiBudgetGuardService.js';

let openaiClient = null;

/**
 * Inicializa y retorna el cliente de OpenAI de forma perezosa
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
    const evoKey = process.env.EVOLUTION_API_KEY || '';

    const tenant = await prisma.tenant.findUnique({
      where: { id: campaign.tenantId }
    });

    // Resolver contexto del Gateway una sola vez para toda la campaña
    const gatewayCtx = await resolveGatewayCtx(campaign.tenantId);
    console.log(`[Campaign Service] Proveedor activo para campana: ${gatewayCtx.provider}`);

    // --- INTEGRACIÓN DE FASE 2B: BUDGET GUARD PARA LA CAMPAÑA COMPLETA ---
    const sysPrompt = 'Eres un redactor de marketing persuasivo y experto en WhatsApp. Genera exactamente 3 variaciones naturales, frescas y atractivas del mensaje base proporcionado. Mantén la intención comercial intacta. Usa SIEMPRE la etiqueta [Nombre] donde iría el nombre del cliente. Separa las 3 variaciones usando exactamente esta cadena: "|||". NO agregues viñetas, números, ni saludos adicionales al inicio.';
    const userPrompt = `Mensaje base a reescribir:\n${campaign.baseMessage}`;

    let variations = [campaign.baseMessage]; // Fallback por defecto

    if (tenant?.aiEnabled !== false && tenant?.aiBudgetEnabled !== false) {
      const budgetGuard = await evaluateAiBudgetGuard({
        tenantId: tenant.id,
        tenant: tenant,
        systemPrompt: sysPrompt,
        chatContext: [{ role: 'user', content: userPrompt }],
        hasTools: false
      });

      if (budgetGuard.allowed) {
        try {
          const aiResponse = await generateAIResponse(
            sysPrompt,
            [{ role: 'user', content: userPrompt }],
            [], null, null, [], null, tenant.id
          );
          if (aiResponse && aiResponse.includes('|||')) {
            const splitVars = aiResponse.split('|||').map(v => v.trim()).filter(v => v.length > 0);
            if (splitVars.length > 0) {
              variations = splitVars;
              console.log(`✅ [Campaign Service] Se generaron ${variations.length} variaciones con IA para la campaña.`);
            }
          } else if (aiResponse) {
             variations = [aiResponse.trim()];
          }
        } catch (aiError) {
          console.error(`⚠️ [Campaign Service] Error generando variaciones con IA:`, aiError.message);
        } finally {
          if (budgetGuard.releaseReservation) budgetGuard.releaseReservation();
        }
      } else {
        console.warn(`🛡️ [Campaign Service] Budget Guard bloqueó la IA para la campaña. Motivo: ${budgetGuard.reason}`);
      }
    }

    for (let i = 0; i < targetContacts.length; i++) {
      const contact = targetContacts[i];
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

      // Seleccionar una variación usando round-robin
      const variationIndex = i % variations.length;
      let selectedVariation = variations[variationIndex];

      // Reemplazar marcador [Nombre] por el nombre real del contacto
      personalizedMessage = selectedVariation
        .replace(/\[Nombre\]/gi, contact.name || 'amigo')
        .replace(/\{Nombre\}/gi, contact.name || 'amigo');

      // ─── GATEWAY: Enviar por el proveedor activo del Tenant ───
      let success = false;
      let errorMsg = null;

      try {
        const cleanPhone = contact.phone.replace(/\D/g, '');
        if (campaign.media) {
          await gatewaySendMedia({
            ...gatewayCtx,
            to: cleanPhone,
            url: campaign.media,
            caption: personalizedMessage,
            isAutomated: true,
            origin: 'campaign'
          });
        } else {
          await gatewaySendText({
            ...gatewayCtx,
            to: cleanPhone,
            text: personalizedMessage,
            isAutomated: true,
            origin: 'campaign'
          });
        }
        success = true;
        console.log(`✅ [Campaign Service | ${gatewayCtx.provider}] Mensaje enviado a +${contact.phone}`);
      } catch (sendError) {
        success = false;
        errorMsg = sendError.response?.data?.message || sendError.message;
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
