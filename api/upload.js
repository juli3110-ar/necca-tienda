import { put } from '@vercel/blob';
import { json, checkAdmin, blobReady } from './_lib.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 4 * 1024 * 1024;

// Owner only: store one photo and return its public address.
export async function POST(request) {
  const denied = await checkAdmin(request);
  if (denied) return denied;
  if (!blobReady()) return json({ error: 'missing_blob', message: 'Falta conectar el almacenamiento (Blob) en Vercel.' }, 500);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  const ext = TYPES[type];
  if (!ext) return json({ error: 'bad_type', message: 'Subí una foto JPG, PNG o WEBP.' }, 415);
  const buf = Buffer.from(await request.arrayBuffer());
  if (!buf.length) return json({ error: 'empty', message: 'La foto llegó vacía.' }, 400);
  if (buf.length > MAX) return json({ error: 'too_large', message: 'La foto es muy pesada (máximo 4 MB).' }, 413);
  try {
    const blob = await put(`fotos/foto.${ext}`, buf, { access: 'public', addRandomSuffix: true, contentType: type });
    return json({ url: blob.url });
  } catch (err) {
    return json({ error: 'upload_failed', message: 'No se pudo subir la foto. Probá de nuevo.' }, 502);
  }
}
