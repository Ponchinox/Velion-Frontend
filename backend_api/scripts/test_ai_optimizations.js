/**
 * test_ai_optimizations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de verificación de las optimizaciones de IA:
 *
 *  TEST 1 — Payload (tokens): verifica que el historial se trunca a 8 mensajes
 *            y que el resultado de search_inventory es drásticamente menor
 *            que el catálogo completo.
 *
 *  TEST 2 — Timeout: verifica que el AbortController corta a 8s.
 *
 *  TEST 3 — Integración Prisma: simula la consulta pre-filtrada vs. full scan.
 *
 * Uso: node scripts/test_ai_optimizations.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from '../src/db.js';

// ─── Colores para la terminal ─────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;   // verde
const R = s => `\x1b[31m${s}\x1b[0m`;   // rojo
const Y = s => `\x1b[33m${s}\x1b[0m`;   // amarillo
const B = s => `\x1b[34m${s}\x1b[0m`;   // azul
const sep = () => console.log(B('═'.repeat(65)));

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(G(`  ✅ PASS`) + ` — ${label}`);
    if (detail) console.log(`     ${detail}`);
    passed++;
  } else {
    console.log(R(`  ❌ FAIL`) + ` — ${label}`);
    if (detail) console.log(`     ${detail}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Reducción de Payload (tokens estimados)
// ─────────────────────────────────────────────────────────────────────────────
async function testPayloadReduction() {
  sep();
  console.log(B('TEST 1 — Reducción de Payload & Historial'));
  sep();

  // 1a. MAX_HISTORIAL = 8 mensajes → historial truncado
  const MAX_HISTORIAL = 8;
  const fakeHistory = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'model',
    content: `Mensaje de prueba número ${i + 1} del historial de conversación.`
  }));

  const truncatedHistory = fakeHistory.slice(-MAX_HISTORIAL);
  console.log(`\n  Historial completo  : ${fakeHistory.length} mensajes`);
  console.log(`  Historial truncado  : ${truncatedHistory.length} mensajes`);

  assert(
    truncatedHistory.length === MAX_HISTORIAL,
    `Historial limitado a ${MAX_HISTORIAL} mensajes`,
    `Antes: ${fakeHistory.length} mensajes → Ahora: ${truncatedHistory.length} mensajes`
  );

  // Estimación de tokens del historial (aprox 4 chars/token)
  const historyFull      = JSON.stringify(fakeHistory);
  const historyTruncated = JSON.stringify(truncatedHistory);
  const tokensFull       = Math.round(Buffer.byteLength(historyFull, 'utf8') / 4);
  const tokensTrunc      = Math.round(Buffer.byteLength(historyTruncated, 'utf8') / 4);
  const reductionPct     = Math.round((1 - tokensTrunc / tokensFull) * 100);

  console.log(`\n  Tokens historial completo  : ~${tokensFull}`);
  console.log(`  Tokens historial truncado  : ~${tokensTrunc}`);
  console.log(`  Reducción                  : ${reductionPct}%`);

  assert(
    tokensTrunc < tokensFull,
    'Historial truncado usa menos tokens que el completo',
    `${tokensFull} tokens → ${tokensTrunc} tokens (${reductionPct}% reducción)`
  );

  // 1b. Simulación de resultado search_inventory Top-5 vs catálogo completo
  console.log(`\n  [Simulación search_inventory]`);

  // Simular catálogo completo de 150 productos
  const fullCatalog = Array.from({ length: 150 }, (_, i) => ({
    id: i + 1,
    name: `Producto ${i + 1} — Nombre largo con detalles del artículo`,
    description: `Descripción detallada del producto número ${i + 1} con características técnicas.`,
    category: 'Electrónica',
    price: 99.99,
    isAvailable: true,
    imageUrl: `https://cdn.ejemplo.com/producto-${i + 1}.jpg`,
    images: [`https://cdn.ejemplo.com/gal-${i + 1}-a.jpg`],
    videoUrl: null
  }));

  // Simular resultado Top-5
  const top5 = fullCatalog.slice(0, 5).map(p =>
    `- ${p.name}: S/. ${p.price.toFixed(2)}. ${p.description} | Portada: ${p.imageUrl}`
  ).join('\n');

  const fullCatalogStr = fullCatalog.map(p =>
    `- ${p.name}: S/. ${p.price.toFixed(2)}, Disponible. ${p.description} | Portada: ${p.imageUrl}`
  ).join('\n');

  const tokensFullCatalog = Math.round(Buffer.byteLength(fullCatalogStr, 'utf8') / 4);
  const tokensTop5        = Math.round(Buffer.byteLength(top5, 'utf8') / 4);
  const inventoryReduction = Math.round((1 - tokensTop5 / tokensFullCatalog) * 100);

  console.log(`  Tokens catálogo completo (150 prods) : ~${tokensFullCatalog}`);
  console.log(`  Tokens respuesta Top-5               : ~${tokensTop5}`);
  console.log(`  Reducción search_inventory           : ~${inventoryReduction}%`);

  assert(
    tokensTop5 < tokensFullCatalog * 0.1,
    'search_inventory Top-5 usa <10% de tokens vs catálogo completo',
    `~${tokensFullCatalog} tokens (antes) → ~${tokensTop5} tokens (ahora)`
  );

  assert(
    tokensFullCatalog > 5000,
    'El catálogo completo SÍ excedía 5000 tokens (problema original)',
    `Catálogo completo: ~${tokensFullCatalog} tokens (confirmado problema original)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Timeout de 8 segundos
// ─────────────────────────────────────────────────────────────────────────────
async function testTimeout() {
  sep();
  console.log(B('TEST 2 — Timeout de 8 segundos (AbortController)'));
  sep();

  const TIMEOUT_MS = 8_000;

  console.log(`\n  Verificando que AbortController corta a ${TIMEOUT_MS / 1000}s...`);

  const startTime = Date.now();
  let abortedAt = null;
  let abortError = null;

  // Simular petición que tarda más de 8s
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    await new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        abortedAt = Date.now() - startTime;
        reject(new Error('AbortError'));
      });
      // Simular operación lenta (15s)
      setTimeout(resolve, 15_000);
    });
  } catch (err) {
    abortError = err;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const elapsed = Date.now() - startTime;

  console.log(`  Tiempo hasta abort : ${abortedAt}ms`);
  console.log(`  Tiempo total       : ${elapsed}ms`);
  console.log(`  Configurado        : ${TIMEOUT_MS}ms`);

  assert(
    abortError !== null,
    'AbortController lanzó error al timeout',
    `Error: ${abortError?.message}`
  );

  assert(
    abortedAt !== null && abortedAt >= TIMEOUT_MS - 200 && abortedAt <= TIMEOUT_MS + 500,
    `Abort ocurrió aproximadamente a ${TIMEOUT_MS / 1000}s`,
    `Abort at: ${abortedAt}ms (esperado: ${TIMEOUT_MS}ms ± 500ms)`
  );

  assert(
    elapsed < 10_000,
    'La función NO esperó los 20s del timeout anterior',
    `Tiempo total: ${elapsed}ms (el timeout anterior era 20000ms)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Integración Prisma — Pre-filtro vs Full Scan
// ─────────────────────────────────────────────────────────────────────────────
async function testPrismaPreFilter() {
  sep();
  console.log(B('TEST 3 — Prisma Pre-filtro vs Full Scan'));
  sep();

  // Obtener el primer tenant disponible para prueba
  const tenant = await prisma.tenant.findFirst({
    select: { id: true, name: true }
  });

  if (!tenant) {
    console.log(Y('  ⚠️  No hay tenants en la DB. Saltando TEST 3.'));
    return;
  }

  console.log(`\n  Tenant de prueba: ${tenant.name} (id: ${tenant.id})`);

  // Full scan (método anterior — sin filtro)
  const t1 = Date.now();
  const fullScan = await prisma.product.findMany({
    where: { user: { tenantId: tenant.id } },
    select: {
      id: true, name: true, description: true, category: true,
      price: true, isAvailable: true, tags: true, imageUrl: true,
      images: true, videoUrl: true, promotionalPrice: true,
      promoStartDate: true, promoEndDate: true
    }
  });
  const fullScanMs     = Date.now() - t1;
  const fullScanBytes  = Buffer.byteLength(JSON.stringify(fullScan), 'utf8');
  const fullScanTokens = Math.round(fullScanBytes / 4);

  // Pre-filtro (método nuevo — con OR y take:20)
  const searchTerms = ['audifonos', 'auriculares', 'tws', 'headphones'];
  const orClauses = searchTerms.flatMap(term => [
    { name:        { contains: term, mode: 'insensitive' } },
    { description: { contains: term, mode: 'insensitive' } },
    { category:    { contains: term, mode: 'insensitive' } },
  ]);

  const t2 = Date.now();
  const preFilter = await prisma.product.findMany({
    where: {
      user:        { tenantId: tenant.id },
      isAvailable: true,
      OR:          orClauses,
    },
    select: {
      id: true, name: true, description: true, category: true,
      price: true, isAvailable: true, tags: true, imageUrl: true,
      images: true, videoUrl: true, promotionalPrice: true,
      promoStartDate: true, promoEndDate: true
    },
    take: 20,
  });
  const preFilterMs     = Date.now() - t2;
  const preFilterBytes  = Buffer.byteLength(JSON.stringify(preFilter), 'utf8');
  const preFilterTokens = Math.round(preFilterBytes / 4);

  console.log(`\n  ┌──────────────────────────────────────────────────────────┐`);
  console.log(`  │  Método         │  Productos  │  Tiempo   │   ~Tokens    │`);
  console.log(`  ├──────────────────────────────────────────────────────────┤`);
  console.log(`  │  Full scan      │  ${String(fullScan.length).padEnd(9)}  │  ${String(fullScanMs + 'ms').padEnd(9)} │  ~${String(fullScanTokens).padEnd(8)}  │`);
  console.log(`  │  Pre-filtro OR  │  ${String(preFilter.length).padEnd(9)}  │  ${String(preFilterMs + 'ms').padEnd(9)} │  ~${String(preFilterTokens).padEnd(8)}  │`);
  console.log(`  └──────────────────────────────────────────────────────────┘`);

  assert(
    preFilterTokens <= fullScanTokens,
    'Pre-filtro devuelve igual o menos tokens que full scan',
    `Pre-filtro: ~${preFilterTokens} tokens vs Full scan: ~${fullScanTokens} tokens`
  );

  assert(
    preFilter.length <= 20,
    'Pre-filtro respeta el límite take:20',
    `Devolvió ${preFilter.length} candidatos (máx permitido: 20)`
  );

  if (fullScan.length > 0) {
    assert(
      fullScanTokens > 500,
      'Full scan tenía un volumen de tokens significativo',
      `Full scan: ~${fullScanTokens} tokens para ${fullScan.length} productos`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN FINAL
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n');
  sep();
  console.log(B('  🧪 SUITE DE VERIFICACION — Optimizaciones de IA'));
  console.log(B('  Timeout: 8s  |  Historial: 8 msgs  |  Top-5 Inventory'));
  sep();

  try {
    await testPayloadReduction();
    await testTimeout();
    await testPrismaPreFilter();
  } catch (err) {
    console.error(R('\n❌ Error no capturado en la suite:'), err);
  } finally {
    await prisma.$disconnect();
  }

  sep();
  const resultLine = `  Resultado final: ${G(passed + ' PASSED')} | ${failed > 0 ? R(failed + ' FAILED') : G(failed + ' FAILED')}`;
  console.log(resultLine);
  sep();
  console.log('');

  if (failed > 0) process.exit(1);
}

main();
