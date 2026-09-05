import { apiClient } from './api';

/**
 * Obtiene el historial de campañas del inquilino desde el backend
 * Retorna array de campañas con conteo de logs, estado y scheduling.
 */
export async function getCampaigns() {
  return apiClient('/campaigns', {
    method: 'GET',
  });
}

/**
 * Registra y agenda/lanza una nueva campaña en Campaigns V2.
 * @param {Object} campaignData
 * @param {string} campaignData.name - Nombre identificador de la campaña
 * @param {string} campaignData.baseMessage - Mensaje base (admite [Nombre] / {Nombre})
 * @param {'all'|'manual'} campaignData.audienceType - Tipo de audiencia
 * @param {string[]} [campaignData.contactIds] - IDs de contactos si audiencia manual
 * @param {string|null} [campaignData.scheduledAt] - Fecha/hora ISO si es programada
 * @param {'NONE'|'EVERY_15_DAYS'|'MONTHLY'} [campaignData.recurrenceType] - Recurrencia
 * @param {number} [campaignData.delayMin] - Retraso mínimo entre envíos (seg)
 * @param {number} [campaignData.delayMax] - Retraso máximo entre envíos (seg)
 * @param {string|null} [campaignData.media] - Imagen base64 o URL (opcional)
 */
export async function launchCampaign(campaignData) {
  return apiClient('/campaigns/launch', {
    method: 'POST',
    body: campaignData,
  });
}

/**
 * Obtiene el detalle y los logs de una campaña específica
 */
export async function getCampaignDetail(campaignId) {
  return apiClient(`/campaigns/${campaignId}`, {
    method: 'GET',
  });
}


