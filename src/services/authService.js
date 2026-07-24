import { apiClient } from './api';

/**
 * Inicia sesión de un usuario contra el backend real
 */
export async function loginAccount(email, password) {
  const data = await apiClient('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (data && data.token) {
    localStorage.setItem('sa_token', data.token);
  }
  return data;
}

/**
 * Registra un nuevo tenant/negocio en el sistema
 */
export async function registerAccount(companyName, userName, email, password) {
  return apiClient('/auth/register', {
    method: 'POST',
    body: { companyName, userName, email, password },
  });
}

/* ─── Aliases para cumplimiento de especificaciones del Arquitecto ─── */
export const login = (credentials) => loginAccount(credentials.email, credentials.password);
export const register = (userData) => registerAccount(userData.businessName, userData.email, userData.password);
export const logout = () => {
  localStorage.removeItem('sa_token');
  localStorage.removeItem('sa_mock_user');
};
