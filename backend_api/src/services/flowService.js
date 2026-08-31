import axios from 'axios';
import prisma from '../db.js';
import { sendText as gatewaySendText, sendMedia as gatewaySendMedia } from './whatsappGateway.js';

/**
 * Guarda el mensaje saliente del flujo en la base de datos y lo transmite por WebSockets en tiempo real
 */
async function saveAndEmitOutgoingMessage(customer, text, instance) {
  const cleanPhone = (customer.phone || '').replace(/\D/g, '');

  try {
    let contact = await prisma.contact.findFirst({
      where: {
        tenantId: customer.tenantId,
        phone: cleanPhone
      }
    });

    if (contact) {
      let chat = await prisma.chat.findFirst({
        where: {
          contactId: contact.id,
          tenantId: customer.tenantId
        }
      });

      if (chat) {
        const now = new Date();
        const [savedMsg] = await prisma.$transaction([
          prisma.message.create({
            data: {
              content: text,
              senderRole: 'agent',
              chatId: chat.id,
              tenantId: customer.tenantId
            }
          }),
          prisma.chat.update({
            where: { id: chat.id },
            data: { updatedAt: now }
          })
        ]);

        if (global.io && customer.tenantId) {
          const payload = {
            chatId: chat.id,
            remoteJid: customer.phone,
            text: text,
            type: 'outgoing',
            from: 'business',
            senderRole: 'agent',
            createdAt: savedMsg.createdAt.toISOString(),
            lastMessageAt: savedMsg.createdAt.toISOString(),
            timestamp: savedMsg.createdAt
          };
          global.io.to(`tenant:${customer.tenantId}`).emit('new_whatsapp_message', payload);
        }
      }
    }
  } catch (err) {
    console.error(`⚠️ [Flow Service] Error al guardar/emitir mensaje saliente:`, err.message);
  }
}

/**
 * Envía un mensaje de texto simple a través del Gateway activo del Tenant
 * (Evolution API o Meta Cloud API según configuración en la BD)
 */
async function sendFlowMessage(customer, text, instance) {
  const clientNumber = customer.phone.split('@')[0].replace(/\D/g, '');

  try {
    await gatewaySendText({
      tenantId: customer.tenantId, // El gateway resuelve proveedor desde la BD
      to: clientNumber,
      text,
      isAutomated: true,
      origin: 'flow'
    });
    console.log(`✉️ [Flow Service] Texto enviado a +${clientNumber}: "${text}"`);
    await saveAndEmitOutgoingMessage(customer, text, instance);
  } catch (error) {
    console.error(`❌ [Flow Service] Error al enviar texto a +${clientNumber}:`, error.response?.data || error.message);
  }
}

/**
 * Envía un mensaje multimedia (imagen) a través del Gateway activo del Tenant
 */
async function sendFlowMedia(customer, mediaUrl, caption, instance) {
  const clientNumber = customer.phone.split('@')[0].replace(/\D/g, '');

  if (!mediaUrl) {
    console.warn(`⚠️ [Flow Service] Intento de enviar media sin URL válida.`);
    return;
  }

  try {
    await gatewaySendMedia({
      tenantId: customer.tenantId, // El gateway resuelve proveedor desde la BD
      to: clientNumber,
      url: mediaUrl,
      caption: caption || '',
      isAutomated: true,
      origin: 'flow'
    });
    console.log(`🖼️ [Flow Service] Multimedia enviado a +${clientNumber} (Caption: "${caption}")`);
    await saveAndEmitOutgoingMessage(customer, caption || '[Imagen Adjunta]', instance);
  } catch (error) {
    console.error(`❌ [Flow Service] Error al enviar media a +${clientNumber}:`, error.response?.data || error.message);
  }
}

/**
 * Ejecutor recursivo de nodos (Motor de Ejecución de Flujos)
 * Usa un Set de nodos visitados para detectar y abortar ciclos de forma instantánea
 */
