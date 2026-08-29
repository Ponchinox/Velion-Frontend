import express from 'express';
import { spawn } from 'child_process';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BACKEND_PORT = 5005;
const MOCK_EVO_PORT = 9999;
const TENANT_ID = '1f9cc3ef-6c2a-4309-bd20-86478edcb536';
const INSTANCE = `bot_prod_${TENANT_ID.substring(0, 8)}`;
const API_KEY = 'test_api_key_123';
const TEST_PHONE = '51999999999';
const TEST_JID = `${TEST_PHONE}@s.whatsapp.net`;

let backendProcess;
let mockServer;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function startMockServer() {
  const app = express();
  app.use(express.json());

  app.get(`/instance/connectionState/${INSTANCE}`, (req, res) => {
    res.json({ instance: { state: "open", phone: TEST_PHONE } });
  });

  app.post(`/message/sendText/${INSTANCE}`, (req, res) => {
    console.log(`\n🤖 [MOCK EVO] Mensaje saliente interceptado:\n--- INICIO RESPUESTA ---\n${req.body.text[0] || req.body.text}\n--- FIN RESPUESTA ---\n`);
    res.json({ key: { id: `mock_sent_${Date.now()}` } });
  });

  return new Promise(resolve => {
    mockServer = app.listen(MOCK_EVO_PORT, () => {
      console.log(`✅ Mock Evolution Server running on port ${MOCK_EVO_PORT}`);
      resolve();
    });
  });
}

async function startBackend() {
  return new Promise((resolve) => {
    console.log('Iniciando Backend API localmente...');
    backendProcess = spawn('node', ['server.js'], {
      env: {
        ...process.env,
        PORT: BACKEND_PORT,
        EVOLUTION_API_URL: `http://localhost:${MOCK_EVO_PORT}`,
        EVOLUTION_API_KEY: API_KEY,
        NODE_ENV: 'development'
      },
      stdio: 'pipe'
    });

    let started = false;
    backendProcess.stdout.on('data', (data) => {
      const out = data.toString();
      // Ocultar logs masivos del backend para limpieza de la prueba, salvo que sea error o arranque
      if (out.includes('Servidor')) {
        console.log(`✅ Backend running on port ${BACKEND_PORT}`);
        started = true;
        resolve();
      }
      if (out.includes('Error')) console.log(`[BACKEND ERROR] ${out.trim()}`);
    });

    backendProcess.stderr.on('data', (data) => {
      console.error(`[BACKEND STDERR] ${data.toString().trim()}`);
    });
  });
}

async function sendWebhook(text, msgId) {
  console.log(`\n👤 [TEST USER] Enviando: "${text}"`);
  
  const payload = {
    event: 'messages.upsert',
    instance: INSTANCE,
    apikey: API_KEY,
    data: {
      key: { remoteJid: TEST_JID, fromMe: false, id: msgId },
      pushName: 'Test E2E User',
      message: { conversation: text }
    }
  };

  try {
    const res = await axios.post(`http://localhost:${BACKEND_PORT}/api/whatsapp/webhook`, payload);
    if (res.status === 200) {
      console.log(`✅ Webhook aceptado (200 OK)`);
    }
  } catch (err) {
    console.error('❌ Error enviando webhook:', err.message);
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('INICIANDO PRUEBAS FUNCIONALES END-TO-END');
  console.log('========================================================\n');

  try {
    await prisma.$connect();
    console.log('✅ Prisma connected to Neon OK');
    
    // Limpiar lock y estado del usuario de prueba antes de empezar
    await prisma.customer.updateMany({
      where: { phone: TEST_PHONE, tenantId: TENANT_ID },
      data: { isBotPaused: false }
    });

    await startMockServer();
    await startBackend();

    // Esperar a que los sockets y la DB estén listos
    await sleep(2000);

    // Test 1: Saludo normal
    await sendWebhook('Hola, buenas tardes', 'test_msg_1');
    await sleep(6000); // Esperar que procese (4s de rafaga + AI)

    // Test 2: Pregunta externa
    await sendWebhook('¿Qué es Google Cloud y cómo funciona un servidor Linux?', 'test_msg_2');
    await sleep(6000);

    // Test 3: Pregunta sobre catálogo (Debería invocar FC search_inventory)
    await sendWebhook('¿Tienen audífonos bluetooth disponibles?', 'test_msg_3');
    await sleep(8000);
    
    // Test 4: Verificación isBotPaused
    const cust = await prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId: TENANT_ID, phone: TEST_PHONE } }
    });
    console.log(`\nEstado isBotPaused al final: ${cust?.isBotPaused}`);

  } catch (err) {
    console.error('Error durante pruebas:', err);
  } finally {
    console.log('\nLimpiando recursos...');
    if (mockServer) mockServer.close();
    if (backendProcess) backendProcess.kill();
    await prisma.$disconnect();
    console.log('✅ Pruebas finalizadas.');
    process.exit(0);
  }
}

runTests();
