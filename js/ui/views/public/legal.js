/**
 * #/privacidad — Privacidad, condiciones de la beta y soporte (beta pública).
 *
 * Texto corto y llano: qué se guarda, dónde, quién lo puede ver, cómo se
 * reporta un problema, cómo se borra la cuenta y que es una beta gratuita
 * sin garantía. El contacto sale de SUPPORT_EMAIL (js/config.js); si es null
 * el único canal es «Reportar un problema».
 */

import { h, mount } from '../../dom.js';
import { SUPPORT_EMAIL } from '../../../config.js';
import { flowHeader, headerLink, isSignedIn, reportLink, siteFooter } from './public-chrome.js';

export const LEGAL_UPDATED = '23/11/2026';

function section(title, ...paras) {
  return h('section', { class: 'pub-legal-section' }, h('h2', { class: 'pub-h3' }, title), ...paras.map((p) => (typeof p === 'string' ? h('p', {}, p) : p)));
}

function contactLine(app) {
  const report = reportLink(app, { className: 'pub-inline-link pub-report-link' });
  if (SUPPORT_EMAIL) {
    return h('p', {}, 'Escribinos a ', h('a', { href: `mailto:${SUPPORT_EMAIL}` }, SUPPORT_EMAIL), ' o usá ', report || '«Reportar un problema»', ' (está en todas las pantallas). Respondemos en días hábiles.');
  }
  return h('p', {}, 'Usá ', report || '«Reportar un problema»', ' (está en todas las pantallas, también en la demo). Lo lee el equipo de RATEOS y respondemos en días hábiles.');
}

export function render(root, app) {
  const signedIn = isSignedIn(app);
  const header = flowHeader({ actions: [headerLink('Volver', signedIn ? '#/inicio' : '#/', { iconBefore: 'arrowLeft' })] });
  const content = h('main', { class: 'pub-container pub-container-narrow pub-legal', id: 'main' },
    h('h1', { class: 'pub-h2', tabindex: '-1' }, 'Privacidad y condiciones de la beta'),
    h('p', { class: 'pub-legal-meta' }, `Última actualización: ${LEGAL_UPDATED}.`),
    section('Qué es esta beta',
      'RATEOS está en beta pública y gratuita. La usamos con las primeras empresas para encontrar errores y mejorar. Puede cambiar, tener errores o dejar de estar disponible por un rato.',
      'RATEOS calcula costos y precios con los datos que vos cargás. Es una herramienta de apoyo: revisá cada precio antes de mandarlo a un cliente. No reemplaza a tu contador ni a tu asesor laboral o impositivo.'),
    section('Qué datos guardamos',
      'Tu nombre, tu email y el nombre de tu empresa, para que puedas entrar. Y lo que cargás en RATEOS: recursos, convenios, cotizaciones, clientes y tarifas.',
      'No vendemos ni compartimos tus datos con nadie, no mostramos publicidad y no usamos herramientas de seguimiento de terceros.'),
    section('Dónde están y quién los puede ver',
      'Se guardan en Supabase (servidores en Estados Unidos), con acceso cifrado. Cada empresa ve sólo lo suyo: la base de datos no le deja a una empresa leer los datos de otra.',
      'El panel de administración de RATEOS sólo muestra datos de la cuenta (nombre, email, empresa, fechas), nunca tus cotizaciones ni tus costos. Sólo vamos a mirar o restaurar el contenido de tu empresa si nos lo pedís para resolver un problema.',
      'La demo («Probar con un ejemplo») no necesita cuenta y no guarda nada.'),
    section('Copias de seguridad',
      'Guardamos versiones anteriores del trabajo de cada empresa (hasta 30 días), para poder recuperarlo si algo se pisa por error. Además podés descargar tu propia copia cuando quieras desde Configuración → Datos y backup.'),
    section('Reportes de problemas',
      'Cuando usás «Reportar un problema» se guarda lo que escribís, la pantalla y el paso donde estabas, la versión de RATEOS y tu navegador. No se adjuntan tus cotizaciones, importes ni clientes, y el reporte no se publica en ningún lado. Te pedimos que no escribas nombres de clientes ni precios reales.'),
    section('Borrar tu cuenta',
      'Pedínoslo por el canal de contacto de abajo y borramos tu cuenta y los datos de tu empresa, incluidas las copias de seguridad, dentro de los 30 días. Antes podés descargar tu copia.'),
    section('Contacto y soporte', contactLine(app)),
  );
  mount(root, h('div', { class: 'pub-page pub-legal-page' }, header, content, siteFooter(app)));
  const title = content.querySelector('h1');
  if (title) title.focus();
}
