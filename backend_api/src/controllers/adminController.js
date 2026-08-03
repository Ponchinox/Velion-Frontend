import prisma from '../db.js';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

// Claves de configuración que se gestionan en la tabla SystemConfig de PostgreSQL
const CONFIG_KEYS = [
  'evoUrl', 'evoApiKey', 'wahaUrl', 'wahaApiKey', 'wahaIsPrimary',
  'geminiKey', 'groqKey', 'systemPrompt', 'smtpHost', 'smtpPort',
  'smtpUser', 'smtpPassword', 'errorWebhook',
  'backupFrequency', 'backupCloudEnabled', 'backupCloudProvider',
];

// Valores por defecto que se usan SOLO si la clave aún no existe en la BD
const CONFIG_DEFAULTS = {
  evoUrl:       '',
  evoApiKey:    '',
  wahaUrl:      '',
  wahaApiKey:   '',
  wahaIsPrimary:'false',
  geminiKey:    '',
  groqKey:      '',
  systemPrompt: 'Eres un asistente de atención al cliente educado, eficiente y servicial.',
  smtpHost:     '',
  smtpPort:     '587',
  smtpUser:     '',
  smtpPassword: '',
  errorWebhook: '',
  backupFrequency: 'off',
  backupCloudEnabled: 'false',
  backupCloudProvider: 'cloudinary',
};

// ==========================================
// 1. GESTIÓN DE TENANTS (Base de datos real)
// ==========================================

export async function getTenants(req, res) {
  try {
    // Calcular el inicio del mes vigente para acotar el conteo de mensajes
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const tenants = await prisma.tenant.findMany({
      where: {
        users: {
          none: {
            role: 'superadmin' // Excluir tenants que sean del superadmin
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        users:    { select: { email: true, role: true } },
        chats:    { select: { id: true } },
        messages: { where: { createdAt: { gte: startOfMonth } }, select: { id: true } },
        registeredNumbers: { select: { id: true } },
      },
    });

    // Mapear campos para que el frontend coincida
    const formatted = tenants.map(t => ({
      id:        t.id,
      name:      t.name,
      email:     t.users[0]?.email || 'sin-propietario@plataforma.com',
      plan:      t.plan,
      active:    t.active,
      connUsed:  t.registeredNumbers ? t.registeredNumbers.length : 0, // Conexiones reales
      msgUsed:   t.messages ? t.messages.length : 0,        // Mensajes enviados en el mes vigente
      connLimit: t.connLimit,
      msgLimit:  t.msgLimit,
      createdAt: t.createdAt.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
    }));

    return res.json(formatted);
  } catch (error) {
    console.error('Error en getTenants:', error);
    return res.status(500).json({ error: 'Error al obtener los inquilinos.' });
  }
}

export async function updateTenantStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'active' | 'suspended'

    if (!status) {
      return res.status(400).json({ error: 'El estado es requerido.' });
    }

    const isActive = status === 'active';

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { active: isActive },
    });

    return res.json({
      message: `El inquilino ha sido ${isActive ? 'reactivado' : 'suspendido'}.`,
      tenant,
    });
  } catch (error) {
    console.error('Error en updateTenantStatus:', error);
    return res.status(500).json({ error: 'Error al actualizar el estado del inquilino.' });
  }
}

export async function updateTenantLimits(req, res) {
  try {
    const { id } = req.params;
    const { name, password, plan } = req.body;

    const updateData = {};

    if (name) {
      updateData.name = name;
    }

    if (plan) {
      // Buscar el plan en la base de datos para obtener sus límites
      const planDb = await prisma.plan.findUnique({
        where: { name: plan }
      });
      if (planDb) {
        updateData.plan = planDb.name;
        updateData.planId = planDb.id;   // ← CRÍTICO: sincronizar planId para que el middleware de features funcione
        updateData.connLimit = planDb.connLimit;
        updateData.msgLimit = planDb.msgLimit;
      } else {
        // Failsafe: Si es un plan legacy no encontrado en BD, solo actualizar el nombre
        updateData.plan = plan;
      }
    }

    // Transacción para asegurar consistencia
    const result = await prisma.$transaction(async (tx) => {
      // 1. Actualizar el Tenant
      let tenant = null;
      if (Object.keys(updateData).length > 0) {
        tenant = await tx.tenant.update({
          where: { id },
          data: updateData
        });
      } else {
        tenant = await tx.tenant.findUnique({ where: { id } });
      }

      // 2. Si viene contraseña, actualizar el usuario administrador del Tenant
      if (password && password.trim().length >= 4) {
        const adminUser = await tx.user.findFirst({
          where: { tenantId: id, role: 'client' }
        });
        if (adminUser) {
          const hashedPassword = await bcrypt.hash(password, 10);
          await tx.user.update({
            where: { id: adminUser.id },
            data: { password: hashedPassword }
          });
        }
      }

      return tenant;
    });

    return res.json({
      message: 'Empresa actualizada con éxito.',
      tenant: result,
    });
  } catch (error) {
    console.error('Error en updateTenantLimits:', error);
    return res.status(500).json({ error: 'Error al actualizar los datos de la empresa.' });
  }
}

