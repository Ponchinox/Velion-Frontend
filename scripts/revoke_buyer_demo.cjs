#!/usr/bin/env node
/**
 * REVOCADOR GENÉRICO DE DEMOS PARA COMPRADORES
 *
 * Desactiva el acceso a la demo de un comprador de forma segura:
 * 1. Invalida y resetea la contraseña del usuario a un hash criptográfico inalcanzable.
 * 2. Desactiva el tenant (active = false).
 * 3. Actualiza el estado en config/buyer_demos.json a "REVOKED".
 * 4. Remueve el tenant de DEMO_TENANT_IDS mediante sincronización atómica.
 * 5. Conserva todos los datos (chats, pedidos, notas) para auditoría.
 *
 * Opción de purga definitiva (separada y con confirmación explícita):
 *   --permanent --confirm-permanent-delete
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

let PrismaClient;
try {
  const prismaPkg = require(path.resolve(__dirname, '../backend_api/node_modules/@prisma/client'));
  PrismaClient = prismaPkg.PrismaClient;
} catch {
  try {
    PrismaClient = require('@prisma/client').PrismaClient;
  } catch {}
}

const REGISTRY_PATH = path.resolve(__dirname, '../config/buyer_demos.json');
const REGISTRY_SCRIPT = path.resolve(__dirname, 'manage_buyer_demos.cjs');

// Parse CLI args
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const parts = arg.slice(2).split('=');
    const key = parts[0];
    const val = parts.length > 1 ? parts.slice(1).join('=') : (args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true);
    flags[key] = val;
  }
}

const targetIdentifier = flags.slug || flags.tenantId || flags.buyer;
const isConfirmed = flags.confirm === true;
const isPermanent = flags.permanent === true;
const isPermanentConfirmed = flags['confirm-permanent-delete'] === true;

if (!targetIdentifier) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🔒 VELION AGENT — REVOCADOR SEGURO DE COMPRADORES DEMO');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('Uso:');
  console.log('  node scripts/revoke_buyer_demo.cjs --slug="slug" [--confirm]\n');
  console.log('Ejemplo de revocación (conserva datos para auditoría):');
  console.log('  node scripts/revoke_buyer_demo.cjs --slug="acme" --confirm\n');
  console.log('Ejemplo de purga definitiva (destructiva):');
  console.log('  node scripts/revoke_buyer_demo.cjs --slug="acme" --permanent --confirm-permanent-delete\n');
  console.log('Parámetros:');
  console.log('  --slug                        Slug o identificador del comprador');
  console.log('  --tenantId                    UUID del tenant');
  console.log('  --confirm                     Confirmación de revocación segura');
  console.log('  --permanent                   Habilitar modo de purga total');
  console.log('  --confirm-permanent-delete    Confirmación explícita para purga');
  process.exit(1);
}

// Cargar registro
if (!fs.existsSync(REGISTRY_PATH)) {
  console.error('❌ Archivo de registro no encontrado en:', REGISTRY_PATH);
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
const buyer = (registry.buyers || []).find(b => b.slug === targetIdentifier || b.tenantId === targetIdentifier);

if (!buyer) {
  console.error(`❌ Comprador no encontrado en el registro para: "${targetIdentifier}"`);
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log(`🔒 REVOCACIÓN DE DEMO: ${buyer.name.toUpperCase()} (${buyer.slug})`);
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`• Tenant ID:   ${buyer.tenantId}`);
console.log(`• Tenant Name: "${buyer.tenantName}"`);
console.log(`• Usuario:     ${buyer.email}`);
console.log(`• Tipo acción: ${isPermanent ? '🔥 PURGA DEFINITIVA' : '🛡️ REVOCACIÓN SEGURA (Conserva auditoría)'}`);
console.log(`• Modo:        ${isConfirmed || (isPermanent && isPermanentConfirmed) ? '⚡ CONFIRMADO' : '🔍 DRY-RUN'}`);
console.log('───────────────────────────────────────────────────────────────────\n');

if (isPermanent) {
  if (!isPermanentConfirmed) {
    console.log('⚠️  [SAFETY GATE] Se solicitó purga definitiva pero FALTA: --confirm-permanent-delete');
    console.log('   Operación abortada por seguridad.\n');
    process.exit(0);
  }
} else if (!isConfirmed) {
  console.log('⚠️  [SAFETY GATE] Modo DRY-RUN activado. No se realizaron modificaciones.');
  console.log('   Para ejecutar la revocación añade el flag: --confirm\n');
  console.log('Acciones que se ejecutarán con --confirm:');
  console.log('  1. Invalidar password del usuario (hash aleatorio inalcanzable).');
  console.log('  2. Desactivar Tenant (active = false).');
  console.log('  3. Marcar estado "REVOKED" en config/buyer_demos.json.');
  console.log('  4. Sincronizar DEMO_TENANT_IDS excluyendo este tenant.');
  console.log('  5. Preservar chats, órdenes e historial para Due Diligence y auditoría.\n');
  process.exit(0);
}

async function executeRevocation() {
  if (!PrismaClient) {
    console.error('❌ PrismaClient no disponible en este entorno.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (isPermanent && isPermanentConfirmed) {
      console.log('🔥 Iniciando purga definitiva de datos...');
      const tId = buyer.tenantId;

      // Borrar cascada manual defensiva
      console.log('  • Eliminando operational items...');
      await prisma.operationalItem.deleteMany({ where: { tenantId: tId } });

      console.log('  • Eliminando flujos...');
      await prisma.flow.deleteMany({ where: { tenantId: tId } });
      await prisma.automationFlow.deleteMany({ where: { tenantId: tId } });

      console.log('  • Eliminando mensajes y chats...');
      await prisma.message.deleteMany({ where: { tenantId: tId } });
      await prisma.chat.deleteMany({ where: { tenantId: tId } });

      console.log('  • Eliminando órdenes y items...');
      await prisma.orderItem.deleteMany({ where: { order: { tenantId: tId } } });
      await prisma.order.deleteMany({ where: { tenantId: tId } });

      console.log('  • Eliminando clientes y contactos...');
      await prisma.customer.deleteMany({ where: { tenantId: tId } });
      await prisma.contact.deleteMany({ where: { tenantId: tId } });

      console.log('  • Eliminando productos...');
      await prisma.product.deleteMany({ where: { user: { tenantId: tId } } });

      console.log('  • Eliminando usuarios...');
      await prisma.user.deleteMany({ where: { tenantId: tId } });

      console.log('  • Eliminando tenant...');
      await prisma.tenant.delete({ where: { id: tId } });

      console.log('  • Actualizando registro...');
      buyer.status = 'PURGED';
      fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');

      // Sincronizar DEMO_TENANT_IDS
      execSync(`node "${REGISTRY_SCRIPT}" sync-env`, { stdio: 'inherit' });

      console.log('\n✅ [PURGA DEFINITIVA COMPLETADA]');
      console.log(`El tenant ${tId} y todos sus datos asociados fueron eliminados.`);
      return;
    }

    // Revocación estándar (segura y auditable)
    console.log('1. Invalidando contraseña del usuario demo...');
    const unreachableHash = `$2a$10$REVOKED.${crypto.randomBytes(24).toString('base64url')}`;
    await prisma.user.updateMany({
      where: { tenantId: buyer.tenantId },
      data: { password: unreachableHash }
    });
    console.log(`   ✅ Contraseña invalidada para usuarios del tenant ${buyer.tenantId}`);

    console.log('2. Desactivando tenant...');
    await prisma.tenant.update({
      where: { id: buyer.tenantId },
      data: { active: false }
    });
    console.log('   ✅ Tenant desactivado (active = false)');

    console.log('3. Actualizando estado en config/buyer_demos.json...');
    execSync(`node "${REGISTRY_SCRIPT}" remove --slug="${buyer.slug}"`, { stdio: 'inherit' });

    console.log('4. Sincronizando DEMO_TENANT_IDS...');
    execSync(`node "${REGISTRY_SCRIPT}" sync-env`, { stdio: 'inherit' });

    console.log('\n🛡️ [REVOCACIÓN COMPLETADA]');
    console.log(`• Tenant ID:   ${buyer.tenantId}`);
    console.log(`• Estado:      REVOKED`);
    console.log(`• Login:       BLOQUEADO`);
    console.log(`• Datos:       PRESERVADOS PARA AUDITORÍA`);

  } finally {
    await prisma.$disconnect();
  }
}

executeRevocation().catch(err => {
  console.error('\n❌ ERROR EN REVOCACIÓN:', err.message);
  process.exit(1);
});
