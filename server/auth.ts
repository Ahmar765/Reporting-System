import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { type DB, exec, one, now, audit } from './db.js';
const scrypt = promisify(scryptCallback);
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return salt + ':' + key.toString('hex');
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  const test = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return expected.length === test.length && timingSafeEqual(expected, test);
}
export function createSession(db: DB, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  exec(db, 'INSERT INTO sessions VALUES(?,?,?,?)', digest(token), userId, csrf, new Date(Date.now() + 12 * 3600000).toISOString());
  return {
    token,
    csrf
  };
}
export function publicUser(user: Record<string, any>) {
  const keys = ['id', 'email', 'name', 'employee_code', 'access', 'role_id', 'role_name', 'active', 'joining_date', 'timezone', 'deadline', 'notifications', 'email_notifications', 'created_at', 'deleted_at'];
  const safe = Object.fromEntries(keys.map(k => [k, user[k]]));
  return {
    ...safe,
    workdays: JSON.parse(user.workdays)
  };
}
export async function createAdmin(db: DB, email: string, name: string, password: string) {
  if (one(db, 'SELECT id FROM users WHERE access=?', 'admin')) throw Error('An admin already exists; use account management.');
  const hash = await hashPassword(password);
  const result = exec(db, 'INSERT INTO users(email,password_hash,name,employee_code,access,role_id,joining_date,created_at) VALUES(?,?,?,?,?,?,?,?)', email, hash, name, 'ADMIN-001', 'admin', 1, new Date().toISOString().slice(0, 10), now());
  audit(db, null, 'admin.bootstrap', 'user', Number(result.lastInsertRowid));
}