export async function createTenant(req, res) {
  try {
    const { name, email, plan, msgLimit, connLimit } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Nombre de empresa y correo del propietario son requeridos.' });
    }

    // Verificar si el correo ya existe en la BD
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'El correo electrónico ya se encuentra registrado.' });
    }

    // Buscar información del plan en BD para obtener límites y planId reales
    let planDb = null;
    if (plan) {
      planDb = await prisma.plan.findUnique({ where: { name: plan } });
    }

    const finalMsgLimit  = Number(msgLimit)  || planDb?.msgLimit  || 1000;
    const finalConnLimit = Number(connLimit) || planDb?.connLimit || 1;
    const planId         = planDb?.id        || null;

    // Contraseña por defecto para el nuevo inquilino: admin123
    const hashedPassword = await bcrypt.hash('admin123', 10);

    // Transacción atómica
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear el Tenant
      const tenant = await tx.tenant.create({
        data: {
          name,
          plan: planDb?.name || plan || 'Sin Plan',
          planId: planId,
          msgLimit: finalMsgLimit,
          connLimit: finalConnLimit,
          active: true,
        },
      });

      // 2. Crear el Usuario Administrador (role client)
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'client',
          tenantId: tenant.id,
        },
      });

      return { tenant, user };
    });

    // Dar formato compatible con el listado del frontend
    const formatted = {
      id: result.tenant.id,
      name: result.tenant.name,
      email: result.user.email,
      plan: result.tenant.plan,
      active: result.tenant.active,
      connUsed: 0,
      msgUsed: 0,
      connLimit: result.tenant.connLimit,
      msgLimit: result.tenant.msgLimit,
      createdAt: result.tenant.createdAt.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
    };

    return res.status(201).json(formatted);
  } catch (error) {
    console.error('Error en createTenant:', error);
    return res.status(500).json({ error: 'Error interno al registrar la empresa y su propietario.' });
  }
}

export async function updateTenantPassword(req, res) {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
    }

    // 1. Encontrar el usuario principal del Tenant (rol client)
    const user = await prisma.user.findFirst({
      where: { tenantId: id, role: 'client' },
    });

    if (!user) {
      return res.status(404).json({ error: 'No se encontró el usuario administrador de esta empresa.' });
    }

    // 2. Encriptar la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Actualizar la contraseña en la base de datos
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return res.json({ message: 'Contraseña del cliente actualizada con éxito.' });
  } catch (error) {
    console.error('Error en updateTenantPassword:', error);
    return res.status(500).json({ error: 'Error al actualizar la contraseña del inquilino.' });
  }
}

/**
 * Elimina una empresa (Tenant) y TODOS sus registros asociados de forma permanente en cascada.
 */
