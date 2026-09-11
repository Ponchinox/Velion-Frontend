import crypto from 'crypto';

/**
 * Obtiene o valida la llave de cifrado de las variables de entorno.
 * Si no está definida o no tiene 32 caracteres, lanza un error para proteger la seguridad.
 */
function getEncryptionKey() {
  const keyStr = process.env.TOKEN_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!keyStr) {
    throw new Error('No se encontró llave de cifrado configurada (TOKEN_ENCRYPTION_KEY, BACKUP_ENCRYPTION_KEY o JWT_SECRET).');
  }
  
  if (keyStr.length === 64 && /^[0-9a-fA-F]+$/.test(keyStr)) {
    return Buffer.from(keyStr, 'hex');
  }
  if (keyStr.length === 32) {
    return Buffer.from(keyStr, 'utf-8');
  }

  // Derivación determinística estándar SHA-256 (garantiza exactamente 32 bytes para AES-256-GCM)
  return crypto.createHash('sha256').update(keyStr).digest();
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
 * Si el texto es un token en texto claro (legacy) o no cumple el formato, lo retorna intacto sin error.
 */
export function decryptText(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.includes(':')) {
    return encryptedText; // Token legacy en texto plano
  }
  
  try {
    const parts = encryptedText.split(':');
    // iv (12 bytes = 24 hex) y authTag (16 bytes = 32 hex)
    if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) {
      return encryptedText; // No coincide con el formato GCM hex, tratar como legacy
    }
    
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedData = parts[2];
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.warn('⚠️ [Crypto] No se pudo descifrar token (retornando texto original):', error.message);
    return encryptedText;
  }
}
