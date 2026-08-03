import axios from 'axios';
import prisma from '../db.js';

function getEvoHeaders() {
  return {
    headers: {
      apikey: process.env.EVOLUTION_API_KEY || '',
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Valida un número de WhatsApp recién conectado según las reglas Anti-Fraude y Límites de Plan:
 * 
 * ESCENARIO A (Anti-Fraude): Si el número ya pertenece a OTRO tenant, destruye la instancia y bloquea.
 * ESCENARIO B (Límite Conexiones Simultáneas): Si se supera el connLimit del plan, destruye la instancia.
 * ESCENARIO C (Registro Exitoso): Si es válido y nuevo, amarra el número permanentemente a este Tenant.
 */
export async function validateAndRegisterWhatsAppConnection(tenantId, instanceName, rawPhone) {
  if (!rawPhone || !tenantId) return { allowed: true };

  // Formatear el número de teléfono limpiando cualquier caracter no numérico
  const cleanPhone = String(rawPhone).replace(/[^0-9]/g, '');
  if (!cleanPhone) return { allowed: true };

  const evoUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

  try {
    // Transacción interactiva de Prisma para garantizar atomicidad y prevenir race conditions
    const result = await prisma.$transaction(async (tx) => {
      // 1. Obtener la información del Tenant
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId }
      });

      if (!tenant) return { allowed: true };

      // 2. ESCENARIO A: Verificación Anti-Fraude (Número asignado a OTRO Tenant)
      const registered = await tx.registeredWhatsAppNumber.findUnique({
        where: { phoneNumber: cleanPhone }
      });

      if (registered && registered.tenantId !== tenantId) {
        return {
          allowed: false,
          reason: 'FRAUD',
          errorMessage: 'Este número ya está vinculado a otra cuenta de nuestra plataforma. Inicie sesión en su cuenta original o contacte a soporte.'
        };
      }

      // 3. ESCENARIO B: Verificación de Límite de Conexiones Simultáneas de acuerdo al Plan
      if (!registered) {
        const registeredCount = await tx.registeredWhatsAppNumber.count({
          where: { tenantId }
        });

        const maxAllowed = tenant.connLimit || 1;

        if (registeredCount >= maxAllowed) {
          return {
            allowed: false,
            reason: 'LIMIT_EXCEEDED',
            errorMessage: 'Has alcanzado el límite de conexiones simultáneas de tu plan.'
          };
        }

        // 4. ESCENARIO C: Registro Exitoso y Amarre Permanente dentro de la misma transacción
        console.log(`🔒 [ANTI-FRAUDE REGISTRADO] Vinculando permanentemente el número +${cleanPhone} al Tenant '${tenant.name}' (${tenantId}).`);
        await tx.registeredWhatsAppNumber.create({
          data: {
            phoneNumber: cleanPhone,
            tenantId: tenantId
          }
        });
      }

      return { allowed: true, phoneNumber: cleanPhone };
    });

    // Si la transacción determinó que NO está permitido, destruir la instancia no autorizada en Evolution API
    if (!result.allowed) {
      console.warn(`🚨 [ANTI-FRAUDE / LÍMITE BLOQUEADO] Razón: ${result.reason} para +${cleanPhone} en Tenant '${tenantId}'. Destruyendo instancia.`);
      try {
        await axios.delete(`${evoUrl}/instance/logout/${instanceName}`, getEvoHeaders()).catch(() => {});
        await axios.delete(`${evoUrl}/instance/delete/${instanceName}`, getEvoHeaders()).catch(() => {});
      } catch (destroyErr) {
        console.error('Error al destruir instancia no autorizada:', destroyErr.message);
      }
    }

    return result;
  } catch (error) {
    // Si ocurre un error de duplicado por colisión concurrente (P2002), lo manejamos limpiamente
    if (error.code === 'P2002') {
      console.warn(`⚠️ [ANTI-FRAUDE COLISIÓN] Intento de registro concurrente duplicado para +${cleanPhone}.`);
      return { allowed: true, phoneNumber: cleanPhone };
    }
    console.error('❌ Error en validateAndRegisterWhatsAppConnection:', error);
    return { allowed: true };
  }
}