export async function deleteTenant(req, res) {
  try {
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!tenant) {
      return res.json({
        success: true,
        message: 'La empresa ya no existía o fue eliminada previamente.',
      });
    }

    // Transacción en cascada para eliminar absolutamente todo rastro de la cuenta
    await prisma.$transaction(async (tx) => {
      // 1. Obtener IDs de usuarios del tenant
      const users = await tx.user.findMany({
        where: { tenantId: id },
        select: { id: true },
      });
      const userIds = users.map(u => u.id);

      // 2. Eliminar productos vinculados a los usuarios del tenant
      if (userIds.length > 0) {
        await tx.product.deleteMany({
          where: { userId: { in: userIds } },
        });
      }

      // 3. Eliminar mensajes, chats, contactos, clientes, campañas, flujos, alertas y números registrados
      await tx.message.deleteMany({ where: { tenantId: id } });
      await tx.chat.deleteMany({ where: { tenantId: id } });
      await tx.contact.deleteMany({ where: { tenantId: id } });
      await tx.customer.deleteMany({ where: { tenantId: id } });
      await tx.campaign.deleteMany({ where: { tenantId: id } });
      await tx.automationFlow.deleteMany({ where: { tenantId: id } });
      await tx.flow.deleteMany({ where: { tenantId: id } });
      await tx.alert.deleteMany({ where: { tenantId: id } });
      await tx.registeredWhatsAppNumber.deleteMany({ where: { tenantId: id } });

      // 4. Eliminar usuarios del tenant
      await tx.user.deleteMany({ where: { tenantId: id } });

      // 5. Eliminar la empresa (Tenant) físicamente de PostgreSQL
      await tx.tenant.delete({ where: { id } });
    });

    console.log(`🗑️ [Admin] Empresa "${tenant.name}" (${id}) y todos sus datos fueron eliminados permanentemente.`);

    return res.json({
      success: true,
      message: `Empresa "${tenant.name}" eliminada correctamente de forma permanente.`,
    });
  } catch (error) {
    console.error('Error en deleteTenant:', error);
    return res.status(500).json({ error: 'Error interno al eliminar la empresa.' });
  }
}

// ==========================================
// 2. GESTIÓN DE PLANES (PostgreSQL via Prisma - Sin referencias a Stripe)
// ==========================================

export async function getPlans(req, res) {
  try {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { price: 'asc' },
    });
    return res.json(plans);
  } catch (error) {
    console.error('Error en getPlans:', error);
    try {
      const fallbackPlans = await prisma.plan.findMany({ where: { active: true } });
      return res.json(fallbackPlans);
    } catch (err2) {
      return res.status(500).json({ error: 'Error al obtener los planes comerciales.' });
    }
  }
}

export async function createPlan(req, res) {
  try {
    const planData = req.body;
    if (!planData.name || planData.price === undefined) {
      return res.status(400).json({ error: 'Nombre y precio son requeridos.' });
    }

    const newPlan = await prisma.plan.create({
      data: {
        name:                planData.name,
        price:               Number(planData.price),
        connLimit:           Number(planData.connLimit  || 1),
        msgLimit:            Number(planData.msgLimit   || 1000),
        maxProducts:         Number(planData.maxProducts ?? 10),
        hasCampaigns:        Boolean(planData.hasCampaigns),
        hasAutomations:      Boolean(planData.hasAutomations),
        hasAdvancedMarketing: planData.hasAdvancedMarketing !== undefined ? Boolean(planData.hasAdvancedMarketing) : true,
        flowBuilder:         Boolean(planData.flowBuilder),
        aiBrain:             Boolean(planData.aiBrain),
        popular:             Boolean(planData.popular),
        features:            planData.features || [],
      },
    });

    return res.status(201).json(newPlan);
  } catch (error) {
    console.error('Error en createPlan:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un plan con ese nombre.' });
    }
    return res.status(500).json({ error: 'Error al crear el plan comercial.' });
  }
}

export async function updatePlan(req, res) {
  try {
    const { id } = req.params;
    const planData = req.body;

    const updated = await prisma.plan.update({
      where: { id },
      data: {
        name:                planData.name,
        price:               Number(planData.price),
        connLimit:           Number(planData.connLimit),
        msgLimit:            Number(planData.msgLimit),
        maxProducts:         Number(planData.maxProducts ?? 10),
        hasCampaigns:        Boolean(planData.hasCampaigns),
        hasAutomations:      Boolean(planData.hasAutomations),
        hasAdvancedMarketing: Boolean(planData.hasAdvancedMarketing),
        flowBuilder:         Boolean(planData.flowBuilder),
        aiBrain:             Boolean(planData.aiBrain),
        popular:             Boolean(planData.popular),
        features:            planData.features,
      },
    });

    try {
      await prisma.tenant.updateMany({
        where: {
          OR: [
            { planId: id },
            { plan: { equals: planData.name, mode: 'insensitive' } }
          ]
        },
        data: {
          planId: id,
          plan: updated.name,
          msgLimit: Number(planData.msgLimit),
          connLimit: Number(planData.connLimit)
        }
      });
    } catch (syncErr) {
      console.error('Error al sincronizar tenants con el plan actualizado:', syncErr);
    }

    return res.json(updated);
  } catch (error) {
    console.error('Error en updatePlan:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un plan con ese nombre.' });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Plan no encontrado.' });
    }
    return res.status(500).json({ error: 'Error al modificar el plan comercial.' });
  }
}

