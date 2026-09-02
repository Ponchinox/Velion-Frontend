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
