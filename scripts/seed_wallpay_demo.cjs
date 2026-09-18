/**
 * SCRIPT DE APROVISIONAMIENTO SINTÉTICO IDEMPOTENTE PARA DEMO WALLPAY
 *
 * Requisitos de seguridad obligatorios:
 * - ALLOW_WALLPAY_DEMO_SEED=true
 * - WALLPAY_DEMO_PASSWORD=<contraseña>
 * - DATABASE_URL=<url>
 *
 * Idempotencia garantizada:
 * Ejecutar múltiples veces no duplica tenant, usuario, productos, pedidos,
 * contactos, tareas ni flujos.
 */

const path = require('path');
const fs = require('fs');

// Cargar .env de backend_api con resolución robusta de dotenv
let dotenv;
try {
  dotenv = require('dotenv');
} catch {
  try {
    dotenv = require(path.resolve(__dirname, '../backend_api/node_modules/dotenv'));
  } catch {}
}

const backendEnvPath = path.resolve(__dirname, '../backend_api/.env');
if (dotenv) {
  if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath });
  } else {
    dotenv.config();
  }
}

// ── 1. VALIDACIONES DE SEGURIDAD ESTRICTAS ──
if (!process.env.DATABASE_URL) {
  console.error('❌ [ABORTADO] DATABASE_URL no está definida en las variables de entorno.');
  process.exit(1);
}

if (process.env.ALLOW_WALLPAY_DEMO_SEED !== 'true') {
  console.error('❌ [ABORTADO] Protección contra ejecución accidental activa.');
  console.error('   Se requiere definir explícitamente: ALLOW_WALLPAY_DEMO_SEED=true');
  process.exit(1);
}

if (!process.env.WALLPAY_DEMO_PASSWORD) {
  console.error('❌ [ABORTADO] Contraseña no configurada.');
  console.error('   Se requiere definir: WALLPAY_DEMO_PASSWORD=<password_seguro>');
  process.exit(1);
}

// Cargar dependencias de backend_api
let bcrypt;
let PrismaClient;

try {
  bcrypt = require(path.resolve(__dirname, '../backend_api/node_modules/bcryptjs'));
  const prismaPkg = require(path.resolve(__dirname, '../backend_api/node_modules/@prisma/client'));
  PrismaClient = prismaPkg.PrismaClient;
} catch (e) {
  try {
    bcrypt = require('bcryptjs');
    PrismaClient = require('@prisma/client').PrismaClient;
  } catch (err2) {
    console.error('❌ [ABORTADO] No se pudieron cargar las dependencias (bcryptjs, @prisma/client):', err2.message);
    process.exit(1);
  }
}

const prisma = new PrismaClient();

// Helper para imprimir información de base de datos sin filtrar credenciales
function printSafeDbInfo(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    console.log(`📡 Destino DB: host=${parsed.hostname}, port=${parsed.port || '5432'}, db=${parsed.pathname.replace(/^\//, '')}`);
  } catch {
    console.log('📡 Destino DB: Conexión configurada');
  }
}

