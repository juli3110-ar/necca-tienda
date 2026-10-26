import { randomBytes } from 'node:crypto';
import { json, blobReady, loadState, transferPrice, PAGOS, PROVINCIAS, cp4, shipQuote } from './_lib.js';
import { saveOrder, findOrder } from './_orders.js';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// Anyone: check how an order is going (shown after paying).
export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!blobReady()) return json({ error: 'missing_blob' }, 500);
  const o = await findOrder(id);
  if (!o) return json({ error: 'not_found', message: 'No encontramos ese pedido.' }, 404);
  return json({ id: o.id, estado: o.estado, total: o.total, pago: o.pago });
}

// Anyone: create an order from the bag. Prices are always recalculated here.
export async function POST(request) {
  if (!blobReady()) return json({ error: 'missing_blob', message: 'La tienda todavía no puede recibir pedidos.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json', message: 'El pedido llegó incompleto. Probá de nuevo.' }, 400); }

  const pago = Object.keys(PAGOS).includes(body.pago) ? body.pago : null;
  const entrega = body.entrega === 'envio' ? 'envio' : body.entrega === 'retiro' ? 'retiro' : null;
  const nombre = str(body.nombre, 80);
  const direccion = str(body.direccion, 120);
  const detalle = str(body.detalle, 80);
  const provincia = PROVINCIAS.includes(body.provincia) ? body.provincia : '';
  const ciudad = str(body.ciudad, 60);
  const cp = cp4(body.cp);
  if (!pago || !entrega) return json({ error: 'missing', message: 'Elegí cómo lo recibís y cómo pagás.' }, 400);
  if (nombre.length < 2) return json({ error: 'missing', message: 'Escribí tu nombre.' }, 400);
  if (entrega === 'envio' && (direccion.length < 4 || ciudad.length < 2 || !provincia || !cp)) return json({ error: 'missing', message: 'Completá provincia, código postal, ciudad y dirección.' }, 400);
  if (pago === 'efectivo' && entrega !== 'retiro') return json({ error: 'bad_pay', message: 'El efectivo es solo para retiro.' }, 400);

  let state;
  try { state = await loadState(); } catch { return json({ error: 'read_failed', message: 'No se pudo leer el catálogo. Probá de nuevo.' }, 502); }

  const items = [];
  for (const l of (Array.isArray(body.items) ? body.items : []).slice(0, 30)) {
    const p = state.products.find(x => x.id === l.id);
    const qty = Math.max(1, Math.min(10, Math.round(Number(l.qty) || 0)));
    if (!p || !SIZES.includes(l.size)) continue;
    items.push({ id: p.id, nombre: p.name, color: p.color, talle: l.size, cantidad: qty, precio: p.price });
  }
  if (!items.length) return json({ error: 'empty', message: 'Tu bolsa está vacía o esas prendas ya no están.' }, 400);

  const subtotal = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const descuento = pago === 'transferencia' ? subtotal - transferPrice(subtotal) : 0;
  const envio = entrega === 'envio' ? shipQuote(state, provincia, cp).price : 0;
  if (pago === 'online' && entrega === 'envio' && !envio) return json({ error: 'no_ship', message: 'Para tu zona el envío se coordina aparte. Elegí transferencia.' }, 400);
  const total = subtotal - descuento + envio;

  const id = Date.now().toString(36).toUpperCase().slice(-5) + randomBytes(2).toString('hex').toUpperCase();
  const order = {
    id, key: randomBytes(12).toString('hex'),
    fecha: new Date().toISOString(),
    estado: pago === 'online' ? 'pendiente' : 'a_confirmar',
    nombre, entrega, direccion, detalle, ciudad: entrega === 'envio' ? ciudad : '', provincia: entrega === 'envio' ? provincia : '', cp: entrega === 'envio' ? cp : '', pago,
    items, subtotal, descuento, envio, total
  };

  if (pago !== 'online') {
    await saveOrder(order);
    return json({ ok: true, id, total, pago });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return json({ error: 'no_mp', message: 'El pago online todavía no está activado. Elegí transferencia o escribinos.' }, 500);

  const origin = new URL(request.url).origin;
  const mpItems = items.map(i => ({
    id: i.id,
    title: `${i.nombre} · Talle ${i.talle}`.slice(0, 250),
    quantity: i.cantidad,
    unit_price: i.precio,
    currency_id: 'ARS'
  }));
  if (envio > 0) mpItems.push({ id: 'envio', title: `Envío a ${ciudad}, ${provincia}`.slice(0, 250), quantity: 1, unit_price: envio, currency_id: 'ARS' });

  const pref = {
    items: mpItems,
    payer: { name: nombre },
    external_reference: id,
    statement_descriptor: 'KIVA',
    back_urls: {
      success: `${origin}/?pago=ok&pedido=${id}`,
      pending: `${origin}/?pago=pendiente&pedido=${id}`,
      failure: `${origin}/?pago=error&pedido=${id}`
    },
    auto_return: 'approved',
    notification_url: `${origin}/api/mp-webhook`,
    metadata: { pedido: id, entrega, direccion, detalle, ciudad, provincia, cp }
  };

  let mp;
  try {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-idempotency-key': order.key },
      body: JSON.stringify(pref)
    });
    mp = await res.json();
    if (!res.ok || !mp.init_point) {
      console.error('mp preference', res.status, JSON.stringify(mp).slice(0, 300));
      return json({ error: 'mp_failed', message: 'Mercado Pago no respondió bien. Probá de nuevo en un momento.' }, 502);
    }
  } catch (err) {
    console.error('mp preference fetch', err && err.message);
    return json({ error: 'mp_failed', message: 'No pudimos conectar con Mercado Pago. Probá de nuevo.' }, 502);
  }
  order.mp_preferencia = mp.id;
  await saveOrder(order);
  return json({ ok: true, id, total, pago, pagar: mp.init_point });
}
