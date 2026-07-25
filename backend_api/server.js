import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
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
import stripeRoutes from './src/routes/stripeRoutes.js';
import planRoutes from './src/routes/planRoutes.js';
import { initBackupScheduler } from './src/services/backupScheduler.js';

// Cargar variables de entorno
dotenv.config();

const app = express();

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
  ? [process.env.FRONTEND_URL, 'http://localhost:5173'] 
  : ['http://localhost:5173'];

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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
  credentials: true
}));

// Rate Limiting Básico (100 peticiones por 15 minutos)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, 
  message: { error: 'Demasiadas peticiones desde esta IP, intenta de nuevo en 15 minutos.' },
  skip: (req) => {
    // 🔴 CRÍTICO: No bloquear rutas de webhooks bajo ninguna circunstancia
    if (req.originalUrl.includes('/api/stripe/webhook') || req.originalUrl.includes('/api/whatsapp/webhook')) {
      return true;
    }
    return false;
  }
});
app.use('/api', apiLimiter);

// Webhook de Stripe: Requiere el body crudo (Buffer) para verificar firmas
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

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
app.use('/api/stripe', stripeRoutes);
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

// Socket connection monitor
io.on('connection', (socket) => {
  console.log(`🔌 [Socket.IO] Cliente conectado: ${socket.id}`);
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
