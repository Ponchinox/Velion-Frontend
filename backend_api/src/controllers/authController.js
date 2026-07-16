import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';

/**
 * Registra un nuevo Tenant y su respectivo Usuario Administrador
 */
export async function registerAccount(req, res) {
  try {
    const { email, password, name, plan } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (email, password, name).' });
    }

    // Verificar si el correo ya existe
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'El correo electrónico ya se encuentra registrado.' });
    }

    // Determinar límites por plan
    let msgLimit = 1000;
    let connLimit = 1;
    if (plan === 'Pro') {
      msgLimit = 10000;
      connLimit = 3;
    } else if (plan === 'Elite') {
      msgLimit = 50000;
      connLimit = 10;
    }

    // 1. Crear el Tenant
    const tenant = await prisma.tenant.create({
      data: {
        name,
        plan: plan || 'Básico',
        msgLimit,
        connLimit,
      },
    });

    // 2. Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Crear el Usuario administrador del Tenant
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'client',
        tenantId: tenant.id,
      },
    });

    // 4. Firmar Token JWT
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      process.env.JWT_SECRET || 'supersecreto123',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'Cuenta creada y registrada con éxito.',
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: tenant.name,
        plan: tenant.plan,
      },
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
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      process.env.JWT_SECRET || 'supersecreto123',
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Sesión iniciada con éxito.',
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant?.name || null,
        plan: user.tenant?.plan || null,
      },
    });
  } catch (error) {
    console.error('Error en loginAccount:', error);
    return res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
}
