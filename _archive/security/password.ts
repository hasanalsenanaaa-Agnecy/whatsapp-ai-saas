import crypto from 'crypto';

const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';
const ENCODING = 'hex';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `${salt.toString(ENCODING)}:${hash.toString(ENCODING)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, ENCODING);
    const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
    return crypto.timingSafeEqual(Buffer.from(hashHex, ENCODING), hash);
  } catch (error) {
    return false;
  }
}

export function generateResetToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString(ENCODING);
  const hash = crypto.createHash('sha256').update(token).digest(ENCODING);
  return { token, hash };
}
