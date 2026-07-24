import { apiClient } from './api';

/**
 * Recupera el perfil del usuario autenticado actual
 */
export async function getProfile() {
  return apiClient('/users/me', {
    method: 'GET'
  });
}

/**
 * Actualiza el perfil de contacto del usuario administrador (nombre, correo, teléfono)
 */
export async function updateProfile(profileData) {
  return apiClient('/users/profile', {
    method: 'PUT',
    body: profileData
  });
}

/**
 * Actualiza la contraseña del usuario administrador
 */
export async function updatePassword(passwordData) {
  return apiClient('/users/password', {
    method: 'PUT',
    body: passwordData
  });
}
