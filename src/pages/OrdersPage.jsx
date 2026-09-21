import React, { useState, useEffect, useCallback } from 'react';
import {
  Receipt,
  MagnifyingGlass,
  Funnel,
  ArrowsClockwise,
  Eye,
  ArrowSquareOut,
  X,
  CircleNotch,
  CalendarBlank,
  User,
  Phone,
  MapPin,
  Package,
  CreditCard,
  WarningCircle,
  CheckCircle,
  Clock,
  Check,
} from '@phosphor-icons/react';
import * as orderService from '../services/orderService';

// ─── Mapeos de Estado y Badges ───────────────────────────────────────────

const ORDER_STATUS_MAP = {
  PENDING: { label: 'Pendiente', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
  CONFIRMED: { label: 'Confirmado', color: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
  PROCESSING: { label: 'En preparación', color: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20' },
  SHIPPED: { label: 'Enviado', color: 'bg-purple-500/10 text-purple-700 border-purple-500/20' },
  COMPLETED: { label: 'Completado', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
  CANCELED: { label: 'Cancelado', color: 'bg-red-500/10 text-red-700 border-red-500/20' },
};

const EXTERNAL_SYNC_MAP = {
  NOT_STARTED: { label: 'Pendiente', color: 'bg-slate-100 text-slate-600' },
  CREATING: { label: 'Creando en Shopify', color: 'bg-amber-500/10 text-amber-700' },
  CREATED: { label: 'Creado en Shopify', color: 'bg-emerald-500/10 text-emerald-700' },
  UNKNOWN_RESULT: { label: 'Verificación pendiente', color: 'bg-orange-500/10 text-orange-700' },
  ERROR: { label: 'Error de sincronización', color: 'bg-red-500/10 text-red-700' },
};

function formatCurrency(amount, currencyCode = 'PEN') {
  const code = (currencyCode || 'PEN').toUpperCase();
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  if (code === 'PEN') {
    return `S/. ${num.toFixed(2)}`;
  }
  return `${code} ${num.toFixed(2)}`;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');

  // Detalle de orden modal
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Cargar lista de pedidos
  const loadOrders = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const res = await orderService.getOrders({
          page,
          limit: 10,
          status: statusFilter || undefined,
          externalProvider: providerFilter || undefined,
          search: search || undefined,
        });

        setOrders(res.items || []);
        setPagination(res.pagination || { page: 1, limit: 10, total: 0, pages: 1 });
      } catch (err) {
        console.error('[OrdersPage] Error cargando pedidos:', err);
        setError(err.message || 'Error al obtener la lista de pedidos.');
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, providerFilter, search]
  );

  // Debounce o recarga al cambiar filtros
  useEffect(() => {
    const timer = setTimeout(() => {
      loadOrders(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadOrders]);

  // Cargar detalle cuando se selecciona una orden
  const handleOpenDetail = async (id) => {
    setSelectedOrderId(id);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const order = await orderService.getOrder(id);
      setDetailOrder(order);
    } catch (err) {
      console.error('[OrdersPage] Error cargando detalle:', err);
      setDetailError(err.message || 'No se pudo cargar el detalle del pedido.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setSelectedOrderId(null);
    setDetailOrder(null);
    setDetailError(null);
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
              <Receipt size={24} weight="duotone" />
            </div>
            <h1 className="text-2xl font-bold text-hi">Pedidos</h1>
          </div>
          <p className="text-sm text-lo">
            Gestiona las órdenes de tus clientes sincronizadas y nativas en tiempo real.
          </p>
        </div>

        <button
          onClick={() => loadOrders(pagination.page)}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-card border border-line text-mid hover:text-hi hover:bg-app transition-colors shadow-sm cursor-pointer self-start sm:self-auto"
        >
          <ArrowsClockwise size={15} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-card rounded-2xl border border-line p-4 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Input de Búsqueda */}
        <div className="relative w-full md:w-96">
          <MagnifyingGlass size={18} className="absolute left-3.5 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente, teléfono o # pedido..."
            className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-xl bg-app border border-line text-hi placeholder:text-muted focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Selectores de Filtro */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Filtro de Estado */}
          <div className="flex items-center gap-1.5 bg-app border border-line rounded-xl px-3 py-1.5 text-xs">
            <span className="text-lo font-medium">Estado:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-hi font-semibold focus:outline-none cursor-pointer"
            >
              <option value="">Todos</option>
              <option value="PENDING">Pendiente</option>
              <option value="CONFIRMED">Confirmado</option>
              <option value="PROCESSING">En preparación</option>
              <option value="SHIPPED">Enviado</option>
              <option value="COMPLETED">Completado</option>
              <option value="CANCELED">Cancelado</option>
            </select>
          </div>

          {/* Filtro de Origen */}
          <div className="flex items-center gap-1.5 bg-app border border-line rounded-xl px-3 py-1.5 text-xs">
            <span className="text-lo font-medium">Origen:</span>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="bg-transparent text-hi font-semibold focus:outline-none cursor-pointer"
            >
              <option value="">Todos</option>
              <option value="VELION">Velion</option>
              <option value="SHOPIFY">Shopify</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabla de Pedidos */}
      <div className="bg-card rounded-2xl border border-line shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
            <CircleNotch size={32} className="animate-spin text-brand" />
            <p className="text-sm font-medium">Cargando pedidos...</p>
          </div>
        ) : error ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-center px-4">
            <WarningCircle size={36} className="text-red-500" />
            <p className="text-sm font-semibold text-hi">{error}</p>
            <button
              onClick={() => loadOrders(pagination.page)}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-app border border-line flex items-center justify-center text-slate-400 mb-1">
              <Receipt size={32} weight="duotone" />
            </div>
            <h3 className="text-base font-bold text-hi">Aún no hay pedidos</h3>
            <p className="text-xs text-lo max-w-sm">
              Cuando tus clientes completen un carrito en Velion o Shopify, aparecerán registrados aquí automáticamente.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line bg-app/50 text-lo font-semibold">
                  <th className="py-3.5 px-4">Pedido</th>
                  <th className="py-3.5 px-4">Cliente</th>
                  <th className="py-3.5 px-4">Fecha</th>
                  <th className="py-3.5 px-4">Origen</th>
                  <th className="py-3.5 px-4">Estado</th>
                  <th className="py-3.5 px-4 text-right">Total</th>
                  <th className="py-3.5 px-4">Sync Externo</th>
                  <th className="py-3.5 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((order) => {
                  const statusInfo = ORDER_STATUS_MAP[order.status] || {
                    label: order.status,
                    color: 'bg-slate-100 text-slate-700 border-slate-200',
                  };

                  const isShopify = order.externalProvider === 'SHOPIFY';
                  const syncInfo = isShopify
                    ? EXTERNAL_SYNC_MAP[order.externalSyncStatus] || {
                        label: order.externalSyncStatus || 'Pendiente',
                        color: 'bg-slate-100 text-slate-600',
                      }
                    : null;

                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-app/40 transition-colors group"
                    >
                      {/* Pedido / ID */}
                      <td className="py-4 px-4 font-mono font-bold text-hi">
                        <div className="flex items-center gap-2">
                          <span>{order.orderNumber}</span>
                          {order.externalCheckoutUrlPresent && (
                            <span
                              title="Checkout Shopify disponible"
                              className="w-2 h-2 rounded-full bg-emerald-500 inline-block"
                            />
                          )}
                        </div>
                      </td>

                      {/* Cliente */}
                      <td className="py-4 px-4">
                        <div className="font-semibold text-hi truncate max-w-[180px]">
                          {order.customerName}
                        </div>
                        {order.customerPhone && (
                          <div className="text-[11px] text-lo font-mono">
                            {order.customerPhone}
                          </div>
                        )}
                      </td>

                      {/* Fecha */}
                      <td className="py-4 px-4 text-lo whitespace-nowrap">
                        {order.createdAt
                          ? new Date(order.createdAt).toLocaleString('es-PE', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>

                      {/* Origen */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {isShopify ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Shopify
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            Velion
                          </span>
                        )}
                      </td>

                      {/* Estado */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>

                      {/* Total */}
                      <td className="py-4 px-4 text-right whitespace-nowrap font-bold text-hi">
                        {formatCurrency(order.totalAmount, order.currencyCode)}
                      </td>

                      {/* Sync Externo */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {isShopify && syncInfo ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${syncInfo.color}`}
                          >
                            {syncInfo.label}
                          </span>
                        ) : (
                          <span className="text-lo text-[11px]">—</span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="py-4 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(order.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app hover:bg-card border border-line text-hi font-semibold text-xs shadow-2xs transition-colors cursor-pointer"
                        >
                          <Eye size={14} />
                          Detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {!loading && orders.length > 0 && (
          <div className="p-4 border-t border-line bg-app/30 flex items-center justify-between text-xs text-lo">
            <div>
              Mostrando <span className="font-bold text-hi">{orders.length}</span> de{' '}
              <span className="font-bold text-hi">{pagination.total}</span> pedidos
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => loadOrders(pagination.page - 1)}
                className="px-3 py-1.5 rounded-lg bg-card border border-line text-hi font-semibold disabled:opacity-40 transition-colors cursor-pointer"
              >
                Anterior
              </button>
              <span className="px-2 font-medium">
                Página {pagination.page} de {pagination.pages}
              </span>
              <button
                type="button"
                disabled={pagination.page >= pagination.pages}
                onClick={() => loadOrders(pagination.page + 1)}
                className="px-3 py-1.5 rounded-lg bg-card border border-line text-hi font-semibold disabled:opacity-40 transition-colors cursor-pointer"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL DE DETALLE DEL PEDIDO ──────────────────────────────────── */}
      {selectedOrderId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-card w-full max-w-2xl rounded-2xl border border-line shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 border-b border-line flex items-center justify-between bg-app/40">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-hi">
                    Pedido {detailOrder?.orderNumber || ''}
                  </h3>
                  {detailOrder?.externalProvider === 'SHOPIFY' ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      Shopify
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                      Velion
                    </span>
                  )}
                </div>
                <p className="text-xs text-lo mt-0.5">
                  ID: <span className="font-mono">{detailOrder?.id}</span>
                </p>
              </div>

              <button
                onClick={handleCloseDetail}
                className="p-1.5 rounded-lg text-lo hover:text-hi hover:bg-app transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {detailLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <CircleNotch size={28} className="animate-spin text-brand" />
                  <p>Cargando información completa del pedido...</p>
                </div>
              ) : detailError ? (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-center">
                  {detailError}
                </div>
              ) : detailOrder ? (
                <>
                  {/* Grid de Información del Cliente y Entrega */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-app border border-line">
                    <div>
                      <span className="text-lo font-semibold block mb-1">Datos del Cliente</span>
                      <div className="flex items-center gap-2 text-hi font-bold">
                        <User size={15} className="text-slate-400" />
                        <span>{detailOrder.customer?.name || 'Cliente sin nombre'}</span>
                      </div>
                      {detailOrder.customer?.phone && (
                        <div className="flex items-center gap-2 text-lo font-mono mt-1">
                          <Phone size={15} className="text-slate-400" />
                          <span>{detailOrder.customer.phone}</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-lo font-semibold block mb-1">Destino de Entrega</span>
                      <div className="flex items-center gap-2 text-hi font-medium">
                        <MapPin size={15} className="text-slate-400" />
                        <span>
                          {detailOrder.shippingCity || detailOrder.shippingAddress
                            ? `${detailOrder.shippingCity ? detailOrder.shippingCity + ' — ' : ''}${
                                detailOrder.shippingAddress || ''
                              }`
                            : 'No especificado'}
                        </span>
                      </div>
                      {detailOrder.customerNeeds && (
                        <p className="text-[11px] text-lo mt-1.5 italic">
                          Notas: {detailOrder.customerNeeds}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Tabla de Productos / Items */}
                  <div>
                    <h4 className="font-bold text-hi text-xs mb-2">Artículos del Pedido</h4>
                    <div className="border border-line rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-app/50 text-lo border-b border-line">
                          <tr>
                            <th className="py-2.5 px-3">Producto</th>
                            <th className="py-2.5 px-3 text-center">Cant.</th>
                            <th className="py-2.5 px-3 text-right">Precio Unit.</th>
                            <th className="py-2.5 px-3 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {(detailOrder.items || []).map((item) => (
                            <tr key={item.id} className="hover:bg-app/20">
                              <td className="py-2.5 px-3">
                                <span className="font-semibold text-hi block">{item.name}</span>
                                <div className="flex items-center gap-2 text-[11px] text-lo mt-0.5">
                                  {item.variant && <span>Variante: {item.variant}</span>}
                                  {item.sourceSku && <span className="font-mono">SKU: {item.sourceSku}</span>}
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100">
                                    {item.sourceProvider || 'VELION'}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold text-hi">
                                {item.quantity}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-mid">
                                {formatCurrency(item.price, detailOrder.currencyCode)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-hi">
                                {formatCurrency(item.subtotal, detailOrder.currencyCode)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-app/40 border-t border-line">
                          <tr>
                            <td colSpan={3} className="py-3 px-3 font-bold text-hi text-right">
                              Total del Pedido:
                            </td>
                            <td className="py-3 px-3 font-bold text-hi text-right font-mono text-sm text-brand">
                              {formatCurrency(detailOrder.totalAmount, detailOrder.currencyCode)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Sección de Integración Shopify (Si Aplica) */}
                  {detailOrder.externalProvider === 'SHOPIFY' && (
                    <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-emerald-950 block">
                            Sincronización Externa Shopify
                          </span>
                          <span className="text-[11px] text-emerald-800">
                            Estado:{' '}
                            <span className="font-bold">
                              {EXTERNAL_SYNC_MAP[detailOrder.externalSyncStatus]?.label ||
                                detailOrder.externalSyncStatus}
                            </span>
                            {detailOrder.externalOrderNumber && (
                              <span className="ml-2 font-mono">
                                ({detailOrder.externalOrderNumber})
                              </span>
                            )}
                          </span>
                        </div>

                        {detailOrder.externalCheckoutUrl ? (
                          <a
                            href={detailOrder.externalCheckoutUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            Ver checkout Shopify
                            <ArrowSquareOut size={14} />
                          </a>
                        ) : (
                          <span className="text-xs text-lo italic">
                            Checkout no disponible
                          </span>
                        )}
                      </div>

                      {detailOrder.externalSyncError && (
                        <div className="text-[11px] text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200">
                          {detailOrder.externalSyncError.includes('ACCESS_DENIED')
                            ? 'Esta función de pedidos Shopify no está disponible actualmente.'
                            : `Aviso: ${detailOrder.externalSyncError}`}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-line bg-app/50 flex justify-end">
              <button
                type="button"
                onClick={handleCloseDetail}
                className="px-4 py-2 rounded-lg bg-card border border-line text-xs font-bold text-hi hover:bg-app transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
