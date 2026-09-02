export function mapEvolutionConnectionState(state) {
  if (state === 'open') return 'CONNECTED';
  if (state === 'connecting') return 'CONNECTING';
  if (state === 'close') return 'DISCONNECTED';
  return 'UNKNOWN';
}

export async function determineReconciliationUpdates(connections, fetchEvolutionState) {
  const updates = [];
  
  const promises = connections.map(async (conn) => {
    if (!conn.instanceName) {
      updates.push({ conn, action: 'skip_no_instance' });
      return;
    }
    
    try {
      const evoData = await fetchEvolutionState(conn);
      const state = evoData?.state;
      const realState = mapEvolutionConnectionState(state);

      if (realState !== 'UNKNOWN' && realState !== conn.connectionState) {
        updates.push({ 
          conn, 
          newVelionState: realState, 
          action: 'update_state' 
        });
      } else {
        updates.push({ conn, action: 'no_change' });
      }
    } catch (err) {
      if (err.status === 404) {
        if (conn.connectionState !== 'DISCONNECTED') {
          updates.push({ 
            conn, 
            newVelionState: 'DISCONNECTED', 
            action: 'update_state' 
          });
        } else {
          updates.push({ conn, action: 'no_change' });
        }
      } else {
        updates.push({ conn, action: 'preserve_state_on_error', error: err.status || 'network_error' });
      }
    }
  });

  await Promise.allSettled(promises);
  return updates;
}

export async function applyReconciliationUpdates(updates, prismaClient) {
  const updatePromises = updates.map(async (update) => {
    const { conn, newVelionState, action } = update;
    
    if (action === 'update_state') {
      const updateResult = await prismaClient.registeredWhatsAppNumber.updateMany({
        where: { 
          id: conn.id,
          connectionStateUpdatedAt: conn.connectionStateUpdatedAt 
        },
        data: { connectionState: newVelionState, connectionStateUpdatedAt: new Date() }
      });
      
      if (updateResult.count > 0) {
        conn.connectionState = newVelionState;
      } else {
        // Race condition: webhook actualizó la BD, count = 0
        const freshConn = await prismaClient.registeredWhatsAppNumber.findUnique({
          where: { id: conn.id },
          select: { connectionState: true }
        });
        if (freshConn) {
          conn.connectionState = freshConn.connectionState;
        }
      }
    }
    return conn;
  });

  return Promise.all(updatePromises);
}

/**
 * Procesa el evento de webhook connection.update de forma segura y multi-tenant aislada.
 * Busca la conexión por su instanceName exacto en RegisteredWhatsAppNumber.
 * Nunca utiliza prefijos parciales de 8 caracteres ni recorre tenants con startsWith.
 */
