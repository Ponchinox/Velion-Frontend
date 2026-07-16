import { useState, useEffect, useRef } from 'react';
import {
  Package,
  Plus,
  X,
  UploadSimple,
  CurrencyDollar,
  WarningCircle,
  ArrowsClockwise,
  CheckCircle,
  Eye,
  Trash,
  MagnifyingGlass,
  PencilSimple,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';

/* ─── Skeleton de Carga (Data Table Compacta) ─── */
function ProductSkeleton() {
  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card animate-pulse">
      <div className="h-12 bg-line/45 border-b border-line w-full flex items-center justify-between px-6">
        <div className="h-4 bg-line rounded w-32" />
        <div className="h-4 bg-line rounded w-48" />
      </div>
      <div className="divide-y divide-line">
        {[1, 2, 3, 4, 5].map(n => (
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
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Cargar productos desde el backend
  const loadProducts = async () => {
    setIsLoading(true);
    setErrorMsg('');
    const token = localStorage.getItem('sa_token');
    
    try {
      const response = await fetch('http://localhost:3000/api/products', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
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

  // Manejar el cambio de texto de búsqueda y reiniciar página
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  // Filtrar productos en tiempo real por el nombre
  const filteredProducts = products.filter((prod) =>
    prod.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Paginación lógica en memoria
  const totalItems = filteredProducts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);

  // Manejar el cambio de imagen
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
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
    setImageFile(null);
    setImagePreview(null);
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
    if (imageFile) {
      formData.append('image', imageFile);
    }

    try {
      const url = editingProduct
        ? `http://localhost:3000/api/products/${editingProduct.id}`
        : 'http://localhost:3000/api/products';
      const method = editingProduct ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(editingProduct ? 'Error al actualizar el producto.' : 'Error al registrar el producto.');
      }

      showToast(editingProduct ? 'Producto actualizado con éxito' : 'Producto añadido al inventario');
      setShowModal(false);
      
      // Limpiar formulario y estado de edición
      setEditingProduct(null);
      setName('');
      setDescription('');
      setPrice('');
      setIsAvailable(true);
      setImageFile(null);
      setImagePreview(null);
      
      // Recargar catálogo
      loadProducts();
    } catch (error) {
      showToast(error.message || 'Error de conexión', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Carga los datos del producto actual en el formulario para editar
  const handleEdit = (prod) => {
    setEditingProduct(prod);
    setName(prod.name);
    setDescription(prod.description || '');
    setPrice(prod.price);
    setIsAvailable(prod.isAvailable);
    setImageFile(null);
    setImagePreview(prod.imageUrl || null);
    setShowModal(true);
  };

  // Elimina un producto tras confirmar la acción
  const handleDelete = async (id) => {
    const confirmDelete = window.confirm('¿Estás seguro de que deseas eliminar este producto del catálogo?');
    if (!confirmDelete) return;

    const token = localStorage.getItem('sa_token');
    try {
      const response = await fetch(`http://localhost:3000/api/products/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
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
    }
  };

  // Procesar archivo Excel/CSV para importación masiva
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
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

        // Mapear campos buscando coincidencia semántica
        const mappedProducts = rawData.map(row => {
          const findKey = (keys) => {
            const found = Object.keys(row).find(k => keys.includes(k.toLowerCase().trim()));
            return found ? row[found] : undefined;
          };

          const availableRaw = findKey(['disponible', 'available', 'isavailable', 'disponibilidad', 'activo', 'active']);
          const isAvailableVal = availableRaw !== undefined 
            ? (availableRaw === true || availableRaw === 'true' || availableRaw === 1 || availableRaw === '1' || String(availableRaw).toLowerCase() === 'si' || String(availableRaw).toLowerCase() === 'yes') 
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
        const response = await fetch('http://localhost:3000/api/products/bulk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
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
        e.target.value = ''; // Limpiar el input file
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <section aria-labelledby="inventario-heading" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 id="inventario-heading" className="text-xl font-bold text-hi flex items-center gap-2">
            <Package size={24} className="text-brand" />
            Catálogo de Productos
          </h1>
          <p className="text-sm text-lo mt-0.5">
            Administra tus artículos de inventario, stock físico y precios en el SaaS.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* Botón Excel */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="
              flex items-center gap-2 px-4 py-2.5 rounded-md
              border border-line text-mid hover:text-hi hover:bg-app text-sm font-semibold
              transition-all duration-fast cursor-pointer
            "
          >
            <UploadSimple size={16} />
            Importar Excel
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />

          {/* Botón Crear */}
          <button
            onClick={() => setShowModal(true)}
            className="
              flex items-center gap-2 px-4 py-2.5 rounded-md
              bg-brand text-white text-sm font-semibold
              hover:bg-brand-hover shadow shadow-card transition-all duration-fast cursor-pointer
            "
          >
            <Plus size={16} weight="bold" />
            Añadir Producto
          </button>
        </div>
      </div>

      {/* Filtros de Catálogo */}
      {!isLoading && !errorMsg && products.length > 0 && (
        <div className="flex items-center w-full max-w-md relative">
          <MagnifyingGlass className="absolute left-3.5 text-muted" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Buscar productos por nombre..."
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-card border border-line rounded-lg focus:outline-none focus:border-brand text-hi placeholder:text-muted"
          />
        </div>
      )}

      {/* Grid de Productos / Loader / Failsafe */}
      {isLoading ? (
        <ProductSkeleton />
      ) : errorMsg ? (
        <div className="bg-card border border-line rounded-lg shadow-card p-10 text-center space-y-4 max-w-lg mx-auto">
          <WarningCircle size={40} className="mx-auto text-danger" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-hi">{errorMsg}</p>
            <p className="text-xs text-lo mt-1">El servidor de base de datos no está respondiendo en este momento.</p>
          </div>
          <button
            onClick={loadProducts}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
          >
            <ArrowsClockwise size={14} />
            Reintentar Carga
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="bg-card border border-line rounded-lg shadow-card p-12 text-center text-lo max-w-md mx-auto">
          <Package size={36} className="mx-auto text-muted mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-hi">Tu catálogo está vacío</p>
          <p className="text-xs mt-1">Registra tu primer artículo de inventario pulsando el botón superior.</p>
        </div>
      ) : totalItems === 0 ? (
        <div className="bg-card border border-line rounded-lg shadow-card p-12 text-center text-lo max-w-md mx-auto">
          <MagnifyingGlass size={36} className="mx-auto text-muted mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-hi">Sin resultados coincidentes</p>
          <p className="text-xs mt-1">Intenta con otros términos o limpia tu criterio de búsqueda.</p>
        </div>
      ) : (
        <div className="bg-card border border-line rounded-xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-mid">
              <thead className="bg-app text-xs font-bold text-hi uppercase tracking-wider border-b border-line">
                <tr>
                  <th scope="col" className="px-6 py-4 w-16">Imagen</th>
                  <th scope="col" className="px-6 py-4">Nombre</th>
                  <th scope="col" className="px-6 py-4">Descripción</th>
                  <th scope="col" className="px-6 py-4">Precio</th>
                  <th scope="col" className="px-6 py-4">Estado</th>
                  <th scope="col" className="px-6 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-card">
                {currentItems.map((prod) => (
                  <tr key={prod.id} className="hover:bg-app/35 transition-colors duration-fast">
                    {/* Columna Imagen */}
                    <td className="px-6 py-3">
                      <div className="w-10 h-10 rounded-md border border-line bg-app overflow-hidden flex items-center justify-center flex-shrink-0">
                        {prod.imageUrl ? (
                          <img
                            src={prod.imageUrl}
                            alt={prod.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Package size={18} className="text-muted" />
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
                    <td className="px-6 py-3 font-mono font-bold text-brand">
                      ${prod.price.toFixed(2)}
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
                          onClick={() => handleDelete(prod.id)}
                          className="p-1.5 rounded text-muted hover:text-danger hover:bg-red-50 transition-colors"
                          title="Eliminar"
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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

      {/* Modal Añadir Producto */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-hi/20 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-card border border-line rounded-xl shadow-card-md w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                  <Package size={16} className="text-brand" />
                </div>
                <div>
                  <p className="text-sm font-bold text-hi">{editingProduct ? 'Editar Producto' : 'Añadir Producto'}</p>
                  <p className="text-xs text-lo">{editingProduct ? 'Actualiza la información del artículo' : 'Crea un nuevo artículo en tu catálogo'}</p>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-md text-lo hover:text-hi hover:bg-app transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label htmlFor="prod-name" className="block text-xs font-semibold text-hi mb-1">Nombre del Producto</label>
                <input
                  id="prod-name"
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="ej. Smartphone Pro Max"
                  className="w-full px-3.5 py-2.5 rounded-md border border-line bg-card text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand"
                />
              </div>

              <div>
                <label htmlFor="prod-desc" className="block text-xs font-semibold text-hi mb-1">Descripción (Opcional)</label>
                <textarea
                  id="prod-desc"
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Detalles sobre especificaciones, colores o garantías..."
                  className="w-full px-3.5 py-2.5 rounded-md border border-line bg-card text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prod-price" className="block text-xs font-semibold text-hi mb-1">Precio (USD)</label>
                  <div className="relative">
                    <CurrencyDollar className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                    <input
                      id="prod-price"
                      type="number"
                      required
                      step="0.01"
                      min="0"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      placeholder="99.90"
                      className="w-full pl-8 pr-3 py-2 rounded-md border border-line bg-card text-sm text-hi font-mono focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>

                <div className="flex flex-col justify-end pb-1">
                  <span className="block text-xs font-semibold text-hi mb-2">Estado del Producto</span>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isAvailable}
                      onChange={e => setIsAvailable(e.target.checked)}
                      className="rounded border-line text-brand focus:ring-brand w-4 h-4"
                    />
                    <span className="text-sm font-medium text-mid">Disponible para venta</span>
                  </label>
                </div>
              </div>

              {/* Subida de Imagen */}
              <div>
                <span className="block text-xs font-semibold text-hi mb-1">Imagen del Producto</span>
                <div className="flex items-center gap-4">
                  <label className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-line-strong hover:border-brand bg-app rounded-lg py-5 px-3 cursor-pointer text-center group transition-colors">
                    <UploadSimple size={20} className="text-muted group-hover:text-brand mb-1.5" />
                    <span className="text-2xs font-semibold text-hi group-hover:text-brand">Subir archivo</span>
                    <span className="text-[10px] text-lo mt-0.5">JPG, PNG o WEBP</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="sr-only"
                    />
                  </label>
                  
                  {/* Previsualización */}
                  {imagePreview && (
                    <div className="w-20 h-20 bg-app rounded-lg border border-line overflow-hidden relative flex items-center justify-center flex-shrink-0">
                      <img src={imagePreview} alt="Vista previa" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => { setImageFile(null); setImagePreview(null); }}
                        className="absolute top-1 right-1 p-0.5 rounded-full bg-hi/80 text-card hover:bg-hi transition-colors cursor-pointer"
                        title="Quitar imagen"
                      >
                        <X size={10} weight="bold" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-line bg-app -mx-6 -mb-6 px-6 py-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-xs font-semibold border border-line text-mid hover:bg-app rounded-md transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !name || price === ''}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : (editingProduct ? 'Actualizar Producto' : 'Guardar Producto')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium
            ${toast.type === 'success'
              ? 'bg-card border-emerald-200 text-emerald-700'
              : 'bg-card border-red-200 text-danger'
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
