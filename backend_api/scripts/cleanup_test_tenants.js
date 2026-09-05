import prisma from '../src/db.js';

// Lista explícita e inmutable de IDs protegidos de producción
const PROTECTED_TENANT_IDS = new Set([
  'dfe020e6-5e08-404c-9b89-ef3f08f2b150', // Velion Oficial
  '1f9cc3ef-6c2a-4309-bd20-86478edcb536', // Administración Central
  'c21cf593-4f96-4b30-97c5-4209fd02a918', // Internet
  'b2b283bf-1f5d-4ffd-b233-678e724b987f'  // XGodel
]);

const PROTECTED_TENANT_NAMES = new Set([
  'Velion Oficial',
  'Administración Central',
  'Internet',
  'XGodel'
]);

/**
 * Evalúa si un tenant es estrictamente un fixture sintético creado por tests.
 * DEBE cumplir TODOS los criterios sin excepción.
 */
export function isTestTenantFixture(tenant) {
  if (!tenant || !tenant.id || !tenant.name) return { isFixture: false, reason: 'Objeto inválido' };

  // 1. Protección absoluta por lista blanca
  if (PROTECTED_TENANT_IDS.has(tenant.id)) {
    return { isFixture: false, reason: 'ID en lista blanca de protección' };
  }
  if (PROTECTED_TENANT_NAMES.has(tenant.name)) {
    return { isFixture: false, reason: 'Nombre en lista blanca de protección' };
  }

  // 2. Prefijo exacto de test
  if (!tenant.id.startsWith('camp-t-')) {
    return { isFixture: false, reason: 'ID no comienza con camp-t-' };
  }
  if (!tenant.name.startsWith('Tenant camp-t-')) {
    return { isFixture: false, reason: 'Nombre no comienza con Tenant camp-t-' };
  }

  // 3. No debe tener usuarios humanos reales
  if (Array.isArray(tenant.users) && tenant.users.length > 0) {
    return { isFixture: false, reason: 'Tiene usuarios registrados en tabla User' };
  }

  // 4. No debe tener órdenes comerciales
  if (Array.isArray(tenant.orders) && tenant.orders.length > 0) {
    return { isFixture: false, reason: 'Tiene órdenes comerciales en tabla Order' };
  }

  // 5. No debe tener mensajes en livechat (Message)
  if (Array.isArray(tenant.messages) && tenant.messages.length > 0) {
    return { isFixture: false, reason: 'Tiene mensajes en tabla Message' };
  }

  // 6. Conexiones WhatsApp: si tiene, SOLO pueden ser las sintéticas 'meta-camp-t-'
  if (Array.isArray(tenant.registeredNumbers) && tenant.registeredNumbers.length > 0) {
    for (const r of tenant.registeredNumbers) {
      if (!String(r.phoneNumber || '').startsWith('meta-camp-t-')) {
        return { isFixture: false, reason: `Tiene número WhatsApp real no sintético: ${r.phoneNumber}` };
      }
    }
  }

  return { isFixture: true, reason: 'Cumple todos los criterios de fixture camp-t-*' };
}

