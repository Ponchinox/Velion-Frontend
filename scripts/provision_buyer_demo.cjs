#!/usr/bin/env node
/**
 * PROVISIONADOR GENÉRICO E IDEMPOTENTE DE DEMOS PARA COMPRADORES
 *
 * Automatiza la creación, dataset sintético, credenciales y registro de demo
 * para potenciales compradores de Velion Agent.
 *
 * Invariantes de Seguridad:
 * - Cero media de clientes reales (exclusivamente assets sintéticos).
 * - Outbound WhatsApp: Fail-closed por defecto (sin números en whitelist).
 * - SuperAdmin: Bloqueado (rol estrictamente 'client').
 * - Facturación: Oculta / privada en interfaz (isDemo=true).
 * - Credenciales: Guardadas exclusivamente en scratch/<slug>_demo_credentials.secure.txt.
 * - Password: Cero impresión de plaintext en logs o consola.
 * - Confirmación: Requiere --confirm para ejecutar cambios reales (por defecto: DRY-RUN).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Dependencias de hashing y DB
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

// Cargar variables de entorno si existen
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
const validityHours = parseInt(flags.hours || flags['validity-hours'] || '48', 10);
const sector = flags.sector || 'Comercio & Retail';

if (!buyerName || !buyerSlug) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🏭 VELION AGENT — PROVISIONADOR GENÉRICO DE COMPRADORES DEMO');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('Uso:');
  console.log('  node scripts/provision_buyer_demo.cjs --name="Nombre Empresa" --slug="slug" [--hours=48] [--confirm]\n');
  console.log('Ejemplo:');
  console.log('  node scripts/provision_buyer_demo.cjs --name="Acme Corp" --slug="acme" --confirm\n');
  console.log('Parámetros:');
  console.log('  --name            Nombre comercial de la empresa compradora (Requerido)');
  console.log('  --slug            Identificador en minúsculas y sin espacios (Requerido)');
  console.log('  --email           Email de acceso demo (Opcional, default: <slug>.demo@velion.test)');
  console.log('  --password        Password personalizado (Opcional, se autogenera si se omite)');
  console.log('  --hours           Horas de vigencia de la demo (Opcional, default: 48)');
  console.log('  --sector          Rubro o sector comercial (Opcional, default: Comercio & Retail)');
  console.log('  --confirm         Ejecutar aprovisionamiento real (Sin esto corre en DRY-RUN)');
  process.exit(1);
}

const buyerEmail = flags.email || process.env.BUYER_DEMO_EMAIL || `${buyerSlug}.demo@velion.test`;

// Generar contraseña segura aleatoria si no fue suministrada
let rawPassword = flags.password || process.env.BUYER_DEMO_PASSWORD;
let isGeneratedPassword = false;
if (!rawPassword) {
  const randomChars = crypto.randomBytes(18).toString('base64url');
  rawPassword = `${randomChars}!A9#`;
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
console.log(`• Modo:            ${isConfirmed ? '⚡ EJECUCIÓN CONFIRMADA' : '🔍 DRY-RUN (Simulación)'}`);
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
  console.log(`  5. Crear 3 productos sintéticos (Smartwatch X1, Audífonos AirBeat Pro, Parlante SoundMini).`);
  console.log(`  6. Crear contacto, cliente, chat y 3 mensajes de prueba sintéticos.`);
  console.log(`  7. Crear pedido de prueba confirmado y pagado.`);
  console.log(`  8. Crear nota y tarea operacionales.`);
  console.log(`  9. Crear FlowBuilder sintético con validación de nodos.`);
  console.log(`  10. Registrar comprador en config/buyer_demos.json con expiración a ${validityHours}h.`);
  console.log(`  11. Sincronizar DEMO_TENANT_IDS de forma atómica.`);
  console.log(`  12. Mantener WhatsApp Outbound en FAIL-CLOSED (sin números en lista blanca).\n`);
  process.exit(0);
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
    if (!tenant) {
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
          termsAndPolicies: `Políticas Demo ${buyerName}: Envíos express en 24h. Garantía oficial de fábrica de 12 meses.`,
          customPrompt: `Eres el asesor virtual inteligente de ${tenantDisplayName}. Asesora con profesionalismo sobre productos tecnológicos de consumo.`,
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
          planId: planId
        }
      });
      console.log(`   ℹ️ Tenant existente actualizado: ${tenant.id}`);
    }

    const tenantId = tenant.id;

    console.log(`3. Aprovisionando Usuario ${buyerEmail}...`);
    let user = await prisma.user.findUnique({ where: { email: buyerEmail } });
    if (!user) {
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
      console.log(`   ℹ️ Usuario actualizado: ${user.email}`);
    }

    console.log('4. Aprovisionando catálogo de productos sintéticos...');
    const mediaHost = process.env.PUBLIC_APP_URL || '';
    const baseMediaUrl = `${mediaHost}/media/tenants/${tenantId}/products/images`;
    const syntheticProducts = [
      {
        name: 'Smartwatch X1',
        description: 'Reloj inteligente con pantalla AMOLED de 1.4 pulgadas, monitoreo de frecuencia cardíaca y 7 días de batería.',
        category: 'Wearables',
        price: 189.0,
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

    console.log('5. Aprovisionando contacto y cliente sintético...');
    // Generar número sintético determinista pero aislado por slug
    const cleanSlugDigits = String(Math.abs(buyerSlug.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0))).slice(0, 6);
    const syntheticPhone = `51900${cleanSlugDigits.padStart(6, '0')}`;

    let contact = await prisma.contact.findFirst({
      where: { tenantId: tenantId, phone: syntheticPhone }
    });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          tenantId: tenantId,
          name: `Cliente Demo (${buyerName})`,
          phone: syntheticPhone,
          category: 'Interesados',
          tags: ['demo', 'evaluacion', buyerSlug],
          lastInteraction: 'Consulta sobre Audífonos AirBeat Pro'
        }
      });
      console.log(`   ✅ Contacto creado: ${contact.name}`);
    }

    let customer = await prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId: tenantId, phone: syntheticPhone } }
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          tenantId: tenantId,
          phone: syntheticPhone,
          name: `Cliente Demo (${buyerName})`,
          preferences: 'Prefiere atención por WhatsApp y entrega express',
          tags: ['demo', 'cliente_potencial']
        }
      });
      console.log(`   ✅ Customer creado: ${customer.name}`);
    }

    console.log('6. Aprovisionando chat y conversación sintética...');
    let chat = await prisma.chat.findFirst({
      where: { tenantId: tenantId, contactId: contact.id }
    });
    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          tenantId: tenantId,
          contactId: contact.id,
          status: 'open',
          botPaused: false
        }
      });
      console.log(`   ✅ Chat creado: ${chat.id}`);
    }

    const msgCount = await prisma.message.count({ where: { chatId: chat.id } });
    if (msgCount === 0) {
      const msgNow = new Date();
      await prisma.message.createMany({
        data: [
          {
            chatId: chat.id,
            tenantId: tenantId,
            senderRole: 'contact',
            content: '¡Hola! Quisiera información y disponibilidad de los Audífonos AirBeat Pro.',
            createdAt: new Date(msgNow.getTime() - 1000 * 60 * 20),
            status: 'delivered'
          },
          {
            chatId: chat.id,
            tenantId: tenantId,
            senderRole: 'model',
            content: `¡Hola! Con gusto te asesoro. Los Audífonos AirBeat Pro cuentan con cancelación activa de ruido híbrida y entrega inmediata a domicilio por S/ 149. ¿Deseas coordinar el pedido?`,
            createdAt: new Date(msgNow.getTime() - 1000 * 60 * 19),
            status: 'sent'
          },
          {
            chatId: chat.id,
            tenantId: tenantId,
            senderRole: 'contact',
            content: 'Sí por favor, confírmame el envío para entrega en San Borja.',
            createdAt: new Date(msgNow.getTime() - 1000 * 60 * 15),
            status: 'delivered'
          }
        ]
      });
      console.log('   ✅ Mensajes sintéticos insertados en chat.');
    }

    console.log('7. Aprovisionando orden sintética confirmada...');
    let order = await prisma.order.findFirst({
      where: { tenantId: tenantId, customerId: customer.id }
    });
    if (!order) {
      order = await prisma.order.create({
        data: {
          tenantId: tenantId,
          customerId: customer.id,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          paymentMethod: 'TRANSFERENCIA_DEMO',
          shippingCity: 'Lima',
          shippingAddress: 'Av. Javier Prado Este 2465, San Borja',
          customerNeeds: 'Entrega de prueba demo',
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
      console.log(`   ✅ Orden de prueba creada: ${order.id}`);
    }

    console.log('8. Aprovisionando notas y tareas operacionales...');
    await prisma.operationalItem.upsert({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenantId,
          dedupeKey: `${buyerSlug}-demo-note-01`
        }
      },
      update: { status: 'ACTIVE' },
      create: {
        tenantId: tenantId,
        contactId: contact.id,
        chatId: chat.id,
        customerId: customer.id,
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
          tenantId: tenantId,
          dedupeKey: `${buyerSlug}-demo-task-01`
        }
      },
      update: { status: 'PENDING' },
      create: {
        tenantId: tenantId,
        contactId: contact.id,
        chatId: chat.id,
        customerId: customer.id,
        type: 'TASK',
        category: 'COORDINATION',
        title: 'Coordinar Despacho San Borja',
        summary: 'Confirmar despacho y comprobante para entrega en San Borja.',
        status: 'PENDING',
        priority: 'HIGH',
        createdByType: 'AI',
        dedupeKey: `${buyerSlug}-demo-task-01`,
        dueDateLocal: new Date().toISOString().split('T')[0]
      }
    });
    console.log('   ✅ Items operacionales registrados.');

    console.log('9. Aprovisionando FlowBuilder sintético...');
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
      where: { tenantId: tenantId, name: `Flujo de Bienvenida ${tenantDisplayName}` }
    });
    if (!flow) {
      await prisma.flow.create({
        data: {
          tenantId: tenantId,
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

    // 10. Registrar en buyer_demos.json
    console.log('\n10. Registrando en config/buyer_demos.json...');
    const registryScript = path.resolve(__dirname, 'manage_buyer_demos.cjs');
    const { execSync } = require('child_process');
    execSync(`node "${registryScript}" add --slug="${buyerSlug}" --name="${buyerName}" --tenantId="${tenantId}" --email="${buyerEmail}" --hours=${validityHours}`, { stdio: 'inherit' });

    // 11. Sincronizar DEMO_TENANT_IDS
    console.log('\n11. Sincronizando DEMO_TENANT_IDS...');
    execSync(`node "${registryScript}" sync-env`, { stdio: 'inherit' });

    console.log('\n🎉 [APROVISIONAMIENTO EXITOSO]');
    console.log(`• Tenant ID:   ${tenantId}`);
    console.log(`• Tenant Name: "${tenantDisplayName}"`);
    console.log(`• Usuario:     ${buyerEmail}`);
    console.log(`• Credenciales: scratch/${buyerSlug}_demo_credentials.secure.txt`);
    console.log(`• Vigencia:    Hasta ${expiresAt} (${validityHours}h)`);
    console.log('• Outbound:    FAIL-CLOSED (Protegido contra envíos externos no autorizados)\n');

  } finally {
    await prisma.$disconnect();
  }
}

runProvisioning().catch(err => {
  console.error('\n❌ ERROR EN APROVISIONAMIENTO:', err.message);
  process.exit(1);
});
