import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { put, list } from '@vercel/blob';

const PREFIX = 'clientas/';

/* Secret for signing sessions and naming files. Set SESSION_SECRET in Vercel to rotate it on its own. */
function secret() {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
  if (!s) throw new Error('missing secret');
  return 'kivara-clientas|' + s;
}
const mac = text => createHmac('sha256', secret()).update(text).digest('base64url');

export const normEmail = e => String(e || '').trim().toLowerCase().slice(0, 120);
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/* The file name is a keyed hash of the email, so it can't be guessed from the address. */
const userPath = email => `${PREFIX}${mac('user:' + email).slice(0, 40)}.json`;

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(String(pw), salt, 64).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const a = scryptSync(String(pw), salt, 64), b = Buffer.from(hex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function findUser(email) {
  const path = userPath(email);
  const { blobs } = await list({ prefix: path, limit: 1 });
  if (!blobs.length) return null;
  const res = await fetch(`${blobs[0].url}?v=${encodeURIComponent(blobs[0].uploadedAt)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}
export async function saveUser(user) {
  await put(userPath(user.email), JSON.stringify(user), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, contentType: 'application/json'
  });
}

/* Session token: base64url(json) + "." + signature. Lasts 60 days. */
export function makeToken(email) {
  const body = Buffer.from(JSON.stringify({ e: email, x: Date.now() + 60 * 864e5 })).toString('base64url');
  return `${body}.${mac('tok:' + body)}`;
}
export function readToken(request) {
  const t = request.headers.get('x-user-token') || '';
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const good = mac('tok:' + body);
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    return d.x > Date.now() ? normEmail(d.e) : null;
  } catch { return null; }
}

export const publicUser = u => ({ email: u.email, nombre: u.nombre, datos: u.datos || {} });

/* Password reset link: valid 1 hour and only until the password changes (it carries a piece of the current hash). */
export function makeResetToken(user) {
  const body = Buffer.from(JSON.stringify({ e: user.email, x: Date.now() + 3600e3, h: String(user.pass).slice(-12) })).toString('base64url');
  return `${body}.${mac('reset:' + body)}`;
}
export async function readResetToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = mac('reset:' + body);
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let d; try { d = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!(d.x > Date.now())) return null;
  const user = await findUser(normEmail(d.e));
  if (!user || String(user.pass).slice(-12) !== d.h) return null;
  return user;
}
