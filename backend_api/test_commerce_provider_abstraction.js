import assert from 'node:assert';
import { CommerceProvider } from './src/services/commerce/CommerceProvider.js';
import { VelionNativeProvider } from './src/services/commerce/VelionNativeProvider.js';
import { CommerceService, commerceService } from './src/services/commerce/CommerceService.js';
import { getCanonicalProductImages, getCanonicalProductImageUrl } from './src/services/productMediaOrchestrator.js';

console.log('======================================================================');
console.log('🧪 VELION COMMERCE PROVIDER ABSTRACTION & PARITY SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

/**
 * Adaptador in-memory con semántica idéntica a Prisma Client
 * para pruebas unitarias determinísticas y 100% offline.
 */
function createInMemoryDb() {
  const users = new Map();
  const products = new Map();

  return {
    users,
    products,

    product: {
      findFirst: async ({ where, select }) => {
        for (const prod of products.values()) {
          // Filtrado por id
          if (where.id && prod.id !== where.id) continue;

          // Filtrado por user.tenantId
          if (where.user?.tenantId) {
            const user = users.get(prod.userId);
            if (!user || user.tenantId !== where.user.tenantId) continue;
          }

          if (where.isAvailable !== undefined && prod.isAvailable !== where.isAvailable) continue;

          // Proyección select
          if (select) {
            const res = {};
            for (const key of Object.keys(select)) {
              if (select[key]) res[key] = prod[key] ?? null;
            }
            return res;
          }
          return { ...prod };
        }
        return null;
      },

      findMany: async ({ where = {}, select, orderBy }) => {
        let matched = [];
        for (const prod of products.values()) {
          // Filtrado por user.tenantId
          if (where.user?.tenantId) {
            const user = users.get(prod.userId);
            if (!user || user.tenantId !== where.user.tenantId) continue;
          }

          if (where.isAvailable !== undefined && prod.isAvailable !== where.isAvailable) continue;
          if (where.category && prod.category !== where.category) continue;

          if (select) {
            const res = {};
            for (const key of Object.keys(select)) {
              if (select[key]) res[key] = prod[key] ?? null;
            }
            matched.push(res);
          } else {
            matched.push({ ...prod });
          }
        }

        if (orderBy?.name === 'asc') {
          matched.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }

        return matched;
      }
    }
  };
}

async function main() {
  const mockDb = createInMemoryDb();

  // Setup: Usuarios y Tenants
  mockDb.users.set('user-tenant-a', { id: 'user-tenant-a', tenantId: 'tenant-a-uuid' });
  mockDb.users.set('user-tenant-b', { id: 'user-tenant-b', tenantId: 'tenant-b-uuid' });

  // Setup: Productos Tenant A
  mockDb.products.set('prod-a1', {
    id: 'prod-a1',
    name: 'Smartwatch Velion X1',
    description: 'Reloj inteligente con monitor cardíaco y pantalla OLED.',
    price: 199.00,
    category: 'Tecnología',
    type: 'PHYSICAL_PRODUCT',
    tags: ['smartwatch', 'oled', 'resistente'],
    isAvailable: true,
    promotionalPrice: null,
    promoStartDate: null,
    promoEndDate: null,
    imageUrl: 'https://cdn.velion.com/img/x1-front.jpg',
    images: ['https://cdn.velion.com/img/x1-side.jpg', 'https://cdn.velion.com/img/x1-box.jpg'],
    videoUrl: 'https://cdn.velion.com/video/x1-demo.mp4',
    userId: 'user-tenant-a'
  });

  mockDb.products.set('prod-a2', {
    id: 'prod-a2',
    name: 'Polo Velion Pima',
    description: 'Polo 100% algodón pima peruano.',
    price: 89.00,
    category: 'Ropa',
    type: 'PHYSICAL_PRODUCT',
    tags: ['algodon', 'pima'],
    isAvailable: true,
    promotionalPrice: 69.00,
    promoStartDate: new Date(Date.now() - 86400000), // Ayer
    promoEndDate: new Date(Date.now() + 86400000),   // Mañana
    imageUrl: 'https://cdn.velion.com/img/polo-black.jpg',
    images: [],
    videoUrl: null,
    userId: 'user-tenant-a'
  });

  mockDb.products.set('prod-a3-agotado', {
    id: 'prod-a3-agotado',
    name: 'Audífonos Pro Studio',
    description: 'Audífonos inalámbricos cancelacion activa de ruido.',
    price: 350.00,
    category: 'Audio',
    type: 'PHYSICAL_PRODUCT',
    tags: ['anc', 'bluetooth'],
    isAvailable: false,
    promotionalPrice: null,
    promoStartDate: null,
    promoEndDate: null,
    imageUrl: 'https://cdn.velion.com/img/headphones.jpg',
    images: [],
    videoUrl: null,
    userId: 'user-tenant-a'
  });

  // Setup: Producto Tenant B
  mockDb.products.set('prod-b1', {
    id: 'prod-b1',
    name: 'Laptop Gamer Alien B',
    description: 'Laptop de alta gama del Tenant B.',
    price: 5400.00,
    category: 'Computación',
    type: 'PHYSICAL_PRODUCT',
    tags: ['gamer'],
    isAvailable: true,
    promotionalPrice: null,
    imageUrl: 'https://cdn.velion.com/img/laptop-b.jpg',
    images: [],
    videoUrl: null,
    userId: 'user-tenant-b'
  });

  const provider = new VelionNativeProvider(mockDb);
  const service = new CommerceService(mockDb);

  // ── TEST 1: Aislamiento estricto por tenant ──────────────────────────────────
  await runTest('TEST 1: Aislamiento por tenant — Tenant A NO puede ver productos de Tenant B', async () => {
    const crossTenantProd = await provider.getProduct('tenant-a-uuid', 'prod-b1');
    assert.strictEqual(crossTenantProd, null, 'Un producto de Tenant B no debe ser visible para Tenant A');

    const searchRes = await provider.searchProducts('tenant-a-uuid');
    const ids = searchRes.map(p => p.id);
    assert.ok(!ids.includes('prod-b1'), 'La búsqueda de Tenant A no debe incluir productos de Tenant B');
  });

  // ── TEST 2: Producto válido de tenant autorizado ─────────────────────────────
  await runTest('TEST 2: Producto válido — retorna todos los campos requeridos con tipos correctos', async () => {
    const prod = await provider.getProduct('tenant-a-uuid', 'prod-a1');
    assert.ok(prod, 'El producto prod-a1 debe existir');
    assert.strictEqual(prod.id, 'prod-a1');
    assert.strictEqual(prod.name, 'Smartwatch Velion X1');
    assert.strictEqual(prod.price, 199.00);
    assert.strictEqual(prod.type, 'PHYSICAL_PRODUCT');
    assert.strictEqual(prod.isAvailable, true);
    assert.strictEqual(prod.imageUrl, 'https://cdn.velion.com/img/x1-front.jpg');
    assert.deepStrictEqual(prod.images, ['https://cdn.velion.com/img/x1-side.jpg', 'https://cdn.velion.com/img/x1-box.jpg']);
    assert.strictEqual(prod.videoUrl, 'https://cdn.velion.com/video/x1-demo.mp4');
  });

  // ── TEST 3: Producto inexistente ─────────────────────────────────────────────
  await runTest('TEST 3: Producto inexistente — retorna null fail-closed sin errores', async () => {
    const prod = await provider.getProduct('tenant-a-uuid', 'non-existent-uuid-12345');
    assert.strictEqual(prod, null);
  });

  // ── TEST 4: Parámetros inválidos o tenant vacío ──────────────────────────────
  await runTest('TEST 4: Parámetros nulos o vacíos — fail-closed inmediato', async () => {
    assert.strictEqual(await provider.getProduct('', 'prod-a1'), null);
    assert.strictEqual(await provider.getProduct(null, 'prod-a1'), null);
    assert.strictEqual(await provider.getProduct('tenant-a-uuid', ''), null);
    assert.strictEqual(await provider.getProduct('tenant-a-uuid', null), null);
    assert.deepStrictEqual(await provider.searchProducts(null), []);
  });

  // ── TEST 5: isAvailable y disponibilidad en getStock ─────────────────────────
  await runTest('TEST 5: getStock — refleja correctamente isAvailable binario nativo', async () => {
    const stockAvailable = await provider.getStock('tenant-a-uuid', 'prod-a1');
    assert.strictEqual(stockAvailable.inStock, true);
    assert.strictEqual(stockAvailable.inventoryQuantity, null, 'Velion nativo no tiene contador numérico');

    const stockUnavailable = await provider.getStock('tenant-a-uuid', 'prod-a3-agotado');
    assert.strictEqual(stockUnavailable.inStock, false);
  });

  // ── TEST 6: Precio normal vigente ───────────────────────────────────────────
  await runTest('TEST 6: getPrice normal — retorna precio estándar sin promoción activa', async () => {
    const priceData = await provider.getPrice('tenant-a-uuid', 'prod-a1');
    assert.strictEqual(priceData.price, 199.00);
    assert.strictEqual(priceData.promotionalPrice, null);
    assert.strictEqual(priceData.effectivePrice, 199.00);
    assert.strictEqual(priceData.hasActivePromo, false);
  });

  // ── TEST 7: Precio promocional activo por fecha ──────────────────────────────
  await runTest('TEST 7: getPrice promo — calcula precio promocional activo correctamente', async () => {
    const priceData = await provider.getPrice('tenant-a-uuid', 'prod-a2');
    assert.strictEqual(priceData.price, 89.00);
    assert.strictEqual(priceData.promotionalPrice, 69.00);
    assert.strictEqual(priceData.effectivePrice, 69.00);
    assert.strictEqual(priceData.hasActivePromo, true);
  });

  // ── TEST 8: Generación de catálogo compacto CSV con columna Disponible ───────
  await runTest('TEST 8: getCompactCatalogCsv — genera índice con columna Disponible', async () => {
    const csv = await provider.getCompactCatalogCsv('tenant-a-uuid');
    assert.ok(csv.startsWith('ID,Nombre,PrecioActual,PrecioNormal,Promocion,Disponible,Categoria\n'), 'Debe contener la cabecera exacta');
    assert.ok(csv.includes('Smartwatch Velion X1'), 'Debe incluir producto disponible A1');
    assert.ok(csv.includes('Polo Velion Pima'), 'Debe incluir producto disponible A2');
    assert.ok(csv.includes('Audífonos Pro Studio'), 'SÍ debe incluir producto agotado A3 con Disponible=No');
    assert.ok(csv.includes(',No,Audio'), 'Producto agotado debe indicar No en Disponible');
    assert.ok(!csv.includes('Laptop Gamer Alien B'), 'NO debe incluir producto de Tenant B');

    // Con filtro isAvailable=true explícito
    const csvOnlyAvail = await provider.getCompactCatalogCsv('tenant-a-uuid', { isAvailable: true });
    assert.ok(!csvOnlyAvail.includes('Audífonos Pro Studio'), 'NO debe incluir producto agotado si isAvailable=true');
  });

  // ── TEST 9: Paridad exacta de formato CSV canónico ────────────────────────────
  await runTest('TEST 9: Paridad byte-for-byte del CSV generado con Disponible', async () => {
    const csv = await provider.getCompactCatalogCsv('tenant-a-uuid');
    const lines = csv.trim().split('\n');
    assert.strictEqual(lines[0], 'ID,Nombre,PrecioActual,PrecioNormal,Promocion,Disponible,Categoria');
    // Línea 1 ordenada por nombre: Audífonos Pro Studio (A < P)
    assert.ok(lines[1].includes('prod-a3-agotado,Audífonos Pro Studio,S/. 350,S/. 350,Sin oferta vigente,No,Audio'));
    // Línea 2 ordenada por nombre: Polo Velion Pima (P < S)
    assert.ok(lines[2].includes('prod-a2,Polo Velion Pima,S/. 69,S/. 89,'));
    assert.ok(lines[2].includes(',Sí,Ropa'));
    // Línea 3 ordenada por nombre: Smartwatch Velion X1
    assert.ok(lines[3].includes('prod-a1,Smartwatch Velion X1,S/. 199,S/. 199,Sin oferta vigente,Sí,Tecnología'));
  });

  // ── TEST 10: Compatibilidad con productMediaOrchestrator ─────────────────────
  await runTest('TEST 10: Shape de producto es 100% compatible con productMediaOrchestrator', async () => {
    const prod = await service.getProduct('tenant-a-uuid', 'prod-a1');
    const canonicalImages = getCanonicalProductImages(prod);
    assert.strictEqual(canonicalImages.length, 3, 'Debe extraer portada + 2 secundarias');
    assert.strictEqual(canonicalImages[0], 'https://cdn.velion.com/img/x1-front.jpg');
    assert.strictEqual(getCanonicalProductImageUrl(prod), 'https://cdn.velion.com/img/x1-front.jpg');
  });

  // ── TEST 11: CommerceService delega fielmente al proveedor nativo ───────────
  await runTest('TEST 11: CommerceService delega todas las operaciones al proveedor nativo', async () => {
    const prodFromService = await service.getProduct('tenant-a-uuid', 'prod-a1');
    const prodFromProvider = await provider.getProduct('tenant-a-uuid', 'prod-a1');
    assert.deepStrictEqual(prodFromService, prodFromProvider);

    const csvFromService = await service.getCompactCatalogCsv('tenant-a-uuid');
    const csvFromProvider = await provider.getCompactCatalogCsv('tenant-a-uuid');
    assert.strictEqual(csvFromService, csvFromProvider);

    const stockFromService = await service.getStock('tenant-a-uuid', 'prod-a1');
    const stockFromProvider = await provider.getStock('tenant-a-uuid', 'prod-a1');
    assert.deepStrictEqual(stockFromService, stockFromProvider);

    const priceFromService = await service.getPrice('tenant-a-uuid', 'prod-a1');
    const priceFromProvider = await provider.getPrice('tenant-a-uuid', 'prod-a1');
    assert.deepStrictEqual(priceFromService, priceFromProvider);
  });

  // ── TEST 12: Verificación de contrato abstracto base ─────────────────────────
  await runTest('TEST 12: CommerceProvider base lanza error si no se implementa', async () => {
    const base = new CommerceProvider('TEST_BASE');
    assert.strictEqual(base.getProviderName(), 'TEST_BASE');
    await assert.rejects(async () => await base.getProduct('t', 'p'), /must be implemented|debe ser implementado/i);
    await assert.rejects(async () => await base.getCompactCatalogCsv('t'), /must be implemented|debe ser implementado/i);
  });

  console.log('\n======================================================================');
  console.log(`🎉 SUITE COMMERCE PROVIDER ABSTRACTION: ${passedTests}/${totalTests} TESTS PASARON`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('Fatal error en suite de abstracción:', err);
  process.exit(1);
});
