import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);

// Configuración del servidor WebSocket
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Permitir todos los orígenes para máxima compatibilidad con localhosts
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
app.use(cors());
app.use(express.json());

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

// Ruta de comprobación de estado (Healthcheck + DB Test)
app.get('/api/health', async (req, res) => {
  try {
    const tenantCount = await prisma.tenant.count();
    res.json({
      status: 'ok',
      message: 'Servidor ElitePOS/Velion Operativo',
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
});
