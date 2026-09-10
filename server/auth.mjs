import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const digest = (token) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [, salt, hash] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function sessionToken(req) {
  return (
    (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('voltaris_session='))
      ?.slice('voltaris_session='.length) || ''
  );
}
export async function issueSession(db, res, userId, secure) {
  const token = randomBytes(32).toString('hex');
  const age = 7 * 24 * 60 * 60 * 1000;
  await db.execute({
    sql: 'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',
    args: [digest(token), userId, Date.now() + age],
  });
  res.cookie('voltaris_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: age,
    path: '/',
  });
}