export async function deletePlan(req, res) {
  try {
    const { id } = req.params;
    // Soft-delete: marcar como inactivo en lugar de borrar físicamente
    const deleted = await prisma.plan.update({
      where: { id },
      data: { active: false },
    });
    return res.json({ message: 'Plan eliminado correctamente.', deleted });
  } catch (error) {
    console.error('Error en deletePlan:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Plan no encontrado.' });
    }
    return res.status(500).json({ error: 'Error al eliminar el plan comercial.' });
  }
}

// ==========================================
// 3. CONFIGURACIÓN MAESTRO (PostgreSQL via Prisma — tabla SystemConfig)
// ==========================================

/**
 * Lee todos los registros de SystemConfig y los convierte en un objeto { key: value }
 * Rellena con valores por defecto las claves que no existan todavía en la BD.
 */
export async function getGlobalConfig(req, res) {
  try {
    const rows = await prisma.systemConfig.findMany();
    
    // Generar defaults dinámicos leyendo de las variables de entorno (.env)
    const dynamicDefaults = {
      evoUrl:       process.env.EVOLUTION_API_URL || '',
      evoApiKey:    process.env.EVOLUTION_API_KEY || '',
      wahaUrl:      process.env.WAHA_API_URL || '',
      wahaApiKey:   process.env.WAHA_API_KEY || '',
      wahaIsPrimary: process.env.WAHA_IS_PRIMARY || 'false',
      geminiKey:    process.env.GITHUB_MODELS_KEY || process.env.GITHUB_TOKEN || '',
      groqKey:      process.env.GROQ_API_KEY || '',
      systemPrompt: process.env.SYSTEM_PROMPT || 'Eres un asistente de atención al cliente educado, eficiente y servicial.',
      smtpHost:     process.env.SMTP_HOST || '',
      smtpPort:     process.env.SMTP_PORT || '587',
      smtpUser:     process.env.SMTP_USER || '',
      smtpPassword: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '',
      errorWebhook: process.env.ERROR_WEBHOOK || '',
      backupFrequency: process.env.BACKUP_FREQUENCY || 'off',
      backupCloudEnabled: process.env.BACKUP_CLOUD_ENABLED || 'false',
      backupCloudProvider: process.env.BACKUP_CLOUD_PROVIDER || 'cloudinary',
    };

    const configMap = { ...dynamicDefaults };
    for (const row of rows) {
      if (row.value !== undefined && row.value !== null) {
        configMap[row.key] = row.value;
      }
    }

    // Deserializar wahaIsPrimary, smtpPort y backupCloudEnabled a sus tipos nativos para el frontend
    configMap.wahaIsPrimary      = String(configMap.wahaIsPrimary) === 'true';
    configMap.backupCloudEnabled = String(configMap.backupCloudEnabled) === 'true';
    configMap.smtpPort           = Number(configMap.smtpPort) || 587;
    return res.json(configMap);
  } catch (error) {
    console.error('Error en getGlobalConfig:', error);
    return res.status(500).json({ error: 'Error al obtener la configuración global.' });
  }
}

/**
 * Recibe un objeto plano con las claves de configuración y hace upsert de cada una
 * en la tabla SystemConfig de PostgreSQL.
 */
export async function saveGlobalConfig(req, res) {
  try {
    const configData = req.body;

    // Filtrar solo las claves válidas y hacer upsert de cada una
    const upsertPromises = CONFIG_KEYS
      .filter(key => configData[key] !== undefined)
      .map(key =>
        prisma.systemConfig.upsert({
          where:  { key },
          create: { key, value: String(configData[key]) },
          update: { value: String(configData[key]) },
        })
      );

    await Promise.all(upsertPromises);
    return res.json({ message: 'Configuración global actualizada con éxito en PostgreSQL.' });
  } catch (error) {
    console.error('Error en saveGlobalConfig:', error);
    return res.status(500).json({ error: 'Error al guardar la configuración global.' });
  }
}

