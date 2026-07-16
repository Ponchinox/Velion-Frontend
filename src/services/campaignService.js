import { apiClient } from './api';

/**
 * Obtiene el historial de campañas del inquilino desde el backend
 */
export async function getCampaigns() {
  return apiClient('/campaigns', {
    method: 'GET',
  });
}

/**
 * Registra y lanza/encola una nueva campaña de difusiones masivas
 */
export async function launchCampaign(campaignData) {
  return apiClient('/campaigns/launch', {
    method: 'POST',
    body: campaignData,
  });
}

/**
 * Elimina o cancela una campaña del sistema
 */
export async function deleteCampaign(id) {
  return apiClient(`/campaigns/${id}`, {
    method: 'DELETE',
  });
}
