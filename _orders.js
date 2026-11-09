import { put, list } from '@vercel/blob';

const PREFIX = 'pedidos/';

/** Saves (or overwrites) one order. The file name carries an unguessable key. */
export async function saveOrder(order) {
  await put(`${PREFIX}${order.id}-${order.key}.json`, JSON.stringify(order), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/json'
  });
}

async function readBlob(b) {
  const res = await fetch(`${b.url}?v=${encodeURIComponent(b.uploadedAt)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

/** Finds one order by its public id (the key part of the name stays private). */
export async function findOrder(id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9]/g, '');
  if (!safe) return null;
  const { blobs } = await list({ prefix: `${PREFIX}${safe}-`, limit: 5 });
  if (!blobs.length) return null;
  return readBlob(blobs[0]);
}

/** Newest orders first. */
export async function listOrders(limit = 100) {
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const out = await Promise.all(blobs.slice(0, limit).map(readBlob));
  return out.filter(Boolean).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}
