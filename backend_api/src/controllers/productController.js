import prisma from '../db.js';
import cloudinary from '../config/cloudinary.js';

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
 * Destruye un recurso de Cloudinary de forma segura según sea imagen o video
 */
async function destroyCloudinaryResource(url, isVideo = false) {
  if (!url) return;
  const publicId = getPublicIdFromUrl(url);
  if (!publicId) return;

  try {
    const resourceType = isVideo ? 'video' : 'image';
    console.log(`[Cloudinary Cleanup] Eliminando ${resourceType}: ${publicId}`);
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    console.log(`[Cloudinary Cleanup] ${resourceType} eliminado con éxito.`);
  } catch (err) {
    console.error(`[Cloudinary Cleanup] Error al eliminar ${url}:`, err.message);
  }
}

/**
 * Registra un nuevo producto en la base de datos con portada, galería y video opcional
 */
export async function createProduct(req, res) {
  try {
    const { name, description, price, isAvailable, promotionalPrice, promoStartDate, promoEndDate } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    if (req.user?.role === 'superadmin' && !req.user?.tenantId) {
      return res.status(400).json({ error: 'El SuperAdmin no administra inventario propio. Inicia sesión en Modo Soporte sobre una empresa.' });
    }

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Faltan parámetros obligatorios (name, price).' });
    }

    // 1. Imagen principal / portada
    const imageUrl = req.files?.image?.[0]?.path || req.file?.path || req.body.imageUrl || null;

    // 2. Galería de imágenes secundarias (hasta 4 en total)
    let images = [];
    if (req.files?.images && Array.isArray(req.files.images)) {
      images = req.files.images.map(f => f.path);
    } else if (req.body.images) {
      try {
        images = typeof req.body.images === 'string' ? JSON.parse(req.body.images) : req.body.images;
      } catch {
        images = [];
      }
    }

    // 3. Video demostrativo
    const videoUrl = req.files?.video?.[0]?.path || req.body.videoUrl || null;

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
        images: Array.isArray(images) ? images.slice(0, 4) : [],
        videoUrl,
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

    if (req.user?.role === 'superadmin' && !req.user?.tenantId) {
      return res.json([]);
    }

    const products = await prisma.product.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(products);
  } catch (error) {
    console.error('Error en getProducts:', error);
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

    const formattedProducts = products.map((prod) => ({
      name: String(prod.name || 'Producto sin nombre').trim(),
      description: prod.description ? String(prod.description).trim() : null,
      price: prod.price !== undefined ? parseFloat(prod.price) : 0.0,
      isAvailable: prod.isAvailable !== undefined ? (prod.isAvailable === true || prod.isAvailable === 'true') : true,
      imageUrl: prod.imageUrl ? String(prod.imageUrl).trim() : null,
      images: Array.isArray(prod.images) ? prod.images : [],
      videoUrl: prod.videoUrl ? String(prod.videoUrl).trim() : null,
      userId: userId,
    }));

    const result = await prisma.product.createMany({
      data: formattedProducts,
      skipDuplicates: false,
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
 * Elimina un producto y destruye todos sus recursos multimedia en Cloudinary
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
      where: { id, userId },
    });

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado o no autorizado para su eliminación.' });
    }

    // 2. Destruir imagen de portada en Cloudinary
    if (product.imageUrl) {
      await destroyCloudinaryResource(product.imageUrl, false);
    }

    // 3. Destruir todas las imágenes de la galería en Cloudinary
    if (Array.isArray(product.images)) {
      for (const imgUrl of product.images) {
        await destroyCloudinaryResource(imgUrl, false);
      }
    }

    // 4. Destruir video demostrativo en Cloudinary
    if (product.videoUrl) {
      await destroyCloudinaryResource(product.videoUrl, true);
    }

    // 5. Borrar el producto de PostgreSQL
    await prisma.product.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: 'Producto y archivos multimedia eliminados con éxito.',
    });
  } catch (error) {
    console.error('Error en deleteProduct:', error);
    return res.status(500).json({ error: 'Error al eliminar el producto de la base de datos.' });
  }
}

/**
 * Modifica los datos de un producto, actualizando galería de imágenes y video
 */
export async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      isAvailable,
      promotionalPrice,
      promoStartDate,
      promoEndDate,
      existingImages,
      removeImage,
      removeVideo
    } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    const currentProduct = await prisma.product.findFirst({
      where: { id, userId },
    });

    if (!currentProduct) {
      return res.status(404).json({ error: 'Producto no encontrado o no autorizado para su modificación.' });
    }

    const dataToUpdate = {
      ...(name && { name }),
      ...(description !== undefined && { description: description || null }),
      ...(price !== undefined && { price: parseFloat(price) }),
      ...(isAvailable !== undefined && { isAvailable: (isAvailable === true || isAvailable === 'true') }),
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

    // 1. Manejo de Imagen Principal / Portada
    const newMainImage = req.files?.image?.[0]?.path || req.file?.path;
    if (newMainImage) {
      if (currentProduct.imageUrl) {
        await destroyCloudinaryResource(currentProduct.imageUrl, false);
      }
      dataToUpdate.imageUrl = newMainImage;
    } else if (removeImage === 'true' || removeImage === true) {
      if (currentProduct.imageUrl) {
        await destroyCloudinaryResource(currentProduct.imageUrl, false);
      }
      dataToUpdate.imageUrl = null;
    }

    // 2. Manejo de Galería de Imágenes
    let preservedGallery = [];
    if (existingImages !== undefined) {
      try {
        preservedGallery = typeof existingImages === 'string' ? JSON.parse(existingImages) : existingImages;
      } catch {
        preservedGallery = [];
      }
    } else {
      preservedGallery = currentProduct.images || [];
    }

    // Limpiar de Cloudinary las fotos de la galería que fueron removidas por el usuario
    if (Array.isArray(currentProduct.images)) {
      const removedImages = currentProduct.images.filter(img => !preservedGallery.includes(img));
      for (const imgUrl of removedImages) {
        await destroyCloudinaryResource(imgUrl, false);
      }
    }

    // Agregar las nuevas fotos subidas
    const newGalleryFiles = req.files?.images?.map(f => f.path) || [];
    const finalGallery = [...preservedGallery, ...newGalleryFiles].slice(0, 4);
    dataToUpdate.images = finalGallery;

    // 3. Manejo de Video Demostrativo
    const newVideo = req.files?.video?.[0]?.path;
    if (newVideo) {
      if (currentProduct.videoUrl) {
        await destroyCloudinaryResource(currentProduct.videoUrl, true);
      }
      dataToUpdate.videoUrl = newVideo;
    } else if (removeVideo === 'true' || removeVideo === true) {
      if (currentProduct.videoUrl) {
        await destroyCloudinaryResource(currentProduct.videoUrl, true);
      }
      dataToUpdate.videoUrl = null;
    }

    await prisma.product.updateMany({
      where: { id, userId },
      data: dataToUpdate,
    });

    const updatedProduct = await prisma.product.findFirst({
      where: { id, userId },
    });

    return res.json(updatedProduct);
  } catch (error) {
    console.error('Error en updateProduct:', error);
    return res.status(500).json({ error: 'Error al modificar el producto en la base de datos.' });
  }
}
