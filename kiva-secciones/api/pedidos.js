import { json, checkAdmin, blobReady } from './_lib.js';
import { listOrders, findOrder, saveOrder } from './_orders.js';

// Owner only: list orders, newest first.
export async function GET(request) {
  const denied = await checkAdmin(request);
  if (denied) return denied;
  if (!blobReady()) return json({ pedidos: [] });
  try {
    const pedidos = (await listOrders(100)).map(({ key, ...o }) => o);
    return json({ pedidos, mp: Boolean(process.env.MP_ACCESS_TOKEN) });
  } catch (err) {
    return json({ error: 'read_failed', message: 'No se pudieron leer los pedidos.' }, 502);
  }
}

// Owner only: mark an order as paid or delivered by hand (transfer / cash).
export async function POST(request) {
  const denied = await checkAdmin(request);
  if (denied) return denied;
  let body = {};
  try { body = await request.json(); } catch {}
  const estados = ['a_confirmar', 'pagado', 'entregado'];
  if (!estados.includes(body.estado)) return json({ error: 'bad_state', message: 'Estado no válido.' }, 400);
  const o = await findOrder(body.id);
  if (!o) return json({ error: 'not_found', message: 'No encontramos ese pedido.' }, 404);
  o.estado = body.estado;
  await saveOrder(o);
  const { key, ...pub } = o;
  return json({ ok: true, pedido: pub });
}
