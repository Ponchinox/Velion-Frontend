import { apiClient } from './api';

/**
 * Obtiene la lista de chats / conversaciones activas del inquilino
 */
export async function getChats() {
  return apiClient('/chats', {
    method: 'GET',
  });
}

/**
 * Obtiene el historial de mensajes para una conversación específica
 */
export async function getMessages(chatId) {
  return apiClient(`/chats/${chatId}/messages`, {
    method: 'GET',
  });
}

/**
 * Envía un mensaje a una conversación específica
 */
export async function sendMessage(chatId, textData) {
  return apiClient(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: textData, // Contiene { text: string } u otros parámetros
  });
}

/**
 * Envía un mensaje directo a WhatsApp a través del endpoint general del live chat
 */
export async function sendDirectMessage(data) {
  return apiClient('/chats/send', {
    method: 'POST',
    body: data, // Contiene { chatId, text, remoteJid }
  });
}

/**
 * Reactiva el bot de chat para un cliente específico (isBotPaused: false)
 */
export async function resumeBot(customerId) {
  return apiClient(`/chats/${customerId}/resume-bot`, {
    method: 'POST',
  });
}
