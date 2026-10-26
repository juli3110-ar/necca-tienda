import { createHash, timingSafeEqual } from 'node:crypto';
import { SEED } from './_seed.js';
import { list as blobList, put as blobPut, del as blobDel } from '@vercel/blob';

export { SEED };

const GLYPHS = ['g-dress', 'g-skirt', 'g-short', 'g-pant', 'g-top', 'g-tee', 'g-set'];
const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[A-Za-z0-9._\/-]+$/;
const LOCAL_URL = /^\/fotos\/[A-Za-z0-9._-]+$/;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

const digest = s => createHash('sha256').update(String(s)).digest();

/** Returns null when the request carries the right password, or an error Response. */
export async function checkAdmin(request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return json({ error: 'missing_password', message: 'Falta configurar ADMIN_PASSWORD en Vercel.' }, 500);
  const given = request.headers.get('x-admin-key') || '';
  const ok = given.length > 0 && timingSafeEqual(digest(given), digest(expected));
  if (!ok) {
    await new Promise(r => setTimeout(r, 600));
    return json({ error: 'unauthorized', message: 'La contraseña no es correcta.' }, 401);
  }
  return null;
}

export function blobReady() {
  // Older stores give BLOB_READ_WRITE_TOKEN; newer ones connect with BLOB_STORE_ID.
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const color = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : '#2A2627';
export const safeImg = u => (typeof u === 'string' && (BLOB_URL.test(u) || LOCAL_URL.test(u))) ? u : '';

/** Keeps only the fields the page uses, with sane types and lengths. */
export function cleanState(input) {
  const s = input && typeof input === 'object' ? input : {};
  const hero = s.hero || {};
  const contact = s.contact || {};
  const products = Array.isArray(s.products) ? s.products.slice(0, 300) : [];
  const seen = new Set();
  const menu = (Array.isArray(s.menu) ? s.menu : []).slice(0, 8).map(g => ({
    t: str(g && g.t, 30),
    items: (Array.isArray(g && g.items) ? g.items : []).slice(0, 40).map(c => ({
      id: str(c && c.id, 40).replace(/[^A-Za-z0-9_-]/g, ''),
      label: str(c && c.label, 40)
    })).filter(c => c.id && c.label)
  })).filter(g => g.t);
  return {
    ...(menu.some(g => g.items.length) ? { menu } : {}),
    ...(s.ship && typeof s.ship === 'object' ? { ship: {
      local: str(s.ship.local, 200).replace(/[^0-9, ]/g, ''),
      nota: str(s.ship.nota, 160),
      prov: Object.fromEntries(PROVINCIAS.map(p => [p, Math.max(0, Math.round(Number(s.ship.prov && s.ship.prov[p]) || 0))]).filter(x => x[1] > 0))
    } } : {}),
    ...(Array.isArray(s.faq) ? { faq: s.faq.slice(0, 30).map(x => ({
      q: str(x && x.q, 140),
      a: String(x && x.a != null ? x.a : '').replace(/\r/g, '').trim().slice(0, 1200)
    })).filter(x => x.q && x.a) } : {}),
    hero: {
      img: safeImg(hero.img),
      alt: str(hero.alt, 160),
      eyebrow: str(hero.eyebrow, 60),
      title: str(hero.title, 60)
    },
    contact: {
      instagram: str(contact.instagram, 60),
      whatsapp: str(contact.whatsapp, 30),
      email: str(contact.email, 80),
      alias: str(contact.alias, 60),
      titular: str(contact.titular, 60),
      envio: Math.max(0, Math.round(Number(contact.envio) || 0))
    },
    products: products.map(p => {
      let id = str(p && p.id, 40).replace(/[^A-Za-z0-9_-]/g, '');
      if (!id || seen.has(id)) id = 'p' + Math.random().toString(36).slice(2, 10);
      seen.add(id);
      const price = Math.max(0, Math.round(Number(p.price) || 0));
      return {
        id,
        name: str(p.name, 80),
        cat: str(p.cat, 40).replace(/[^A-Za-z0-9_-]/g, ''),
        color: str(p.color, 40),
        price,
        badge: p.badge ? 'Nuevo' : '',
        desc: String(p.desc == null ? '' : p.desc).replace(/\r/g, '').trim().slice(0, 800),
        img: safeImg(p.img),
        sizes: cleanSizes(p.sizes),
        imgs: (Array.isArray(p.imgs) ? p.imgs : []).map(safeImg).filter(Boolean).slice(0, 6),
        colors: (Array.isArray(p.colors) ? p.colors : []).slice(0, 12).map(c => ({ n: str(c && c.n, 30), h: color(c && c.h) })).filter(c => c.n),
        tint: color(p.tint),
        ink: color(p.ink),
        glyph: GLYPHS.includes(p.glyph) ? p.glyph : 'g-top',
        m: (Array.isArray(p.m) ? p.m : []).slice(0, 4)
          .map(r => (Array.isArray(r) ? r : []).slice(0, 4).map(x => str(x, 20)))
          .filter(r => r[0])
      };
    }).filter(p => p.name && p.price > 0)
  };
}

/* ---------- Catálogo guardado ---------- */

/** Reads the latest saved catalog, or the starting one. */
export async function loadState() {
  if (!blobReady()) return SEED;
  const { blobs } = await blobList({ prefix: 'data/store', limit: 100 });
  if (!blobs.length) return SEED;
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const res = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!res.ok) throw new Error('read ' + res.status);
  return cleanState(await res.json());
}

