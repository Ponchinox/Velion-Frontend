import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  X,
  UploadSimple,
  WarningCircle,
  ArrowsClockwise,
  CheckCircle,
  Eye,
  Trash,
  MagnifyingGlass,
  PencilSimple,
  CaretLeft,
  CaretRight,
  Package,
  Images,
  VideoCamera,
  FilmStrip,
  PlayCircle,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';
import ConfirmModal from '../components/ui/ConfirmModal';
import Modal from '../components/ui/Modal';

/* ─── Utilidad: Compresión ligera de imágenes en el cliente (Canvas) ─── */
async function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
  if (!file || !file.type.startsWith('image/') || file.size < 80 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = event.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/* ─── Utilidad: Validación de video en el cliente (15MB y 45s) ─── */
async function validateVideoFile(file) {
  const MAX_SIZE_MB = 15;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return {
      valid: false,
      error: `El video pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB. El tamaño máximo permitido es de ${MAX_SIZE_MB} MB.`,
    };
  }

  const MAX_DURATION_SEC = 45;
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      const duration = video.duration;
      if (duration > MAX_DURATION_SEC) {
        resolve({
          valid: false,
          error: `El video dura ${Math.round(duration)} segundos. La duración máxima permitida es de ${MAX_DURATION_SEC} segundos.`,
        });
      } else {
        resolve({
          valid: true,
          duration: Math.round(duration),
          sizeMb: (file.size / (1024 * 1024)).toFixed(1),
        });
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ valid: true, duration: null, sizeMb: (file.size / (1024 * 1024)).toFixed(1) });
    };

    video.src = objectUrl;
  });
}

