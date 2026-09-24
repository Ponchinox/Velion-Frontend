import fs from 'fs';
import path from 'path';
import prisma from '../db.js';
import { invalidateCatalogCache } from '../services/catalogCacheService.js';

const MEDIA_ROOT = path.resolve('/var/www/velion-media');

/**
 * Destruye un recurso multimedia de forma segura del almacenamiento local (/media/...)
 * con validación estricta de Path Traversal.
 */
async function destroyMediaResource(url) {
  if (!url || typeof url !== 'string') return;

  // Archivo local del VPS (/media/...)
  if (url.includes('/media/')) {
    try {
      const parts = url.split('/media/');
      if (parts.length < 2) return;
      const relPath = parts[1].split('?')[0]; // Descartar querystrings
      const targetPath = path.resolve(MEDIA_ROOT, relPath);

      // Verificación estricta: debe residir estrictamente dentro de MEDIA_ROOT
      if (!targetPath.startsWith(MEDIA_ROOT + path.sep)) {
        console.error(`⚠️ [Security Alert] Path traversal bloqueado al eliminar: ${url} -> ${targetPath}`);
        return;
      }

      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
        console.log(`🗑️ [Local Media Cleanup] Archivo local eliminado con éxito: ${targetPath}`);
      } else {
        console.log(`ℹ️ [Local Media Cleanup] Archivo no existía en disco: ${targetPath}`);
      }
    } catch (err) {
      console.error(`❌ [Local Media Cleanup] Error al eliminar archivo local ${url}:`, err.message);
    }
  }
}

const destroyCloudinaryResource = destroyMediaResource;

/**
 * Limpia los archivos subidos al disco si ocurre un error antes de persistir en base de datos
 */
