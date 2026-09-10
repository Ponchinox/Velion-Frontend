/**
 * Synthetic Business Fixtures: Tenant A vs Tenant B
 * =================================================
 * Datos sintéticos de negocio para pruebas de aislamiento y lógica comercial:
 * - 0 clientes reales
 * - 0 números telefónicos de clientes reales
 * - Catálogos 100% disjuntos
 * - Precios y políticas independientes
 */

export const TENANT_A = {
  id: 'tenant-synth-alpha-101',
  name: 'TecnoStore Arequipa',
  businessSector: 'Tecnología y Gadgets',
  aiEnabled: true,
  msgLimit: 10000,
  bankAccounts: 'Yape / Plin al 900000001 (TecnoStore Arequipa) o Transferencia BCP: 191-99998888-0-12',
  termsAndPolicies: 'Envíos en Arequipa el mismo día. Provincias vía Olva Courier en 48 horas.',
  products: [
    {
      id: 'prod-alpha-watch-01',
      tenantId: 'tenant-synth-alpha-101',
      name: 'Smartwatch Ultra Pro A1',
      price: 50.00,
      promotionalPrice: null,
      stock: 15,
      type: 'PHYSICAL_PRODUCT',
      category: 'Relojes',
      imageUrl: '/media/tenants/alpha/smartwatch.jpg',
      images: ['/media/tenants/alpha/smartwatch.jpg'],
      videoUrl: null // Sin video
    },
    {
      id: 'prod-alpha-jbl-02',
      tenantId: 'tenant-synth-alpha-101',
      name: 'JBL Go 4 A1',
      price: 50.00,
      promotionalPrice: null,
      stock: 8,
      type: 'PHYSICAL_PRODUCT',
      category: 'Audio',
      imageUrl: '/media/tenants/alpha/jbl.jpg',
      images: ['/media/tenants/alpha/jbl.jpg'],
      videoUrl: '/products/videos/jbl-go-4.mp4' // Con video disponible
    }
  ]
};

export const TENANT_B = {
  id: 'tenant-synth-beta-202',
  name: 'Boutique Moda Elegante',
  businessSector: 'Ropa y Calzado Femenino',
  aiEnabled: true,
  msgLimit: 10000,
  bankAccounts: 'Transferencia BBVA: 0011-0123-0200345678 a nombre de Moda Elegante SAC',
  termsAndPolicies: 'Envíos exclusivamente dentro de Lima Metropolitana en 24h. No hacemos envíos a provincias.',
  products: [
    {
      id: 'prod-beta-dress-01',
      tenantId: 'tenant-synth-beta-202',
      name: 'Vestido Seda Italiana',
      price: 120.00,
      promotionalPrice: null,
      stock: 5,
      type: 'PHYSICAL_PRODUCT',
      category: 'Vestidos',
      imageUrl: '/media/tenants/beta/vestido.jpg',
      images: ['/media/tenants/beta/vestido.jpg'],
      videoUrl: null
    },
    {
      id: 'prod-beta-shoes-02',
      tenantId: 'tenant-synth-beta-202',
      name: 'Zapatos Cuero Oxford',
      price: 180.00,
      promotionalPrice: null,
      stock: 3,
      type: 'PHYSICAL_PRODUCT',
      category: 'Calzado',
      imageUrl: '/media/tenants/beta/zapatos.jpg',
      images: ['/media/tenants/beta/zapatos.jpg'],
      videoUrl: '/products/videos/zapatos-oxford.mp4'
    },
    {
      id: 'prod-beta-service-03',
      tenantId: 'tenant-synth-beta-202',
      name: 'Asesoría de Imagen Personalizada',
      price: 250.00,
      promotionalPrice: null,
      stock: 999,
      type: 'SERVICE',
      category: 'Servicios',
      imageUrl: null,
      images: [],
      videoUrl: null
    }
  ]
};
