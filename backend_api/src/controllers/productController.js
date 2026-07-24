import prisma from '../db.js';
import cloudinary from '../config/cloudinary.js';

/**
 * Registra un nuevo producto en la base de datos vinculándolo al usuario autenticado
 */
export async function createProduct(req, res) {
  try {
    const { name, description, price, isAvailable, promotionalPrice, promoStartDate, promoEndDate } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Faltan parámetros obligatorios (name, price).' });
    }

    // Obtener la URL de Cloudinary del middleware de Multer
    const imageUrl = req.file?.path || null;

    const parsedPromoPrice = (promotionalPrice !== undefined && promotionalPrice !== '' && promotionalPrice !== 'null' && promotionalPrice !== null) 
      ? parseFloat(promotionalPrice) 
      : null;
    const parsedPromoStart = (promoStartDate && promoStartDate !== 'null') ? new Date(promoStartDate) : null;
    const parsedPromoEnd = (promoEndDate && promoEndDate !== 'null') ? new Date(promoEndDate) : null;

    const product = await prisma.product.create({
      data: {
        name,
        description: description || null,
        price: parseFloat(price),
        isAvailable: isAvailable !== undefined ? (isAvailable === true || isAvailable === 'true') : true,
        imageUrl,
        promotionalPrice: parsedPromoPrice,
        promoStartDate: parsedPromoStart,
        promoEndDate: parsedPromoEnd,
        userId,
      },
    });

    return res.status(201).json(product);
  } catch (error) {
    console.error('🚨 Error al crear producto:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}

/**
 * Obtiene la lista de todos los productos pertenecientes al usuario autenticado
 */
export async function getProducts(req, res) {
  try {
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    const products = await prisma.product.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(products);
  } catch (error) {
    console.error('Error en getProducts:', error);
    // Retornar un array vacío en lugar de error 500 para evitar crash del frontend
    return res.json([]);
  }
}

/**
 * Registra múltiples productos en lote (inserción masiva) para el usuario autenticado
 */
export async function createBulkProducts(req, res) {
  try {
    const { products } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Se requiere un array de productos válido en la propiedad "products".' });
    }

    // Formatear cada producto asegurando la conversión de tipos correcta
    const formattedProducts = products.map((prod) => ({
      name: String(prod.name || 'Producto sin nombre').trim(),
      description: prod.description ? String(prod.description).trim() : null,
      price: prod.price !== undefined ? parseFloat(prod.price) : 0.0,
      isAvailable: prod.isAvailable !== undefined ? (prod.isAvailable === true || prod.isAvailable === 'true') : true,
      imageUrl: prod.imageUrl ? String(prod.imageUrl).trim() : null,
      userId: userId,
    }));

    // Inserción en lote utilizando la funcionalidad nativa de Prisma
    const result = await prisma.product.createMany({
      data: formattedProducts,
      skipDuplicates: false, // Lanzará error si hay colisiones no deseadas, o false para forzar
    });

    return res.status(201).json({
      success: true,
      message: `${result.count} productos importados con éxito.`,
      count: result.count,
    });
  } catch (error) {
    console.error('Error en createBulkProducts:', error);
    return res.status(500).json({ error: 'Error interno al procesar la importación masiva de productos.' });
  }
}

/**
 * Extrae el public_id de un recurso de Cloudinary a partir de su URL completa
 */
function getPublicIdFromUrl(url) {
  if (!url || !url.includes('res.cloudinary.com')) return null;
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    
    let pathPart = parts[1];
    // Remover la versión (ej: v1721111716/)
    if (pathPart.startsWith('v')) {
      const slashIndex = pathPart.indexOf('/');
      if (slashIndex !== -1) {
        pathPart = pathPart.substring(slashIndex + 1);
      }
    }
    
    // Remover la extensión del archivo
    const dotIndex = pathPart.lastIndexOf('.');
    if (dotIndex !== -1) {
      pathPart = pathPart.substring(0, dotIndex);
    }
    
    return pathPart;
  } catch (err) {
    console.error('Error al extraer public_id de Cloudinary:', err);
    return null;
  }
}

/**
 * Elimina un producto de forma segura filtrando por el ID de producto y del usuario
 */
export async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    // 1. Obtener la información del producto antes de borrarlo
    const product = await prisma.product.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado o no autorizado para su eliminación.' });
    }

    // 2. Si tiene una imagen en Cloudinary, eliminarla físicamente de la nube
    if (product.imageUrl) {
      const publicId = getPublicIdFromUrl(product.imageUrl);
      if (publicId) {
        console.log(`[Cloudinary Cleanup] Destruyendo imagen huérfana de Cloudinary: ${publicId}`);
        try {
          await cloudinary.uploader.destroy(publicId);
          console.log('[Cloudinary Cleanup] Imagen destruida en la nube con éxito.');
        } catch (uploadErr) {
          console.error('[Cloudinary Cleanup] Error al destruir imagen en Cloudinary:', uploadErr);
        }
      }
    }

    // 3. Borrar el producto de PostgreSQL
    await prisma.product.delete({
      where: {
        id,
      },
    });

    return res.json({
      success: true,
      message: 'Producto e imagen eliminados con éxito.',
    });
  } catch (error) {
    console.error('Error en deleteProduct:', error);
    return res.status(500).json({ error: 'Error al eliminar el producto de la base de datos.' });
  }
}

/**
 * Modifica los datos de un producto de forma segura y actualiza su imagen en Cloudinary
 */
export async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { name, description, price, isAvailable, promotionalPrice, promoStartDate, promoEndDate } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    // Si se adjunta un nuevo archivo, usar la URL del middleware de Cloudinary
    const imageUrl = req.file?.path || undefined;

    const dataToUpdate = {
      ...(name && { name }),
      ...(description !== undefined && { description: description || null }),
      ...(price !== undefined && { price: parseFloat(price) }),
      ...(isAvailable !== undefined && { isAvailable: (isAvailable === true || isAvailable === 'true') }),
      ...(imageUrl && { imageUrl }),
      ...(promotionalPrice !== undefined && { 
        promotionalPrice: (promotionalPrice === '' || promotionalPrice === null || promotionalPrice === 'null') ? null : parseFloat(promotionalPrice) 
      }),
      ...(promoStartDate !== undefined && { 
        promoStartDate: (promoStartDate === '' || promoStartDate === null || promoStartDate === 'null') ? null : new Date(promoStartDate) 
      }),
      ...(promoEndDate !== undefined && { 
        promoEndDate: (promoEndDate === '' || promoEndDate === null || promoEndDate === 'null') ? null : new Date(promoEndDate) 
      }),
    };

    const result = await prisma.product.updateMany({
      where: {
        id,
        userId,
      },
      data: dataToUpdate,
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Producto no encontrado o no autorizado para su modificación.' });
    }

    // Obtener el registro actualizado completo para retornar al cliente
    const updatedProduct = await prisma.product.findFirst({
      where: { id, userId },
    });

    return res.json(updatedProduct);
  } catch (error) {
    console.error('Error en updateProduct:', error);
    return res.status(500).json({ error: 'Error al modificar el producto en la base de datos.' });
  }
}