function cleanupUploadedFiles(req) {
  if (!req.files) return;
  try {
    for (const field of Object.keys(req.files)) {
      for (const file of req.files[field]) {
        const localPath = file.localFullPath;
        if (localPath && fs.existsSync(localPath)) {
          try {
            fs.unlinkSync(localPath);
            console.log(`🧹 [Upload Cleanup] Archivo huérfano limpiado tras error: ${localPath}`);
          } catch (e) {
            console.error(`⚠️ [Upload Cleanup] No se pudo borrar archivo huérfano: ${localPath}`, e.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error during uploaded files cleanup:', err);
  }
}

/**
 * Registra un nuevo producto en la base de datos con portada, galería y video opcional
 */
export async function createProduct(req, res) {
  try {
    const { name, description, price, isAvailable, promotionalPrice, promoStartDate, promoEndDate, type } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      cleanupUploadedFiles(req);
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    if (req.user?.role === 'superadmin' && !req.user?.tenantId) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'El SuperAdmin no administra inventario propio. Inicia sesión en Modo Soporte sobre una empresa.' });
    }

    if (!name || price === undefined) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'Faltan parámetros obligatorios (name, price).' });
    }

    // Validación estricta del tipo de producto
    let finalType = 'PHYSICAL_PRODUCT';
    if (type !== undefined && type !== null && String(type).trim() !== '') {
      const normalizedType = String(type).trim().toUpperCase();
      if (normalizedType !== 'PHYSICAL_PRODUCT' && normalizedType !== 'SERVICE') {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'Tipo de producto no válido. Debe ser PHYSICAL_PRODUCT o SERVICE.' });
      }
      finalType = normalizedType;
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

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'El precio del producto debe ser un número mayor a 0.' });
    }

    let parsedPromoPrice = null;
    if (promotionalPrice !== undefined && promotionalPrice !== '' && promotionalPrice !== 'null' && promotionalPrice !== null) {
      parsedPromoPrice = parseFloat(promotionalPrice);
      if (isNaN(parsedPromoPrice) || parsedPromoPrice <= 0) {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'El precio promocional debe ser mayor a 0.' });
      }
      if (parsedPromoPrice >= parsedPrice) {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'El precio promocional debe ser menor al precio normal.' });
      }
    }

    const parsedPromoStart = (promoStartDate && promoStartDate !== 'null' && promoStartDate !== '') ? new Date(promoStartDate) : null;
    const parsedPromoEnd = (promoEndDate && promoEndDate !== 'null' && promoEndDate !== '') ? new Date(promoEndDate) : null;

    if (parsedPromoStart && isNaN(parsedPromoStart.getTime())) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'Fecha de inicio de promoción no válida.' });
    }
    if (parsedPromoEnd && isNaN(parsedPromoEnd.getTime())) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'Fecha de fin de promoción no válida.' });
    }
    if (parsedPromoStart && parsedPromoEnd && parsedPromoEnd < parsedPromoStart) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la fecha de inicio.' });
    }

    const product = await prisma.product.create({
      data: {
        name,
        description: description || null,
        price: parsedPrice,
        isAvailable: isAvailable !== undefined ? (isAvailable === true || isAvailable === 'true') : true,
        imageUrl,
        images: Array.isArray(images) ? images.slice(0, 4) : [],
        videoUrl,
        promotionalPrice: parsedPromoPrice,
        promoStartDate: parsedPromoStart,
        promoEndDate: parsedPromoEnd,
        type: finalType,
        userId,
      },
    });

    if (req.user?.tenantId) {
      invalidateCatalogCache(req.user.tenantId);
    }

    return res.status(201).json(product);
  } catch (error) {
    cleanupUploadedFiles(req);
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
    let tenantId = req.user?.tenantId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    if (req.user?.role === 'superadmin' && !req.user?.tenantId) {
      return res.json([]);
    }

    // Si tenantId no vino en req.user, resolverlo desde el usuario
    if (!tenantId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });
      tenantId = user?.tenantId;
    }

    const nativeProducts = await prisma.product.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    let externalProducts = [];
    if (tenantId) {
      const externals = await prisma.externalProduct.findMany({
        where: { tenantId },
        include: {
          variants: true,
          integration: {
            select: {
              shopDomain: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      externalProducts = externals.map((ep) => {
        const firstVariant = ep.variants?.[0];
        const minPrice = ep.variants?.length > 0
          ? Math.min(...ep.variants.map((v) => v.price))
          : 0;
        const totalStock = ep.variants?.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0) || 0;
        const rawShopifyId = ep.externalId ? ep.externalId.replace('gid://shopify/Product/', '') : '';
        const adminUrl = ep.integration?.shopDomain && rawShopifyId
          ? `https://${ep.integration.shopDomain}/admin/products/${rawShopifyId}`
          : null;
        const inventoryTracked = totalStock > 0 || !ep.isAvailable;

        return {
          id: ep.id,
          name: ep.title,
          description: ep.description || '',
          price: minPrice || firstVariant?.price || 0,
          isAvailable: ep.isAvailable,
          imageUrl: ep.imageUrl || ep.images?.[0] || null,
          images: ep.images || [],
          type: 'PHYSICAL_PRODUCT',
          source: 'SHOPIFY',
          isExternal: true,
          readOnly: true,
          sku: firstVariant?.sku || null,
          stock: totalStock,
          inventoryTracked,
          variantsCount: ep.variants?.length || 0,
          shopDomain: ep.integration?.shopDomain || null,
          adminUrl,
          createdAt: ep.createdAt,
          updatedAt: ep.updatedAt,
        };
      });
    }

    const allProducts = [
      ...nativeProducts.map((p) => ({ ...p, source: 'VELION', isExternal: false, readOnly: false, inventoryTracked: true })),
      ...externalProducts,
    ];

    return res.json(allProducts);
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

    const formattedProducts = products.map((prod) => {
      let finalType = 'PHYSICAL_PRODUCT';
      if (prod.type !== undefined && prod.type !== null && String(prod.type).trim() !== '') {
        const normalizedType = String(prod.type).trim().toUpperCase();
        if (normalizedType === 'SERVICE') {
          finalType = 'SERVICE';
        }
      }
      return {
        name: String(prod.name || 'Producto sin nombre').trim(),
        description: prod.description ? String(prod.description).trim() : null,
        price: prod.price !== undefined ? parseFloat(prod.price) : 0.0,
        type: finalType,
        isAvailable: prod.isAvailable !== undefined ? (prod.isAvailable === true || prod.isAvailable === 'true') : true,
        imageUrl: prod.imageUrl ? String(prod.imageUrl).trim() : null,
        images: Array.isArray(prod.images) ? prod.images : [],
        videoUrl: prod.videoUrl ? String(prod.videoUrl).trim() : null,
        userId: userId,
      };
    });

    const result = await prisma.product.createMany({
      data: formattedProducts,
      skipDuplicates: false,
    });

    if (req.user?.tenantId) {
      invalidateCatalogCache(req.user.tenantId);
    }

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

    // Proteger productos sincronizados de Shopify (Read-Only)
    const isExternal = await prisma.externalProduct.findUnique({
      where: { id },
      select: { id: true, provider: true },
    });
    if (isExternal) {
      return res.status(403).json({
        error: 'Este producto se administra desde Shopify.',
        code: 'READ_ONLY_EXTERNAL_PRODUCT',
      });
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

    if (req.user?.tenantId) {
      invalidateCatalogCache(req.user.tenantId);
    }

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
      removeVideo,
      type
    } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      cleanupUploadedFiles(req);
      return res.status(401).json({ error: 'Usuario no autenticado o sesión inválida.' });
    }

    // Proteger productos sincronizados de Shopify (Read-Only)
    const isExternal = await prisma.externalProduct.findUnique({
      where: { id },
      select: { id: true, provider: true },
    });
    if (isExternal) {
      cleanupUploadedFiles(req);
      return res.status(403).json({
        error: 'Este producto se administra desde Shopify.',
        code: 'READ_ONLY_EXTERNAL_PRODUCT',
      });
    }

    const currentProduct = await prisma.product.findFirst({
      where: { id, userId },
    });

    if (!currentProduct) {
      cleanupUploadedFiles(req);
      return res.status(404).json({ error: 'Producto no encontrado o no autorizado para su modificación.' });
    }

    const targetPrice = price !== undefined ? parseFloat(price) : currentProduct.price;
    if (price !== undefined && (isNaN(targetPrice) || targetPrice <= 0)) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'El precio del producto debe ser un número mayor a 0.' });
    }

    let parsedPromoPrice = undefined;
    if (promotionalPrice !== undefined) {
      if (promotionalPrice === '' || promotionalPrice === null || promotionalPrice === 'null') {
        parsedPromoPrice = null;
      } else {
        const promoVal = parseFloat(promotionalPrice);
        if (isNaN(promoVal) || promoVal <= 0) {
          cleanupUploadedFiles(req);
          return res.status(400).json({ error: 'El precio promocional debe ser mayor a 0.' });
        }
        if (promoVal >= targetPrice) {
          cleanupUploadedFiles(req);
          return res.status(400).json({ error: 'El precio promocional debe ser menor al precio normal.' });
        }
        parsedPromoPrice = promoVal;
      }
    } else if (price !== undefined && currentProduct.promotionalPrice !== null) {
      if (currentProduct.promotionalPrice >= targetPrice) {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'El precio promocional actual no puede ser mayor o igual al nuevo precio normal.' });
      }
    }

    let effectiveStart = currentProduct.promoStartDate;
    let effectiveEnd = currentProduct.promoEndDate;

    if (promoStartDate !== undefined) {
      effectiveStart = (promoStartDate === '' || promoStartDate === null || promoStartDate === 'null') ? null : new Date(promoStartDate);
      if (effectiveStart && isNaN(effectiveStart.getTime())) {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'Fecha de inicio de promoción no válida.' });
      }
    }
    if (promoEndDate !== undefined) {
      effectiveEnd = (promoEndDate === '' || promoEndDate === null || promoEndDate === 'null') ? null : new Date(promoEndDate);
      if (effectiveEnd && isNaN(effectiveEnd.getTime())) {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'Fecha de fin de promoción no válida.' });
      }
    }

    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      cleanupUploadedFiles(req);
      return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la fecha de inicio.' });
    }

    const dataToUpdate = {
      ...(name && { name }),
      ...(description !== undefined && { description: description || null }),
      ...(price !== undefined && { price: targetPrice }),
      ...(isAvailable !== undefined && { isAvailable: (isAvailable === true || isAvailable === 'true') }),
      ...(promotionalPrice !== undefined && { promotionalPrice: parsedPromoPrice }),
      ...(promoStartDate !== undefined && { promoStartDate: effectiveStart }),
      ...(promoEndDate !== undefined && { promoEndDate: effectiveEnd }),
    };

    if (type !== undefined && type !== null && String(type).trim() !== '') {
      const normalizedType = String(type).trim().toUpperCase();
      if (normalizedType !== 'PHYSICAL_PRODUCT' && normalizedType !== 'SERVICE') {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'Tipo de producto no válido. Debe ser PHYSICAL_PRODUCT o SERVICE.' });
      }
      dataToUpdate.type = normalizedType;
    }

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

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: dataToUpdate,
    });

    if (req.user?.tenantId) {
      invalidateCatalogCache(req.user.tenantId);
    }

    return res.json(updatedProduct);
  } catch (error) {
    cleanupUploadedFiles(req);
    console.error('Error en updateProduct:', error);
    return res.status(500).json({ error: 'Error al modificar el producto en la base de datos.' });
  }
}
