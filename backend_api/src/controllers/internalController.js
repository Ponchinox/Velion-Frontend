import prisma from '../db.js';

/**
 * Obtiene el inventario completo filtrado por Tenant ID para uso del bot
 */
export async function getBotInventory(req, res) {
  try {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'El parámetro tenantId es requerido.' });
    }

    // Consultar todos los productos pertenecientes a usuarios de este tenant
    const products = await prisma.product.findMany({
      where: {
        user: {
          tenantId: tenantId
        }
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        stock: true,
        imageUrl: true
      }
    });

    return res.json(products);
  } catch (error) {
    console.error('Error en getBotInventory:', error);
    return res.status(500).json({ error: 'Error al recuperar el inventario interno para el bot.' });
  }
}
