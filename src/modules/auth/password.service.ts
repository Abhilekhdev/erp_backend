import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

// Memory-hard params: ~16 MB per hash (128 * N * r). Tune with hardware.
const COST: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing using Node's built-in scrypt — no native build step required.
 * Stored format: `scrypt$N$r$p$saltB64$hashB64`.
 * Legacy Laravel bcrypt hashes ($2y$/$2a$) are handled during data migration, not here.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(password, salt, KEYLEN, COST);
    return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(password: string, stored: string | null): Promise<boolean> {
    if (!stored || !stored.startsWith('scrypt$')) return false;
    const [, n, r, p, saltB64, hashB64] = stored.split('$');
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scryptAsync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
}
