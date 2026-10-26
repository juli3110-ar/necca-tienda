import { put, list, del } from '@vercel/blob';
import { json, checkAdmin, cleanState, blobReady, SEED } from './_lib.js';

const PREFIX = 'data/store';

async function latest() {
  const { blobs } = await list({ prefix: PREFIX, limit: 100 });
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return blobs;
}

// Everyone: read the catalog.
const online = () => Boolean(process.env.MP_ACCESS_TOKEN);

export async function GET() {
  if (!blobReady()) return json({ state: SEED, source: 'seed', pagos_online: online() });
  try {
    const blobs = await latest();
    if (!blobs.length) return json({ state: SEED, source: 'seed', pagos_online: online() });
    const res = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!res.ok) throw new Error('read ' + res.status);
    return json({ state: cleanState(await res.json()), source: 'saved', pagos_online: online() });
  } catch (err) {
    return json({ error: 'read_failed', message: 'No se pudo leer el catálogo.' }, 502);
  }
}

// Owner only: save the whole catalog.
export async function POST(request) {
  const denied = await checkAdmin(request);
  if (denied) return denied;
  if (!blobReady()) return json({ error: 'missing_blob', message: 'Falta conectar el almacenamiento (Blob) en Vercel.' }, 500);
  let body;
  try {
    const text = await request.text();
    if (text.length > 1_500_000) return json({ error: 'too_large', message: 'El catálogo es demasiado grande.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad_json', message: 'Los datos enviados no son válidos.' }, 400);
  }
  const state = cleanState(body);
  try {
    // Each save is a new file, so the next read never gets a cached old copy.
    const saved = await put(PREFIX + '.json', JSON.stringify(state), {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'application/json'
    });
    const old = (await latest()).filter(b => b.url !== saved.url).map(b => b.url);
    if (old.length) await del(old);
    return json({ ok: true, state });
  } catch (err) {
    return json({ error: 'save_failed', message: 'No se pudo guardar. Probá de nuevo.' }, 502);
  }
}
