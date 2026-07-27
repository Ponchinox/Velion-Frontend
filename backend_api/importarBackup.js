import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Cargar variables de entorno (asegúrate de que DATABASE_URL apunte a tu BD de producción)
dotenv.config();

const prisma = new PrismaClient();

/**
 * Convierte automáticamente cadenas ISO de fechas a objetos Date requeridos por Prisma
 */
function convertDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(convertDates);

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      result[key] = new Date(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = convertDates(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Función auxiliar para importar registros respetando upserts
 */
async function importModel(modelName, records, upsertFn) {
  if (!records || records.length === 0) {
    console.log(`ℹ️ [${modelName}] No hay registros para importar.`);
    return;
  }

  console.log(`📦 Importando ${records.length} registros en [${modelName}]...`);
  let successCount = 0;
  let skipCount = 0;

  for (const item of records) {
    const sanitized = convertDates(item);
    try {
      await upsertFn(sanitized);
      successCount++;
    } catch (err) {
      console.warn(`  ⚠️ Error importando registro en [${modelName}] (ID: ${item.id || item.key}):`, err.message);
      skipCount++;
    }
  }

  console.log(`✅ [${modelName}] Finalizado: ${successCount} guardados / ${skipCount} con advertencia.\n`);
}

async function main() {
  console.log('🚀 Iniciando script de restauración de Base de Datos...\n');

  // 1. Determinar el archivo de respaldo a leer
  const backupsDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    console.error('❌ Error: La carpeta backups/ no existe.');
    process.exit(1);
  }

  // Permitir pasar el nombre del archivo como argumento: node importarBackup.js mi_backup.json
  const specifiedFile = process.argv[2];
  let targetFile = specifiedFile;

  if (!targetFile) {
    const files = fs.readdirSync(backupsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      console.error('❌ Error: No se encontraron archivos .json en la carpeta backups/.');
      process.exit(1);
    }

    // Ordenar los archivos por fecha de modificación (más reciente primero)
    files.sort((a, b) => {
      const statA = fs.statSync(path.join(backupsDir, a));
      const statB = fs.statSync(path.join(backupsDir, b));
      return statB.mtime.getTime() - statA.mtime.getTime();
    });

    targetFile = files[0];
  }

  const filePath = path.join(backupsDir, targetFile);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: El archivo especificado no existe: ${filePath}`);
    process.exit(1);
  }

  console.log(`📂 Leyendo archivo de respaldo: ${targetFile}`);
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const backupJson = JSON.parse(rawContent);
  const data = backupJson.data || backupJson;

  console.log(`📅 Respaldo generado en: ${backupJson.metadata?.generatedAt || 'Desconocido'}`);
  console.log(`🔗 Conectado a BD: ${process.env.DATABASE_URL?.split('@')[1] || 'Base de datos actual'}\n`);

  // 2. Importar registros manteniendo el ORDEN ESTRICTO de dependencias de llaves foráneas

  // Nivel 1: Tablas independientes / maestras
  await importModel('Plan', data.plans, (item) =>
    prisma.plan.upsert({ where: { id: item.id }, update: item, create: item })
  );

  await importModel('SystemConfig', data.systemConfigs, (item) =>
    prisma.systemConfig.upsert({ where: { key: item.key }, update: item, create: item })
  );

  await importModel('Tenant', data.tenants, (item) =>
    prisma.tenant.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 2: Usuarios (depende de Tenant)
  await importModel('User', data.users, (item) =>
    prisma.user.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 3: Productos (depende de User)
  await importModel('Product', data.products, (item) =>
    prisma.product.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 4: Contactos (depende de Tenant)
  await importModel('Contact', data.contacts, (item) =>
    prisma.contact.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 5: Chats (depende de Contact y Tenant)
  await importModel('Chat', data.chats, (item) =>
    prisma.chat.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 6: Mensajes (depende de Chat y Tenant)
  await importModel('Message', data.messages, (item) =>
    prisma.message.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 7: Flujos de automatización y alertas (depende de Tenant)
  await importModel('AutomationFlow', data.automationFlows, (item) =>
    prisma.automationFlow.upsert({ where: { id: item.id }, update: item, create: item })
  );

  await importModel('Flow', data.flows, (item) =>
    prisma.flow.upsert({ where: { id: item.id }, update: item, create: item })
  );

  await importModel('Alert', data.alerts, (item) =>
    prisma.alert.upsert({ where: { id: item.id }, update: item, create: item })
  );

  await importModel('Customer', data.customers, (item) =>
    prisma.customer.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 8: Campañas de marketing (depende de Tenant)
  await importModel('Campaign', data.campaigns, (item) =>
    prisma.campaign.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 9: Logs de campaña (depende de Campaign)
  await importModel('CampaignLog', data.campaignLogs, (item) =>
    prisma.campaignLog.upsert({ where: { id: item.id }, update: item, create: item })
  );

  // Nivel 10: Registros Anti-Fraude de WhatsApp (depende de Tenant)
  if (data.registeredNumbers) {
    await importModel('RegisteredWhatsAppNumber', data.registeredNumbers, (item) =>
      prisma.registeredWhatsAppNumber.upsert({ where: { id: item.id }, update: item, create: item })
    );
  }

  console.log('🎉 ¡Restauración de la base de datos completada con éxito!');
}

main()
  .catch((e) => {
    console.error('❌ Error crítico al ejecutar la importación:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
