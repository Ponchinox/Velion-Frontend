import prisma from '../src/db.js';

async function getKeys() {
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'GEMINI_API_KEYS' },
  });
  if (config && config.value) {
    const keys = JSON.parse(config.value);
    console.log(keys);
  } else {
    console.log('No keys found in SystemConfig');
  }
}

getKeys().catch(console.error).finally(() => prisma.$disconnect());
