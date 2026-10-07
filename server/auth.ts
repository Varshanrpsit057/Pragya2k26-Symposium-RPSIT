/**
 * Admin sign-in: one username and a scrypt password hash, both Amplify secrets (never in the
 * browser, the repository or the sheet). A successful sign-in gets a random session token;
 * only its SHA-256 is stored (DynamoDB, with an expiry), so a leaked table cannot be replayed.
 *
 *   npm run admin:password      makes the ADMIN_PASSWORD_HASH value for a new password
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))),
  );

/** scrypt cost: about 100 ms on a Lambda function, far too slow to guess passwords at. */
const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

/** How long an admin stays signed in. */
export const SESSION_HOURS = 8;

/** A strong admin password: long, and not just one kind of character. */
export function passwordProblem(password: string): string | null {
  if (password.length < 14) return 'Use at least 14 characters.';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (kinds < 3) return 'Mix at least three of: lower-case, upper-case, digits, symbols.';
  return null;
}

/** 'scrypt$32768$8$1$<salt>$<hash>' (base64url), the value of ADMIN_PASSWORD_HASH. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...COST, maxmem: MAX_MEMORY });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** True when `password` matches the stored hash. A malformed hash never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  const N = Number(n);
  const cost = { N, r: Number(r), p: Number(p) };
  if (kind !== 'scrypt' || !salt || !hash || !Number.isInteger(N) || N < 2 ** 14 || (N & (N - 1)) !== 0) return false;
  if (!Number.isInteger(cost.r) || !Number.isInteger(cost.p) || cost.r < 1 || cost.p < 1) return false;
  const expected = Buffer.from(hash, 'base64url');
  if (expected.length < 32) return false;
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    ...cost,
    maxmem: MAX_MEMORY,
  });
  return timingSafeEqual(actual, expected);
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Compares two strings in constant time (by their hashes, so their lengths do not leak either). */
export const sameText = (a: string, b: string) => timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));

/** A new session token for the browser (256 random bits). */
export const newSessionToken = () => randomBytes(32).toString('base64url');

/** 'Bearer abc' → 'abc' (only well-formed tokens). */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(header?.trim() ?? '');
  return match ? match[1] : null;
}
