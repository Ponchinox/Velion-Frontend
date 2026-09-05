import prisma from '../src/db.js';

async function auditTestTenantsReadOnly() {
  console.log('=== AUDITORÍA SOLO LECTURA DE TENANTS EN BD ===\n');

  // 1. Total general de tenants
  const totalTenantsCount = await prisma.tenant.count();
  console.log(`1. Total general de tenants en BD: ${totalTenantsCount}`);

  // 2. Tenants que coinciden con el patrón de test de campaigns worker
  const testTenantsPattern = await prisma.tenant.findMany({
    where: {
      OR: [
        { id: { startsWith: 'camp-t-' } },
        { name: { startsWith: 'Tenant camp-t-' } }
      ]
    },
    include: {
      users: { select: { id: true, email: true, role: true } },
      registeredNumbers: { select: { id: true, phoneNumber: true, instanceName: true, provider: true } },
      messages: { select: { id: true }, take: 5 },
      orders: { select: { id: true, totalAmount: true }, take: 5 },
      campaigns: {
        select: {
          id: true,
          name: true,
          status: true,
          _count: { select: { logs: true } }
        }
      },
      contacts: { select: { id: true } },
      customers: { select: { id: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`2. Total tenants con patrón 'camp-t-': ${testTenantsPattern.length}`);

  // 3. Revisar si hay otros tenants con patrones sintéticos de tests (ej. 'tenant-a', 'test-', etc.)
  const otherSuspiciousTenants = await prisma.tenant.findMany({
    where: {
      AND: [
        { NOT: { id: { startsWith: 'camp-t-' } } },
        { NOT: { name: { startsWith: 'Tenant camp-t-' } } },
        {
          OR: [
            { id: { startsWith: 'test-' } },
            { name: { startsWith: 'Test ' } },
            { id: { in: ['tenant-a', 'tenant-b', 'tenant-alpha', 'tenant-beta', 'tenant-off'] } }
          ]
        }
      ]
    },
    include: {
      users: { select: { id: true, email: true } },
      registeredNumbers: { select: { id: true } }
    }
  });

  console.log(`3. Otros tenants sospechosos de tests: ${otherSuspiciousTenants.length}`);
  if (otherSuspiciousTenants.length > 0) {
    for (const t of otherSuspiciousTenants) {
      console.log(`   - ID: ${t.id} | Name: "${t.name}" | Users: ${t.users.length} | Conns: ${t.registeredNumbers.length}`);
    }
  }

  // 4. Analizar los tenants con patrón 'camp-t-'
  if (testTenantsPattern.length > 0) {
    const dates = testTenantsPattern.map(t => t.createdAt.toISOString().slice(0, 10));
    const dateCounts = {};
    for (const d of dates) {
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    }
    console.log('\n4. Distribución por fecha de creación (camp-t-):', dateCounts);

    // Comprobar si alguno tiene usuarios reales
    const withUsers = testTenantsPattern.filter(t => t.users.length > 0);
    console.log(`5. ¿Tienen usuarios en tabla User? ${withUsers.length}`);

    // Comprobar si alguno tiene conexiones WhatsApp reales
    const withRealConn = testTenantsPattern.filter(t => t.registeredNumbers.length > 0);
    console.log(`6. ¿Tienen RegisteredWhatsAppNumber? ${withRealConn.length}`);
    if (withRealConn.length > 0) {
      console.log('   Ejemplos de RegisteredWhatsAppNumber en test tenants:');
      for (const t of withRealConn.slice(0, 5)) {
        console.log(`   - Tenant ${t.id}:`, t.registeredNumbers);
      }
    }

    // Comprobar mensajes reales
    const withMessages = testTenantsPattern.filter(t => t.messages.length > 0);
    console.log(`7. ¿Tienen registros en tabla Message? ${withMessages.length}`);

    // Comprobar órdenes reales
    const withOrders = testTenantsPattern.filter(t => t.orders.length > 0);
    console.log(`8. ¿Tienen órdenes comerciales? ${withOrders.length}`);

    // Comprobar campañas y CampaignLogs
    const withCampaigns = testTenantsPattern.filter(t => t.campaigns.length > 0);
    let totalTestLogs = 0;
    for (const t of testTenantsPattern) {
      for (const c of t.campaigns) {
        totalTestLogs += c._count.logs;
      }
    }
    console.log(`9. ¿Tienen Campaigns de test? ${withCampaigns.length} tenants (${totalTestLogs} CampaignLogs de test asociados)`);

    // Comprobar planes
    const plans = {};
    for (const t of testTenantsPattern) {
      plans[t.plan || 'Sin Plan'] = (plans[t.plan || 'Sin Plan'] || 0) + 1;
    }
    console.log('10. Distribución de Planes en test tenants:', plans);

    // Comprobar contactos y customers sintéticos
    let totalTestContacts = 0;
    let totalTestCustomers = 0;
    for (const t of testTenantsPattern) {
      totalTestContacts += t.contacts.length;
      totalTestCustomers += t.customers.length;
    }
    console.log(`11. Contactos sintéticos acumulados: ${totalTestContacts} | Customers sintéticos: ${totalTestCustomers}`);

    console.log('\n12. Primeros 5 ejemplos:');
    for (const t of testTenantsPattern.slice(0, 5)) {
      console.log(`   - ID: ${t.id} | Name: "${t.name}" | CreatedAt: ${t.createdAt.toISOString()}`);
    }

    console.log('\n13. Últimos 5 ejemplos:');
    for (const t of testTenantsPattern.slice(-5)) {
      console.log(`   - ID: ${t.id} | Name: "${t.name}" | CreatedAt: ${t.createdAt.toISOString()}`);
    }
  }

  // 14. Tenants LEGÍTIMOS (que NO son camp-t-)
  const legitTenants = await prisma.tenant.findMany({
    where: {
      AND: [
        { NOT: { id: { startsWith: 'camp-t-' } } },
        { NOT: { name: { startsWith: 'Tenant camp-t-' } } }
      ]
    },
    include: {
      users: { select: { email: true } },
      registeredNumbers: { select: { phoneNumber: true, instanceName: true } },
      _count: { select: { messages: true, orders: true, contacts: true, campaigns: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`\n=== 15. TENANTS LEGÍTIMOS RESTANTES (${legitTenants.length}) ===`);
  for (const t of legitTenants) {
    console.log(`   * ID: ${t.id}`);
    console.log(`     Name: "${t.name}" | Plan: "${t.plan}" | CreatedAt: ${t.createdAt.toISOString()}`);
    console.log(`     Users: ${t.users.map(u => u.email).join(', ') || 'NINGUNO'}`);
    console.log(`     WhatsApp: ${t.registeredNumbers.map(r => r.phoneNumber || r.instanceName).join(', ') || 'NINGUNA'}`);
    console.log(`     Conteos: Msgs=${t._count.messages}, Orders=${t._count.orders}, Contacts=${t._count.contacts}, Camps=${t._count.campaigns}`);
  }
}

auditTestTenantsReadOnly()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
