#!/usr/bin/env node
/**
 * PROVISIONADOR GENÉRICO E IDEMPOTENTE DE DEMOS PARA COMPRADORES
 *
 * Automatiza la creación, dataset sintético enriquecido, credenciales y registro de demo
 * para potenciales compradores de Velion Agent (ej. marketplaces como IndieMaker).
 *
 * Invariantes de Seguridad:
 * - Cero media de clientes reales (exclusivamente assets sintéticos).
 * - Outbound WhatsApp: Fail-closed por defecto (sin números en whitelist).
 * - SuperAdmin: Bloqueado (rol estrictamente 'client').
 * - Facturación: Oculta / privada en interfaz (isDemo=true).
 * - Credenciales: Guardadas exclusivamente en scratch/<slug>_demo_credentials.secure.txt.
 * - Password: Cero impresión de plaintext en logs o consola.
 * - Confirmación: Requiere --confirm para ejecutar cambios reales (por defecto: DRY-RUN).
 * - Reset: Soporta --reset para purgar y restaurar los datos al estado inicial limpio.
 * - Remoto: Soporta --remote para ejecutar la provisión directamente en el VPS de producción.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');

// Parse args
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

// Validar argumentos
const buyerName = flags.name || flags.buyer || process.env.BUYER_NAME;
const buyerSlug = (flags.slug || process.env.BUYER_SLUG || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
const isConfirmed = flags.confirm === true || process.env.CONFIRM_PROVISION === 'true';
const isReset = flags.reset === true || flags['reset-data'] === true;
const isRemote = flags.remote === true || flags['remote-vps'] === true;
const isAutoRenew = flags['auto-renew'] === true || flags.autoRenew === true || flags.autoRenew === 'true';
const validityHours = parseInt(flags.hours || flags['validity-hours'] || '48', 10);
const sector = flags.sector || 'Comercio & Retail';

if (!buyerName || !buyerSlug) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🏭 VELION AGENT — PROVISIONADOR GENÉRICO DE COMPRADORES DEMO');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('Uso:');
  console.log('  node scripts/provision_buyer_demo.cjs --name="Nombre Empresa" --slug="slug" [--hours=48] [--confirm] [--reset] [--remote]\n');
  console.log('Ejemplo:');
  console.log('  node scripts/provision_buyer_demo.cjs --name="IndieMaker" --slug="indiemaker" --confirm --remote\n');
  console.log('Parámetros:');
  console.log('  --name            Nombre comercial de la empresa compradora (Requerido)');
  console.log('  --slug            Identificador en minúsculas y sin espacios (Requerido)');
  console.log('  --email           Email de acceso demo (Opcional, default: <slug>.demo@velion.test)');
  console.log('  --password        Password personalizado (Opcional, se autogenera si se omite)');
  console.log('  --hours           Horas de vigencia de la demo (Opcional, default: 48)');
  console.log('  --sector          Rubro o sector comercial (Opcional, default: Comercio & Retail)');
  console.log('  --confirm         Ejecutar aprovisionamiento real (Sin esto corre en DRY-RUN)');
  console.log('  --reset           Limpiar y resembrar todos los datos del tenant demo al estado inicial');
  console.log('  --remote          Despachar ejecución segura al VPS de producción vía SSH');
  process.exit(1);
}

const buyerEmail = flags.email || process.env.BUYER_DEMO_EMAIL || `${buyerSlug}.demo@velion.test`;

// Generar contraseña segura aleatoria si no fue suministrada
let rawPassword = flags.password || process.env.BUYER_DEMO_PASSWORD;
let isGeneratedPassword = false;
if (!rawPassword) {
  const randomChars = crypto.randomBytes(18).toString('base64url');
  rawPassword = `${randomChars}!M9#`;
  isGeneratedPassword = true;
}

const tenantDisplayName = `${buyerName} Demo`;

console.log('═══════════════════════════════════════════════════════════════════');
console.log(`🏭 PROVISIÓN DE DEMO: ${buyerName.toUpperCase()}`);
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`• Comprador:       ${buyerName}`);
console.log(`• Slug:            ${buyerSlug}`);
console.log(`• Tenant Name:     "${tenantDisplayName}"`);
console.log(`• Email:           ${buyerEmail}`);
console.log(`• Vigencia:        ${validityHours} horas`);
console.log(`• Modo Ejecución:  ${isRemote ? '🌐 REMOTO (VPS)' : '💻 NATIVO / LOCAL'}`);
console.log(`• Modo Acción:     ${isConfirmed ? '⚡ CONFIRMADA' : '🔍 DRY-RUN (Simulación)'}`);
console.log(`• Reset Limpieza:  ${isReset ? '♻️ SI (--reset activo)' : 'NO (conservativo)'}`);
console.log('───────────────────────────────────────────────────────────────────\n');

// Si no está confirmado, mostrar plan y salir
if (!isConfirmed) {
  console.log('⚠️  [SAFETY GATE] Modo DRY-RUN activado. No se realizaron modificaciones.');
  console.log('   Para ejecutar el aprovisionamiento real añade el flag: --confirm\n');
  console.log('Plan de acciones que se ejecutarían con --confirm:');
  console.log(`  1. Generar credenciales en: scratch/${buyerSlug}_demo_credentials.secure.txt`);
  console.log(`  2. Hashear contraseña de alta entropía con bcrypt.`);
  console.log(`  3. Crear o actualizar Tenant "${tenantDisplayName}" en PostgreSQL.`);
  console.log(`  4. Crear o actualizar Usuario ${buyerEmail} (rol 'client', tenant-scoped).`);
  console.log(`  5. Crear catálogo de productos sintéticos (Smartwatch X1, Audífonos AirBeat Pro, Parlante SoundMini, Smartband PulseFit, Cable Rápido UltraUSB).`);
  console.log(`  6. Crear contactos y clientes sintéticos (Interesados, Clientes Frecuentes, Nuevos Leads).`);
  console.log(`  7. Crear chats y mensajes realistas de prueba.`);
  console.log(`  8. Crear órdenes sintéticas (Pagada y Pendiente).`);
  console.log(`  9. Crear notas y tareas operacionales.`);
  console.log(`  10. Crear Follow-up Sequence y Attempt sintético.`);
  console.log(`  11. Crear Campaña y CampaignLogs sintéticos con métricas.`);
  console.log(`  12. Crear FlowBuilder sintético con validación de nodos.`);
  console.log(`  13. Registrar comprador en config/buyer_demos.json.`);
  console.log(`  14. Sincronizar DEMO_TENANT_IDS de forma atómica.`);
  console.log(`  15. Mantener WhatsApp Outbound en FAIL-CLOSED (sin números en lista blanca).\n`);
  process.exit(0);
}

// ── MODO REMOTO (VPS) ───────────────────────────────────────────────────────
if (isRemote) {
  console.log('🚀 Iniciando aprovisionamiento remoto en el VPS de producción...');
  const sshKey = process.env.SSH_KEY_PATH || path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'id_ed25519');
  const vpsHost = process.env.VPS_HOST || 'root@127.0.0.1';
  const appUrl = flags.url || process.env.APP_URL || 'https://app.tuempresa.com';

  // 1. Guardar credenciales localmente
  const credPath = path.resolve(`scratch/${buyerSlug}_demo_credentials.secure.txt`);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validityHours * 60 * 60 * 1000).toISOString();
  const credContent = [
    'BUYER DEMO ACCESS',
    '',
    `BUYER: ${buyerName}`,
    `URL: ${appUrl}`,
    `EMAIL: ${buyerEmail}`,
    `PASSWORD: ${rawPassword}`,
    `VALIDITY: ${validityHours} horas (hasta ${expiresAt})`,
    `ROLE: client`,
    `GENERATED_AT: ${now.toISOString()}`
  ].join('\n');

  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  fs.writeFileSync(credPath, credContent, { mode: 0o600 });
  console.log(`✅ Credenciales generadas y custodiadas localmente en: ${credPath}`);

  // 2. Sincronizar este script y manage_buyer_demos al VPS
  console.log('📡 Sincronizando scripts al VPS...');
  execFileSync('scp', ['-i', sshKey, 'scripts/provision_buyer_demo.cjs', `${vpsHost}:/home/velion/velion-app/scripts/provision_buyer_demo.cjs`]);
  execFileSync('scp', ['-i', sshKey, 'scripts/manage_buyer_demos.cjs', `${vpsHost}:/home/velion/velion-app/scripts/manage_buyer_demos.cjs`]);

  // Sincronizar controladores blindados
  console.log('🛡️ Sincronizando controladores protegidos al VPS...');
  execFileSync('scp', ['-i', sshKey, 'backend_api/src/controllers/userController.js', `${vpsHost}:/home/velion/velion-app/backend_api/src/controllers/userController.js`]);
  execFileSync('scp', ['-i', sshKey, 'backend_api/src/controllers/connectionController.js', `${vpsHost}:/home/velion/velion-app/backend_api/src/controllers/connectionController.js`]);
  execFileSync('scp', ['-i', sshKey, 'backend_api/src/controllers/metaOnboardingController.js', `${vpsHost}:/home/velion/velion-app/backend_api/src/controllers/metaOnboardingController.js`]);

  // 3. Ejecutar provisión en el VPS
  console.log('⚡ Ejecutando aprovisionamiento en base de datos del VPS...');
  const remoteCmd = `
    cd /home/velion/velion-app &&
    node scripts/provision_buyer_demo.cjs \
      --name="${buyerName}" \
      --slug="${buyerSlug}" \
      --email="${buyerEmail}" \
      --password="${rawPassword}" \
      --hours=${validityHours} \
      --sector="${sector}" \
      --url="${appUrl}" \
      ${isReset ? '--reset' : ''} \
      ${isAutoRenew ? '--auto-renew' : ''} \
      --confirm
  `;

  const remoteOut = execFileSync('ssh', ['-i', sshKey, vpsHost, remoteCmd], { encoding: 'utf8', timeout: 35000 });
  console.log(remoteOut.trim());

  // 4. Recargar backend para aplicar DEMO_TENANT_IDS sincronizado
  console.log('\n🔄 Recargando velion-backend para aplicar nuevo DEMO_TENANT_IDS...');
  execFileSync('ssh', ['-i', sshKey, vpsHost, 'pm2 reload velion-backend'], { encoding: 'utf8', timeout: 20000 });
  console.log('✅ velion-backend recargado con éxito.');

  // 5. Traer buyer_demos.json actualizado del VPS
  try {
    execFileSync('scp', ['-i', sshKey, `${vpsHost}:/home/velion/velion-app/config/buyer_demos.json`, 'config/buyer_demos.json']);
    console.log('✅ config/buyer_demos.json sincronizado localmente.');
  } catch {}

  console.log('\n🎉 [APROVISIONAMIENTO REMOTO COMPLETADO EXITOSAMENTE]');
  console.log(`• Comprador:   ${buyerName} (${buyerSlug})`);
  console.log(`• Usuario:     ${buyerEmail}`);
  console.log(`• URL Login:   ${appUrl}`);
  console.log(`• Credenciales guardadas en: scratch/${buyerSlug}_demo_credentials.secure.txt`);
  process.exit(0);
}

// ── MODO NATIVO / LOCAL ─────────────────────────────────────────────────────
let bcrypt;
let PrismaClient;

try {
  bcrypt = require(path.resolve(__dirname, '../backend_api/node_modules/bcryptjs'));
} catch {
  try {
    bcrypt = require('bcryptjs');
  } catch {
    console.error('❌ Error: bcryptjs no disponible');
  }
}

try {
  const prismaPkg = require(path.resolve(__dirname, '../backend_api/node_modules/@prisma/client'));
  PrismaClient = prismaPkg.PrismaClient;
} catch {
  try {
    PrismaClient = require('@prisma/client').PrismaClient;
  } catch {}
}

let dotenv;
try {
  dotenv = require('dotenv');
} catch {
  try {
    dotenv = require(path.resolve(__dirname, '../backend_api/node_modules/dotenv'));
  } catch {}
}
if (dotenv) {
  const envPath = path.resolve(__dirname, '../backend_api/.env');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

async function runProvisioning() {
  if (!PrismaClient) {
    console.error('❌ PrismaClient no está disponible en este entorno.');
    process.exit(1);
  }

  // 1. Guardar credenciales de forma segura en scratch/
  const credPath = path.resolve(`scratch/${buyerSlug}_demo_credentials.secure.txt`);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validityHours * 60 * 60 * 1000).toISOString();
  const appUrl = process.env.PUBLIC_APP_URL || flags.url || 'https://demo.velion.app';

  const credContent = [
    'BUYER DEMO ACCESS',
    '',
    `BUYER: ${buyerName}`,
    `URL: ${appUrl}`,
    `EMAIL: ${buyerEmail}`,
    `PASSWORD: ${rawPassword}`,
    `VALIDITY: ${validityHours} horas (hasta ${expiresAt})`,
    `ROLE: client`,
    `GENERATED_AT: ${now.toISOString()}`
  ].join('\n');

  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  fs.writeFileSync(credPath, credContent, { mode: 0o600 });
  console.log(`✅ Credenciales generadas y custodiadas en: ${credPath}`);
  console.log(`   (Permisos restrictivos; contraseña protegida, jamás impresa en logs)`);

  // 2. Hashear password
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  // 3. Inicializar Prisma
  const prisma = new PrismaClient();

  try {
    console.log('\n1. Verificando plan activo para evaluación...');
    let plan = await prisma.plan.findFirst({ where: { name: 'Pro' } });
    if (!plan) plan = await prisma.plan.findFirst({ where: { active: true } });
    const planName = plan?.name || 'Pro';
    const planId = plan?.id || null;

    console.log(`2. Aprovisionando Tenant "${tenantDisplayName}"...`);
    let tenant = await prisma.tenant.findFirst({ where: { name: tenantDisplayName } });
    let isNewTenant = false;
    if (!tenant) {
      isNewTenant = true;
      tenant = await prisma.tenant.create({
        data: {
          name: tenantDisplayName,
          companyName: tenantDisplayName,
          plan: planName,
          planId: planId,
          msgLimit: 5000,
          connLimit: 3,
          active: true,
          aiEnabled: true,
          marketingModeEnabled: true,
          businessSector: sector,
          bankAccounts: 'BCP Cuenta Corriente Soles: 191-11223344-0-55, Interbank: 200-3004005001, Yape / Plin corporativo.',
          termsAndPolicies: `Políticas Demo ${buyerName}: Envíos express en 24h a todo el país. Garantía oficial de fábrica de 12 meses con reemplazo inmediato.`,
          customPrompt: `Eres el asesor virtual inteligente de ${tenantDisplayName}. Asesora con cordialidad, profesionalismo y precisión sobre productos tecnológicos de consumo y ventas.`,
          botRole: `Asesor Comercial ${tenantDisplayName}`
        }
      });
      console.log(`   ✅ Tenant creado: ${tenant.id}`);
    } else {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          active: true,
          plan: planName,
          planId: planId,
          msgLimit: 5000,
          connLimit: 3,
          aiEnabled: true,
          marketingModeEnabled: true,
          businessSector: sector,
          termsAndPolicies: `Políticas Demo ${buyerName}: Envíos express en 24h a todo el país. Garantía oficial de fábrica de 12 meses con reemplazo inmediato.`,
          customPrompt: `Eres el asesor virtual inteligente de ${tenantDisplayName}. Asesora con cordialidad, profesionalismo y precisión sobre productos tecnológicos de consumo y ventas.`,
          botRole: `Asesor Comercial ${tenantDisplayName}`
        }
      });
      console.log(`   ℹ️ Tenant existente actualizado: ${tenant.id}`);
    }

    const tenantId = tenant.id;

    console.log(`3. Aprovisionando Usuario ${buyerEmail}...`);
    let user = await prisma.user.findUnique({ where: { email: buyerEmail } });
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          name: `Evaluador ${buyerName}`,
          email: buyerEmail,
          password: passwordHash,
          role: 'client',
          tenantId: tenantId
        }
      });
      console.log(`   ✅ Usuario creado: ${user.email} (Rol: client)`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          password: passwordHash,
          tenantId: tenantId,
          role: 'client'
        }
      });
      console.log(`   ℹ️ Usuario actualizado: ${user.email} (Rol: client)`);
    }

    // ── PURGA SELECTIVA SI --reset ESTÁ ACTIVO ──
    if (isReset) {
      console.log('\n♻️  [RESET] Purgando datos sintéticos existentes del tenant demo...');
      await prisma.campaignLog.deleteMany({ where: { campaign: { tenantId } } });
      await prisma.campaign.deleteMany({ where: { tenantId } });
      await prisma.followUpAttempt.deleteMany({ where: { sequence: { tenantId } } });
      await prisma.followUpSequence.deleteMany({ where: { tenantId } });
      await prisma.operationalItem.deleteMany({ where: { tenantId } });
      await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
      await prisma.order.deleteMany({ where: { tenantId } });
      await prisma.message.deleteMany({ where: { tenantId } });
      await prisma.chat.deleteMany({ where: { tenantId } });
      await prisma.customer.deleteMany({ where: { tenantId } });
      await prisma.contact.deleteMany({ where: { tenantId } });
      await prisma.product.deleteMany({ where: { userId: user.id } });
      console.log('   ✅ Datos sintéticos purgados.');
    }

    // ── 4. PRODUCTOS SINTÉTICOS ──
    console.log('4. Aprovisionando catálogo de productos sintéticos enriquecido...');
    const mediaHost = process.env.PUBLIC_APP_URL || '';
    const baseMediaUrl = `${mediaHost}/media/tenants/${tenantId}/products/images`;
    const syntheticProducts = [
      {
        name: 'Smartwatch X1',
        description: 'Reloj inteligente con pantalla AMOLED de 1.4 pulgadas, monitoreo de frecuencia cardíaca y 7 días de batería.',
        category: 'Wearables',
        price: 189.0,
        promotionalPrice: 169.0,
        imageUrl: `${baseMediaUrl}/smartwatch-x1.png`,
        images: [`${baseMediaUrl}/smartwatch-x1.png`],
        tags: ['smartwatch', 'fitness', 'salud'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true
      },
      {
        name: 'Audífonos AirBeat Pro',
        description: 'Audífonos inalámbricos con cancelación activa de ruido (ANC), estuche de carga rápida USB-C y 32h de autonomía.',
        category: 'Audio',
        price: 149.0,
        promotionalPrice: 129.0,
        imageUrl: `${baseMediaUrl}/airbeat-pro.png`,
        images: [`${baseMediaUrl}/airbeat-pro.png`],
        tags: ['auriculares', 'bluetooth', 'anc', 'audio'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true
      },
      {
        name: 'Parlante SoundMini',
        description: 'Altavoz Bluetooth ultracompacto con certificación IPX7 contra agua y bajos profundos.',
        category: 'Audio',
        price: 89.0,
        imageUrl: `${baseMediaUrl}/soundmini.png`,
        images: [`${baseMediaUrl}/soundmini.png`],
        tags: ['parlante', 'bluetooth', 'portatil'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true
      },
      {
        name: 'Smartband PulseFit',
        description: 'Banda deportiva inteligente con sensor SpO2, resistencia al agua 5ATM y 14 modos deportivos.',
        category: 'Wearables',
        price: 79.0,
        imageUrl: `${baseMediaUrl}/pulsefit.png`,
        images: [`${baseMediaUrl}/pulsefit.png`],
        tags: ['smartband', 'deporte', 'resistencia'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true
      },
      {
        name: 'Cable Rápido UltraUSB',
        description: 'Cable reforzado trenzado USB-C a USB-C de 100W con soporte de carga ultra rápida y transferencia de datos.',
        category: 'Accesorios',
        price: 29.0,
        imageUrl: `${baseMediaUrl}/ultra-usb.png`,
        images: [`${baseMediaUrl}/ultra-usb.png`],
        tags: ['cable', 'usb-c', 'carga_rapida'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true
      }
    ];

    const productMap = {};
    for (const prodData of syntheticProducts) {
      let prod = await prisma.product.findFirst({
        where: { name: prodData.name, userId: user.id }
      });
      if (!prod) {
        prod = await prisma.product.create({
          data: { ...prodData, userId: user.id }
        });
        console.log(`   ✅ Producto creado: ${prod.name}`);
      } else {
        prod = await prisma.product.update({
          where: { id: prod.id },
          data: prodData
        });
        console.log(`   ℹ️ Producto actualizado: ${prod.name}`);
      }
      productMap[prod.name] = prod;
    }

    // ── 5. CONTACTOS Y CLIENTES SINTÉTICOS ──
    console.log('5. Aprovisionando múltiples contactos y clientes sintéticos...');
    const cleanSlugDigits = String(Math.abs(buyerSlug.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0))).slice(0, 6);
    
    const contactsData = [
      {
        name: `Cliente Demo (${buyerName})`,
        phone: `51900${cleanSlugDigits.padStart(6, '0')}`,
        category: 'Interesados',
        tags: ['demo', 'evaluacion', buyerSlug],
        lastInteraction: 'Consulta sobre Audífonos AirBeat Pro',
        preferences: 'Prefiere atención por WhatsApp y entrega express en Lima'
      },
      {
        name: 'María Rodríguez (VIP)',
        phone: `51901${cleanSlugDigits.padStart(6, '0')}`,
        category: 'Clientes Frecuentes',
        tags: ['demo', 'vip', 'cliente_frecuente'],
        lastInteraction: 'Confirmación de orden Smartwatch X1',
        preferences: 'Cliente VIP; solicita factura electrónica y envío prioritario'
      },
      {
        name: 'Carlos Mendoza (Lead)',
        phone: `51902${cleanSlugDigits.padStart(6, '0')}`,
        category: 'Nuevos Leads',
        tags: ['demo', 'nuevo_lead', 'campaña_q3'],
        lastInteraction: 'Consulta general de catálogo y formas de pago',
        preferences: 'Interesado en gadgets deportivos'
      }
    ];

    const createdContacts = [];
    const createdCustomers = [];

    for (const cData of contactsData) {
      let contact = await prisma.contact.findFirst({
        where: { tenantId, phone: cData.phone }
      });
      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            tenantId,
            name: cData.name,
            phone: cData.phone,
            category: cData.category,
            tags: cData.tags,
            lastInteraction: cData.lastInteraction
          }
        });
        console.log(`   ✅ Contacto creado: ${contact.name}`);
      }
      createdContacts.push(contact);

      let customer = await prisma.customer.findUnique({
        where: { tenantId_phone: { tenantId, phone: cData.phone } }
      });
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            tenantId,
            phone: cData.phone,
            name: cData.name,
            preferences: cData.preferences,
            tags: cData.tags
          }
        });
        console.log(`   ✅ Customer creado: ${customer.name}`);
      }
      createdCustomers.push(customer);
    }

    // ── 6. CHATS Y CONVERSACIONES REALISTAS ──
    console.log('6. Aprovisionando chats y conversaciones con historial...');
    const chatsScenario = [
      {
        contact: createdContacts[0],
        status: 'open',
        messages: [
          { role: 'contact', text: '¡Hola! Quisiera información y disponibilidad de los Audífonos AirBeat Pro.', offsetMin: 25 },
          { role: 'model', text: '¡Hola! Con gusto te asesoro. Los Audífonos AirBeat Pro cuentan con cancelación activa de ruido híbrida y entrega inmediata a domicilio por S/ 149. ¿Deseas coordinar el pedido?', offsetMin: 24 },
          { role: 'contact', text: 'Sí por favor, confírmame el envío para entrega en San Borja.', offsetMin: 20 },
          { role: 'model', text: 'Excelente, tu pedido ha sido registrado con entrega express. Un asesor te enviará los datos de tracking.', offsetMin: 18 }
        ]
      },
      {
        contact: createdContacts[1],
        status: 'open',
        messages: [
          { role: 'contact', text: 'Buenas tardes, ¿tienen stock del Smartwatch X1 en color negro?', offsetMin: 60 },
          { role: 'model', text: 'Buenas tardes María. Sí, contamos con stock del Smartwatch X1 para entrega inmediata por S/ 189 con envío gratis por ser cliente VIP. ¿Lo agregamos a tu orden?', offsetMin: 58 },
          { role: 'contact', text: 'Perfecto, agrégalo por favor.', offsetMin: 55 },
          { role: 'model', text: '¡Confirmado! Tu orden fue generada con éxito y está lista para despacho.', offsetMin: 52 }
        ]
      },
      {
        contact: createdContacts[2],
        status: 'open',
        messages: [
          { role: 'contact', text: 'Hola, ¿cuál es el horario de atención y métodos de pago disponibles?', offsetMin: 120 },
          { role: 'model', text: '¡Hola Carlos! Atendemos de lunes a sábado de 9:00 am a 8:00 pm. Aceptamos transferencias BCP/BBVA, Yape/Plin y tarjeta. ¿En qué producto te interesaría recibir asesoría?', offsetMin: 118 }
        ]
      }
    ];

    const createdChats = [];
    const msgNow = new Date();

    for (const sc of chatsScenario) {
      let chat = await prisma.chat.findFirst({
        where: { tenantId, contactId: sc.contact.id }
      });
      if (!chat) {
        chat = await prisma.chat.create({
          data: {
            tenantId,
            contactId: sc.contact.id,
            status: sc.status,
            botPaused: false
          }
        });
        console.log(`   ✅ Chat creado para: ${sc.contact.name}`);
      }
      createdChats.push(chat);

      const msgCount = await prisma.message.count({ where: { chatId: chat.id } });
      if (msgCount === 0) {
        for (const m of sc.messages) {
          await prisma.message.create({
            data: {
              chatId: chat.id,
              tenantId,
              senderRole: m.role,
              content: m.text,
              createdAt: new Date(msgNow.getTime() - 1000 * 60 * m.offsetMin),
              status: m.role === 'contact' ? 'delivered' : 'sent'
            }
          });
        }
        console.log(`      ✅ Mensajes insertados en chat de ${sc.contact.name}`);
      }
    }

    // ── 7. ÓRDENES SINTÉTICAS ──
    console.log('7. Aprovisionando órdenes sintéticas...');
    // Orden 1: Pagada
    let order1 = await prisma.order.findFirst({
      where: { tenantId, customerId: createdCustomers[0].id }
    });
    if (!order1) {
      order1 = await prisma.order.create({
        data: {
          tenantId,
          customerId: createdCustomers[0].id,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          paymentMethod: 'TRANSFERENCIA_DEMO',
          shippingCity: 'Lima',
          shippingAddress: 'Av. Javier Prado Este 2465, San Borja',
          customerNeeds: 'Entrega en horario de tarde',
          totalAmount: 149.0,
          items: {
            create: [
              {
                name: 'Audífonos AirBeat Pro',
                productId: productMap['Audífonos AirBeat Pro']?.id || null,
                quantity: 1,
                price: 149.0,
                variant: 'Color Blanco'
              }
            ]
          }
        }
      });
      console.log(`   ✅ Orden 1 creada: ${order1.id} (CONFIRMED / PAID)`);
    }

    // Orden 2: Pendiente
    let order2 = await prisma.order.findFirst({
      where: { tenantId, customerId: createdCustomers[1].id }
    });
    if (!order2) {
      order2 = await prisma.order.create({
        data: {
          tenantId,
          customerId: createdCustomers[1].id,
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          paymentMethod: 'YAPE_DEMO',
          shippingCity: 'Lima',
          shippingAddress: 'Calle Las Flores 412, Miraflores',
          customerNeeds: 'Solicita empaque de regalo',
          totalAmount: 268.0,
          items: {
            create: [
              {
                name: 'Smartwatch X1',
                productId: productMap['Smartwatch X1']?.id || null,
                quantity: 1,
                price: 189.0,
                variant: 'Color Negro'
              },
              {
                name: 'Smartband PulseFit',
                productId: productMap['Smartband PulseFit']?.id || null,
                quantity: 1,
                price: 79.0,
                variant: 'Negro Mate'
              }
            ]
          }
        }
      });
      console.log(`   ✅ Orden 2 creada: ${order2.id} (PENDING / UNPAID)`);
    }

    // ── 8. NOTAS Y TAREAS OPERACIONALES ──
    console.log('8. Aprovisionando notas y tareas operacionales...');
    await prisma.operationalItem.upsert({
      where: {
        tenantId_dedupeKey: {
          tenantId,
          dedupeKey: `${buyerSlug}-demo-note-01`
        }
      },
      update: { status: 'ACTIVE' },
      create: {
        tenantId,
        contactId: createdContacts[0].id,
        chatId: createdChats[0].id,
        customerId: createdCustomers[0].id,
        type: 'NOTE',
        category: 'SERVICE_INSTRUCTION',
        title: 'Instrucción de Facturación',
        summary: `Cliente solicita comprobante comercial a nombre de ${buyerName}.`,
        status: 'ACTIVE',
        priority: 'NORMAL',
        createdByType: 'AI',
        dedupeKey: `${buyerSlug}-demo-note-01`
      }
    });

    await prisma.operationalItem.upsert({
      where: {
        tenantId_dedupeKey: {
          tenantId,
          dedupeKey: `${buyerSlug}-demo-task-01`
        }
      },
      update: { status: 'PENDING' },
      create: {
        tenantId,
        contactId: createdContacts[0].id,
        chatId: createdChats[0].id,
        customerId: createdCustomers[0].id,
        type: 'TASK',
        category: 'COORDINATION',
        title: 'Coordinar Despacho San Borja',
        summary: 'Confirmar despacho express y comprobante para entrega en San Borja.',
        status: 'PENDING',
        priority: 'HIGH',
        createdByType: 'AI',
        dedupeKey: `${buyerSlug}-demo-task-01`,
        dueDateLocal: new Date().toISOString().split('T')[0]
      }
    });

    await prisma.operationalItem.upsert({
      where: {
        tenantId_dedupeKey: {
          tenantId,
          dedupeKey: `${buyerSlug}-demo-task-02`
        }
      },
      update: { status: 'COMPLETED' },
      create: {
        tenantId,
        contactId: createdContacts[1].id,
        chatId: createdChats[1].id,
        customerId: createdCustomers[1].id,
        type: 'TASK',
        category: 'SUPPORT',
        title: 'Confirmación post-venta Smartwatch',
        summary: 'Cliente confirmó recepción conforme del producto y sincronización con app.',
        status: 'COMPLETED',
        priority: 'NORMAL',
        createdByType: 'AI',
        completedAt: new Date(msgNow.getTime() - 1000 * 60 * 30),
        dedupeKey: `${buyerSlug}-demo-task-02`,
        dueDateLocal: new Date().toISOString().split('T')[0]
      }
    });
    console.log('   ✅ Items operacionales (notas y tareas) registrados.');

    // ── 9. FOLLOW-UPS SINTÉTICOS ──
    console.log('9. Aprovisionando secuencias de Follow-Up...');
    let followUp = await prisma.followUpSequence.findFirst({
      where: { tenantId, customerId: createdCustomers[0].id }
    });
    if (!followUp) {
      followUp = await prisma.followUpSequence.create({
        data: {
          tenantId,
          customerId: createdCustomers[0].id,
          chatId: createdChats[0].id,
          productId: productMap['Smartwatch X1']?.id || null,
          productName: 'Smartwatch X1',
          stageAtCreation: 'INTERESTED',
          status: 'WAITING_NEXT',
          currentAttempt: 1,
          maxAttempts: 3,
          anchorAt: new Date(msgNow.getTime() - 1000 * 60 * 120),
          nextRunAt: new Date(msgNow.getTime() + 1000 * 60 * 240),
          contextSnapshot: {
            product: 'Smartwatch X1',
            price: 189.0,
            buyerInterest: 'Batería de larga duración'
          },
          attempts: {
            create: [
              {
                attemptNumber: 1,
                status: 'SENT',
                deliveryStatus: 'READ',
                scheduledAt: new Date(msgNow.getTime() - 1000 * 60 * 120),
                sentAt: new Date(msgNow.getTime() - 1000 * 60 * 115),
                sentMessage: '¡Hola! ¿Tuviste oportunidad de revisar las especificaciones del Smartwatch X1? Tenemos stock disponible para despacho express.',
                provider: 'EVOLUTION'
              }
            ]
          }
        }
      });
      console.log(`   ✅ Secuencia de Follow-up creada: ${followUp.id}`);
    }

    // ── 10. CAMPAÑAS SINTÉTICAS ──
    console.log('10. Aprovisionando campañas de marketing sintéticas...');
    let campaign = await prisma.campaign.findFirst({
      where: { tenantId, name: `Campaña Flash Tech Q3` }
    });
    if (!campaign) {
      campaign = await prisma.campaign.create({
        data: {
          tenantId,
          name: 'Campaña Flash Tech Q3',
          baseMessage: '¡Hola! Conoce nuestra nueva línea de gadgets con 20% de descuento sólo por 48 horas.',
          status: 'completed',
          audienceType: 'all',
          delayMin: 5,
          delayMax: 15,
          scheduledAt: new Date(msgNow.getTime() - 1000 * 60 * 60 * 24),
          logs: {
            create: createdContacts.map(c => ({
              customerPhone: c.phone,
              status: 'sent',
              sentMessage: '¡Hola! Conoce nuestra nueva línea de gadgets con 20% de descuento sólo por 48 horas.',
              sentAt: new Date(msgNow.getTime() - 1000 * 60 * 60 * 24 + 1000 * 60 * 3)
            }))
          }
        }
      });
      console.log(`   ✅ Campaña de marketing creada: ${campaign.name} (${campaign.id})`);
    }

    // ── 11. FLOWBUILDER SINTÉTICO ──
    console.log('11. Aprovisionando FlowBuilder sintético...');
    const demoFlowNodes = [
      {
        id: 'start',
        type: 'trigger',
        position: { x: 250, y: 100 },
        data: { label: 'Palabra clave: hola' }
      },
      {
        id: 'greet',
        type: 'message',
        position: { x: 250, y: 250 },
        data: { text: `¡Bienvenido a ${tenantDisplayName}! ¿En qué podemos asesorarte hoy?` }
      }
    ];
    const demoFlowEdges = [
      { id: 'e-start-greet', source: 'start', target: 'greet' }
    ];

    let flow = await prisma.flow.findFirst({
      where: { tenantId, name: `Flujo de Bienvenida ${tenantDisplayName}` }
    });
    if (!flow) {
      await prisma.flow.create({
        data: {
          tenantId,
          name: `Flujo de Bienvenida ${tenantDisplayName}`,
          triggerKeyword: 'hola',
          isActive: true,
          nodes: demoFlowNodes,
          edges: demoFlowEdges
        }
      });
      console.log('   ✅ FlowBuilder creado.');
    } else {
      await prisma.flow.update({
        where: { id: flow.id },
        data: {
          nodes: demoFlowNodes,
          edges: demoFlowEdges,
          isActive: true
        }
      });
      console.log('   ℹ️ FlowBuilder actualizado.');
    }

    // ── 12. REGISTRAR EN BUYER_DEMOS.JSON Y SINCRONIZAR DEMO_TENANT_IDS ──
    console.log('\n12. Registrando en config/buyer_demos.json...');
    const registryScript = path.resolve(__dirname, 'manage_buyer_demos.cjs');
    if (fs.existsSync(registryScript)) {
      execSync(`node "${registryScript}" add --slug="${buyerSlug}" --name="${buyerName}" --tenantId="${tenantId}" --email="${buyerEmail}" --hours=${validityHours} ${isAutoRenew ? '--auto-renew' : ''}`, { stdio: 'inherit' });

      console.log('\n13. Sincronizando DEMO_TENANT_IDS...');
      execSync(`node "${registryScript}" sync-env`, { stdio: 'inherit' });
    }

    console.log('\n🎉 [APROVISIONAMIENTO COMPLETADO CON ÉXITO]');
    console.log(`• Tenant ID:      ${tenantId}`);
    console.log(`• Tenant Name:    "${tenantDisplayName}" (${isNewTenant ? 'NUEVO' : 'ACTUALIZADO'})`);
    console.log(`• Usuario:        ${buyerEmail} (${isNewUser ? 'NUEVO' : 'ACTUALIZADO'})`);
    console.log(`• Rol:            ${user.role} (Estrictamente client)`);
    console.log(`• Plan:           ${planName} (Evaluación activa)`);
    console.log(`• Credenciales:   scratch/${buyerSlug}_demo_credentials.secure.txt`);
    console.log(`• Vigencia:       Hasta ${expiresAt} (${validityHours}h)`);
    console.log('• WhatsApp Gate:  FAIL-CLOSED (Protegido contra envíos externos no autorizados)\n');

  } finally {
    await prisma.$disconnect();
  }
}

runProvisioning().catch(err => {
  console.error('\n❌ ERROR EN APROVISIONAMIENTO:', err.message);
  process.exit(1);
});