async function runNode(targetNode, activeFlow, customer, instance, visitedNodeIds = new Set()) {
  // 🛡️ Escudo Anti-Ciclo: si este nodo ya fue procesado, es un bucle cerrado
  if (visitedNodeIds.has(targetNode.id)) {
    console.error(`⚠️ [Flow Engine] Ciclo detectado en nodo "${targetNode.id}" del flujo "${activeFlow.name}". Abortando para +${customer.phone}.`);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { currentFlowId: null, currentNodeId: null }
    });
    return;
  }

  // Marcar este nodo como visitado antes de procesar
  visitedNodeIds.add(targetNode.id);

  const nodes = typeof activeFlow.nodes === 'string' ? JSON.parse(activeFlow.nodes) : activeFlow.nodes;
  const edges = typeof activeFlow.edges === 'string' ? JSON.parse(activeFlow.edges) : activeFlow.edges;

  console.log(`🚀 [Flow Engine] Ejecutando nodo: "${targetNode.id}" de tipo: "${targetNode.type}"`);

  // 1. Ejecutar acción según el tipo de nodo
  if (targetNode.type === 'messageNode') {
    await sendFlowMessage(customer, targetNode.data?.label || '', instance);
  } 
  else if (targetNode.type === 'mediaNode') {
    await sendFlowMedia(customer, targetNode.data?.mediaUrl || '', targetNode.data?.label || '', instance);
  } 
  else if (targetNode.type === 'tagNode') {
    const tag = (targetNode.data?.tagName || '').trim();
    if (tag) {
      const currentTags = customer.tags || [];
      if (!currentTags.includes(tag)) {
        const updatedTags = [...currentTags, tag];
        await prisma.customer.update({
          where: { id: customer.id },
          data: { tags: updatedTags }
        });
        customer.tags = updatedTags;
        console.log(`🏷️ [Flow Engine] Etiqueta "${tag}" añadida con éxito a +${customer.phone}`);
      }
    }
  } 
  else if (targetNode.type === 'delayNode') {
    const delaySec = parseInt(targetNode.data?.delaySeconds) || 5;
    console.log(`⏱️ [Flow Engine] Espera de ${delaySec}s iniciada...`);
    await new Promise(r => setTimeout(r, delaySec * 1000));
    console.log(`⏱️ [Flow Engine] Espera de ${delaySec}s finalizada.`);
  }
  else if (targetNode.type === 'handoffNode') {
    console.log(`👥 [Flow Engine] Pausando bot e iniciando transferencia humana para +${customer.phone}`);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { isBotPaused: true, currentFlowId: null, currentNodeId: null }
    });
    await sendFlowMessage(customer, 'Transfiriendo conversación a un agente humano. Por favor, espera un momento...', instance);
    return;
  }
  else if (targetNode.type === 'apiNode') {
    const url = targetNode.data?.apiUrl || '';
    const method = (targetNode.data?.apiMethod || 'GET').toUpperCase();
    const bodyStr = targetNode.data?.apiBody || '';
    if (url) {
      console.log(`🔌 [Flow Engine] Ejecutando petición Webhook: ${method} ${url}`);
      try {
        let parsedBody = null;
        if (bodyStr) {
          try { parsedBody = JSON.parse(bodyStr); } catch { parsedBody = bodyStr; }
        }
        await axios({ url, method, data: method === 'POST' ? parsedBody : undefined, timeout: 5000 });
        console.log(`🔌 [Flow Engine] Webhook ejecutado con éxito.`);
      } catch (apiError) {
        console.error(`❌ [Flow Engine] Error ejecutando Webhook:`, apiError.message);
      }
    }
  }

  // 2. Determinar salidas y siguiente avance
  const outgoingEdges = edges.filter(e => e.source === targetNode.id);

  if (outgoingEdges.length === 0) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { currentFlowId: null, currentNodeId: null }
    });
    console.log(`🎉 [Flow Engine] Flujo finalizado en nodo final "${targetNode.id}"`);
    return;
  }

  // Si es un nodo de condición o posee bifurcaciones (múltiples salidas), frenar y esperar input
  if (targetNode.type === 'conditionNode' || outgoingEdges.length > 1) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { currentFlowId: activeFlow.id, currentNodeId: targetNode.id }
    });
    console.log(`⏳ [Flow Engine] Posicionado en nodo de decisión "${targetNode.id}". Esperando respuesta.`);
    return;
  }

  // Nodos secuenciales de avance automático (una única salida)
  if (outgoingEdges.length === 1) {
    const nextNode = nodes.find(n => n.id === outgoingEdges[0].target);
    if (nextNode) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { currentFlowId: activeFlow.id, currentNodeId: nextNode.id }
      });
      // Propagar el Set de visitados para detectar ciclos en toda la cadena
      await runNode(nextNode, activeFlow, customer, instance, visitedNodeIds);
    }
  }
}

