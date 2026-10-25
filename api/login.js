import { json, checkAdmin, blobReady } from './_lib.js';

// Owner only: checks the password so the page can show the editor.
export async function POST(request) {
  const denied = await checkAdmin(request);
  if (denied) return denied;
  return json({ ok: true, storage: blobReady() });
}