async function runSeed() {
  console.log('🚀 Iniciando aprovisionamiento sintético seguro para Demo Wallpay...');
  printSafeDbInfo(process.env.DATABASE_URL);

  try {
    // ── 2. SELECCIONAR PLAN EXISTENTE ──
    let plan = await prisma.plan.findFirst({
      where: { name: 'Pro' }
    });

    if (!plan) {
      plan = await prisma.plan.findFirst({
        where: { active: true }
      });
    }

    const planName = plan?.name || 'Pro';
    const planId = plan?.id || null;
    const msgLimit = plan?.msgLimit || 5000;
    const connLimit = plan?.connLimit || 3;

    console.log(`📋 Plan seleccionado para demo: "${planName}" (ID: ${planId || 'N/A'})`);

    // ── 3. TENANT IDEMPOTENTE ──
    const tenantName = 'Velion Demo';
    let tenant = await prisma.tenant.findFirst({
      where: { name: tenantName }
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: tenantName,
          companyName: 'Velion Demo',
          plan: planName,
          planId: planId,
          msgLimit: msgLimit,
          connLimit: connLimit,
          active: true,
          aiEnabled: true,
          marketingModeEnabled: true,
          businessSector: 'Tecnología & Gadgets',
          bankAccounts: 'BCP Cuenta Corriente Soles: 191-98765432-0-99 (CCI: 002-191-009876543299-11), BBVA: 0011-0123-4567890123, Yape / Plin al 987654321, Transferencia bancaria nacional.',
          termsAndPolicies: 'Políticas Demo: Envíos y delivery a todo Lima Metropolitana en 24h vía courier express. Envíos a provincias vía Olva Courier. Garantía oficial de 12 meses con reemplazo inmediato ante fallas técnicas.',
          customPrompt: 'Eres el asesor virtual inteligente de Velion Demo. Responde dudas sobre audífonos, smartwatches y parlantes con cordialidad y precisión.',
          botRole: 'Asesor Tecnológico Velion Demo'
        }
      });
      console.log(`✅ Tenant creado: "${tenant.name}" (ID: ${tenant.id})`);
    } else {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          active: true,
          plan: planName,
          planId: planId,
          msgLimit: msgLimit,
          connLimit: connLimit,
          bankAccounts: 'BCP Cuenta Corriente Soles: 191-98765432-0-99 (CCI: 002-191-009876543299-11), BBVA: 0011-0123-4567890123, Yape / Plin al 987654321, Transferencia bancaria nacional.',
          termsAndPolicies: 'Políticas Demo: Envíos y delivery a todo Lima Metropolitana en 24h vía courier express. Envíos a provincias vía Olva Courier. Garantía oficial de 12 meses con reemplazo inmediato ante fallas técnicas.'
        }
      });
      console.log(`ℹ️ Tenant existente actualizado: "${tenant.name}" (ID: ${tenant.id})`);
    }

    // ── 4. USUARIO DEMO IDEMPOTENTE ──
    const demoEmail = 'wallpay.demo@velion.test';
    const hashedPassword = await bcrypt.hash(process.env.WALLPAY_DEMO_PASSWORD, 10);

    let user = await prisma.user.findUnique({
      where: { email: demoEmail }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: 'Evaluador Wallpay',
          email: demoEmail,
          password: hashedPassword,
          role: 'client',
          tenantId: tenant.id,
        }
      });
      console.log(`✅ Usuario demo creado: ${user.email} (Rol: ${user.role})`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          role: 'client',
          tenantId: tenant.id,
        }
      });
      console.log(`ℹ️ Usuario demo existente sincronizado: ${user.email}`);
    }

    // ── 5. PRODUCTOS SINTÉTICOS IDEMPOTENTES ──
    const baseDemoMediaUrl = `https://185.163.116.210/media/tenants/${tenant.id}/products/images`;
    const syntheticProducts = [
      {
        name: 'Smartwatch X1',
        description: 'Reloj inteligente con pantalla AMOLED de 1.4", monitoreo continuo de ritmo cardíaco, SpO2 y batería de hasta 7 días.',
        category: 'Wearables',
        price: 189.0,
        imageUrl: `${baseDemoMediaUrl}/smartwatch-x1.png`,
        images: [`${baseDemoMediaUrl}/smartwatch-x1.png`],
        tags: ['smartwatch', 'fitness', 'tecnologia', 'salud'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true,
      },
      {
        name: 'Audífonos AirBeat Pro',
        description: 'Audífonos inalámbricos TWS con cancelación activa de ruido (ANC) híbrida, 32h de autonomía total y carga rápida USB-C.',
        category: 'Audio',
        price: 149.0,
        imageUrl: `${baseDemoMediaUrl}/airbeat-pro.png`,
        images: [`${baseDemoMediaUrl}/airbeat-pro.png`],
        tags: ['auriculares', 'bluetooth', 'anc', 'audio'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true,
      },
      {
        name: 'Parlante SoundMini',
        description: 'Altavoz Bluetooth portátil ultracompacto con certificación impermeable IPX7, bajos reforzados y 10h de reproducción continua.',
        category: 'Audio',
        price: 89.0,
        imageUrl: `${baseDemoMediaUrl}/soundmini.png`,
        images: [`${baseDemoMediaUrl}/soundmini.png`],
        tags: ['parlante', 'portatil', 'bluetooth', 'musica'],
        type: 'PHYSICAL_PRODUCT',
        isAvailable: true,
      }
    ];

    const productMap = {};
    for (const prodData of syntheticProducts) {
      let prod = await prisma.product.findFirst({
        where: {
          name: prodData.name,
          userId: user.id
        }
      });

      if (!prod) {
        prod = await prisma.product.create({
          data: {
            ...prodData,
            userId: user.id
          }
        });
        console.log(`✅ Producto sintético creado: ${prod.name} (S/ ${prod.price})`);
      } else {
        prod = await prisma.product.update({
          where: { id: prod.id },
          data: {
            description: prodData.description,
            category: prodData.category,
            price: prodData.price,
            imageUrl: prodData.imageUrl,
            images: prodData.images,
            tags: prodData.tags,
            isAvailable: true,
          }
        });
        console.log(`ℹ️ Producto existente actualizado: ${prod.name}`);
      }
      productMap[prod.name] = prod;
    }

    // ── 6. CONTACTO Y CUSTOMER SINTÉTICOS IDEMPOTENTES ──
    const demoPhone = '51900000001';
    let contact = await prisma.contact.findFirst({
      where: {
        tenantId: tenant.id,
        phone: demoPhone
      }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          tenantId: tenant.id,
          name: 'Carlos Mendoza (Demo Lead)',
          phone: demoPhone,
          category: 'Interesados',
          tags: ['demo', 'evaluacion', 'lead'],
          lastInteraction: 'Consulta sobre Smartwatch X1'
        }
      });
      console.log(`✅ Contacto sintético creado: ${contact.name} (${demoPhone})`);
    }

    let customer = await prisma.customer.findUnique({
      where: {
        tenantId_phone: {
          tenantId: tenant.id,
          phone: demoPhone
        }
      }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          tenantId: tenant.id,
          phone: demoPhone,
          name: 'Carlos Mendoza (Demo Lead)',
          preferences: 'Prefiere color negro y entrega en horario de tarde',
          tags: ['demo', 'cliente_potencial']
        }
      });
      console.log(`✅ Customer sintético creado: ${customer.name}`);
    }

    // ── 7. CHAT Y MENSAJES SINTÉTICOS IDEMPOTENTES ──
    let chat = await prisma.chat.findFirst({
      where: {
        tenantId: tenant.id,
        contactId: contact.id
      }
    });

    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          tenantId: tenant.id,
          contactId: contact.id,
          status: 'open',
          botPaused: false,
        }
      });
      console.log(`✅ Chat sintético creado (ID: ${chat.id})`);
    }

    const messageCount = await prisma.message.count({
      where: { chatId: chat.id }
    });

    if (messageCount === 0) {
      const now = new Date();
      await prisma.message.createMany({
        data: [
          {
            chatId: chat.id,
            tenantId: tenant.id,
            senderRole: 'contact',
            content: '¡Hola! Quisiera consultar sobre el Smartwatch X1 y tiempos de entrega.',
            createdAt: new Date(now.getTime() - 1000 * 60 * 15),
            status: 'delivered'
          },
          {
            chatId: chat.id,
            tenantId: tenant.id,
            senderRole: 'model',
            content: '¡Hola Carlos! Un gusto saludarte. El Smartwatch X1 cuenta con entrega inmediata a domicilio por S/ 189. ¿Deseas que coordinemos el pedido?',
            createdAt: new Date(now.getTime() - 1000 * 60 * 14),
            status: 'sent'
          },
          {
            chatId: chat.id,
            tenantId: tenant.id,
            senderRole: 'contact',
            content: 'Excelente, me interesa en color negro para entrega en San Isidro.',
            createdAt: new Date(now.getTime() - 1000 * 60 * 10),
            status: 'delivered'
          }
        ]
      });
      console.log(`✅ 3 mensajes sintéticos inicializados en el chat.`);
    }

    // ── 8. ORDEN SINTÉTICA IDEMPOTENTE ──
    let order = await prisma.order.findFirst({
      where: {
        tenantId: tenant.id,
        customerId: customer.id
      }
    });

    if (!order) {
      order = await prisma.order.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          paymentMethod: 'TRANSFERENCIA_DEMO',
          shippingCity: 'Lima',
          shippingAddress: 'Av. Las Begonias 450, San Isidro',
          customerNeeds: 'Entrega prioritaria',
          totalAmount: 189.0,
          items: {
            create: [
              {
                name: 'Smartwatch X1',
                productId: productMap['Smartwatch X1']?.id || null,
                quantity: 1,
                price: 189.0,
                variant: 'Color Negro'
              }
            ]
          }
        }
      });
      console.log(`✅ Orden sintética creada: Orden #${order.id.slice(0, 8)} (S/ 189.00)`);
    }

    // ── 9. NOTA Y TAREA OPERACIONALES IDEMPOTENTES ──
    await prisma.operationalItem.upsert({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: 'demo-item-note-01'
        }
      },
      update: {
        summary: 'Cliente solicita empaque especial para regalo con tarjeta personalizada.',
        status: 'ACTIVE'
      },
      create: {
        tenantId: tenant.id,
        contactId: contact.id,
        chatId: chat.id,
        customerId: customer.id,
        type: 'NOTE',
        category: 'SERVICE_INSTRUCTION',
        title: 'Instrucción de empaque',
        summary: 'Cliente solicita empaque especial para regalo con tarjeta personalizada.',
        status: 'ACTIVE',
        priority: 'NORMAL',
        createdByType: 'AI',
        dedupeKey: 'demo-item-note-01'
      }
    });

    await prisma.operationalItem.upsert({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: 'demo-item-task-01'
        }
      },
      update: {
        summary: 'Confirmar guía de remisión y despacho del Smartwatch X1 para entrega en San Isidro.',
        status: 'PENDING',
        priority: 'HIGH'
      },
      create: {
        tenantId: tenant.id,
        contactId: contact.id,
        chatId: chat.id,
        customerId: customer.id,
        type: 'TASK',
        category: 'COORDINATION',
        title: 'Coordinar Courier San Isidro',
        summary: 'Confirmar guía de remisión y despacho del Smartwatch X1 para entrega en San Isidro.',
        status: 'PENDING',
        priority: 'HIGH',
        createdByType: 'AI',
        dedupeKey: 'demo-item-task-01',
        dueDateLocal: new Date().toISOString().split('T')[0]
      }
    });
    console.log(`✅ Items operacionales (Nota y Tarea) sincronizados con dedupeKey.`);

    // ── 10. FLOW DE BIENVENIDA BÁSICO IDEMPOTENTE ──
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
        data: { text: '¡Bienvenido a Velion Demo! ¿En qué podemos asesorarte hoy?' }
      }
    ];
    const demoFlowEdges = [
      { id: 'e-start-greet', source: 'start', target: 'greet' }
    ];

    let flow = await prisma.flow.findFirst({
      where: {
        tenantId: tenant.id,
        name: 'Flujo de Bienvenida Demo'
      }
    });

    if (!flow) {
      await prisma.flow.create({
        data: {
          tenantId: tenant.id,
          name: 'Flujo de Bienvenida Demo',
          triggerKeyword: 'hola',
          isActive: true,
          nodes: demoFlowNodes,
          edges: demoFlowEdges
        }
      });
      console.log(`✅ Flujo de bienvenida sintético configurado.`);
    } else {
      await prisma.flow.update({
        where: { id: flow.id },
        data: {
          nodes: demoFlowNodes,
          edges: demoFlowEdges,
          triggerKeyword: 'hola',
          isActive: true
        }
      });
      console.log(`ℹ️ Flujo de bienvenida sintético actualizado con posiciones válidas.`);
    }

    console.log('\n🎉 [ÉXITO] Aprovisionamiento sintético de demo completado correctamente.');
    console.log(`   Tenant ID: ${tenant.id}`);
    console.log(`   Usuario:   ${user.email}`);
    console.log(`   Rol:       ${user.role}`);
    console.log(`   Idempotente: SÍ (seguro para re-ejecución)`);

  } catch (error) {
    console.error('❌ Error durante la ejecución del seed sintético:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runSeed();
