import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';

/**
 * Registra un nuevo Tenant y su respectivo Usuario Administrador
 */
export async function registerAccount(req, res) {
  try {
    const { companyName, userName, email, password } = req.body;

    if (!companyName || !userName || !email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (companyName, userName, email, password).' });
    }

    // Verificar si el correo ya existe
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'El correo electrónico ya se encuentra registrado.' });
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Lógica de negocio con Transacción Prisma para consistencia
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear el Tenant sin plan inicial
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          plan: 'Sin Plan',
          planId: null,
          msgLimit: 0,
          connLimit: 0,
        },
      });

      // 2. Crear el Usuario administrador (rol 'client') asociado al Tenant
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name: userName,
          role: 'client',
          tenantId: tenant.id,
        },
      });

      return { tenant, user };
    });

    return res.status(201).json({
      message: 'Cuenta creada con éxito, inicia sesión.',
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        tenantId: result.user.tenantId,
        tenantName: result.tenant.name,
        plan: result.tenant.plan,
        planId: null,
        hasPlan: false,
        tenant: {
          id: result.tenant.id,
          name: result.tenant.name,
          plan: result.tenant.plan,
          planId: null,
          connLimit: result.tenant.connLimit,
          msgLimit: result.tenant.msgLimit,
          hasPlan: false,
        }
      }
    });
  } catch (error) {
    console.error('Error en registerAccount:', error);
    return res.status(500).json({ error: 'Error interno al registrar la cuenta.' });
  }
}


/**
 * Autentica un usuario existente y devuelve su token de sesión
 */
export async function loginAccount(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (email, password).' });
    }

    // Buscar usuario e incluir información de su Tenant si existe
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    // Firmar Token JWT
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET no está configurada en el entorno de Producción.');
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const hasPlan = user.role === 'superadmin' ? true : Boolean(user.tenant?.planId);

    // Cargar los feature flags del plan para el cliente (evita peticiones adicionales)
    let planFeatures = null;
    if (user.tenant?.planId) {
      planFeatures = await prisma.plan.findUnique({
        where: { id: user.tenant.planId },
        select: {
          id: true,
          name: true,
          maxProducts: true,
          hasCampaigns: true,
          hasAutomations: true,
          hasAdvancedMarketing: true,
          connLimit: true,
          msgLimit: true,
        },
      });
    } else if (user.tenant?.plan && user.tenant.plan !== 'Sin Plan') {
      planFeatures = await prisma.plan.findFirst({
        where: { name: user.tenant.plan },
        select: {
          id: true,
          name: true,
          maxProducts: true,
          hasCampaigns: true,
          hasAutomations: true,
          hasAdvancedMarketing: true,
          connLimit: true,
          msgLimit: true,
        },
      });
    }

    return res.json({
      message: 'Sesión iniciada con éxito.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || '',
        phone: user.phone || '',
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant?.name || null,
        plan: user.tenant?.plan || null,
        planId: user.tenant?.planId || null,
        hasPlan,
        planFeatures,
        tenant: user.tenant ? {
          id: user.tenant.id,
          name: user.tenant.name,
          plan: user.tenant.plan,
          planId: user.tenant.planId,
          connLimit: user.tenant.connLimit,
          msgLimit: user.tenant.msgLimit,
          hasPlan,
        } : null,
      },
    });
  } catch (error) {
    console.error('Error en loginAccount:', error);
    return res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
}
