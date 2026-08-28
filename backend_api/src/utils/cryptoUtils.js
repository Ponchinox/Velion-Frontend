import crypto from 'crypto';

/**
 * Obtiene o valida la llave de cifrado de las variables de entorno.
 * Si no está definida o no tiene 32 caracteres, lanza un error para proteger la seguridad.
 */
function getEncryptionKey() {
  const keyStr = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error('La variable de entorno BACKUP_ENCRYPTION_KEY no está configurada.');
  }
  
  // Convertir a buffer asumiendo que puede ser hex o utf8. Si es menor a 32 bytes o mayor, ajustaremos.
  let keyBuffer;
  if (keyStr.length === 64 && /^[0-9a-fA-F]+$/.test(keyStr)) {
    keyBuffer = Buffer.from(keyStr, 'hex');
  } else {
    keyBuffer = Buffer.from(keyStr, 'utf-8');
  }
  
  if (keyBuffer.length !== 32) {
    throw new Error('La BACKUP_ENCRYPTION_KEY debe ser de exactamente 32 bytes (64 hex o 32 chars).');
  }

  return keyBuffer;
}

/**
 * Cifra un texto utilizando AES-256-GCM.
 * Retorna un string en formato: iv:authTag:encryptedData (codificado en hex).
 */
export function encryptText(text) {
  if (!text) return text;
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // GCM recomienda 12 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Error al cifrar el texto:', error.message);
    throw error;
  }
}

/**
 * Descifra un texto previamente cifrado con AES-256-GCM en el formato iv:authTag:encryptedData.
 */
export function decryptText(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.includes(':')) {
    return encryptedText; // Podría no estar cifrado si es un dato legacy
  }
  
  try {
    const key = getEncryptionKey();
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato cifrado inválido.');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedData = parts[2];
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Error al descifrar el texto:', error.message);
    throw error;
  }
}
