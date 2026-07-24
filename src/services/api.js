const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api';

/**
 * Función de ayuda para realizar peticiones HTTP Fetch con interceptores globales
 */
export async function apiClient(endpoint, options = {}) {
  const token = localStorage.getItem('sa_token');

  // Configuración de cabeceras por defecto
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Inyectar JWT Token si está disponible
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Inyectar X-Tenant-Id si hay impersonación activa
  const impersonatedTenantId = localStorage.getItem('impersonatedTenantId');
  if (impersonatedTenantId) {
    headers['X-Tenant-Id'] = impersonatedTenantId;
  }

  const config = {
    ...options,
    headers,
  };

  if (options.body) {
    config.body = JSON.stringify(options.body);
  }

  let finalUrl = `${API_URL}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const separator = finalUrl.includes('?') ? '&' : '?';
    finalUrl = `${finalUrl}${separator}_t=${Date.now()}`;
  }

  try {
    const response = await fetch(finalUrl, config);

    // Manejo de errores globales (ej: 401 No Autorizado)
    if (response.status === 401) {
      const errorData = await response.json().catch(() => ({}));

      // Si el error ocurrió en el login, no limpiamos la sesión ni redirigimos
      if (endpoint === '/auth/login') {
        const error = new Error(errorData.error || errorData.message || 'Correo o contraseña incorrectos.');
        error.status = 401;
        throw error;
      }

      localStorage.removeItem('sa_token');
      localStorage.removeItem('sa_mock_user');
      // Recargar para limpiar el estado de la app y forzar redirección
      window.location.href = '/login';
      const error = new Error(errorData.message || 'Sesión expirada. Por favor inicie sesión nuevamente.');
      error.status = 401;
      throw error;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data.error || data.message || 'Ocurrió un error en el servidor';
      const error = new Error(errorMessage);
      error.status = response.status;
      error.code = data.code; // Soporte para códigos de error específicos (ej: Firebase format)
      throw error;
    }

    return data;
  } catch (error) {
    // Si es un error de red (no tiene status asignado)
    if (!error.status) {
      error.message = 'No se pudo conectar con el servidor. Compruebe su conexión.';
    }
    throw error;
  }
}
