import prisma from '../db.js';

/**
 * Obtiene todos los flujos del tenant ordenados por fecha de actualización
 */
export async function getFlows(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const flows = await prisma.flow.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' }
    });

    return res.status(200).json(flows);
  } catch (error) {
    console.error('❌ Error al obtener flujos:', error);
    return res.status(500).json({ error: 'Error al recuperar los flujos.' });
  }
}

/**
 * Crea o actualiza un flujo de chatbot visual guardando nodos y aristas como JSON
 */
export async function saveFlow(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id, name, triggerKeyword, nodes, edges, isActive } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }
    if (!name || !triggerKeyword) {
      return res.status(400).json({ error: 'El nombre del flujo y la palabra clave de activación son obligatorios.' });
    }

    let flow;

    if (id) {
      // Verificar pertenencia antes de actualizar
      const existing = await prisma.flow.findFirst({
        where: { id, tenantId }
      });
      if (!existing) {
        return res.status(404).json({ error: 'Flujo no encontrado o no autorizado.' });
      }

      flow = await prisma.flow.update({
        where: { id },
        data: {
          name,
          triggerKeyword,
          nodes: nodes || [],
          edges: edges || [],
          isActive: isActive ?? false
        }
      });
      console.log(`📝 [Flow Controller] Flujo actualizado con éxito: "${name}" (${id})`);
    } else {
      // Crear nuevo flujo
      flow = await prisma.flow.create({
        data: {
          name,
          triggerKeyword,
          nodes: nodes || [],
          edges: edges || [],
          isActive: isActive ?? false,
          tenantId
        }
      });
      console.log(`✨ [Flow Controller] Nuevo flujo creado con éxito: "${name}" (${flow.id})`);
    }

    return res.status(200).json(flow);
  } catch (error) {
    console.error('❌ Error al guardar flujo:', error);
    return res.status(500).json({ error: 'Error al procesar el flujo.' });
  }
}
