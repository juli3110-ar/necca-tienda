import { put, del } from '@vercel/blob';
import { json } from './_lib.js';

// Diagnóstico: dice qué configuración ve la tienda (nunca muestra valores secretos).
// Con ?probar=1 guarda y borra un archivo de prueba para comprobar el almacén.
export async function GET(request) {
  const has = k => Boolean(process.env[k]);
  const out = {
    version: (process.env.VERCEL_GIT_COMMIT_SHA || 'desconocida').slice(0, 7),
    entorno: process.env.VERCEL_ENV || 'desconocido',
    contrasena: has('ADMIN_PASSWORD'),
    blob_token: has('BLOB_READ_WRITE_TOKEN'),
    blob_store_id: has('BLOB_STORE_ID'),
    oidc_header: Boolean(request.headers.get('x-vercel-oidc-token'))
  };
  if (new URL(request.url).searchParams.get('probar') === '1') {
    try {
      const b = await put('prueba/ok.txt', 'ok', { access: 'public', addRandomSuffix: true, contentType: 'text/plain' });
      await del(b.url);
      out.prueba_guardar = 'ok';
      out.dominio_fotos = new URL(b.url).hostname;
    } catch (err) {
      out.prueba_guardar = 'error';
      out.error = String(err && err.message || err).slice(0, 300);
    }
  }
  return json(out);
}
