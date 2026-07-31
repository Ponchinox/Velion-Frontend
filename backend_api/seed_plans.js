import prisma from './src/db.js';

/**
 * Planes con feature flags completos para MVP de Velion
 * Ejecutar: node seed_plans.js
 */
const PLANS = [
  {
    name: 'Básico',
    price: 29,
    connLimit: 1,
    msgLimit: 1000,
    maxProducts: 10,
    hasCampaigns: false,
    hasAutomations: false,
    hasAdvancedMarketing: false,
    flowBuilder: false,
    aiBrain: false,
    popular: false,
    active: true,
    features: [
      '1 Conexión WhatsApp',
      '1,000 Mensajes / mes',
      'Hasta 10 Productos en Inventario',
      'Live Chat en Tiempo Real',
      'Soporte por WhatsApp'
    ]
  },
  {
    name: 'Pro',
    price: 69,
    connLimit: 3,
    msgLimit: 5000,
    maxProducts: 100,
    hasCampaigns: true,
    hasAutomations: true,
    hasAdvancedMarketing: true,
    flowBuilder: true,
    aiBrain: true,
    popular: true,
    active: true,
    features: [
      'Hasta 3 Conexiones WhatsApp',
      '5,000 Mensajes / mes',
      'Hasta 100 Productos en Inventario',
      'Campañas Masivas',
      'Automatizaciones con Flow Builder',
      'Modo Vendedor Persuasivo',
      'IA Brain Avanzada & Agentes',
      'Soporte Prioritario 24/7'
    ]
  },
  {
    name: 'Elite',
    price: 149,
    connLimit: 10,
    msgLimit: 25000,
    maxProducts: 999999,
    hasCampaigns: true,
    hasAutomations: true,
    hasAdvancedMarketing: true,
    flowBuilder: true,
    aiBrain: true,
    popular: false,
    active: true,
    features: [
      'Hasta 10 Conexiones WhatsApp',
      '25,000 Mensajes / mes',
      'Productos Ilimitados',
      'Campañas Masivas Ilimitadas',
      'Automatizaciones Avanzadas',
      'Modo Vendedor Persuasivo',
      'Cerebro IA Ilimitado & Personalizado',
      'Soporte VIP Directo'
    ]
  }
];

async function seed() {
  try {
    console.log('🌱 Actualizando planes en PostgreSQL con feature flags...');

    for (const plan of PLANS) {
      const existing = await prisma.plan.findUnique({ where: { name: plan.name } });
      if (!existing) {
        const created = await prisma.plan.create({ data: plan });
        console.log(`✅ Creado plan: ${created.name} (ID: ${created.id})`);
      } else {
        // Actualizar con los nuevos campos si ya existe
        const updated = await prisma.plan.update({
          where: { name: plan.name },
          data: {
            price: plan.price,
            connLimit: plan.connLimit,
            msgLimit: plan.msgLimit,
            maxProducts: plan.maxProducts,
            hasCampaigns: plan.hasCampaigns,
            hasAutomations: plan.hasAutomations,
            hasAdvancedMarketing: plan.hasAdvancedMarketing,
            flowBuilder: plan.flowBuilder,
            aiBrain: plan.aiBrain,
            popular: plan.popular,
            features: plan.features,
          }
        });
        console.log(`♻️  Actualizado plan: ${updated.name} — hasCampaigns:${updated.hasCampaigns}, hasAutomations:${updated.hasAutomations}, hasAdvancedMarketing:${updated.hasAdvancedMarketing}, maxProducts:${updated.maxProducts}`);
      }
    }

    const allPlans = await prisma.plan.findMany({ select: { name: true, price: true, hasCampaigns: true, hasAutomations: true, hasAdvancedMarketing: true, maxProducts: true } });
    console.log('\n📋 Estado final de planes:');
    allPlans.forEach(p => {
      console.log(`  ${p.name}: S/${p.price} | maxProducts:${p.maxProducts} | campaigns:${p.hasCampaigns} | automations:${p.hasAutomations} | marketing:${p.hasAdvancedMarketing}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding plans:', err);
    process.exit(1);
  }
}

seed();
