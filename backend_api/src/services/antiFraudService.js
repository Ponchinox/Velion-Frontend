import axios from 'axios';
import prisma from '../db.js';

function getEvoHeaders() {
  return {
    headers: {
      apikey: process.env.EVOLUTION_API_KEY || 'A59F9002-9FFF-41CF-8EA6-58AEEB06ED7B',
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

  // 1. Obtener la información del Tenant
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId }
  });

  if (!tenant) return { allowed: true };

  // 2. ESCENARIO A: Verificación Anti-Fraude (Número asignado a OTRO Tenant)
  const registered = await prisma.registeredWhatsAppNumber.findUnique({
    where: { phoneNumber: cleanPhone }
  });

  if (registered && registered.tenantId !== tenantId) {
    console.warn(`🚨 [ANTI-FRAUDE BLOQUEADO] El número +${cleanPhone} pertenece al Tenant '${registered.tenantId}' pero fue intentado por '${tenantId}'. Destruyendo instancia.`);

    // Destruir la instancia en Evolution API inmediatamente
    try {
      await axios.delete(`${evoUrl}/instance/logout/${instanceName}`, getEvoHeaders()).catch(() => {});
      await axios.delete(`${evoUrl}/instance/delete/${instanceName}`, getEvoHeaders()).catch(() => {});
    } catch (destroyErr) {
      console.error('Error al destruir instancia fraudulenta:', destroyErr.message);
    }

    return {
      allowed: false,
      reason: 'FRAUD',
      errorMessage: 'Este número ya está vinculado a otra cuenta de nuestra plataforma. Inicie sesión en su cuenta original o contacte a soporte.'
    };
  }

  // 3. ESCENARIO B: Verificación de Límite de Conexiones Simultáneas de acuerdo al Plan
  const registeredCount = await prisma.registeredWhatsAppNumber.count({
    where: { tenantId }
  });

  const maxAllowed = tenant.connLimit || 1;

  // Si el número NO está registrado aún para este tenant y ya se alcanzó el límite permitido por su plan
  if (!registered && registeredCount >= maxAllowed) {
    console.warn(`🛑 [LÍMITE CONEXIONES EXCEDIDO] Tenant '${tenant.name}' intentó conectar un nuevo número (+${cleanPhone}) superando su límite de ${maxAllowed}.`);

    // Destruir la instancia en Evolution API
    try {
      await axios.delete(`${evoUrl}/instance/logout/${instanceName}`, getEvoHeaders()).catch(() => {});
      await axios.delete(`${evoUrl}/instance/delete/${instanceName}`, getEvoHeaders()).catch(() => {});
    } catch (destroyErr) {
      console.error('Error al destruir instancia por límite excedido:', destroyErr.message);
    }

    return {
      allowed: false,
      reason: 'LIMIT_EXCEEDED',
      errorMessage: 'Has alcanzado el límite de conexiones simultáneas de tu plan.'
    };
  }

  // 4. ESCENARIO C: Registro Exitoso y Amarre Permanente
  if (!registered) {
    console.log(`🔒 [ANTI-FRAUDE REGISTRADO] Vinculando permanentemente el número +${cleanPhone} al Tenant '${tenant.name}' (${tenantId}).`);
    await prisma.registeredWhatsAppNumber.create({
      data: {
        phoneNumber: cleanPhone,
        tenantId: tenantId
      }
    });
  }

  return { allowed: true, phoneNumber: cleanPhone };
}
