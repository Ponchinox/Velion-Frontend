/**
 * BILLING CONFIG SERVICE
 * Centraliza la configuración de métodos de pago para planes y facturación.
 * Reutiliza el modelo SystemConfig de PostgreSQL y permite fallbacks seguros por variables de entorno.
 */

import defaultPrisma from '../db.js';

let customBillingResolver = null;

export function setBillingConfigMock(mockFn) {
  customBillingResolver = typeof mockFn === 'function' ? mockFn : null;
}

/**
 * Obtiene la configuración de pago activa desde SystemConfig o variables de entorno.
 * @param {object} [prismaClient]
 * @returns {Promise<{ paymentMethod: string|null, paymentRecipient: string|null, paymentContact: string|null }>}
 */
export async function getBillingConfig(prismaClient = defaultPrisma) {
  if (customBillingResolver) {
    return await customBillingResolver();
  }

  try {
    const db = prismaClient || defaultPrisma;
    const rows = await db.systemConfig.findMany({
      where: {
        key: { in: ['paymentMethod', 'paymentRecipient', 'paymentContact'] }
      }
    });

    const map = {};
    for (const r of rows) {
      if (r.value !== undefined && r.value !== null) {
        map[r.key] = String(r.value).trim();
      }
    }

    const paymentMethod = map.paymentMethod || (process.env.BILLING_PAYMENT_METHOD || '').trim() || null;
    const paymentRecipient = map.paymentRecipient || (process.env.BILLING_PAYMENT_RECIPIENT || '').trim() || null;
    const paymentContact = map.paymentContact || (process.env.BILLING_PAYMENT_CONTACT || '').trim() || null;

    return {
      paymentMethod: paymentMethod || null,
      paymentRecipient: paymentRecipient || null,
      paymentContact: paymentContact || null,
    };
  } catch (err) {
    console.error('[BillingConfigService] Error al consultar SystemConfig:', err.message);
    const paymentMethod = (process.env.BILLING_PAYMENT_METHOD || '').trim() || null;
    const paymentRecipient = (process.env.BILLING_PAYMENT_RECIPIENT || '').trim() || null;
    const paymentContact = (process.env.BILLING_PAYMENT_CONTACT || '').trim() || null;

    return {
      paymentMethod: paymentMethod || null,
      paymentRecipient: paymentRecipient || null,
      paymentContact: paymentContact || null,
    };
  }
}
