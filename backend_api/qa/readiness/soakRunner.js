/**
 * soakRunner.js — Velion Soak Test Runner (Configurable Duration & Load)
 * =======================================================================
 * Ejecuta carga continua y controlada de múltiples conversaciones simultáneas
 * para medir estabilidad en RAM, ciclos de event loop, latencias y fugas.
 *
 * Garantías:
 * - Network Guard activo: 0 llamadas WAN, 0 WhatsApp real, 0 producción DB.
 * - S/0.00 costo.
 * - Soporta argumento CLI: --minutes=N (por defecto 1 minuto).
 */

import '../networkGuard.js';
import assert from 'node:assert';
import {
  GlobalErrorTracker,
  createMockPrismaStore,
  resetTestingEnvironment,
  getMemorySnapshotMb
} from './readinessUtils.js';

import { TENANT_A } from '../fixtures/tenants.js';

import {
  getChatGenerationVersion,
  incrementChatGenerationVersion,
  processingLocks,
  pendingQueues,
  messageBuffers,
  handleOperationalTool,
  detectProductMediaIntent,
  enforceMediaAuthority,
  enforceBusinessAuthority,
  calculateDueDateLocal,
  calculateDueAtUtc
} from '../../src/controllers/whatsappController.js';

import { getCanonicalProductPrice } from '../../src/services/orderCommercialService.js';
import { isHandoffActive } from '../../src/services/humanHandoffGate.js';

// Parsear argumento CLI: --minutes=N
function parseDurationMinutes() {
  const arg = process.argv.find(a => a.startsWith('--minutes='));
  if (arg) {
    const val = parseFloat(arg.split('=')[1]);
    if (!isNaN(val) && val > 0) return val;
  }
  return 1; // 1 minuto por defecto
}

const errorTracker = new GlobalErrorTracker();

