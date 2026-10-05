/**
 * Rutas públicas / protegidas y destino seguro (?next=).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isSafeNextPath, loginHash, nextFromHash, registerHash, resolveAccess } from '../../js/services/auth-routing.js';
import { ROUTES, matchRoute } from '../../js/ui/router.js';

describe('auth-routing', () => {
  test('sin sesión, una ruta protegida va a #/login conservando el destino', () => {
    assert.deepEqual(resolveAccess({ access: 'auth', status: 'anonymous', path: '/cotizaciones/nueva' }), { action: 'redirect', to: '#/login?next=%2Fcotizaciones%2Fnueva' });
  });

  test('mientras la sesión se restaura NO se muestra nada protegido', () => {
    assert.deepEqual(resolveAccess({ access: 'auth', status: 'loading', path: '/inicio' }), { action: 'wait' });
    assert.deepEqual(resolveAccess({ access: 'guest', status: 'loading', path: '/login' }), { action: 'wait' });
  });

  test('con sesión, login/registro llevan a la app o al destino pedido', () => {
    assert.deepEqual(resolveAccess({ access: 'guest', status: 'authenticated', path: '/login', hash: '#/login?next=%2Fcotizaciones%2Fnueva' }), { action: 'redirect', to: '#/cotizaciones/nueva' });
    assert.deepEqual(resolveAccess({ access: 'guest', status: 'authenticated', path: '/registro', hash: '#/registro' }), { action: 'redirect', to: '#/inicio' });
  });

  test('las rutas públicas se ven siempre', () => {
    for (const status of ['loading', 'anonymous', 'authenticated']) assert.deepEqual(resolveAccess({ access: 'public', status, path: '/demo' }), { action: 'render' });
  });

  test('destino seguro: sólo rutas internas (sin "//", protocolos, ".." ni pantallas de ingreso)', () => {
    for (const ok of ['/inicio', '/cotizaciones/nueva', '/cotizaciones/abc-123/result', '/configuracion/cuenta']) assert.equal(isSafeNextPath(ok), true, ok);
    for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/login', '/registro', '/recuperar-contrasena', '/../x', '', '/', '/a b', null]) assert.equal(isSafeNextPath(bad), false, String(bad));
    assert.equal(nextFromHash('#/login?next=%2F%2Fevil.example'), null);
    assert.equal(loginHash('/inicio', { expired: true }), '#/login?next=%2Finicio&sesion=vencida');
    assert.equal(registerHash('/cotizaciones/nueva'), '#/registro?next=%2Fcotizaciones%2Fnueva');
  });

  test('cada ruta declara su acceso; la app real requiere sesión y la demo no', () => {
    for (const r of ROUTES) assert.ok(['public', 'guest', 'auth'].includes(r.access), `${r.name} sin access`);
    const accessOf = (hash) => matchRoute(hash).route.access;
    for (const h of ['#/', '#/demo', '#/demo/analisis', '#/recuperar-contrasena']) assert.equal(accessOf(h), 'public', h);
    for (const h of ['#/login', '#/registro']) assert.equal(accessOf(h), 'guest', h);
    for (const h of ['#/inicio', '#/cotizaciones', '#/cotizaciones/nueva', '#/cotizaciones/x/result', '#/recursos', '#/servicios', '#/escenarios', '#/configuracion', '#/configuracion/cuenta', '#/bienvenida']) assert.equal(accessOf(h), 'auth', h);
  });
});
