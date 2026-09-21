/**
 * Configuración centralizada de navegación interna y breadcrumbs de Velion
 */
export const NAVIGATION_CONFIG = {
  '/integraciones': {
    backTo: '/settings',
    backLabel: 'Volver a Ajustes',
    breadcrumbs: [
      { label: 'Ajustes', to: '/settings' },
      { label: 'Integraciones' },
    ],
  },
  '/integraciones/shopify': {
    backTo: '/integraciones',
    backLabel: 'Volver a Integraciones',
    breadcrumbs: [
      { label: 'Ajustes', to: '/settings' },
      { label: 'Integraciones', to: '/integraciones' },
      { label: 'Shopify' },
    ],
  },
  '/billing': {
    backTo: '/settings',
    backLabel: 'Volver a Ajustes',
    breadcrumbs: [
      { label: 'Ajustes', to: '/settings' },
      { label: 'Facturación' },
    ],
  },
};

/**
 * Normaliza rutas alias (ej: /ajustes -> /settings)
 */
export function normalizeNavRoute(route) {
  if (!route) return '/settings';
  if (route === '/ajustes' || route === 'ajustes') return '/settings';
  return route;
}