async function runSoak() {
  errorTracker.start();

  const minutes = parseDurationMinutes();
  const durationMs = minutes * 60 * 1000;
  const startTime = Date.now();
  const endTime = startTime + durationMs;

  console.log('\n======================================================================');
  console.log(`    VELION SIMULATED SOAK TEST RUNNER (${minutes} MINUTO(S) CONFIGURADO)      `);
  console.log('    LOCAL HARNESS SIMULATION, MEMORY & RESOURCE LIFECYCLE AUDIT       ');
  console.log('======================================================================\n');

  const initialMem = getMemorySnapshotMb();
  let peakMem = { ...initialMem };

  const store = createMockPrismaStore({
    tenants: [TENANT_A],
    products: [...TENANT_A.products]
  });

  const CHATS = [
    { id: 'chat-soak-1', phone: '51900000001', paused: false },
    { id: 'chat-soak-2', phone: '51900000002', paused: false },
    { id: 'chat-soak-3', phone: '51900000003', paused: true },
    { id: 'chat-soak-4', phone: '51900000004', paused: false }
  ];

  // Crear contactos en el store
  for (const c of CHATS) {
    await store.contact.create({ data: { id: c.id, tenantId: TENANT_A.id, phone: c.phone, botPaused: c.paused } });
  }

  // Crear un cliente con isBotPaused para verificar ruta Customer con OR/contains
  await store.customer.create({
    data: { id: 'cust-paused-or', tenantId: TENANT_A.id, phone: '51900000099', isBotPaused: true }
  });

  const SCENARIO_TYPES = [
    'SALUDO',
    'PRODUCTO',
    'PRECIO',
    'IMAGEN',
    'VIDEO',
    'BURST',
    'SUPERSEDED',
    'TASK',
    'NOTE',
    'HANDOFF_MOCK'
  ];

  let totalIterations = 0;
  let passedIterations = 0;
  let failedIterations = 0;
  const latencies = [];

  let lastTelemetryTime = Date.now();
  const telemetryIntervalMs = 5000; // Log cada 5 segundos

  console.log(`🚀 Iniciando ejecución continua. Fin estimado: ${new Date(endTime).toLocaleTimeString()}...`);
  console.log(`   Baseline Memory: RSS=${initialMem.rssMb}MB, HeapUsed=${initialMem.heapUsedMb}MB\n`);

  while (Date.now() < endTime) {
    totalIterations++;
    const chat = CHATS[totalIterations % CHATS.length];
    const scenarioType = SCENARIO_TYPES[totalIterations % SCENARIO_TYPES.length];
    const bufferKey = `${TENANT_A.id}:${chat.phone}`;

    const iterStart = Date.now();
    let iterPassed = false;

    try {
      switch (scenarioType) {
        case 'SALUDO': {
          incrementChatGenerationVersion(bufferKey);
          processingLocks.add(bufferKey);
          const reply = 'Hola buenas tardes, ¿en qué te puedo ayudar hoy?';
          assert.ok(reply.length > 0);
          processingLocks.delete(bufferKey);
          iterPassed = true;
          break;
        }

        case 'PRODUCTO': {
          incrementChatGenerationVersion(bufferKey);
          processingLocks.add(bufferKey);
          const prod = await store.product.findFirst({ where: { tenantId: TENANT_A.id } });
          assert.ok(prod && prod.name);
          processingLocks.delete(bufferKey);
          iterPassed = true;
          break;
        }

        case 'PRECIO': {
          incrementChatGenerationVersion(bufferKey);
          processingLocks.add(bufferKey);
          const prod = TENANT_A.products[0];
          const price = getCanonicalProductPrice(prod);
          assert.ok(price > 0);
          processingLocks.delete(bufferKey);
          iterPassed = true;
          break;
        }

        case 'IMAGEN': {
          incrementChatGenerationVersion(bufferKey);
          processingLocks.add(bufferKey);
          const intent = detectProductMediaIntent('¿Tienes foto del reloj?');
          assert.strictEqual(intent, 'image');
          const cleaned = enforceMediaAuthority('Aquí tienes la foto http://185.163.116.210/media/tenants/tenant-1/test.jpg', true);
          assert.ok(!cleaned.includes('/media/tenants/tenant-1/test.jpg'));
          processingLocks.delete(bufferKey);
          iterPassed = true;
          break;
        }

        case 'VIDEO': {
          incrementChatGenerationVersion(bufferKey);
          processingLocks.add(bufferKey);
          const intent = detectProductMediaIntent('Mándame video');
          assert.strictEqual(intent, 'video');
          processingLocks.delete(bufferKey);
          iterPassed = true;
          break;
        }

        case 'BURST': {
          // 2 mensajes rápidos seguidos
          const v0 = getChatGenerationVersion(bufferKey);
          incrementChatGenerationVersion(bufferKey);
          processingLocks.add(bufferKey);

          incrementChatGenerationVersion(bufferKey);
          pendingQueues.set(bufferKey, { text: 'Mensaje acumulado 2' });

          const isSup = getChatGenerationVersion(bufferKey) > v0 + 1;
          assert.strictEqual(isSup, true);

          processingLocks.delete(bufferKey);
          pendingQueues.delete(bufferKey);
          iterPassed = true;
          break;
        }

        case 'SUPERSEDED': {
          incrementChatGenerationVersion(bufferKey);
          const v1 = getChatGenerationVersion(bufferKey);
          processingLocks.add(bufferKey);

          incrementChatGenerationVersion(bufferKey);
          const isSup = getChatGenerationVersion(bufferKey) !== v1;
          assert.strictEqual(isSup, true);

          processingLocks.delete(bufferKey);
          iterPassed = true;
          break;
        }

        case 'TASK': {
          const res = await handleOperationalTool('create_operational_task', {
            category: 'FOLLOW_UP',
            summary: `Tarea soak iteración ${totalIterations}`,
            dueDaysOffset: 1,
            dueTime: '15:00'
          }, {
            tenant: TENANT_A,
            prismaClient: store,
            clientNumber: chat.phone
          });
          assert.strictEqual(res.success, true);
          assert.ok(res.itemId);
          iterPassed = true;
          break;
        }

        case 'NOTE': {
          const res = await handleOperationalTool('register_operational_note', {
            category: 'COORDINATION',
            summary: `Nota soak iteración ${totalIterations}`
          }, {
            tenant: TENANT_A,
            prismaClient: store,
            clientNumber: chat.phone
          });
          assert.strictEqual(res.success, true);
          assert.ok(res.itemId);
          iterPassed = true;
          break;
        }

        case 'HANDOFF_MOCK': {
          // 1. Probar ruta por teléfono (evalúa Contact con OR: [{ phone: { contains: cleanPhone } }, { phone: rawPhone }])
          const pausedByPhone = await isHandoffActive({
            tenantId: TENANT_A.id,
            phone: chat.phone,
            prismaClient: store
          });
          // Si el mock Prisma fallara con error, el catch en isHandoffActive retornaría true (fail-closed)
          // Esta aserción estricta garantiza que los contactos NO pausados retornen false y los pausados true
          assert.strictEqual(
            pausedByPhone,
            chat.paused,
            `isHandoffActive por teléfono para ${chat.phone} debe ser ${chat.paused} (no fail-closed accidental)`
          );

          // 2. Si es chat pausado, verificar también por contactId
          if (chat.paused) {
            const pausedById = await isHandoffActive({
              tenantId: TENANT_A.id,
              contactId: chat.id,
              prismaClient: store
            });
            assert.strictEqual(pausedById, true, 'isHandoffActive por contactId debe retornar true');
          }

          // 3. Probar ruta Customer.isBotPaused vía OR/contains (sin contactId)
          const customerPaused = await isHandoffActive({
            tenantId: TENANT_A.id,
            phone: '51900000099',
            prismaClient: store
          });
          assert.strictEqual(customerPaused, true, 'Customer pausado debe detectarse vía OR/contains');

          iterPassed = true;
          break;
        }

        default:
          iterPassed = true;
      }
    } catch (err) {
      iterPassed = false;
      failedIterations++;
      console.error(`❌ Error en iteración ${totalIterations} (${scenarioType}):`, err.message);
    } finally {
      processingLocks.delete(bufferKey);
      pendingQueues.delete(bufferKey);
    }

    const iterDuration = Date.now() - iterStart;
    latencies.push(iterDuration);

    if (iterPassed) {
      passedIterations++;
    }

    // Monitoreo periódico de memoria
    const currentMem = getMemorySnapshotMb();
    if (currentMem.rssMb > peakMem.rssMb) peakMem.rssMb = currentMem.rssMb;
    if (currentMem.heapUsedMb > peakMem.heapUsedMb) peakMem.heapUsedMb = currentMem.heapUsedMb;

    if (Date.now() - lastTelemetryTime >= telemetryIntervalMs) {
      lastTelemetryTime = Date.now();
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`📊 [SOAK T+${elapsedSec}s] Iters: ${totalIterations} | RSS: ${currentMem.rssMb}MB (Peak: ${peakMem.rssMb}MB) | HeapUsed: ${currentMem.heapUsedMb}MB | Locks: ${processingLocks.size} | Queues: ${pendingQueues.size}`);
    }

    // Pequeño yield al event loop de 1ms para que se procesen ticks y timers
    await new Promise(r => setTimeout(r, 1));
  }

  const finalMem = getMemorySnapshotMb();
  const totalElapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  // Cálculos estadísticos de latencia
  latencies.sort((a, b) => a - b);
  const minLatency = latencies[0] || 0;
  const maxLatency = latencies[latencies.length - 1] || 0;
  const sumLatency = latencies.reduce((acc, val) => acc + val, 0);
  const avgLatency = latencies.length ? (sumLatency / latencies.length).toFixed(2) : 0;
  const p50Index = Math.floor(latencies.length * 0.5);
  const p95Index = Math.floor(latencies.length * 0.95);
  const p50Latency = latencies[p50Index] || 0;
  const p95Latency = latencies[p95Index] || 0;

  const errorRate = totalIterations ? ((failedIterations / totalIterations) * 100).toFixed(2) : 0;

  errorTracker.assertClean();
  errorTracker.stop();

  console.log('\n======================================================================');
  console.log('                     RESUMEN FINAL DEL SOAK TEST                      ');
  console.log('======================================================================');
  console.log(`  DURACIÓN TOTAL.......: ${totalElapsedSec}s (${minutes} min configurados)`);
  console.log(`  ITERACIONES TOTALES..: ${totalIterations}`);
  console.log(`  EXITOSAS.............: ${passedIterations}`);
  console.log(`  FALLIDAS.............: ${failedIterations}`);
  console.log(`  TASA DE ERROR........: ${errorRate}%`);
  console.log('----------------------------------------------------------------------');
  console.log('  MÉTRICAS DE LATENCIA:');
  console.log(`    Min Latency........: ${minLatency}ms`);
  console.log(`    Avg Latency........: ${avgLatency}ms`);
  console.log(`    p50 Latency........: ${p50Latency}ms`);
  console.log(`    p95 Latency........: ${p95Latency}ms`);
  console.log(`    Max Latency........: ${maxLatency}ms`);
  console.log('----------------------------------------------------------------------');
  console.log('  MÉTRICAS DE MEMORIA:');
  console.log(`    Initial RSS........: ${initialMem.rssMb} MB`);
  console.log(`    Final RSS..........: ${finalMem.rssMb} MB`);
  console.log(`    Peak RSS...........: ${peakMem.rssMb} MB`);
  console.log(`    Net Growth (RSS)...: ${(finalMem.rssMb - initialMem.rssMb).toFixed(2)} MB`);
  console.log(`    Initial HeapUsed...: ${initialMem.heapUsedMb} MB`);
  console.log(`    Final HeapUsed.....: ${finalMem.heapUsedMb} MB`);
  console.log(`    Peak HeapUsed......: ${peakMem.heapUsedMb} MB`);
  console.log('----------------------------------------------------------------------');
  console.log('  ESTADO DE LIMPIEZA DE ESTRUCTURAS:');
  console.log(`    Remaining Locks....: ${processingLocks.size}`);
  console.log(`    Remaining Queues...: ${pendingQueues.size}`);
  console.log(`    Remaining Buffers..: ${messageBuffers.size}`);
  console.log('======================================================================');

  if (failedIterations > 0 || processingLocks.size > 0 || pendingQueues.size > 0) {
    console.error('\n❌ SOAK TEST FINALIZÓ CON ERRORES O ESTRUCTURAS HUÉRFANAS.\n');
    process.exit(1);
  } else {
    console.log('\n🎉 SIMULATED SOAK COMPLETED: Estabilidad de estructuras y arneses locales (S/0.00).');
    console.log('   (Nota: Mide la simulación local; no certifica ausencia de fugas en producción bajo WAN real)\n');
    process.exit(0);
  }
}

runSoak().catch((err) => {
  console.error('Fatal soak error:', err);
  errorTracker.stop();
  process.exit(1);
});