async function main() {
  const isExecute = process.argv.includes('--execute');
  const envConfirmed = process.env.CONFIRM_CLEANUP === 'YES_DELETE_TEST_TENANTS';

  console.log('======================================================================');
  console.log('🛡️ VELION TEST TENANTS CLEANUP TOOL');
  console.log(`Modo de ejecución: ${isExecute && envConfirmed ? '🔴 EXECUTE (BORRADO REAL)' : '🟡 DRY RUN (SOLO LECTURA)'}`);
  console.log('======================================================================\n');

  // 1. Obtener todos los candidatos que inicien con camp-t-
  const candidateTenants = await prisma.tenant.findMany({
    where: {
      OR: [
        { id: { startsWith: 'camp-t-' } },
        { name: { startsWith: 'Tenant camp-t-' } }
      ]
    },
    include: {
      users: { select: { id: true, email: true } },
      registeredNumbers: { select: { id: true, phoneNumber: true } },
      orders: { select: { id: true } },
      messages: { select: { id: true }, take: 1 },
      campaigns: {
        select: {
          id: true,
          _count: { select: { logs: true } }
        }
      },
      contacts: { select: { id: true } },
      customers: { select: { id: true } },
      chats: { select: { id: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  const fixturesToClean = [];
  const rejectedProtected = [];

  for (const t of candidateTenants) {
    const evalResult = isTestTenantFixture(t);
    if (evalResult.isFixture) {
      fixturesToClean.push(t);
    } else {
      rejectedProtected.push({ tenant: t, reason: evalResult.reason });
    }
  }

  // Conteos de datos relacionados a limpiar
  let totalCampaigns = 0;
  let totalCampaignLogs = 0;
  let totalContacts = 0;
  let totalCustomers = 0;
  let totalChats = 0;
  let totalRegisteredNumbers = 0;

  for (const t of fixturesToClean) {
    totalContacts += t.contacts.length;
    totalCustomers += t.customers.length;
    totalChats += t.chats.length;
    totalRegisteredNumbers += t.registeredNumbers.length;
    totalCampaigns += t.campaigns.length;
    for (const c of t.campaigns) {
      totalCampaignLogs += c._count.logs;
    }
  }

  console.log(`Candidatos evaluados con prefijo 'camp-t-': ${candidateTenants.length}`);
  console.log(`✅ Fixtures identificados para limpieza:     ${fixturesToClean.length}`);
  console.log(`🛡️ Candidatos rechazados/protegidos:        ${rejectedProtected.length}`);

  if (rejectedProtected.length > 0) {
    console.log('\nDetalle de rechazados por protección:');
    for (const r of rejectedProtected) {
      console.log(`  - [PROTEGIDO] ID: ${r.tenant.id} | Name: "${r.tenant.name}" | Causa: ${r.reason}`);
    }
  }

  console.log('\n--- DATOS ASOCIADOS A LIMPIAR ---');
  console.log(`- Campaigns:              ${totalCampaigns}`);
  console.log(`- CampaignLogs:          ${totalCampaignLogs}`);
  console.log(`- Contacts sintéticos:   ${totalContacts}`);
  console.log(`- Customers sintéticos:  ${totalCustomers}`);
  console.log(`- Chats sintéticos:      ${totalChats}`);
  console.log(`- WhatsApp sintéticos:   ${totalRegisteredNumbers}`);

  if (fixturesToClean.length > 0) {
    console.log('\nPrimeros 3 fixtures que se eliminarían:');
    for (const t of fixturesToClean.slice(0, 3)) {
      console.log(`  - ${t.id} ("${t.name}") creado el ${t.createdAt.toISOString()}`);
    }
    console.log('Últimos 3 fixtures que se eliminarían:');
    for (const t of fixturesToClean.slice(-3)) {
      console.log(`  - ${t.id} ("${t.name}") creado el ${t.createdAt.toISOString()}`);
    }
  }

  if (!isExecute || !envConfirmed) {
    console.log('\n======================================================================');
    console.log('🟡 REPORTE DRY RUN: CERO REGISTROS HAN SIDO MODIFICADOS O BORRADOS.');
    console.log('Para ejecutar el borrado real se requiere:');
    console.log('  CONFIRM_CLEANUP=YES_DELETE_TEST_TENANTS node backend_api/scripts/cleanup_test_tenants.js --execute');
    console.log('======================================================================');
    return { dryRun: true, count: fixturesToClean.length };
  }

  // ── EJECUCIÓN REAL CONTROLADA (Solo cuando se pasa --execute y CONFIRM_CLEANUP) ──
  console.log('\n🔴 INICIANDO BORRADO EN CASCADA SEGURO (BATCH POR BATCH)...');
  let deletedCount = 0;

  for (const t of fixturesToClean) {
    const tenantId = t.id;
    try {
      // 1. Logs y campañas
      await prisma.campaignLog.deleteMany({ where: { campaign: { tenantId } } });
      await prisma.campaign.deleteMany({ where: { tenantId } });

      // 2. Conexiones sintéticas
      await prisma.registeredWhatsAppNumber.deleteMany({ where: { tenantId } });

      // 3. Livechat sintético
      await prisma.message.deleteMany({ where: { tenantId } });
      await prisma.chat.deleteMany({ where: { tenantId } });

      // 4. CRM sintético
      await prisma.contact.deleteMany({ where: { tenantId } });
      await prisma.customer.deleteMany({ where: { tenantId } });

      // 5. Tenant
      await prisma.tenant.delete({ where: { id: tenantId } });

      deletedCount++;
    } catch (err) {
      console.error(`❌ Error al eliminar fixture tenant ${tenantId}:`, err.message);
    }
  }

  console.log(`\n🎉 LIMPIEZA FINALIZADA: ${deletedCount}/${fixturesToClean.length} test tenants eliminados exitosamente.`);
  return { dryRun: false, count: deletedCount };
}

import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