/* ─── Skeleton de Carga (Data Table Compacta) ─── */
function ProductSkeleton() {
  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card animate-pulse">
      <div className="h-12 bg-line/45 border-b border-line w-full flex items-center justify-between px-6">
        <div className="h-4 bg-line rounded w-32" />
        <div className="h-4 bg-line rounded w-48" />
      </div>
      <div className="divide-y divide-line">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="flex items-center gap-6 px-6 py-4">
            <div className="w-10 h-10 bg-line rounded-md" />
            <div className="h-4 bg-line rounded w-1/4" />
            <div className="h-4 bg-line rounded w-1/3" />
            <div className="h-4 bg-line rounded w-16 ml-auto" />
            <div className="h-4 bg-line rounded w-12" />
            <div className="h-8 bg-line rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Componente Principal ─── */
export default function Products() {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);
  const [productToDelete, setProductToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Referencia para la carga de archivos Excel
  const fileInputRef = useRef(null);

  // Estados de Búsqueda y Paginación
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Estados del modal y formulario
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);

  // Multimedia: Imagen Principal / Portada
  const [mainImageFile, setMainImageFile] = useState(null);
  const [mainImagePreview, setMainImagePreview] = useState(null);
  const [removeMainImage, setRemoveMainImage] = useState(false);

  // Multimedia: Galería Secundaria (hasta 3 fotos adicionales)
  const [galleryItems, setGalleryItems] = useState([]); // [{ id, file?, previewUrl, isExisting }]
  const [isCompressingImages, setIsCompressingImages] = useState(false);

  // Multimedia: Video Demostrativo (hasta 15MB, 45s)
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [removeVideo, setRemoveVideo] = useState(false);
  const [videoMeta, setVideoMeta] = useState(null);
  const [isValidatingVideo, setIsValidatingVideo] = useState(false);

  const [saving, setSaving] = useState(false);

  // Estados de Promociones Temporales
  const [hasPromo, setHasPromo] = useState(false);
  const [promotionalPrice, setPromotionalPrice] = useState('');
  const [promoStartDate, setPromoStartDate] = useState('');
  const [promoEndDate, setPromoEndDate] = useState('');

  const { setIsDirty } = useUnsavedChanges();
  const setIsFormDirty = setIsDirty;

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Cargar productos desde el backend
  const loadProducts = async () => {
    setIsLoading(true);
    setErrorMsg('');
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch(`${API_BASE_URL}/api/products`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('No se pudieron obtener los productos.');
      }

      const data = await response.json();
      setProducts(data || []);
    } catch (error) {
      console.error(error);
      setErrorMsg('No se pudo conectar con el servidor de inventario.');
      showToast('Error al conectar con la base de datos de productos.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const filteredProducts = products.filter((prod) =>
    prod.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalItems = filteredProducts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);

  // Manejar adición unificada de fotos
  const handleAddUnifiedImages = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const currentMainPreview = mainImagePreview;
    const currentGalleryCount = galleryItems.length;
    const availableSlots = 4 - (currentMainPreview ? 1 : 0) - currentGalleryCount;

    if (availableSlots <= 0) {
      showToast('Máximo 4 fotos permitidas en total.', 'error');
      return;
    }

    const filesToAdd = files.slice(0, availableSlots);
    setIsCompressingImages(true);

    try {
      let firstNewFile = filesToAdd[0];
      let restNewFiles = filesToAdd.slice(1);
      let newGalleryFiles = [];

      if (!currentMainPreview) {
        const compressedMain = await compressImageFile(firstNewFile);
        setMainImageFile(compressedMain);
        setMainImagePreview(URL.createObjectURL(compressedMain));
        setRemoveMainImage(false);
        newGalleryFiles = restNewFiles;
      } else {
        newGalleryFiles = filesToAdd;
      }

      if (newGalleryFiles.length > 0) {
        const newItems = await Promise.all(
          newGalleryFiles.map(async (file) => {
            const compressed = await compressImageFile(file);
            return {
              id: `new_${Date.now()}_${Math.random()}`,
              file: compressed,
              previewUrl: URL.createObjectURL(compressed),
              isExisting: false,
            };
          })
        );
        setGalleryItems((prev) => [...prev, ...newItems]);
      }

      setIsFormDirty(true);
      if (files.length > availableSlots) {
        showToast(`Se añadieron las fotos que cabían. Límite de 4 alcanzado.`, 'info');
      }
    } catch (err) {
      console.error('Error al procesar imágenes:', err);
      showToast('Error al procesar las imágenes.', 'error');
    } finally {
      setIsCompressingImages(false);
    }
  };

  const handleRemoveUnifiedImage = (index) => {
    if (mainImagePreview) {
      if (index === 0) {
        setMainImageFile(null);
        setMainImagePreview(null);
        setRemoveMainImage(true);
      } else {
        setGalleryItems((prev) => prev.filter((_, i) => i !== index - 1));
      }
    } else {
      setGalleryItems((prev) => prev.filter((_, i) => i !== index));
    }
    setIsFormDirty(true);
  };

  // Manejar selección de Video Demostrativo
  const handleVideoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsValidatingVideo(true);
    try {
      const validation = await validateVideoFile(file);
      if (!validation.valid) {
        showToast(validation.error, 'error');
        e.target.value = '';
        return;
      }

      setVideoFile(file);
      setVideoPreview(URL.createObjectURL(file));
      setRemoveVideo(false);
      setVideoMeta({ duration: validation.duration, sizeMb: validation.sizeMb });
      setIsFormDirty(true);
      showToast(`Video validado: ${validation.sizeMb} MB${validation.duration ? ` (${validation.duration}s)` : ''}`);
    } catch (err) {
      console.error('Error validando video:', err);
      showToast('No se pudo validar el video seleccionado.', 'error');
    } finally {
      setIsValidatingVideo(false);
    }
  };

  const handleRemoveVideo = () => {
    setVideoFile(null);
    setVideoPreview(null);
    setRemoveVideo(true);
    setVideoMeta(null);
    setIsFormDirty(true);
  };

  const handleEdit = (prod) => {
    try {
      setEditingProduct(prod);
      setName(prod.name || '');
      setDescription(prod.description || '');
      setPrice(prod.price || '');
      setIsAvailable(prod.isAvailable !== false);
      
      setMainImageFile(null);
      setMainImagePreview(prod.imageUrl || null);
      setRemoveMainImage(false);

      let parsedImages = [];
      if (prod.images) {
        if (Array.isArray(prod.images)) {
          parsedImages = prod.images;
        } else if (typeof prod.images === 'string') {
          try {
            parsedImages = JSON.parse(prod.images);
          } catch (e) {
            console.error('Error parsing prod.images:', e);
          }
        }
      }

      if (Array.isArray(parsedImages)) {
        setGalleryItems(parsedImages.map((url, i) => ({
          id: `existing_${i}_${Date.now()}`,
          previewUrl: url,
          isExisting: true
        })));
      } else {
        setGalleryItems([]);
      }

      setVideoFile(null);
      setVideoPreview(prod.videoUrl || null);
      setRemoveVideo(false);
      setVideoMeta(null);

      setHasPromo(prod.promotionalPrice !== null && prod.promotionalPrice !== undefined);
      setPromotionalPrice(prod.promotionalPrice || '');
      
      const safeSplit = (dateStr) => {
        if (!dateStr) return '';
        if (typeof dateStr.split === 'function') return dateStr.split('T')[0];
        if (dateStr instanceof Date) return dateStr.toISOString().split('T')[0];
        return '';
      };
      setPromoStartDate(safeSplit(prod.promoStartDate));
      setPromoEndDate(safeSplit(prod.promoEndDate));

      setIsFormDirty(false);
      setShowModal(true);
    } catch (error) {
      console.error('Error in handleEdit:', error);
      showToast('Error al cargar datos del producto para edición.', 'error');
    }
  };

  // Limpiar estados y cerrar modal de producto
  const closeModal = () => {
    setShowModal(false);
    setEditingProduct(null);
    setName('');
    setDescription('');
    setPrice('');
    setIsAvailable(true);
    setMainImageFile(null);
    setMainImagePreview(null);
    setRemoveMainImage(false);
    setGalleryItems([]);
    setVideoFile(null);
    setVideoPreview(null);
    setRemoveVideo(false);
    setVideoMeta(null);
    setHasPromo(false);
    setPromotionalPrice('');
    setPromoStartDate('');
    setPromoEndDate('');
    setIsFormDirty(false);
  };

  // Enviar formulario (FormData) para creación o actualización
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || price === '') return;

    setSaving(true);
    const token = localStorage.getItem('sa_token');
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('price', price);
    formData.append('isAvailable', isAvailable);

    // 1. Imagen Principal
    if (mainImageFile) {
      formData.append('image', mainImageFile);
    } else if (removeMainImage) {
      formData.append('removeImage', 'true');
    }

    // 2. Galería de Imágenes
    const existingImages = galleryItems.filter((item) => item.isExisting).map((item) => item.previewUrl);
    formData.append('existingImages', JSON.stringify(existingImages));

    galleryItems.forEach((item) => {
      if (!item.isExisting && item.file) {
        formData.append('images', item.file);
      }
    });

    // 3. Video Demostrativo
    if (videoFile) {
      formData.append('video', videoFile);
    } else if (removeVideo) {
      formData.append('removeVideo', 'true');
    }

    // Inyectar campos de promoción
    formData.append('promotionalPrice', hasPromo ? promotionalPrice : '');
    formData.append('promoStartDate', hasPromo ? promoStartDate : '');
    formData.append('promoEndDate', hasPromo ? promoEndDate : '');

    try {
      const url = editingProduct
        ? `${API_BASE_URL}/api/products/${editingProduct.id}`
        : `${API_BASE_URL}/api/products`;
      const method = editingProduct ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || (editingProduct ? 'Error al actualizar el producto.' : 'Error al registrar el producto.'));
      }

      showToast(editingProduct ? 'Producto actualizado con éxito' : 'Producto añadido al inventario');
      closeModal();
      loadProducts();
    } catch (error) {
      showToast(error.message || 'Error al completar la operación.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!productToDelete) return;

    setIsDeleting(true);
    const token = localStorage.getItem('sa_token');
    try {
      const response = await fetch(`${API_BASE_URL}/api/products/${productToDelete.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('No se pudo eliminar el producto.');
      }

      showToast('Producto eliminado del inventario.');
      loadProducts();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Error al eliminar el producto.', 'error');
    } finally {
      setIsDeleting(false);
      setProductToDelete(null);
    }
  };

  // Procesar archivo Excel/CSV para importación masiva
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(sheet);

        if (rawData.length === 0) {
          throw new Error('El archivo Excel está vacío.');
        }

        const mappedProducts = rawData.map((row) => {
          const findKey = (keys) => {
            const found = Object.keys(row).find((k) => keys.includes(k.toLowerCase().trim()));
            return found ? row[found] : undefined;
          };

          const availableRaw = findKey(['disponible', 'available', 'isavailable', 'disponibilidad', 'activo', 'active']);
          const isAvailableVal =
            availableRaw !== undefined
              ? availableRaw === true ||
                availableRaw === 'true' ||
                availableRaw === 1 ||
                availableRaw === '1' ||
                String(availableRaw).toLowerCase() === 'si' ||
                String(availableRaw).toLowerCase() === 'yes'
              : true;

          return {
            name: findKey(['nombre', 'name', 'producto', 'product']) || 'Producto sin nombre',
            description: findKey(['descripcion', 'description', 'detalle', 'details']) || '',
            price: parseFloat(findKey(['precio', 'price', 'costo', 'cost']) || 0.0),
            isAvailable: isAvailableVal,
            imageUrl: findKey(['imagen', 'image', 'url', 'imageurl']) || null,
          };
        });

        const token = localStorage.getItem('sa_token');
        const response = await fetch(`${API_BASE_URL}/api/products/bulk`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ products: mappedProducts }),
        });

        if (!response.ok) {
          throw new Error('Error al importar lote de productos en el servidor.');
        }

        const resData = await response.json();
        showToast(resData.message || 'Productos importados con éxito.');
        loadProducts();
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Error al procesar archivo Excel.', 'error');
        setIsLoading(false);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <section className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-hi tracking-tight">Catálogo de Productos</h1>
          <p className="text-sm text-lo mt-1">
            Gestiona tu inventario con fotos de portada, galería múltiple y videos demostrativos que la IA usará para responder a tus clientes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold border border-line bg-card hover:bg-app text-mid hover:text-hi rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <UploadSimple size={16} />
            <span>Importar Excel</span>
          </button>

          <button
            type="button"
            onClick={() => {
              closeModal();
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold bg-brand text-white hover:bg-brand-hover rounded-lg shadow transition-colors cursor-pointer"
          >
            <Plus size={16} weight="bold" />
            <span>Añadir Producto</span>
          </button>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="flex items-center justify-between gap-4 bg-card p-4 rounded-xl border border-line shadow-card">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Buscar por nombre de producto..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-app border border-line rounded-lg text-hi placeholder:text-muted focus:outline-none focus:border-brand"
          />
        </div>

        <button
          onClick={loadProducts}
          className="p-2 text-muted hover:text-hi hover:bg-app border border-line rounded-lg transition-colors cursor-pointer"
          title="Actualizar catálogo"
        >
          <ArrowsClockwise size={16} />
        </button>
      </div>

      {/* Tabla de Productos o Estado Vacío */}
      {isLoading ? (
        <ProductSkeleton />
      ) : filteredProducts.length === 0 ? (
        <div className="bg-card border border-line rounded-xl p-12 text-center text-lo shadow-card">
          <Package size={40} className="mx-auto text-muted mb-3" />
          <p className="text-sm font-semibold text-hi">No se encontraron productos</p>
          <p className="text-xs mt-1">Intenta con otros términos o añade un nuevo artículo a tu inventario.</p>
        </div>
      ) : (
        <div className="bg-card border border-line rounded-xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-mid">
              <thead className="bg-app text-xs font-bold text-hi uppercase tracking-wider border-b border-line">
                <tr>
                  <th scope="col" className="px-6 py-4 w-28">Multimedia</th>
                  <th scope="col" className="px-6 py-4">Nombre</th>
                  <th scope="col" className="px-6 py-4">Descripción</th>
                  <th scope="col" className="px-6 py-4">Precio</th>
                  <th scope="col" className="px-6 py-4">Estado</th>
                  <th scope="col" className="px-6 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-card">
                {currentItems.map((prod) => {
                  const galleryCount = Array.isArray(prod.images) ? prod.images.length : 0;
                  const hasVideo = !!prod.videoUrl;

                  return (
                    <tr key={prod.id} className="hover:bg-app/35 transition-colors duration-fast">
                      {/* Columna Multimedia */}
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <div className="relative w-11 h-11 rounded-lg border border-line bg-app overflow-hidden flex items-center justify-center flex-shrink-0">
                            {prod.imageUrl ? (
                              <img
                                src={prod.imageUrl}
                                alt={prod.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <Package size={20} className="text-muted" />
                            )}
                            {galleryCount > 0 && (
                              <span className="absolute bottom-0 right-0 bg-hi/80 text-card text-[9px] font-bold px-1 rounded-tl-md">
                                +{galleryCount}
                              </span>
                            )}
                          </div>

                          {/* Indicador de Video */}
                          {hasVideo && (
                            <span
                              title="Cuenta con video demostrativo"
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                            >
                              <VideoCamera size={14} weight="fill" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Columna Nombre */}
                      <td className="px-6 py-3 font-semibold text-hi">
                        <span className="block truncate max-w-[200px]">{prod.name}</span>
                      </td>

                      {/* Columna Descripción */}
                      <td className="px-6 py-3">
                        <span className="block truncate max-w-xs text-lo">{prod.description || 'Sin descripción'}</span>
                      </td>

                      {/* Columna Precio */}
                      <td className="px-6 py-3 font-mono">
                        {(() => {
                          const hasPromoPrice = prod.promotionalPrice !== null && prod.promotionalPrice !== undefined;
                          let isPromoActive = false;
                          if (hasPromoPrice) {
                            const hoy = new Date();
                            hoy.setHours(0, 0, 0, 0);
                            const start = prod.promoStartDate ? new Date(prod.promoStartDate) : null;
                            const end = prod.promoEndDate ? new Date(prod.promoEndDate) : null;
                            if (start) start.setHours(0, 0, 0, 0);
                            if (end) end.setHours(0, 0, 0, 0);
                            const despuesDeInicio = !start || hoy >= start;
                            const antesDeFin = !end || hoy <= end;
                            isPromoActive = despuesDeInicio && antesDeFin;
                          }

                          return isPromoActive ? (
                            <div className="flex flex-col">
                              <span className="text-3xs text-gray-400 line-through">S/. {prod.price.toFixed(2)}</span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-sm font-bold text-green-600">
                                  S/. {prod.promotionalPrice.toFixed(2)}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-green-50 text-green-700 border border-green-200">
                                  PROMO
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm font-bold text-brand">S/. {prod.price.toFixed(2)}</span>
                          );
                        })()}
                      </td>

                      {/* Columna Disponibilidad */}
                      <td className="px-6 py-3">
                        {prod.isAvailable ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-2xs font-bold border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            Disponible
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-50 text-danger text-2xs font-bold border border-red-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                            Agotado
                          </div>
                        )}
                      </td>

                      {/* Columna Acciones */}
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => handleEdit(prod)}
                            className="p-1.5 rounded text-muted hover:text-hi hover:bg-app transition-colors"
                            title="Editar"
                          >
                            <PencilSimple size={16} />
                          </button>
                          <button
                            onClick={() => setProductToDelete(prod)}
                            className="p-1.5 rounded text-muted hover:text-danger hover:bg-red-50 transition-colors cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pie de Tabla con Paginación */}
          <div className="flex items-center justify-between border-t border-line px-6 py-4 bg-app/20">
            <span className="text-xs text-lo">
              Mostrando <span className="font-semibold text-hi">{indexOfFirstItem + 1}</span> a{' '}
              <span className="font-semibold text-hi">{Math.min(indexOfLastItem, totalItems)}</span> de{' '}
              <span className="font-semibold text-hi">{totalItems}</span> artículos
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="p-2 rounded border border-line bg-card hover:bg-app text-mid hover:text-hi transition-colors disabled:opacity-40 disabled:hover:bg-card disabled:cursor-not-allowed cursor-pointer"
                aria-label="Página anterior"
              >
                <CaretLeft size={14} weight="bold" />
              </button>

              <span className="text-xs text-mid font-medium font-mono">
                Pág. {currentPage} de {totalPages || 1}
              </span>

              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="p-2 rounded border border-line bg-card hover:bg-app text-mid hover:text-hi transition-colors disabled:opacity-40 disabled:hover:bg-card disabled:cursor-not-allowed cursor-pointer"
                aria-label="Página siguiente"
              >
                <CaretRight size={14} weight="bold" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Producto */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingProduct ? 'Editar Producto' : 'Añadir Nuevo Producto'}
        subtitle={
          editingProduct
            ? 'Actualiza la información, galería y video de tu artículo.'
            : 'Crea un nuevo artículo en tu catálogo con fotos y video.'
        }
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
          {/* Nombre */}
          <div>
            <label htmlFor="prod-name" className="block text-xs font-semibold text-hi mb-1">
              Nombre del Producto <span className="text-red-500">*</span>
            </label>
            <input
              id="prod-name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIsFormDirty(true);
              }}
              placeholder="Ej. Zapatillas Urban Runner Pro"
              className="w-full px-3 py-2.5 text-sm bg-app border border-line rounded-lg text-hi placeholder:text-muted focus:outline-none focus:border-brand focus:shadow-input-focus transition-all"
            />
            <div className="text-right mt-0.5">
              <span className="text-[11px] text-lo font-mono">{(name || '').length} / 100</span>
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label htmlFor="prod-desc" className="block text-xs font-semibold text-hi mb-1">
              Descripción (Opcional)
            </label>
            <textarea
              id="prod-desc"
              rows={2}
              maxLength={600}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setIsFormDirty(true);
              }}
              placeholder="Detalles, materiales, tallas o características que la IA explicará al cliente..."
              className="w-full px-3 py-2.5 text-sm bg-app border border-line rounded-lg text-hi placeholder:text-muted focus:outline-none focus:border-brand focus:shadow-input-focus transition-all resize-none"
            />
            <div className="text-right mt-0.5">
              <span className="text-[11px] text-lo font-mono">{(description || '').length} / 600</span>
            </div>
          </div>

          {/* Precio y Disponibilidad */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="prod-price" className="block text-xs font-semibold text-hi mb-1">
                Precio (S/.) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm font-bold select-none">
                  S/.
                </span>
                <input
                  id="prod-price"
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setIsFormDirty(true);
                  }}
                  placeholder="0.00"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-line bg-app text-sm text-hi font-mono focus:outline-none focus:border-brand focus:shadow-input-focus transition-all"
                />
              </div>
            </div>

            <div className="flex flex-col justify-end pb-1">
              <span className="block text-xs font-semibold text-hi mb-2">Estado del Producto</span>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => {
                    setIsAvailable(e.target.checked);
                    setIsFormDirty(true);
                  }}
                  className="rounded border-line text-brand focus:ring-brand w-4 h-4"
                />
                <span className="text-sm font-medium text-mid">Disponible para venta</span>
              </label>
            </div>
          </div>

          {/* Promoción Temporal */}
          <div className="border-t border-line pt-4">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-3">
              <input
                type="checkbox"
                checked={hasPromo}
                onChange={(e) => {
                  setHasPromo(e.target.checked);
                  setIsFormDirty(true);
                }}
                className="rounded border-line text-brand focus:ring-brand w-4 h-4"
              />
              <span className="text-sm font-semibold text-hi">Activar Promoción Temporal</span>
            </label>

            {hasPromo && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="prod-promo-price" className="block text-[10px] font-semibold text-lo mb-1">
                    Precio Oferta (S/.)
                  </label>
                  <input
                    id="prod-promo-price"
                    type="number"
                    step="0.01"
                    min="0"
                    required={hasPromo}
                    value={promotionalPrice}
                    onChange={(e) => {
                      setPromotionalPrice(e.target.value);
                      setIsFormDirty(true);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-line bg-app text-xs text-hi font-mono focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label htmlFor="prod-promo-start" className="block text-[10px] font-semibold text-lo mb-1">
                    Fecha Inicio
                  </label>
                  <input
                    id="prod-promo-start"
                    type="date"
                    required={hasPromo}
                    value={promoStartDate}
                    onChange={(e) => {
                      setPromoStartDate(e.target.value);
                      setIsFormDirty(true);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label htmlFor="prod-promo-end" className="block text-[10px] font-semibold text-lo mb-1">
                    Fecha Fin
                  </label>
                  <input
                    id="prod-promo-end"
                    type="date"
                    required={hasPromo}
                    value={promoEndDate}
                    onChange={(e) => {
                      setPromoEndDate(e.target.value);
                      setIsFormDirty(true);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand"
                  />
                </div>
              </div>
            )}
          </div>

          {/* SECCIÓN: Imágenes Unificadas */}
          <div className="border-t border-line pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-semibold text-hi">
                Imágenes (Máx. 4)
              </span>
              <span className="text-[10px] text-lo font-mono">{(mainImagePreview ? 1 : 0) + galleryItems.length} / 4 fotos</span>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {/* Lista combinada */}
              {(() => {
                const combined = [];
                if (mainImagePreview) combined.push({ id: 'main', previewUrl: mainImagePreview, isMain: true });
                galleryItems.forEach((item) => combined.push({ ...item, isMain: false }));

                return combined.map((item, index) => (
                  <div
                    key={item.id || index}
                    className="relative aspect-square rounded-xl border border-line bg-app overflow-hidden flex items-center justify-center shadow-sm group"
                  >
                    <img src={item.previewUrl} alt={`Foto ${index + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemoveUnifiedImage(index)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-hi/80 text-card hover:bg-red-600 transition-colors cursor-pointer"
                      title="Eliminar foto"
                    >
                      <X size={10} weight="bold" />
                    </button>
                    {index === 0 && (
                      <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-brand/90 text-white px-1.5 py-0.5 rounded shadow-sm">
                        PORTADA
                      </span>
                    )}
                  </div>
                ));
              })()}

              {/* Botón para añadir foto(s) */}
              {((mainImagePreview ? 1 : 0) + galleryItems.length) < 4 && (
                <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-line hover:border-brand bg-app rounded-xl cursor-pointer text-center group transition-colors">
                  <Plus size={18} className="text-muted group-hover:text-brand mb-1" />
                  <span className="text-[10px] font-semibold text-lo group-hover:text-brand">Añadir fotos</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleAddUnifiedImages}
                    disabled={isCompressingImages}
                    className="sr-only"
                  />
                </label>
              )}
            </div>
            {isCompressingImages && (
              <p className="text-[10px] text-brand animate-pulse">Optimizando imágenes...</p>
            )}
          </div>

          {/* SECCIÓN: Video Demostrativo */}
          <div className="border-t border-line pt-4 space-y-3">
            <span className="block text-xs font-semibold text-hi">
              Video demostrativo (Opcional - Máx. 15 MB / 45s)
            </span>

            {!videoPreview ? (
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-line hover:border-blue-500 bg-app rounded-xl py-4 px-3 cursor-pointer text-center group transition-colors">
                <VideoCamera size={22} className="text-muted group-hover:text-blue-500 mb-1" />
                <span className="text-2xs font-semibold text-hi group-hover:text-blue-500">
                  {isValidatingVideo ? 'Validando video...' : 'Subir Video'}
                </span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={handleVideoChange}
                  disabled={isValidatingVideo}
                  className="sr-only"
                />
              </label>
            ) : (
              <div className="relative rounded-xl border border-line bg-black/90 p-2 overflow-hidden flex flex-col items-center">
                <video
                  src={videoPreview}
                  controls
                  className="w-full max-h-48 rounded-lg object-contain bg-black"
                />
                <div className="w-full flex items-center justify-between mt-2 px-1 text-xs">
                  <span className="text-[11px] text-zinc-300 font-mono flex items-center gap-1">
                    <PlayCircle size={14} className="text-blue-400" />
                    {videoMeta?.sizeMb ? `${videoMeta.sizeMb} MB` : 'Video adjunto'}
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveVideo}
                    className="text-[11px] font-semibold text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash size={12} />
                    <span>Quitar video</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-xs font-semibold border border-line text-mid hover:bg-app rounded-lg transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || isCompressingImages || isValidatingVideo || !name || price === ''}
              className="px-5 py-2 text-xs font-bold bg-brand text-white hover:bg-brand-hover rounded-lg shadow cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <ArrowsClockwise size={14} className="animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : editingProduct ? (
                'Actualizar Producto'
              ) : (
                'Guardar Producto'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Global de Confirmación de Eliminación */}
      <ConfirmModal
        isOpen={!!productToDelete}
        onClose={() => setProductToDelete(null)}
        onConfirm={handleConfirmDeleteProduct}
        title="Eliminar Producto"
        message="¿Está seguro que desea eliminar este producto? Se eliminarán también las fotos de la galería y el video demostrativo asociado."
        confirmText="Eliminar"
        cancelText="Cancelar"
        isLoading={isDeleting}
      />

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium
            ${
              toast.type === 'success'
                ? 'bg-card border-emerald-200 text-emerald-700'
                : toast.type === 'error'
                ? 'bg-card border-red-200 text-danger'
                : 'bg-card border-blue-200 text-blue-700'
            }
          `}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'success' ? (
            <CheckCircle size={18} weight="bold" className="text-success flex-shrink-0" />
          ) : (
            <WarningCircle size={18} weight="bold" className="text-danger flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-1 text-muted hover:text-hi cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
