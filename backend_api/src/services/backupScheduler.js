import prisma from '../db.js';
import fs from 'fs';
import path from 'path';
import cloudinary from '../config/cloudinary.js';
import { google } from 'googleapis';
import { decryptText } from '../utils/cryptoUtils.js';

// Intervalo de validación periódica del scheduler (cada 30 minutos)
const CHECK_INTERVAL = 30 * 60 * 1000;

// Mapeo de frecuencias a milisegundos
const FREQUENCY_MAP = {
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/**
 * Obtiene el valor de una configuración del sistema desde SystemConfig
 */
async function getConfigValue(key, defaultValue = '') {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key } });
    return config ? config.value : defaultValue;
  } catch (error) {
    console.error(`Error al obtener config para ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Lógica principal de ejecución de backup automático
 */
export async function runAutomaticBackup() {
  try {
    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    console.log('[Backup Scheduler] Iniciando generación de copia de seguridad automática...');

    // 1. Recopilar datos de todas las tablas de PostgreSQL
    const tenants = await prisma.tenant.findMany();
    const users = await prisma.user.findMany();
    const products = await prisma.product.findMany();
    const contacts = await prisma.contact.findMany();
    const chats = await prisma.chat.findMany();
    const messages = await prisma.message.findMany();
    const flows = await prisma.flow.findMany();
    const automationFlows = await prisma.automationFlow.findMany();
    const alerts = await prisma.alert.findMany();
    const campaigns = await prisma.campaign.findMany();
    const campaignLogs = await prisma.campaignLog.findMany();
    const customers = await prisma.customer.findMany();
    const plans = await prisma.plan.findMany();
    const systemConfigs = await prisma.systemConfig.findMany();

    const backupPayload = {
      metadata: {
        version: '1.0.0',
        generatedAt: new Date(),
        scope: 'SaaS Bot Database Backup (Automatic)',
      },
      data: {
        tenants,
        users,
        products,
        contacts,
        chats,
        messages,
        flows,
        automationFlows,
        alerts,
        campaigns,
        campaignLogs,
        customers,
        plans,
        systemConfigs,
      },
    };

    // Nombre de archivo auto_backup_YYYYMMDD_HHMMSS.json
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-T:]/g, '')
      .split('.')[0];
    const filename = `auto_backup_${timestamp}.json`;
    const filePath = path.join(backupsDir, filename);

    // Guardar copia local
    fs.writeFileSync(filePath, JSON.stringify(backupPayload, null, 2), 'utf-8');
    console.log(`[Backup Scheduler] Copia de seguridad guardada localmente: ${filename}`);

    // 2. Rotación: Mantener únicamente las últimas 3 copias automáticas
    const files = fs.readdirSync(backupsDir);
    const autoBackups = files
      .filter(file => file.startsWith('auto_backup_') && file.endsWith('.json'))
      .map(file => {
        const fullPath = path.join(backupsDir, file);
        return {
          filename: file,
          fullPath,
          createdAt: fs.statSync(fullPath).mtime,
        };
      });

    // Ordenar por fecha ascendente (los más antiguos primero)
    autoBackups.sort((a, b) => a.createdAt - b.createdAt);

    if (autoBackups.length > 3) {
      const toDelete = autoBackups.slice(0, autoBackups.length - 3);
      for (const fileInfo of toDelete) {
        fs.unlinkSync(fileInfo.fullPath);
        console.log(`[Backup Scheduler] Rotación: Se eliminó copia automática antigua: ${fileInfo.filename}`);
      }
    }

    // 3. Sincronización en la Nube
    const cloudEnabled = await getConfigValue('backupCloudEnabled', 'false');
    const cloudProvider = await getConfigValue('backupCloudProvider', 'cloudinary');

    if (cloudEnabled === 'true') {
      if (cloudProvider === 'cloudinary') {
        console.log('[Backup Scheduler] Sincronizando respaldo automático en Cloudinary...');
        try {
          await cloudinary.uploader.upload(filePath, {
            folder: 'saas_backups',
            resource_type: 'raw',
            public_id: filename,
          });
          console.log('[Backup Scheduler] Respaldo sincronizado en Cloudinary con éxito.');
        } catch (uploadErr) {
          console.error('[Backup Scheduler] Error al subir respaldo a Cloudinary:', uploadErr);
        }
      } else if (cloudProvider === 'gdrive') {
        console.log('[Backup Scheduler] Sincronizando respaldo automático en Google Drive...');
        try {
          const encCreds = await getConfigValue('backupGdriveCredentials', '');
          const folderId = await getConfigValue('backupGdriveFolderId', '');
          
          if (!encCreds) throw new Error('Credenciales de Google Drive no configuradas.');
          if (!folderId) throw new Error('Folder ID de Google Drive no configurado.');
          
          const rawCreds = decryptText(encCreds);
          const credentials = JSON.parse(rawCreds);
          
          const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
          });
          
          const drive = google.drive({ version: 'v3', auth });
          const fileMetadata = {
            name: filename,
            parents: [folderId],
          };
          const media = {
            mimeType: 'application/json',
            body: fs.createReadStream(filePath),
          };
          
          const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id',
          });
          
          if (response.status === 200 && response.data.id) {
            console.log(`[Backup Scheduler] Respaldo sincronizado en Google Drive con éxito (ID: ${response.data.id}).`);
          } else {
            throw new Error(`Respuesta inesperada de Google Drive: ${response.status}`);
          }
        } catch (uploadErr) {
          console.error('[Backup Scheduler] Error al subir respaldo a Google Drive:', uploadErr.message);
        }
      }
    }

  } catch (error) {
    console.error('[Backup Scheduler] Error crítico en la ejecución del backup automático:', error);
  }
}

/**
 * Ciclo periódico de validación
 */
async function checkAndRunScheduler() {
  try {
    const frequency = await getConfigValue('backupFrequency', 'off');
    
    // Si está desactivado, no hacer nada
    if (frequency === 'off' || !FREQUENCY_MAP[frequency]) {
      return;
    }

    const intervalMs = FREQUENCY_MAP[frequency];
    const backupsDir = path.join(process.cwd(), 'backups');

    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    // Buscar la última copia de seguridad automática generada
    const files = fs.readdirSync(backupsDir);
    const autoBackups = files
      .filter(file => file.startsWith('auto_backup_') && file.endsWith('.json'))
      .map(file => {
        const fullPath = path.join(backupsDir, file);
        return fs.statSync(fullPath).mtime.getTime();
      });

    let runBackup = false;

    if (autoBackups.length === 0) {
      // Si nunca se ha corrido uno, lo ejecutamos inmediatamente
      runBackup = true;
    } else {
      // Obtener la fecha del más reciente
      const latestBackupTime = Math.max(...autoBackups);
      const timeSinceLastBackup = Date.now() - latestBackupTime;
      
      if (timeSinceLastBackup >= intervalMs) {
        runBackup = true;
      }
    }

    if (runBackup) {
      await runAutomaticBackup();
    }
  } catch (error) {
    console.error('[Backup Scheduler] Error en el ciclo de validación del scheduler:', error);
  }
}

/**
 * Inicializa el Scheduler al iniciar el servidor
 */
export function initBackupScheduler() {
  console.log('[Backup Scheduler] Inicializado con éxito. Ciclo de monitoreo activo.');
  
  // Ejecutar primera validación al arrancar (con delay de 10s para no congelar la app)
  setTimeout(() => {
    checkAndRunScheduler();
  }, 10000);

  // Programar validación periódica
  setInterval(() => {
    checkAndRunScheduler();
  }, CHECK_INTERVAL);
}
