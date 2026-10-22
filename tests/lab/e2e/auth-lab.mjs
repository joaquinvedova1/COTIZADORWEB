#!/usr/bin/env node
/**
 * RATEOS — registro público y correos de Auth en NAVEGADOR (HD-03, PLAN-2026-018).
 *
 *   npm run build && npm run test:auth:e2e          escritorio (1360 × 900) y celular (390 × 844)
 *   node tests/lab/e2e/auth-lab.mjs --mode=mobile   uno solo
 *
 * Pruebas SIMULADAS: Supabase simulado (supabase-mock.mjs) y correos en un
 * buzón en memoria (db.outbox). Nada sale a internet, ningún correo se envía y
 * la base real nunca recibe un pedido. Las pruebas con envío REAL son manuales
 * (docs/BETA_PERIMETER.md §2.4).
 *
 * Recorre lo que hace una persona:
 *   AUTH-01 registro público: formulario, respuesta neutra y UN correo de confirmación (PKCE); la cuenta nace con SU empresa
 *   AUTH-10 sin confirmar no entra: con la contraseña correcta lo explica y reenvía (sólo sirve el último correo)
 *   AUTH-11 enlace de confirmación en el mismo navegador: entra a SU empresa
 *   AUTH-12 email ya registrado: la misma pantalla y ningún correo (no revela cuentas)
 *   AUTH-13 confirmación abierta en otro navegador: el email queda confirmado y pide ingresar
 *   AUTH-02 email sin cuenta: la pantalla no promete un correo; respuesta neutra, ningún correo, espera (UX) antes de reenviar
 *   AUTH-03 cuenta creada desde el Dashboard (alternativa del dueño): la misma respuesta y UN correo con enlace y código
 *   AUTH-04 enlace en el mismo navegador (PKCE): elegir la contraseña, entrar a SU empresa
 *   AUTH-05 enlace abierto en otro navegador: ofrece el código; con el código entra
 *   AUTH-06 enlace de "Send invitation" (tokens en el #): no abre sesión y se borra de la URL
 *   AUTH-07 SMTP por defecto (sólo equipo): fuera de sesión neutro; "Cambiar contraseña" avisa
 *   AUTH-14 SMTP por defecto: el registro dice que el correo no salió y no crea la cuenta
 *   AUTH-15 envío rechazado (HD-03 R3): el reenvío de una cuenta sin confirmar dice que no salió, nunca "Pedido enviado"
 *   AUTH-08 cada cuenta ve sólo su empresa (RLS simulada)
 *   AUTH-09 privacidad: ni contraseña ni código en el almacenamiento; URL sin códigos
 * Escribe reports/lab/e2e/auth-lab-report.{json,md} (sin emails: sólo resultados).
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../../scripts/serve.mjs';
import { assertSafeReport } from '../lib/report.js';
import { PUBLIC_SITE_URL, SUPABASE } from '../../../js/config.js';
import { CONFIRMATION_RESEND_FAILED_MESSAGE, CONFIRMATION_RESENT_MESSAGE, INVITE_LINK_MESSAGE, RECOVER_REQUEST_SUBTITLE, RECOVERY_LINK_INVALID_MESSAGE, RESET_REQUESTED_MESSAGE, RESET_SENT_OWN_MESSAGE, SIGNUP_MAIL_FAILED_MESSAGE, SIGNUP_REQUESTED_MESSAGE } from '../../../js/services/auth-service.js';
import { createDb, installSupabaseMock, SUPA } from './supabase-mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const out = { modes: ['desktop', 'mobile'], out: 'reports/lab/e2e' };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) out.modes = arg.slice(7) === 'both' ? ['desktop', 'mobile'] : [arg.slice(7)];
    else if (arg.startsWith('--out=')) out.out = arg.slice(6);
  }
  return out;
}

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try {
      return require(id);
    } catch {
      // siguiente candidato
    }
  }
  process.stderr.write('Playwright no está instalado. En CI: npm install --prefix "$RUNNER_TEMP/pw" playwright@1.56.1 y PLAYWRIGHT_MODULE=$RUNNER_TEMP/pw/node_modules/playwright\n');
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const dist = path.join(ROOT, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  process.stderr.write('Falta dist/: corré "npm run build" antes de la prueba en navegador.\n');
  process.exit(2);
}
const { chromium } = loadPlaywright();
const server = createStaticServer({ root: dist });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
// Host "de producción" (no localhost: así la app no se comporta como versión de prueba).
const base = `http://rateos.test:${server.address().port}/COTIZADORWEB/`;
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP rateos.test 127.0.0.1'] });
const outDir = path.resolve(ROOT, args.out);
if (!outDir.startsWith(ROOT + path.sep)) throw new Error('--out tiene que quedar dentro del repo.');
mkdirSync(outDir, { recursive: true });

const results = [];
const pkceMethods = new Set();
const norm = (s) => String(s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Nunca un email en el reporte. */
const mask = (s) => String(s || '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g, '<email>');

/**
 * El enlace del correo apunta al sitio publicado (lo que se verifica); para
 * abrirlo en el servidor local se cambia SÓLO el origen del redirect_to, como
 * si Supabase redirigiera al sitio: la query (?auth=recovery|confirm) queda igual.
 */
function mailLink(mail) {
  const published = new URL(mail.redirectTo);
  const local = new URL(base);
  local.search = published.search;
  return `${SUPA}/auth/v1/verify?token=${mail.tokenHash}&type=${mail.type}&redirect_to=${encodeURIComponent(local.href)}`;
}

async function runMode(mode) {
  const viewport = mode === 'mobile' ? { width: 390, height: 844 } : { width: 1360, height: 900 };
  const db = createDb();
  const errors = [];
  const blocked = [];
  const contexts = [];
  const check = (scenario, name, ok, detail = '') => {
    results.push({ mode, scenario, check: name, ok: Boolean(ok), detail: ok ? '' : mask(detail) });
    process.stdout.write(`${ok ? '  ok  ' : '  FAIL'} [${mode}] ${scenario} · ${name}${ok ? '' : ` — ${mask(detail)}`}\n`);
  };

  /** Un navegador aparte (otro dispositivo): su propio almacenamiento. */
  async function newBrowser() {
    const context = await browser.newContext({ viewport, ...(mode === 'mobile' ? { hasTouch: true, isMobile: true } : {}) });
    contexts.push(context);
    await installSupabaseMock(context, db);
    await context.route((u) => !u.href.startsWith(base) && !u.href.startsWith(SUPA), (r) => {
      blocked.push(r.request().url());
      return r.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`console ${m.text()}`);
    });
    return page;
  }
  const text = (page) => page.evaluate(() => document.body.innerText).then(norm);
  /** Todo el texto, también el del menú plegado en el celular (nombre de la empresa). */
  const allText = (page) => page.evaluate(() => document.body.textContent).then(norm);
  /** Espera a que aparezca un texto (la app arranca más lento en el celular emulado). */
  const waitText = (page, re, timeout = 12000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), re.source, { timeout }).catch(() => {});
  const waitUrl = (page, re, timeout = 12000) => page.waitForURL(re, { timeout }).catch(() => {});
  const go = async (page, hash, wait = 700) => {
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate((x) => { window.location.hash = x; }, hash);
    await page.waitForTimeout(wait);
  };
  const tap = async (page, loc) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    if (mode === 'mobile') await loc.tap();
    else await loc.click();
  };
  // Como ui-lab: con isMobile, innerWidth crece con el contenido; clientWidth no (K0C-02).
  const overflow = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth, 0));
  const requestReset = async (page, email) => {
    // Volver a la pantalla desde otra (el mismo hash no vuelve a dibujarla).
    if (/#\/recuperar-contrasena/.test(page.url())) await go(page, '#/login', 300);
    await go(page, '#/recuperar-contrasena');
    await page.getByLabel('Email de tu cuenta', { exact: true }).fill(email);
    await tap(page, page.getByRole('button', { name: 'Enviarme el correo' }));
    await page.waitForTimeout(900);
  };
  const storageDump = (page) => page.evaluate(() => {
    const out = [];
    for (const s of [window.localStorage, window.sessionStorage]) for (let i = 0; i < s.length; i += 1) out.push(`${s.key(i)}=${s.getItem(s.key(i))}`);
    return out.join('\n');
  });
  const invite = (company) => {
    // Alta como "Add user → Create new user" del Dashboard: contraseña al azar que nadie conoce.
    const email = `invitada.${company.toLowerCase().replace(/\W+/g, '')}.${mode}@rateos.test`;
    db.createUser({ email, password: `no-se-comparte-${randomUUID()}`, fullName: '', company });
    return email;
  };

  const signUp = async (page, { name, company, email, password }) => {
    if (/#\/registro/.test(page.url())) await go(page, '#/login', 300);
    await go(page, '#/registro');
    await waitText(page, /Creá tu cuenta/);
    await page.getByLabel('Tu nombre', { exact: true }).fill(name);
    await page.getByLabel('Empresa', { exact: true }).fill(company);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await tap(page, page.getByRole('button', { name: 'Crear cuenta' }));
    await page.waitForTimeout(900);
  };
  const logIn = async (page, email, password) => {
    await go(page, '#/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await tap(page, page.getByRole('button', { name: 'Ingresar' }));
    await page.waitForTimeout(900);
  };
  const orgNameOf = (email) => db.orgs.get(db.orgOf(db.users.get(email).id)).name;
  const signupMails = (email) => db.outbox.filter((m) => m.type === 'signup' && (!email || m.to === email));

  // AUTH-01 · registro público.
  const p1 = await newBrowser();
  await p1.goto(`${base}#/`);
  await waitText(p1, /Crear cuenta/);
  check('AUTH-01', 'la landing ofrece "Crear cuenta" (sin invitación)', /Crear cuenta/.test(await text(p1)), (await text(p1)).slice(0, 200));
  await go(p1, '#/registro');
  await waitText(p1, /Creá tu cuenta/);
  const labels = await Promise.all(['Tu nombre', 'Empresa', 'Email', 'Contraseña'].map((l) => p1.getByLabel(l, { exact: true }).count()));
  check('AUTH-01', 'formulario: nombre, empresa, email y contraseña', labels.every((n) => n === 1), labels.join(','));
  const emailS = `registro.${mode}@rateos.test`;
  const passS = `clave-propia-${randomUUID().slice(0, 8)}`;
  await signUp(p1, { name: 'Persona Uno', company: 'Constructora Uno', email: emailS, password: passS });
  const t1 = await text(p1);
  check('AUTH-01', 'respuesta neutra: dice qué pasa si el email es nuevo y si ya tenía cuenta', t1.includes(norm(SIGNUP_REQUESTED_MESSAGE)), t1.slice(0, 260));
  check('AUTH-01', 'no afirma "te enviamos" ni "ya está registrado"', !/te enviamos|ya está registrado/i.test(t1), 'texto que revela o promete');
  const mailS = signupMails(emailS)[0];
  check('AUTH-01', 'salió UN correo de confirmación', signupMails().length === 1 && Boolean(mailS), `${signupMails().length} correos`);
  check('AUTH-01', 'el enlace es PKCE y vuelve al sitio publicado con ?auth=confirm', Boolean(mailS && mailS.challenge) && mailS.redirectTo === `${PUBLIC_SITE_URL}?auth=confirm`, mailS ? mailS.redirectTo : 'sin correo');
  check('AUTH-01', 'la cuenta nace SIN confirmar y con SU empresa (la que escribió)', db.users.get(emailS).confirmed === false && orgNameOf(emailS) === 'Constructora Uno', orgNameOf(emailS));
  const resendS = p1.getByRole('button', { name: /Reenviar el correo de confirmación/ });
  check('AUTH-01', 'reenvío con espera visible', (await resendS.isDisabled()) && /en \d+ s/.test(await resendS.innerText()), await resendS.innerText());
  check('AUTH-01', 'ninguna sesión todavía', !/access_token/.test(await storageDump(p1)), 'hay una sesión');
  check('AUTH-01', 'sin scroll horizontal', (await overflow(p1)) <= 1, `${await overflow(p1)}px`);

  // AUTH-10 · sin confirmar no entra; con la contraseña correcta lo explica y ofrece reenviar.
  await logIn(p1, emailS, 'contraseña-equivocada-1');
  const t10a = await text(p1);
  check('AUTH-10', 'con la contraseña equivocada no revela que la cuenta existe', /No pudimos iniciar sesión/.test(t10a) && !/confirmaste/.test(t10a) && (await p1.getByRole('button', { name: /Reenviar el correo de confirmación/ }).count()) === 0, t10a.slice(0, 200));
  await logIn(p1, emailS, passS);
  const t10 = await text(p1);
  check('AUTH-10', 'con la contraseña correcta: "Todavía no confirmaste tu email" y no entra', /Todavía no confirmaste tu email/.test(t10) && /#\/login/.test(p1.url()), t10.slice(0, 200));
  mailS.at -= 61000;
  await tap(p1, p1.getByRole('button', { name: /Reenviar el correo de confirmación/ }));
  await p1.waitForTimeout(900);
  check('AUTH-10', 'reenvío: respuesta neutra', (await text(p1)).includes(norm(CONFIRMATION_RESENT_MESSAGE)), (await text(p1)).slice(0, 240));
  const mailS2 = signupMails(emailS).at(-1);
  check('AUTH-10', 'salió otro correo y el anterior ya no sirve', signupMails(emailS).length === 2 && mailS.used === true && mailS2.used === false, `${signupMails(emailS).length} correos`);

  // AUTH-11 · enlace de confirmación en el mismo navegador.
  await p1.goto(mailLink(mailS2));
  await waitUrl(p1, /#\/inicio/);
  await waitText(p1, /Inicio/);
  await p1.waitForTimeout(800);
  check('AUTH-11', 'el email quedó confirmado', db.users.get(emailS).confirmed === true, 'sin confirmar');
  check('AUTH-11', 'entra a la app (#/inicio) con SU empresa', /#\/inicio/.test(p1.url()) && /Constructora Uno/.test(await allText(p1)), mask(p1.url()));
  check('AUTH-11', 'el código PKCE no queda en la URL', !/[?&]code=/.test(p1.url()), mask(p1.url()));

  // AUTH-12 · email ya registrado: la misma pantalla y ningún correo.
  const pDup = await newBrowser();
  const mailsBefore = db.outbox.length;
  await signUp(pDup, { name: 'Otra persona', company: 'Otra empresa', email: emailS, password: `otra-clave-${randomUUID().slice(0, 8)}` });
  const t12 = await text(pDup);
  check('AUTH-12', 'la misma respuesta que un registro nuevo (no revela que el email tiene cuenta)', t12.includes(norm(SIGNUP_REQUESTED_MESSAGE)) && !/ya está registrado/i.test(t12), t12.slice(0, 240));
  check('AUTH-12', 'no salió ningún correo y la cuenta original no cambió', db.outbox.length === mailsBefore && orgNameOf(emailS) === 'Constructora Uno', `${db.outbox.length - mailsBefore} correos`);

  // AUTH-13 · confirmación abierta en otro navegador.
  const emailT = `registro-otro.${mode}@rateos.test`;
  const passT = `clave-propia-${randomUUID().slice(0, 8)}`;
  const pPideT = await newBrowser();
  await signUp(pPideT, { name: 'Persona Dos', company: 'Servicios Dos', email: emailT, password: passT });
  const pOtroT = await newBrowser();
  await pOtroT.goto(mailLink(signupMails(emailT).at(-1)));
  await waitText(pOtroT, /Tu email ya puede estar confirmado/);
  const t13 = await text(pOtroT);
  check('AUTH-13', 'en otro navegador no abre la sesión: dice que el email quedó confirmado y que ingrese', /Tu email ya puede estar confirmado/.test(t13) && /#\/login/.test(pOtroT.url()) && !/access_token/.test(await storageDump(pOtroT)), t13.slice(0, 200));
  check('AUTH-13', 'el email quedó confirmado igual', db.users.get(emailT).confirmed === true, 'sin confirmar');
  await logIn(pOtroT, emailT, passT);
  await waitUrl(pOtroT, /#\/inicio/);
  await waitText(pOtroT, /Inicio/);
  await pOtroT.waitForTimeout(800);
  check('AUTH-13', 'con email y contraseña entra a SU empresa', /#\/inicio/.test(pOtroT.url()) && /Servicios Dos/.test(await allText(pOtroT)), mask(pOtroT.url()));

  // AUTH-02 · email sin cuenta: neutro y ningún correo (otro navegador, sin sesión).
  const recoveryMails = () => db.outbox.filter((m) => m.type === 'recovery');
  const p2 = await newBrowser();
  // Antes de pedir nada, la pantalla no promete un correo.
  await go(p2, '#/recuperar-contrasena');
  await waitText(p2, /Elegí o recuperá tu contraseña/);
  const t2a = await text(p2);
  check('AUTH-02', 'antes del pedido no promete un correo y dice que sólo llega si hay cuenta', t2a.includes(norm(RECOVER_REQUEST_SUBTITLE)) && !/te mandamos|te enviamos/i.test(t2a), t2a.slice(0, 240));
  await requestReset(p2, `sin-alta.${mode}@rateos.test`);
  const t2 = await text(p2);
  check('AUTH-02', 'respuesta neutra con qué hacer si no llega nada', t2.includes(norm(RESET_REQUESTED_MESSAGE)), t2.slice(0, 240));
  check('AUTH-02', 'no afirma "te enviamos"', !/te enviamos/i.test(t2), 'dice "te enviamos"');
  check('AUTH-02', 'no salió ningún correo', recoveryMails().length === 0, `${recoveryMails().length} correos`);
  const resend = p2.getByRole('button', { name: /Volver a enviar el correo/ });
  check('AUTH-02', 'espera antes de reenviar (botón deshabilitado con cuenta regresiva)', (await resend.isDisabled()) && /en \d+ s/.test(await resend.innerText()), await resend.innerText());
  check('AUTH-02', 'ofrece escribir el código del correo', (await p2.getByLabel('Código del correo', { exact: true }).count()) === 1, 'sin campo de código');
  const neutralA = norm(await p2.locator('.pub-auth-card').innerText());

  // AUTH-03 · cuenta creada desde el Dashboard (alternativa del dueño): la misma pantalla y un correo con enlace + código.
  const emailA = invite('Empresa A');
  const pA = await newBrowser();
  await requestReset(pA, emailA);
  const neutralB = norm(await pA.locator('.pub-auth-card').innerText());
  check('AUTH-03', 'misma pantalla haya o no cuenta (no revela quién usa RATEOS)', neutralA === neutralB, 'las pantallas difieren');
  const mailA = recoveryMails().find((m) => m.to === emailA);
  check('AUTH-03', 'salió UN correo, con enlace y código de 6 dígitos', recoveryMails().length === 1 && Boolean(mailA && mailA.tokenHash && /^\d{6}$/.test(mailA.otp)), `${recoveryMails().length} correos`);
  check('AUTH-03', 'el enlace vuelve al sitio publicado con ?auth=recovery (Redirect URLs)', Boolean(mailA) && mailA.redirectTo === `${PUBLIC_SITE_URL}?auth=recovery`, mailA ? mailA.redirectTo : 'sin correo');
  check('AUTH-03', 'el pedido es PKCE (lleva code_challenge)', Boolean(mailA && mailA.challenge), 'sin code_challenge');
  // En http://rateos.test (sin crypto.subtle) el SDK usa PKCE "plain"; en el sitio publicado (https), S256.
  pkceMethods.add(mailA ? mailA.method : '—');

  // AUTH-04 · enlace en el mismo navegador.
  await pA.goto(mailLink(mailA));
  await waitText(pA, /Elegí una contraseña nueva/);
  const t4 = await text(pA);
  check('AUTH-04', 'el enlace abre "Elegí una contraseña nueva" con la cuenta a la vista', /Elegí una contraseña nueva/.test(t4) && t4.includes('Cuenta:'), t4.slice(0, 200));
  check('AUTH-04', 'el código PKCE no queda en la URL', !/[?&]code=/.test(pA.url()), mask(pA.url()));
  const passA = `clave-elegida-${randomUUID().slice(0, 8)}`;
  await pA.getByLabel('Contraseña nueva', { exact: true }).fill(passA);
  await tap(pA, pA.getByRole('button', { name: 'Guardar contraseña' }));
  await waitUrl(pA, /#\/inicio/);
  await waitText(pA, /Inicio/);
  await pA.waitForTimeout(800);
  check('AUTH-04', 'la contraseña quedó guardada', db.users.get(emailA).password === passA, 'no cambió');
  check('AUTH-04', 'entra a la app (#/inicio) con SU empresa', /#\/inicio/.test(pA.url()) && /Empresa A/.test(await allText(pA)), mask(pA.url()));

  // AUTH-05 · enlace abierto en otro navegador (correo en el celular) y código.
  const emailC = invite('Empresa C');
  const pPide = await newBrowser();
  await requestReset(pPide, emailC);
  const mailC = db.outbox.find((m) => m.to === emailC);
  const pOtro = await newBrowser();
  await pOtro.goto(mailLink(mailC));
  await waitText(pOtro, /El enlace venció/);
  const t5 = await text(pOtro);
  check('AUTH-05', 'en otro navegador el enlace no abre la cuenta y ofrece el código', t5.includes(norm(RECOVERY_LINK_INVALID_MESSAGE)) && /#\/login/.test(pOtro.url()), t5.slice(0, 240));
  await go(pOtro, '#/recuperar-contrasena');
  await tap(pOtro, pOtro.getByRole('button', { name: 'Ya tengo un código' }));
  await pOtro.waitForTimeout(400);
  // Abrir el enlace usó el correo entero: su código tampoco sirve (como en Supabase, misma credencial).
  await pOtro.getByLabel('Email de tu cuenta', { exact: true }).fill(emailC);
  await pOtro.getByLabel('Código del correo', { exact: true }).fill(mailC.otp);
  await tap(pOtro, pOtro.getByRole('button', { name: 'Verificar código' }));
  await pOtro.waitForTimeout(900);
  check('AUTH-05', 'el código de un correo cuyo enlace ya se abrió no sirve (hay que pedir otro, como dice la pantalla)', /El código no es válido o venció/.test(await text(pOtro)) && !/Elegí una contraseña nueva/.test(await text(pOtro)), (await text(pOtro)).slice(0, 200));
  // Se pide otro (pasado el minuto) y se usa su código, sin abrir su enlace.
  mailC.at -= 61000;
  await requestReset(pPide, emailC);
  const mailC2 = db.outbox.filter((m) => m.to === emailC).at(-1);
  await pOtro.getByLabel('Email de tu cuenta', { exact: true }).fill(emailC);
  await pOtro.getByLabel('Código del correo', { exact: true }).fill('000000');
  await tap(pOtro, pOtro.getByRole('button', { name: 'Verificar código' }));
  await pOtro.waitForTimeout(900);
  check('AUTH-05', 'un código equivocado se rechaza sin abrir la cuenta', /El código no es válido o venció/.test(await text(pOtro)), (await text(pOtro)).slice(0, 200));
  await pOtro.getByLabel('Código del correo', { exact: true }).fill(mailC2.otp);
  await tap(pOtro, pOtro.getByRole('button', { name: 'Verificar código' }));
  await waitText(pOtro, /Elegí una contraseña nueva/);
  check('AUTH-05', 'con el código correcto, "Elegí una contraseña nueva"', /Elegí una contraseña nueva/.test(await text(pOtro)), (await text(pOtro)).slice(0, 200));
  const passC = `clave-elegida-${randomUUID().slice(0, 8)}`;
  await pOtro.getByLabel('Contraseña nueva', { exact: true }).fill(passC);
  await tap(pOtro, pOtro.getByRole('button', { name: 'Guardar contraseña' }));
  await waitUrl(pOtro, /#\/inicio/);
  await waitText(pOtro, /Inicio/);
  await pOtro.waitForTimeout(800);
  check('AUTH-05', 'la contraseña quedó guardada y entra a SU empresa', db.users.get(emailC).password === passC && /Empresa C/.test(await allText(pOtro)), mask(pOtro.url()));
  check('AUTH-05', 'el código sirve una sola vez', mailC2.used === true, 'sigue sin usar');
  check('AUTH-05', 'sin scroll horizontal', (await overflow(pOtro)) <= 1, `${await overflow(pOtro)}px`);

  // AUTH-06 · enlace de "Send invitation" (tokens en el #).
  const pInv = await newBrowser();
  await pInv.goto(`${base}#access_token=token-de-invitacion&expires_in=3600&refresh_token=refresh-de-invitacion&token_type=bearer&type=invite`);
  await waitText(pInv, /Ese enlace no sirve/);
  const t6 = await text(pInv);
  check('AUTH-06', 'explica que ese enlace no sirve y cómo entrar', t6.includes(norm(INVITE_LINK_MESSAGE)), t6.slice(0, 200));
  check('AUTH-06', 'los tokens no quedan en la URL', !/access_token|refresh_token/.test(pInv.url()), mask(pInv.url()));
  const s6 = await storageDump(pInv);
  check('AUTH-06', 'no se abrió ninguna sesión con esos tokens', !/token-de-invitacion|refresh-de-invitacion/.test(s6) && !s6.includes(SUPABASE.url.replace(/^https:\/\//, '')) && !/access_token/.test(s6), 'hay datos de sesión');

  // AUTH-07 · SMTP por defecto: sólo envía al equipo.
  db.smtp.mode = 'default';
  db.smtp.team = [];
  const emailD = invite('Empresa D');
  const passD = `clave-${randomUUID().slice(0, 8)}`;
  db.users.get(emailD).password = passD;
  const pD = await newBrowser();
  const before = db.outbox.length;
  await requestReset(pD, emailD);
  const neutralD = norm(await pD.locator('.pub-auth-card').innerText());
  check('AUTH-07', 'fuera de sesión: la misma respuesta neutra (no revela la cuenta)', neutralD === neutralA, 'la pantalla difiere');
  check('AUTH-07', 'y no salió ningún correo', db.outbox.length === before, 'salió un correo');
  await go(pD, '#/login');
  await pD.getByLabel('Email').fill(emailD);
  await pD.getByLabel('Contraseña', { exact: true }).fill(passD);
  await tap(pD, pD.getByRole('button', { name: 'Ingresar' }));
  await waitUrl(pD, /#\/inicio/);
  await pD.waitForTimeout(800);
  await go(pD, '#/configuracion/cuenta', 1200);
  const change = pD.getByRole('button', { name: 'Cambiar contraseña' });
  if (await change.count()) {
    await tap(pD, change);
    await pD.waitForTimeout(1200);
    const t7 = await text(pD);
    check('AUTH-07', 'con la sesión iniciada, "Cambiar contraseña" avisa que no se pudo enviar', /No pudimos enviarte el email/.test(t7) && !t7.includes(norm(RESET_SENT_OWN_MESSAGE)), t7.slice(-300));
  } else {
    check('AUTH-07', 'con la sesión iniciada, "Cambiar contraseña" avisa que no se pudo enviar', false, 'no se encontró el botón');
  }
  // AUTH-14 · SMTP por defecto: el registro dice que el correo no salió y no crea la cuenta.
  const emailU = `registro-smtp.${mode}@rateos.test`;
  const pU = await newBrowser();
  const beforeU = db.outbox.length;
  await signUp(pU, { name: 'Persona Tres', company: 'Taller Tres', email: emailU, password: `clave-${randomUUID().slice(0, 8)}` });
  const t14 = await text(pU);
  check('AUTH-14', 'dice que el correo de confirmación no salió (no deja esperando)', t14.includes(norm(SIGNUP_MAIL_FAILED_MESSAGE)), t14.slice(0, 240));
  check('AUTH-14', 'no se creó la cuenta ni salió un correo', !db.users.has(emailU) && db.outbox.length === beforeU, 'se creó la cuenta');
  // AUTH-15 · HD-03 R3: con el envío rechazado, el reenvío de una cuenta sin confirmar dice que no salió.
  db.smtp.mode = 'custom';
  const emailV = `reenvio-smtp.${mode}@rateos.test`;
  const passV = `clave-${randomUUID().slice(0, 8)}`;
  const pV = await newBrowser();
  await signUp(pV, { name: 'Persona Cuatro', company: 'Taller Cuatro', email: emailV, password: passV });
  db.smtp.mode = 'default';
  signupMails(emailV)[0].at -= 61000;
  await logIn(pV, emailV, passV);
  const beforeV = signupMails(emailV).length;
  await tap(pV, pV.getByRole('button', { name: /Reenviar el correo de confirmación/ }));
  await pV.waitForTimeout(900);
  const t15 = await text(pV);
  check('AUTH-15', 'con el envío rechazado, el reenvío dice que el correo no salió (nunca "Pedido enviado")', t15.includes(norm(CONFIRMATION_RESEND_FAILED_MESSAGE)) && !t15.includes(norm(CONFIRMATION_RESENT_MESSAGE)), t15.slice(0, 240));
  check('AUTH-15', 'no salió ningún correo', signupMails(emailV).length === beforeV, `${signupMails(emailV).length - beforeV} correos`);
  db.smtp.mode = 'custom';

  // AUTH-08 · cada cuenta ve sólo su empresa (registro público y alta del dueño).
  const tokenOf = (page) => page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const v = localStorage.getItem(localStorage.key(i));
      try {
        const j = JSON.parse(v);
        if (j && j.access_token) return j.access_token;
      } catch { /* no es JSON */ }
    }
    return null;
  });
  const orgA = db.orgOf(db.users.get(emailA).id);
  const orgC = db.orgOf(db.users.get(emailC).id);
  check('AUTH-08', 'cada persona invitada nació con su propia empresa', orgA !== orgC, 'misma organización');
  const tokenC = await tokenOf(pOtro);
  const cross = await pOtro.evaluate(async ({ supa, key, token, org }) => {
    const r = await fetch(`${supa}/rest/v1/workspace_states?organization_id=eq.${org}&select=*`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return { status: r.status, rows: (await r.json()).length };
  }, { supa: SUPA, key: SUPABASE.publishableKey, token: tokenC, org: orgA });
  check('AUTH-08', 'con su sesión, C no puede leer el workspace de A', Boolean(tokenC) && cross.rows === 0, JSON.stringify(cross));
  check('AUTH-08', 'C no ve el nombre de la empresa de A', !/Empresa A/.test(await allText(pOtro)), 'aparece "Empresa A"');
  const orgS = db.orgOf(db.users.get(emailS).id);
  const orgT = db.orgOf(db.users.get(emailT).id);
  check('AUTH-08', 'cada registro público nació con su propia empresa', new Set([orgS, orgT, orgA, orgC]).size === 4, 'empresas compartidas');
  const tokenS = await tokenOf(p1);
  const crossS = await p1.evaluate(async ({ supa, key, token, org }) => {
    const r = await fetch(`${supa}/rest/v1/workspace_states?organization_id=eq.${org}&select=*`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return { status: r.status, rows: (await r.json()).length };
  }, { supa: SUPA, key: SUPABASE.publishableKey, token: tokenS, org: orgT });
  check('AUTH-08', 'con su sesión, quien se registró no puede leer el workspace de otro registro', Boolean(tokenS) && crossS.rows === 0, JSON.stringify(crossS));

  // AUTH-09 · privacidad.
  for (const [who, page, secret, code] of [['A', pA, passA, mailA.otp], ['C', pOtro, passC, mailC2.otp], ['registro', p1, passS, mailS2.otp], ['registro en otro navegador', pOtroT, passT, signupMails(emailT).at(-1).otp]]) {
    const dump = await storageDump(page);
    check('AUTH-09', `${who}: ni la contraseña ni el código quedan en el almacenamiento del navegador`, !dump.includes(secret) && !new RegExp(`(^|[^0-9])${code}([^0-9]|$)`).test(dump), 'aparecen en el almacenamiento');
    check('AUTH-09', `${who}: la URL no guarda códigos ni tokens`, !/[?&](code|token_hash)=|access_token/.test(page.url()), mask(page.url()));
  }

  check('consola', 'sin errores de la app en la consola', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('red', 'ningún pedido fuera del sitio y del Supabase simulado', blocked.length === 0, blocked.slice(0, 3).join(' | '));
  for (const c of contexts) await c.close();
}

try {
  for (const mode of args.modes) {
    process.stdout.write(`\n=== HD-03: registro público y correos (SIMULADO) — ${mode} ===\n`);
    await runMode(mode);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((x) => !x.ok);
const md = [
  '# RATEOS — registro público y correos de Auth (HD-03) · pruebas SIMULADAS',
  '',
  'Supabase simulado y correos en un buzón en memoria: ningún correo real. Las pruebas con envío real son manuales (docs/BETA_PERIMETER.md §2.4).',
  '',
  `Modos: ${args.modes.join(', ')} · controles: ${results.length} · fallas: ${failed.length} · PKCE en el host de prueba (http): ${[...pkceMethods].join(', ')} (en https el SDK usa s256)`,
  '',
  '| Modo | Escenario | Control | Estado | Detalle |',
  '|---|---|---|---|---|',
  ...results.map((x) => `| ${x.mode} | ${x.scenario} | ${x.check.replace(/\|/g, '\\|')} | ${x.ok ? 'PASS' : 'FAIL'} | ${x.detail.replace(/\|/g, '\\|')} |`),
  '',
].join('\n');
writeFileSync(path.join(outDir, 'auth-lab-report.md'), assertSafeReport(md));
writeFileSync(path.join(outDir, 'auth-lab-report.json'), assertSafeReport(JSON.stringify({ kind: 'simulada', modes: args.modes, results }, null, 2)));
process.stdout.write(`\n${results.length - failed.length}/${results.length} controles en verde · reporte: ${path.relative(ROOT, outDir)}/auth-lab-report.md\n`);
if (failed.length) process.exitCode = 1;
