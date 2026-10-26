import { json } from './_lib.js';
import { findOrder, saveOrder } from './_orders.js';

const STATUS = { approved: 'pagado', authorized: 'pagado', rejected: 'rechazado', cancelled: 'rechazado', refunded: 'rechazado', charged_back: 'rechazado' };

// Mercado Pago avisa acá cuando cambia un pago. Siempre consultamos el pago
// directo a Mercado Pago, así nadie puede marcar un pedido como pagado desde afuera.
export async function POST(request) {
  const url = new URL(request.url);
  let body = {};
  try { body = await request.json(); } catch {}
  const type = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const paymentId = (body.data && body.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id');
  if (type !== 'payment' || !paymentId) return json({ ok: true, ignorado: true });

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return json({ ok: false }, 200);
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!res.ok) { console.error('mp payment', res.status); return json({ ok: false }, 200); }
    const pay = await res.json();
    const order = await findOrder(pay.external_reference);
    if (!order) return json({ ok: true, sin_pedido: true });
    order.estado = STATUS[pay.status] || 'pendiente';
    order.mp_pago = String(pay.id);
    order.mp_estado = pay.status;
    if (pay.payer && pay.payer.email) order.email = String(pay.payer.email).slice(0, 120);
    await saveOrder(order);
    return json({ ok: true });
  } catch (err) {
    console.error('mp webhook', err && err.message);
    return json({ ok: false }, 200);
  }
}

export async function GET() {
  return json({ ok: true });
}