/**
 * Obtiene métricas del sistema globales reales desde PostgreSQL para el Dashboard de SuperAdmin
 */
export async function getGlobalStats(req, res) {
  try {
    // ── Rangos temporales ──────────────────────────────────────────────
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart); // = inicio de hoy (exclusive)

    // ── Conteos de Tenants ─────────────────────────────────────────────
    const totalTenants   = await prisma.tenant.count();
    const activeTenants  = await prisma.tenant.count({ where: { active: true } });
    const suspendedTenants = totalTenants - activeTenants;

    // ── Usuarios y Productos ───────────────────────────────────────────
    const totalUsers    = await prisma.user.count();
    const totalProducts = await prisma.product.count();

    // ── Conversaciones (Chats) ─────────────────────────────────────────
    // "Activas hoy" = chats donde se recibió al menos un mensaje hoy
    const chatsToday = await prisma.chat.count({
      where: {
        messages: {
          some: { createdAt: { gte: todayStart } }
        }
      }
    });
    const chatsYesterday = await prisma.chat.count({
      where: {
        messages: {
          some: {
            createdAt: { gte: yesterdayStart, lt: yesterdayEnd }
          }
        }
      }
    });
    const totalChats = await prisma.chat.count();

    // ── Mensajes ───────────────────────────────────────────────────────
    const msgsToday     = await prisma.message.count({ where: { createdAt: { gte: todayStart } } });
    const msgsYesterday = await prisma.message.count({
      where: { createdAt: { gte: yesterdayStart, lt: yesterdayEnd } }
    });
    const totalMessages = await prisma.message.count();

    // ── Estado de IA ───────────────────────────────────────────────────
    const aiStatusConfig = await prisma.systemConfig.findUnique({
      where: { key: 'aiStatus' }
    });
    const aiStatus = aiStatusConfig?.value || 'OPERATIVE';

    return res.json({
      tenants: {
        total:     totalTenants,
        active:    activeTenants,
        suspended: suspendedTenants,
      },
      users: {
        total: totalUsers,
      },
      products: {
        total: totalProducts,
      },
      chats: {
        total:     totalChats,
        today:     chatsToday,
        yesterday: chatsYesterday,
        delta:     chatsToday - chatsYesterday,  // positivo = más que ayer
      },
      messages: {
        total:     totalMessages,
        today:     msgsToday,
        yesterday: msgsYesterday,
        delta:     msgsToday - msgsYesterday,    // positivo = más que ayer
      },
      aiStatus,
    });
  } catch (error) {
    console.error('Error en getGlobalStats:', error);
    return res.status(500).json({ error: 'Error al calcular las estadísticas globales del sistema.' });
  }
}

/**
 * Comprueba el estado real de los servicios del sistema:
 * 1. Base de datos (Prisma ping)
 * 2. API Gateway WhatsApp (Evolution API — ping desde SystemConfig)
 * 3. Almacenamiento Cloudinary (variable de entorno)
 * 4. Backend propio (siempre OK si esta función responde)
 */
export async function getSystemHealth(req, res) {
  const checks = [];

  // ── 1. Base de Datos ───────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ label: 'Base de Datos', ok: true, status: 'Operacional', latencyMs: Date.now() - dbStart });
  } catch {
    checks.push({ label: 'Base de Datos', ok: false, status: 'Error de conexión', latencyMs: Date.now() - dbStart });
  }

  // ── 2. API Gateway (Evolution API) ────────────────────────────────
  try {
    const [urlRow, keyRow] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'evoUrl' } }),
      prisma.systemConfig.findUnique({ where: { key: 'evoApiKey' } }),
    ]);
    const gatewayUrl = urlRow?.value;

    if (!gatewayUrl) {
      checks.push({ label: 'API Gateway (WhatsApp)', ok: false, status: 'Sin configurar', latencyMs: 0 });
    } else {
      const gwStart = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const r = await fetch(gatewayUrl, {
          method: 'GET',
          headers: keyRow?.value ? { apikey: keyRow.value } : {},
          signal: controller.signal,
        });
        clearTimeout(timeout);
        checks.push({
          label: 'API Gateway (WhatsApp)',
          ok: r.ok || r.status < 500,
          status: (r.ok || r.status < 500) ? 'Operacional' : `HTTP ${r.status}`,
          latencyMs: Date.now() - gwStart,
        });
      } catch (e) {
        clearTimeout(timeout);
        checks.push({
          label: 'API Gateway (WhatsApp)',
          ok: false,
          status: e.name === 'AbortError' ? 'Timeout (>4s)' : 'Sin respuesta',
          latencyMs: Date.now() - gwStart,
        });
      }
    }
  } catch {
    checks.push({ label: 'API Gateway (WhatsApp)', ok: false, status: 'Error interno', latencyMs: 0 });
  }

  // ── 3. Almacenamiento (Cloudinary) ────────────────────────────────
  const cloudOk = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  checks.push({
    label: 'Almacenamiento (Cloudinary)',
    ok: cloudOk,
    status: cloudOk ? 'Configurado' : 'Credenciales no configuradas',
    latencyMs: 0,
  });

  // ── 4. Backend (este propio servidor) ─────────────────────────────
  checks.push({ label: 'Backend API (Render)', ok: true, status: 'Operacional', latencyMs: 0 });

  return res.json({ services: checks, checkedAt: new Date().toISOString() });
}