/* ---------- Pedidos ---------- */
export const transferPrice = n => Math.round(n * 0.9 / 100) * 100;
export const PAGOS = { transferencia: 'Transferencia', online: 'Tarjeta o Mercado Pago', efectivo: 'Efectivo al retirar' };
export const ESTADOS = { a_confirmar: 'A confirmar', pendiente: 'Esperando el pago', pagado: 'Pagado', rechazado: 'Pago rechazado' };

export const PROVINCIAS = ['Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];
export const cp4 = cp => (String(cp || '').match(/\d{4}/) || [''])[0];
/** Same rules as the page: local postal codes pay the Rosario price, the rest their province's price. 0 = a coordinar. */
export function shipQuote(state, prov, cp) {
  const ship = state.ship || {};
  const local = String(ship.local == null ? '2000' : ship.local).split(/[^0-9]+/).filter(Boolean);
  const d = cp4(cp);
  if (d && local.includes(d)) return { local: true, price: Number(state.contact && state.contact.envio) || 0 };
  return { local: false, price: Number(ship.prov && ship.prov[prov]) || 0 };
}

/* ---------- Talles y stock ---------- */
export const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
function cleanSizes(z) {
  if (!z || typeof z !== 'object') return undefined;
  const out = {};
  for (const s of SIZES) {
    const v = z[s];
    out[s] = v === 'no' || v === 'enc' || v === 'si' ? v : (v !== '' && v != null && Number.isFinite(Number(v)) ? Math.max(0, Math.min(9999, Math.round(Number(v)))) : 'no');
  }
  return out;
}
/** What a size allows: 'no', 'enc', 'si' or a number of units. Old products (no sizes set) work as before. */
export function sizeVal(p, s) {
  if (!p.sizes) return s === 'XS' || s === 'XL' ? 'enc' : 'si';
  return p.sizes[s] == null ? 'no' : p.sizes[s];
}
/** Units still free of a size (Infinity when not counted, 0 when not offered). */
export function sizeLeft(p, s) {
  const v = sizeVal(p, s);
  if (v === 'si' || v === 'enc') return Infinity;
  return typeof v === 'number' ? v : 0;
}
/** Adds (sign 1) or takes away (sign -1) the units of an order from the counted sizes. */
export function moveStock(state, items, sign) {
  let changed = false;
  for (const i of items) {
    const p = state.products.find(x => x.id === i.id);
    if (!p || !p.sizes || typeof p.sizes[i.talle] !== 'number') continue;
    p.sizes[i.talle] = Math.max(0, p.sizes[i.talle] + sign * i.cantidad);
    changed = true;
  }
  return changed;
}
/** Saves the whole catalog as a new file and removes the old ones. */
export async function saveState(state) {
  const saved = await blobPut('data/store.json', JSON.stringify(cleanState(state)), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
  const { blobs } = await blobList({ prefix: 'data/store', limit: 100 });
  const old = blobs.filter(b => b.url !== saved.url).map(b => b.url);
  if (old.length) await blobDel(old);
}
/** Re-reads the catalog and applies a stock change for an order. */
export async function updateStock(items, sign) {
  const state = await loadState();
  if (moveStock(state, items, sign)) await saveState(state);
}
