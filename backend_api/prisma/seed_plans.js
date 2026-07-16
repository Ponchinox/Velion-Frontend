import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedPlans() {
  console.log("Sembrando planes por defecto en PostgreSQL...");

  const defaultPlans = [
    {
      name: "Basico",
      price: 29,
      connLimit: 1,
      msgLimit: 1000,
      flowBuilder: false,
      aiBrain: false,
      popular: false,
      active: true,
      features: [
        { text: "1 Conexion WhatsApp",       included: true  },
        { text: "1,000 Mensajes / mes",       included: true  },
        { text: "Soporte por Email",          included: true  },
        { text: "Acceso a Flow Builder",      included: false },
        { text: "Cerebro IA (Gemini/Groq)",   included: false }
      ]
    },
    {
      name: "Pro",
      price: 99,
      connLimit: 3,
      msgLimit: 10000,
      flowBuilder: true,
      aiBrain: false,
      popular: true,
      active: true,
      features: [
        { text: "3 Conexiones WhatsApp",      included: true  },
        { text: "10,000 Mensajes / mes",      included: true  },
        { text: "Soporte Prioritario",        included: true  },
        { text: "Acceso a Flow Builder",      included: true  },
        { text: "Cerebro IA (Gemini/Groq)",   included: false }
      ]
    },
    {
      name: "Elite",
      price: 299,
      connLimit: 10,
      msgLimit: 50000,
      flowBuilder: true,
      aiBrain: true,
      popular: false,
      active: true,
      features: [
        { text: "10 Conexiones WhatsApp",                included: true },
        { text: "50,000 Mensajes / mes",                 included: true },
        { text: "Soporte 24/7 Dedicado",                 included: true },
        { text: "Acceso a Flow Builder",                 included: true },
        { text: "Cerebro IA (Gemini/Groq) ilimitado",    included: true }
      ]
    }
  ];

  for (const plan of defaultPlans) {
    await prisma.plan.upsert({
      where:  { name: plan.name },
      create: plan,
      update: {
        price:       plan.price,
        connLimit:   plan.connLimit,
        msgLimit:    plan.msgLimit,
        flowBuilder: plan.flowBuilder,
        aiBrain:     plan.aiBrain,
        popular:     plan.popular,
        features:    plan.features,
        active:      true
      }
    });
    console.log("Plan " + plan.name + " listo en PostgreSQL.");
  }

  console.log("Planes sembrados correctamente.");
}

seedPlans()
  .catch((e) => {
    console.error("Error durante el seed de planes:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
