import { json } from './_lib.js';

// Diagnóstico: dice qué configuración ve la tienda (nunca muestra valores secretos).
export async function GET(request) {
  const has = k => Boolean(process.env[k]);
  const blobVars = Object.keys(process.env).filter(k => k.includes('BLOB')).sort();
  return json({
    version: (process.env.VERCEL_GIT_COMMIT_SHA || 'desconocida').slice(0, 7),
    entorno: process.env.VERCEL_ENV || 'desconocido',
    contrasena: has('ADMIN_PASSWORD'),
    blob_token: has('BLOB_READ_WRITE_TOKEN'),
    blob_store_id: has('BLOB_STORE_ID'),
    oidc_env: has('VERCEL_OIDC_TOKEN'),
    oidc_header: Boolean(request.headers.get('x-vercel-oidc-token')),
    variables_blob: blobVars
  });
}