/**
 * Restablece el estado global de los servidores de IA a 'OPERATIVE'
 */
export async function resetAiStatus(req, res) {
  try {
    await prisma.systemConfig.upsert({
      where: { key: 'aiStatus' },
      update: { value: 'OPERATIVE' },
      create: { key: 'aiStatus', value: 'OPERATIVE' }
    });
    return res.json({ message: 'El estado de los servidores de IA ha sido restablecido a Operativo.' });
  } catch (error) {
    console.error('Error en resetAiStatus:', error);
    return res.status(500).json({ error: 'Error al restablecer el estado de los servidores de IA.' });
  }
}

/**
 * Devuelve las últimas 5 alertas del sistema para usarlas como feed de "Actividad Reciente"
 * en el Dashboard del SuperAdmin.
 */
export async function getRecentActivity(req, res) {
  try {
    const alerts = await prisma.alert.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { name: true } },
      },
    });

    const activity = alerts.map(al => ({
      id:     al.id,
      action: al.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      detail: al.tenant?.name ? `${al.tenant.name} — ${al.message.slice(0, 50)}` : al.message.slice(0, 60),
      time:   al.createdAt,
      resolved: al.resolved,
    }));

    return res.json(activity);
  } catch (error) {
    console.error('Error en getRecentActivity:', error);
    return res.status(500).json({ error: 'Error al obtener la actividad reciente.' });
  }
}

/**
 * Hace un ping real al gateway de WhatsApp configurado (Evolution API o WAHA).
 * Lee la URL desde SystemConfig y devuelve si responde o no.
 */
