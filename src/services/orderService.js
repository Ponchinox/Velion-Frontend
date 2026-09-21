import { apiClient } from './api';

/**
 * SERVICIO DE PEDIDOS (ORDERS)
 * ============================
 * Consultas para el listado paginado y detalle de pedidos del tenant autenticado.
 */

/**
 * Obtiene la lista paginada de pedidos con filtros opcionales.
 * @param {Object} [params]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=10]
 * @param {string} [params.status]
 * @param {string} [params.externalProvider]
 * @param {string} [params.search]
 */
export async function getOrders(params = {}) {
  const queryParts = [];

  if (params.page) queryParts.push(`page=${encodeURIComponent(params.page)}`);
  if (params.limit) queryParts.push(`limit=${encodeURIComponent(params.limit)}`);
  if (params.status) queryParts.push(`status=${encodeURIComponent(params.status)}`);
  if (params.externalProvider) queryParts.push(`externalProvider=${encodeURIComponent(params.externalProvider)}`);
  if (params.search) queryParts.push(`search=${encodeURIComponent(params.search)}`);

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  return apiClient(`/orders${queryString}`, { method: 'GET' });
}

/**
 * Obtiene el detalle completo de un pedido específico por ID.
 * @param {string} id
 */
export async function getOrder(id) {
  return apiClient(`/orders/${encodeURIComponent(id)}`, { method: 'GET' });
}
