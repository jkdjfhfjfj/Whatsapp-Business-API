import crypto from 'node:crypto';

// Encrypts/decrypts secrets (Meta access tokens, Groq API keys) at rest.
// Prefer a 32-byte base64-encoded CREDENTIALS_ENCRYPTION_KEY. When it is not
// configured, derive a separate encryption key from SESSION_SECRET so a fresh
// deployment can save settings without a second required secret.

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }
    return key;
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('Set SESSION_SECRET or CREDENTIALS_ENCRYPTION_KEY before saving credentials.');
  }

  return crypto
    .createHash('sha256')
    .update(`whatsapp-business-api:credentials:${sessionSecret}`)
    .digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted secret.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// Never log or return this directly to the client — used only for masked previews.
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return '••••';
  return `••••${plaintext.slice(-4)}`;
}
