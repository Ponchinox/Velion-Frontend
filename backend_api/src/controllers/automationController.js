import prisma from '../db.js';

// Flujo por defecto para inicializar nuevos tenants
const DEFAULT_FLOW = {
  nodes: [
    { id: 'n1', type: 'trigger', label: 'Disparador', content: 'Palabra clave: "Hola"', x: 180, y: 120 },
    { id: 'n2', type: 'text', label: 'Mensaje de Texto', content: '¡Hola! ¿En qué te puedo ayudar hoy? 😊', x: 480, y: 60 },
    { id: 'n3', type: 'ai', label: 'Cerebro IA', content: 'Responder con catálogo de productos', x: 480, y: 210 },
    { id: 'n4', type: 'condition', label: 'Condición', content: '¿El cliente confirmó interés?', x: 780, y: 140 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', label: '' },
    { id: 'e2', from: 'n1', to: 'n3', label: '' },
    { id: 'e3', from: 'n2', to: 'n4', label: 'Sí' },
    { id: 'e4', from: 'n3', to: 'n4', label: '' },
  ],
};

/**
 * Obtiene el flujo de automatización (nodos y conexiones) del tenant de la base de datos real
 */
export async function getFlow(req, res) {
  try {
    const tenantId = req.user.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const flow = await prisma.automationFlow.findFirst({
      where: { tenantId },
    });

    if (!flow) {
      // Si no existe, devolvemos el flujo de inicialización por defecto
      return res.json(DEFAULT_FLOW);
    }

    return res.json({
      nodes: flow.nodes,
      edges: flow.edges,
    });
  } catch (error) {
    console.error('Error en getFlow:', error);
    return res.status(500).json({ error: 'Error al obtener el flujo de automatización de la base de datos.' });
  }
}

/**
 * Guarda o actualiza de forma persistente el flujo del tenant en base de datos
 */
export async function saveFlow(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { nodes, edges } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    if (!nodes || !edges) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos (nodes, edges).' });
    }

    // Buscar si el tenant ya posee un flujo de trabajo registrado
    const existingFlow = await prisma.automationFlow.findFirst({
      where: { tenantId },
    });

    if (existingFlow) {
      // Actualizar flujo existente
      await prisma.automationFlow.update({
        where: { id: existingFlow.id },
        data: {
          nodes,
          edges,
        },
      });
    } else {
      // Crear flujo nuevo
      await prisma.automationFlow.create({
        data: {
          name: 'Flujo Principal',
          isActive: true,
          nodes,
          edges,
          tenantId,
        },
      });
    }

    return res.json({
      success: true,
      message: 'Flujo de automatización guardado con éxito en la base de datos.',
    });
  } catch (error) {
    console.error('Error en saveFlow:', error);
    return res.status(500).json({ error: 'Error al guardar el flujo de automatización en la base de datos.' });
  }
}
