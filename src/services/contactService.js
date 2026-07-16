import { apiClient } from './api';

/**
 * Obtiene la lista completa de contactos desde el backend
 */
export async function getContacts() {
  return apiClient('/contacts', {
    method: 'GET',
  });
}

/**
 * Crea un nuevo contacto en el backend
 */
export async function createContact(contactData) {
  return apiClient('/contacts', {
    method: 'POST',
    body: contactData,
  });
}

/**
 * Actualiza los datos de un contacto existente
 */
export async function updateContact(id, contactData) {
  return apiClient(`/contacts/${id}`, {
    method: 'PUT',
    body: contactData,
  });
}

/**
 * Elimina un contacto del sistema
 */
export async function deleteContact(id) {
  return apiClient(`/contacts/${id}`, {
    method: 'DELETE',
  });
}
