import { json, blobReady, PROVINCIAS } from './_lib.js';
import { normEmail, validEmail, hashPassword, checkPassword, findUser, saveUser, makeToken, readToken, publicUser, makeResetToken, readResetToken } from './_users.js';
import { sendMail, layout, mailReady } from './_mail.js';
import { listOrders } from './_orders.js';

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const slow = () => new Promise(r => setTimeout(r, 500));

// Logged-in customer: her data and her orders.
export async function GET(request) {
  if (!blobReady()) return json({ error: 'missing_blob', message: 'Las cuentas todavía no están activas.' }, 500);
  const email = readToken(request);
  if (!email) return json({ error: 'unauthorized', message: 'Volvé a iniciar sesión.' }, 401);
  const user = await findUser(email);
  if (!user) return json({ error: 'unauthorized', message: 'Volvé a iniciar sesión.' }, 401);
  let pedidos = [];
  try {
    pedidos = (await listOrders(300)).filter(o => o.cuenta === email).slice(0, 30)
      .map(o => ({ id: o.id, fecha: o.fecha, estado: o.estado, total: o.total, items: (o.items || []).map(i => ({ nombre: i.nombre, talle: i.talle, color: i.color, cantidad: i.cantidad })) }));
  } catch {}
  return json({ user: publicUser(user), pedidos });
}

// Sign up, log in, or save details.
export async function POST(request) {
  if (!blobReady()) return json({ error: 'missing_blob', message: 'Las cuentas todavía no están activas.' }, 500);
  let b = {};
  try { b = await request.json(); } catch { return json({ error: 'bad_json', message: 'Datos inválidos.' }, 400); }

  if (b.accion === 'registro') {
    const email = normEmail(b.email), nombre = str(b.nombre, 60), pw = String(b.password || '');
    if (nombre.length < 2) return json({ error: 'missing', message: 'Escribí tu nombre.' }, 400);
    if (!validEmail(email)) return json({ error: 'missing', message: 'Revisá tu mail.' }, 400);
    if (pw.length < 6) return json({ error: 'weak', message: 'La contraseña tiene que tener al menos 6 caracteres.' }, 400);
    if (await findUser(email)) return json({ error: 'exists', message: 'Ya hay una cuenta con ese mail. Iniciá sesión.' }, 409);
    const user = { email, nombre, pass: hashPassword(pw), datos: {}, creada: new Date().toISOString() };
    await saveUser(user);
    await sendMail({ to: email, subject: '¡Bienvenida a Kivara!', html: layout({
      title: `¡Hola ${nombre.split(' ')[0]}!`,
      rows: ['Ya tenés tu cuenta en Kivara. Desde ahí ves tus pedidos y guardás tu dirección para comprar más rápido.'],
      button: { text: 'Ir a la tienda', url: new URL(request.url).origin },
      footer: 'Si no creaste esta cuenta, ignorá este mail.'
    }) });
    return json({ ok: true, token: makeToken(email), user: publicUser(user) });
  }

  if (b.accion === 'olvide') {
    if (!mailReady()) return json({ error: 'no_mail', message: 'Por ahora escribinos por WhatsApp y te ayudamos a recuperar tu cuenta.' }, 503);
    const email = normEmail(b.email);
    const user = validEmail(email) ? await findUser(email) : null;
    if (user) {
      const link = `${new URL(request.url).origin}/#reset=${makeResetToken(user)}`;
      await sendMail({ to: email, subject: 'Cambiá tu contraseña de Kivara', html: layout({
        title: 'Cambiá tu contraseña',
        rows: [`Hola ${user.nombre.split(' ')[0]}, tocá el botón para elegir una contraseña nueva. El link vale por 1 hora.`],
        button: { text: 'Elegir contraseña nueva', url: link },
        footer: 'Si no lo pediste vos, ignorá este mail: tu contraseña sigue igual.'
      }) });
    } else await slow();
    return json({ ok: true, message: 'Si hay una cuenta con ese mail, te mandamos un link para cambiar la contraseña. Revisá también en spam.' });
  }

  if (b.accion === 'reset') {
    const user = await readResetToken(b.token);
    if (!user) return json({ error: 'bad_reset', message: 'El link venció o ya se usó. Pedí uno nuevo.' }, 400);
    if (String(b.password || '').length < 6) return json({ error: 'weak', message: 'La contraseña tiene que tener al menos 6 caracteres.' }, 400);
    user.pass = hashPassword(b.password);
    await saveUser(user);
    return json({ ok: true, token: makeToken(user.email), user: publicUser(user) });
  }

  if (b.accion === 'login') {
    const email = normEmail(b.email);
    const user = validEmail(email) ? await findUser(email) : null;
    if (!user || !checkPassword(b.password, user.pass)) { await slow(); return json({ error: 'bad_login', message: 'El mail o la contraseña no son correctos.' }, 401); }
    return json({ ok: true, token: makeToken(email), user: publicUser(user) });
  }

  if (b.accion === 'datos') {
    const email = readToken(request);
    const user = email ? await findUser(email) : null;
    if (!user) return json({ error: 'unauthorized', message: 'Volvé a iniciar sesión.' }, 401);
    const d = b.datos || {};
    user.nombre = str(b.nombre, 60) || user.nombre;
    user.datos = {
      telefono: str(d.telefono, 30), provincia: PROVINCIAS.includes(d.provincia) ? d.provincia : '',
      ciudad: str(d.ciudad, 60), cp: str(d.cp, 10), direccion: str(d.direccion, 120), detalle: str(d.detalle, 80)
    };
    await saveUser(user);
    return json({ ok: true, user: publicUser(user) });
  }

  return json({ error: 'bad_action', message: 'Acción no válida.' }, 400);
}
