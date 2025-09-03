import crypto from 'crypto';

// Simple AES-GCM encryption helpers for secrets. In production, consider KMS/HSM.
const algo = 'aes-256-gcm';

function getKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string, masterSecret: string) {
  const key = getKey(masterSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algo, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { algo, iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') };
}

export function decryptSecret(valueEnc: any, masterSecret: string): string {
  const key = getKey(masterSecret);
  const iv = Buffer.from(valueEnc.iv, 'base64');
  const tag = Buffer.from(valueEnc.tag, 'base64');
  const data = Buffer.from(valueEnc.data, 'base64');
  const decipher = crypto.createDecipheriv(algo, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