/**
 * Controlador de flujos en la recepción de webhooks de WhatsApp
 */
export async function executeFlowContext(customer, incomingText, instance) {
  const normalizedText = incomingText.trim().toLowerCase();

  // A) ¿ACTIVACIÓN NUEVA POR PALABRA CLAVE?
  const matchingFlow = await prisma.flow.findFirst({
    where: {
      tenantId: customer.tenantId,
      isActive: true,
      triggerKeyword: {
        equals: normalizedText,
        mode: 'insensitive'
      }
    }
  });

  if (matchingFlow) {
    console.log(`🎯 [Flow Engine] Iniciando flujo "${matchingFlow.name}" para +${customer.phone}`);

    const nodes = typeof matchingFlow.nodes === 'string' ? JSON.parse(matchingFlow.nodes) : matchingFlow.nodes;
    const edges = typeof matchingFlow.edges === 'string' ? JSON.parse(matchingFlow.edges) : matchingFlow.edges;

    if (!nodes || nodes.length === 0) return false;

    // Buscar nodo inicial (de tipo input o el que no tiene conexiones de entrada)
    const incomingNodeIds = new Set(edges.map(e => e.target));
    const startNode = nodes.find(n => n.type === 'input' || !incomingNodeIds.has(n.id)) || nodes[0];

    if (startNode) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          currentFlowId: matchingFlow.id,
          currentNodeId: startNode.id
        }
      });

      // Ejecutar recursivamente a partir del nodo inicial con Set de visitados fresco
      await runNode(startNode, matchingFlow, customer, instance, new Set());

      // Re-leer el estado del cliente para verificar si el flujo sigue activo o fue abortado
      const updatedCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
      if (!updatedCustomer?.currentFlowId) {
        // El flujo terminó o fue abortado (ciclo/fin de rama) → ceder el control a la IA
        return false;
      }
      return true;
    }
  }

  // B) ¿CONTINUACIÓN DE FLUJO EXISTENTE?
  if (customer.currentFlowId && customer.currentNodeId) {
    const activeFlow = await prisma.flow.findUnique({
      where: { id: customer.currentFlowId }
    });

    if (!activeFlow || !activeFlow.isActive) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          currentFlowId: null,
          currentNodeId: null
        }
      });
      return false;
    }

    const nodes = typeof activeFlow.nodes === 'string' ? JSON.parse(activeFlow.nodes) : activeFlow.nodes;
    const edges = typeof activeFlow.edges === 'string' ? JSON.parse(activeFlow.edges) : activeFlow.edges;

    // Obtener aristas que parten del nodo actual del cliente
    const outgoingEdges = edges.filter(e => e.source === customer.currentNodeId);

    if (outgoingEdges.length === 0) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          currentFlowId: null,
          currentNodeId: null
        }
      });
      return false;
    }

    // Evaluar y hacer coincidir la respuesta con una arista de salida
    let matchingEdge = null;

    if (outgoingEdges.length === 1 && (!outgoingEdges[0].label || outgoingEdges[0].label.trim() === '')) {
      // Transición simple sin condiciones de etiqueta
      matchingEdge = outgoingEdges[0];
    } else {
      // Buscar coincidencia en etiquetas
      matchingEdge = outgoingEdges.find(e => {
        const edgeLabel = (e.label || '').trim().toLowerCase();
        return edgeLabel === normalizedText || normalizedText.includes(edgeLabel);
      });
    }

    if (matchingEdge) {
      const targetNode = nodes.find(n => n.id === matchingEdge.target);

      if (targetNode) {
        // Ejecutar recursión a partir del nodo destino con Set de visitados fresco
        await runNode(targetNode, activeFlow, customer, instance, new Set());
        return true;
      }
    } else {
      // Enviar recordatorio de opciones válidas si no hay coincidencia
      const validOptions = outgoingEdges.map(e => e.label).filter(Boolean);
      if (validOptions.length > 0) {
        const reminderText = `Opción no válida. Por favor, selecciona una de las siguientes opciones:\n\n` +
          validOptions.map(opt => `👉 *${opt}*`).join('\n');
        
        await sendFlowMessage(customer, reminderText, instance);
        return true;
      }
    }
  }

  return false;
}