export async function handleConnectionUpdateWebhook({
  instance,
  state,
  phone = null,
  prisma,
  validateAndRegister = null
}) {
  if (!instance || typeof instance !== 'string') {
    return { success: false, reason: 'NO_INSTANCE', updatedCount: 0 };
  }

  const velionState = mapEvolutionConnectionState(state);

  // 1. Buscar directamente el registro de RegisteredWhatsAppNumber por su instanceName EXACTO
  const registered = await (prisma.registeredWhatsAppNumber.findUnique
    ? prisma.registeredWhatsAppNumber.findUnique({ where: { instanceName: instance } })
    : prisma.registeredWhatsAppNumber.findFirst({ where: { instanceName: instance } }));

  // CASO A: Conexión ya registrada en la base de datos
  if (registered) {
    if (state === 'open' && phone && validateAndRegister) {
      const validation = await validateAndRegister(registered.tenantId, instance, phone);
      if (validation && validation.allowed === false) {
        console.warn(`🚨 [ConnectionUpdate] Registro rechazado por validación anti-fraude/límite para instancia: ${instance}`);
        return {
          success: false,
          mode: 'VALIDATION_REJECTED',
          reason: validation.reason || 'VALIDATION_FAILED',
          errorMessage: validation.errorMessage,
          updatedCount: 0
        };
      }
    }

    const updateResult = await prisma.registeredWhatsAppNumber.updateMany({
      where: {
        id: registered.id,
        tenantId: registered.tenantId,
        instanceName: instance
      },
      data: {
        connectionState: velionState,
        connectionStateUpdatedAt: new Date()
      }
    });

    return {
      success: true,
      mode: 'EXISTING_CONNECTION',
      tenantId: registered.tenantId,
      updatedCount: updateResult.count,
      connectionState: velionState
    };
  }

  // CASO B: Instancia NO encontrada en RegisteredWhatsAppNumber
  // Si el estado es close, connecting o cualquier otro NO 'open', NO creamos nada ni tocamos otros tenants
  if (state !== 'open') {
    return {
      success: false,
      mode: 'UNKNOWN_INSTANCE_SKIPPED',
      reason: 'INSTANCE_NOT_REGISTERED',
      updatedCount: 0
    };
  }

  // CASO B2: state === 'open' (Onboarding inicial / primer vínculo de QR)
  // 1) Si phone está disponible, verificar si ya existe un registro con ese número
  if (phone) {
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    if (cleanPhone) {
      const existingByPhone = await prisma.registeredWhatsAppNumber.findUnique({
        where: { phoneNumber: cleanPhone }
      });
      if (existingByPhone) {
        if (validateAndRegister) {
          const validation = await validateAndRegister(existingByPhone.tenantId, instance, cleanPhone);
          if (validation && validation.allowed === false) {
            console.warn(`🚨 [ConnectionUpdate Onboarding Phone] Registro rechazado por validación para instancia: ${instance}`);
            return {
              success: false,
              mode: 'VALIDATION_REJECTED',
              reason: validation.reason || 'VALIDATION_FAILED',
              errorMessage: validation.errorMessage,
              updatedCount: 0
            };
          }
        }
        const updateResult = await prisma.registeredWhatsAppNumber.updateMany({
          where: {
            id: existingByPhone.id,
            tenantId: existingByPhone.tenantId
          },
          data: {
            instanceName: instance,
            connectionState: velionState,
            connectionStateUpdatedAt: new Date()
          }
        });
        return {
          success: true,
          mode: 'ONBOARDING_MATCHED_BY_PHONE',
          tenantId: existingByPhone.tenantId,
          updatedCount: updateResult.count,
          connectionState: velionState
        };
      }
    }
  }

  // 2) Si es un número nuevo, verificar si la instancia codifica el UUID COMPLETO del tenant (36 caracteres)
  // Formato: bot_prod_<UUID> o bot_prod_<UUID>_<timestamp>
  let candidateTenantId = null;
  if (instance.startsWith('bot_prod_')) {
    const rawSuffix = instance.replace('bot_prod_', '');
    const uuidMatch = rawSuffix.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (uuidMatch) {
      candidateTenantId = uuidMatch[1];
    }
  }

  if (candidateTenantId) {
    const exactTenant = await prisma.tenant.findUnique({
      where: { id: candidateTenantId }
    });

    if (exactTenant && phone) {
      if (validateAndRegister) {
        const validation = await validateAndRegister(exactTenant.id, instance, phone);
        if (validation && validation.allowed === false) {
          console.warn(`🚨 [ConnectionUpdate Onboarding UUID] Registro rechazado por validación para instancia: ${instance}`);
          return {
            success: false,
            mode: 'VALIDATION_REJECTED',
            reason: validation.reason || 'VALIDATION_FAILED',
            errorMessage: validation.errorMessage,
            updatedCount: 0
          };
        }
      }
      const updateResult = await prisma.registeredWhatsAppNumber.updateMany({
        where: {
          instanceName: instance,
          tenantId: exactTenant.id
        },
        data: {
          connectionState: velionState,
          connectionStateUpdatedAt: new Date()
        }
      });
      return {
        success: true,
        mode: 'ONBOARDING_MATCHED_EXACT_UUID',
        tenantId: exactTenant.id,
        updatedCount: updateResult.count,
        connectionState: velionState
      };
    }
  }

  return {
    success: false,
    mode: 'UNRESOLVED_ONBOARDING',
    reason: 'TENANT_NOT_IDENTIFIED',
    updatedCount: 0
  };
}
