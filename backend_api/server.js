import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from './src/db.js';
import authRoutes from './src/routes/authRoutes.js';
import contactRoutes from './src/routes/contactRoutes.js';
import whatsappRoutes from './src/routes/whatsappRoutes.js';
import chatRoutes from './src/routes/chatRoutes.js';
import automationRoutes from './src/routes/automationRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import productRoutes from './src/routes/productRoutes.js';
import internalRoutes from './src/routes/internalRoutes.js';
import campaignRoutes from './src/routes/campaignRoutes.js';
import flowRoutes from './src/routes/flowRoutes.js';
import settingsRoutes from './src/routes/settingsRoutes.js';
import connectionRoutes from './src/routes/connectionRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import tenantDashboardRoutes from './src/routes/tenantDashboardRoutes.js';
import planRoutes from './src/routes/planRoutes.js';
import { initBackupScheduler } from './src/services/backupScheduler.js';

// Cargar variables de entorno
dotenv.config();

const app = express();

app.set('trust proxy', true);

app.get('/ping', (req, res) => res.status(200).send('pong'));

// Aumentar el límite de carga a 50mb para flujos pesados con multimedia (Base64)
app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.includes('/stripe/webhook')) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);

// Configuración del servidor WebSocket
const allowedOrigins = process.env.FRONTEND_URL 
  ? [process.env.FRONTEND_URL, 'https://velion-dashboard-visual.vercel.app', 'http://localhost:5173', 'http://localhost:3000'] 
  : ['https://velion-dashboard-visual.vercel.app', 'http://localhost:5173', 'http://localhost:3000'];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// Guardar instancia global de socket.io
global.io = io;

// Middleware para adjuntar la instancia de socket.io a cada request
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Middlewares generales
app.use(helmet());
app.use(cors({
  origin: [
    'https://velion-dashboard-visual.vercel.app', // Tu página en producción
    'http://localhost:5173', // Tu página local (para cuando programes)
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
  credentials: true
}));

// ── Rate Limiting (Protección contra abusos y fuerza bruta) ───────────────

// Limiter General: 300 peticiones por IP cada 15 minutos
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,      // 15 minutos
  max: 300,                       // Máximo 300 peticiones por IP por ventana
  standardHeaders: true,          // Envía los headers RateLimit-* estándar
  legacyHeaders: false,           // Desactiva los headers X-RateLimit-* obsoletos
  validate: { trustProxy: false }, // Deshabilita la validación de trustProxy (Render usa proxy propio)
  message: { error: 'Demasiadas peticiones desde esta IP. Intenta de nuevo en 15 minutos.' },
  skip: (req) => {
    // 🔴 CRÍTICO: Excluir rutas de webhook — reciben tráfico masivo de WhatsApp
    // y no deben ser bloqueadas bajo ninguna circunstancia.
    if (req.originalUrl.includes('/webhook')) return true;
    // Excluir también las rutas internas del sistema (bot ↔ backend)
    if (req.originalUrl.includes('/api/internal')) return true;
    return false;
  }
});

// Limiter Estricto para Autenticación: máximo 20 intentos por IP cada 15 minutos
// Protege el endpoint de login contra ataques de fuerza bruta.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // Deshabilita la validación de trustProxy (Render usa proxy propio)
  message: { error: 'Demasiados intentos de inicio de sesión. Espera 15 minutos antes de volver a intentarlo.' }
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/products', productRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/flows', flowRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tenant/dashboard', tenantDashboardRoutes);
app.use('/api/plans', planRoutes);

// Ruta de comprobación de estado (Healthcheck + DB Test)
app.get('/api/health', async (req, res) => {
  try {
    const tenantCount = await prisma.tenant.count();
    res.json({
      status: 'ok',
      message: 'Servidor API Operativo',
      database: 'Conectado',
      tenants: tenantCount,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Servidor operativo, pero no se pudo conectar con la base de datos.',
      error: error.message,
    });
  }
});

// ── Socket.IO Authentication & Tenant Isolation Middleware ───────────────
// REQUISITO ESTRICTO DE SEGURIDAD:
//   A. Sin token   → conexión RECHAZADA
//   B. JWT inválido → conexión RECHAZADA
//   C. JWT expirado → conexión RECHAZADA
//   D. Tenant válido → sala de su tenant (tenantId del JWT, NO del cliente)
//   E. Usuario normal intentando otro tenant → ignorado/rechazado
//   F. SuperAdmin autorizado → puede impersonar mediante mecanismo validado
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || 
                  socket.handshake.headers?.authorization?.replace('Bearer ', '') || 
                  socket.handshake.query?.token;

    // A. Sin token → rechazado estrictamente
    if (!token) {
      console.warn('🚫 [Socket.IO] Conexión rechazada: sin token JWT.');
      return next(new Error('Authentication error'));
    }

    if (!process.env.JWT_SECRET) {
      // Sin JWT_SECRET configurado en el entorno → rechazamos por seguridad
      console.error('🚫 [Socket.IO] JWT_SECRET no configurado. Rechazando conexión.');
      return next(new Error('Authentication error'));
    }

    // B/C. Token inválido o expirado → jwt.verify lanza excepción → catch rechaza
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;

    // D. TenantId proviene del JWT validado, NUNCA del cliente sin firmar
    let effectiveTenantId = decoded.tenantId;

    // F. Impersonación de SuperAdmin: solo válida si el JWT tiene role 'superadmin'
    // E. Un usuario normal NO puede cambiar su tenant a otro
    const impersonatedTenantId = socket.handshake.auth?.impersonatedTenantId || 
                                 socket.handshake.query?.impersonatedTenantId;

    if (impersonatedTenantId && decoded.role === 'superadmin') {
      effectiveTenantId = impersonatedTenantId;
      console.log(`🔑 [Socket.IO] SuperAdmin ${decoded.email || decoded.id} impersonando tenant: ${effectiveTenantId}`);
    }

    socket.tenantId = effectiveTenantId;
    next();
  } catch (err) {
    // B/C. JWT inválido o expirado
    console.warn('🚫 [Socket.IO] Conexión rechazada por JWT inválido/expirado:', err.message);
    return next(new Error('Authentication error'));
  }
});

// Socket connection monitor & room assignment
io.on('connection', (socket) => {
  if (socket.tenantId) {
    const roomName = `tenant:${socket.tenantId}`;
    socket.join(roomName);
    console.log(`🔌 [Socket.IO] Cliente ${socket.id} autenticado y unido a sala ${roomName} (User: ${socket.user?.email || 'N/A'})`);
  } else {
    console.log(`🔌 [Socket.IO] Cliente conectado sin tenant verificado: ${socket.id}`);
  }

  socket.on('disconnect', () => {
    console.log(`🔌 [Socket.IO] Cliente desconectado: ${socket.id}`);
  });
});


// Levantar servidor
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  // Iniciar la tarea programada de copias de seguridad automáticas
  initBackupScheduler();
});