export async function checkGatewayHealth(req, res) {
  const { gateway } = req.params; // 'evolution' | 'waha'

  try {
    const keyUrl    = gateway === 'evolution' ? 'evoUrl'    : 'wahaUrl';
    const keyApiKey = gateway === 'evolution' ? 'evoApiKey' : 'wahaApiKey';

    const [urlRow, keyRow] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: keyUrl    } }),
      prisma.systemConfig.findUnique({ where: { key: keyApiKey } }),
    ]);

    const gatewayUrl = urlRow?.value;
    if (!gatewayUrl) {
      return res.status(400).json({ ok: false, message: 'URL del gateway no configurada todavía.' });
    }

    // Intento de ping real con un timeout de 5 segundos
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const pingResponse = await fetch(`${gatewayUrl}`, {
        method: 'GET',
        headers: keyRow?.value ? { 'apikey': keyRow.value } : {},
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return res.json({
        ok:      pingResponse.ok || pingResponse.status < 500,
        status:  pingResponse.status,
        message: pingResponse.ok ? 'Gateway respondiendo correctamente.' : `Gateway respondió con estado ${pingResponse.status}.`,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const timedOut = fetchErr.name === 'AbortError';
      return res.json({
        ok:      false,
        message: timedOut ? 'Timeout: el gateway no respondió en 5 segundos.' : `No se pudo conectar: ${fetchErr.message}`,
      });
    }
  } catch (error) {
    console.error('Error en checkGatewayHealth:', error);
    return res.status(500).json({ ok: false, message: 'Error interno al verificar el gateway.' });
  }
}

/**
 * Obtiene la lista de todas las alertas ordenadas por fecha reciente, incluyendo información del tenant asociado
 */
export async function getAlerts(req, res) {
  try {
    const alerts = await prisma.alert.findMany({
      include: {
        tenant: {
          select: {
            name: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc',
      }
    });

    return res.json(alerts);
  } catch (error) {
    console.error('Error en getAlerts:', error);
    return res.status(500).json({ error: 'Error al obtener la lista de alertas globales.' });
  }
}

/**
 * Marca una alerta específica como resuelta
 */
export async function resolveAlert(req, res) {
  try {
    const { id } = req.params;

    const alert = await prisma.alert.update({
      where: { id },
      data: { resolved: true },
    });

    return res.json({
      success: true,
      message: 'Alerta marcada como resuelta con éxito.',
      alert
    });
  } catch (error) {
    console.error('Error en resolveAlert:', error);
    return res.status(500).json({ error: 'Error al marcar la alerta como resuelta.' });
  }
}

/**
 * Obtiene la lista de backups generados en el directorio local de backups
 */
export async function getBackups(req, res) {
  try {
    const backupsDir = path.join(process.cwd(), 'backups');

    // Asegurar la existencia física del directorio
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const files = fs.readdirSync(backupsDir);
    const backupList = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const filePath = path.join(backupsDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          sizeBytes: stats.size,
          createdAt: stats.birthtime || stats.mtime,
        };
      });

    // Ordenar por fecha de creación descendente
    backupList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json(backupList);
  } catch (error) {
    console.error('Error en getBackups:', error);
    return res.status(500).json({ error: 'Error al escanear los respaldos en el servidor.' });
  }
}

/**
 * Genera un backup estructurado en formato JSON con la información principal de la BD
 */
export async function generateBackup(req, res) {
  try {
    const backupsDir = path.join(process.cwd(), 'backups');

    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    // Recopilar datos reales de la base de datos PostgreSQL
    const tenants = await prisma.tenant.findMany();
    const users = await prisma.user.findMany();
    const products = await prisma.product.findMany();
    const contacts = await prisma.contact.findMany();
    const chats = await prisma.chat.findMany();
    const messages = await prisma.message.findMany();
    const flows = await prisma.flow.findMany(); // Respaldar tabla de flujos reales
    const automationFlows = await prisma.automationFlow.findMany(); // Respaldar de respaldo heredada
    const alerts = await prisma.alert.findMany();
    const campaigns = await prisma.campaign.findMany();
    const campaignLogs = await prisma.campaignLog.findMany();
    const customers = await prisma.customer.findMany();
    const plans = await prisma.plan.findMany();
    const systemConfigs = await prisma.systemConfig.findMany();

    const backupPayload = {
      metadata: {
        version: '1.0.0',
        generatedAt: new Date(),
        scope: 'SaaS Bot Database Backup',
      },
      data: {
        tenants,
        users,
        products,
        contacts,
        chats,
        messages,
        flows,
        automationFlows,
        alerts,
        campaigns,
        campaignLogs,
        customers,
        plans,
        systemConfigs,
      },
    };

    // Nombre de archivo con marca de tiempo: backup_YYYYMMDD_HHMMSS.json
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-T:]/g, '')
      .split('.')[0];
    const filename = `backup_${timestamp}.json`;
    const filePath = path.join(backupsDir, filename);

    // Escribir el respaldo en el disco (async para no bloquear el event loop)
    await fs.promises.writeFile(filePath, JSON.stringify(backupPayload, null, 2), 'utf-8');

    return res.status(201).json({
      success: true,
      message: 'Respaldo del sistema generado con éxito.',
      filename,
      sizeBytes: fs.statSync(filePath).size,
      createdAt: now,
    });
  } catch (error) {
    console.error('Error en generateBackup:', error);
    return res.status(500).json({ error: 'Error al volcar y generar el respaldo de base de datos.' });
  }
}

/**
 * Descarga físicamente un archivo de backup del servidor
 */
export async function downloadBackup(req, res) {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filePath = path.join(process.cwd(), 'backups', safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'El archivo de respaldo no existe.' });
    }

    return res.download(filePath, safeFilename);
  } catch (error) {
    console.error('Error en downloadBackup:', error);
    return res.status(500).json({ error: 'Error al descargar el archivo de respaldo.' });
  }
}
