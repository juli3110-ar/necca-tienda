/* Sending mails through Brevo (BREVO_API_KEY) or Resend (RESEND_API_KEY).
   MAIL_FROM is the sender address (verified in the service); MAIL_NAME the name shown. */
export const mailReady = () => Boolean((process.env.BREVO_API_KEY || process.env.RESEND_API_KEY) && process.env.MAIL_FROM);

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const peso = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

/** A simple, clean mail layout. `rows` are paragraphs (plain text, escaped here); `button` is {text, url}. */
export function layout({ title, rows = [], button, footer }) {
  const brand = esc(process.env.MAIL_NAME || 'Kivara').toUpperCase().split('').join('&nbsp;');
  return `<!doctype html><html><body style="margin:0;background:#f4f1ec;font-family:Helvetica,Arial,sans-serif;color:#1a1718">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff">
<tr><td style="background:#0a0909;color:#f4eee8;padding:22px 28px;font-size:18px;letter-spacing:6px;font-weight:300">${brand}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;font-weight:400;letter-spacing:1px">${esc(title)}</h1>
${rows.map(r => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${esc(r).replace(/\n/g, '<br>')}</p>`).join('')}
${button ? `<p style="margin:24px 0 8px"><a href="${esc(button.url)}" style="display:inline-block;background:#0a0909;color:#f4eee8;text-decoration:none;padding:14px 26px;font-size:13px;letter-spacing:3px;text-transform:uppercase">${esc(button.text)}</a></p>` : ''}
${footer ? `<p style="margin:20px 0 0;font-size:12.5px;color:#8a8384;line-height:1.5">${esc(footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

/** Sends one mail. Never throws: returns true/false so a mail problem never breaks a sale. */
export async function sendMail({ to, subject, html, text }) {
  if (!mailReady() || !to) return false;
  const from = process.env.MAIL_FROM, name = process.env.MAIL_NAME || 'Kivara';
  try {
    let res;
    if (process.env.BREVO_API_KEY) {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name, email: from }, to: [{ email: to }], subject, htmlContent: html, textContent: text || subject })
      });
    } else {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${name} <${from}>`, to: [to], subject, html, text: text || subject })
      });
    }
    if (!res.ok) { console.error('mail', res.status, (await res.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) { console.error('mail', e && e.message); return false; }
}

const PAGO = { online: 'Mercado Pago', efectivo: 'Efectivo al retirar', transferencia: 'Transferencia' };
const itemsText = o => (o.items || []).map(i => `${i.cantidad} × ${i.nombre}${i.color ? ' · ' + i.color : ''} · Talle ${i.talle} — ${peso(i.precio * i.cantidad)}`).join('\n');
const entregaText = o => o.entrega === 'envio' ? `Envío a ${[o.direccion, o.detalle, o.ciudad, o.provincia].filter(Boolean).join(', ')}${o.cp ? ' (CP ' + o.cp + ')' : ''}` : 'Retiro en punto de entrega';

/** Mail to the customer when an order is confirmed or paid. */
export function orderMailForCustomer(o, paid) {
  return {
    subject: paid ? `Recibimos tu pago · Pedido #${o.id}` : `Recibimos tu pedido #${o.id}`,
    html: layout({
      title: paid ? '¡Gracias por tu compra!' : '¡Recibimos tu pedido!',
      rows: [`Hola ${o.nombre || ''}, ${paid ? 'tu pago se acreditó.' : 'ya tenemos tu pedido.'} Te escribimos por WhatsApp para coordinar la entrega.`, itemsText(o), `${entregaText(o)}\nPago: ${PAGO[o.pago] || o.pago}${o.envio ? '\nEnvío: ' + peso(o.envio) : ''}\nTotal: ${peso(o.total)}`],
      footer: `Pedido #${o.id}. Si tenés alguna duda, respondé este mail o escribinos por WhatsApp.`
    })
  };
}
/** Mail to the owner for every new order (and when an online payment is approved). */
export function orderMailForOwner(o, paid) {
  return {
    subject: `${paid ? 'Pago aprobado' : 'Nuevo pedido'} #${o.id} · ${peso(o.total)}`,
    html: layout({
      title: paid ? `Se acreditó el pago del pedido #${o.id}` : `Entró el pedido #${o.id}`,
      rows: [`${o.nombre}${o.cuenta ? ' (' + o.cuenta + ')' : ''}`, itemsText(o), `${entregaText(o)}\nPago: ${PAGO[o.pago] || o.pago}\nTotal: ${peso(o.total)}`],
      footer: 'Lo ves completo en Pedidos, dentro del modo edición de la tienda.'
    })
  };
}
