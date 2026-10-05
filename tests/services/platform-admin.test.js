/**
 * RATEOS ADMIN (rol de plataforma): identificación, separación del rol de
 * empresa, menú condicional, guard de la ruta y manipulación del frontend.
 *
 * La autoridad real está en Postgres (supabase/tests/rls_admin_test.sql);
 * acá se prueba que el frontend nunca la reemplaza: sólo pregunta a la base,
 * trata cualquier duda como "no es admin" y no filtra datos de más.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createAdminGateway } from '../../js/data/admin-gateway.js';
import { ADMIN_NO_ACCESS, PLATFORM_ADMIN_LABEL, adminErrorMessage, adminRows, adminSummary, createAdminService } from '../../js/services/admin-service.js';
import { createAccountContext } from '../../js/services/app-context.js';
import { createCloud } from '../../js/services/cloud.js';
import { ROUTES, matchRoute } from '../../js/ui/router.js';
import { ADMIN_NAV_ITEM, NAV_ITEMS } from '../../js/ui/layout.js';
import { canOpenAdmin } from '../../js/ui/views/admin.js';
import { createFakeServer, SpyStorage } from '../helpers/fake-supabase.js';

/** Cliente de Supabase falso: responde cada RPC con lo que se le indique. */
function rpcClient(responses) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      const r = responses[name];
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? r() : r;
    },
  };
}

const forbidden = { data: null, error: { code: '42501', message: 'forbidden' }, status: 403 };

describe('admin-gateway: sólo pregunta a la base', () => {
  test('exige un cliente con rpc()', () => {
    assert.throws(() => createAdminGateway(null));
    assert.throws(() => createAdminGateway({}));
  });

  test('am_i_platform_admin: sólo true literal de la base es admin', async () => {
    for (const [data, expected] of [[true, true], [false, false], [null, false], ['true', false], [1, false], [{ isAdmin: true }, false], [[true], false]]) {
      const gw = createAdminGateway(rpcClient({ am_i_platform_admin: { data, error: null } }));
      assert.equal((await gw.amIPlatformAdmin()).isAdmin, expected, JSON.stringify(data));
    }
  });

  test('cualquier error (permiso, red, sesión, excepción) = no es admin', async () => {
    const cases = [
      forbidden,
      { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
      { data: null, error: { message: 'Failed to fetch' }, status: 0 },
      new TypeError('Failed to fetch'),
      new Error('boom'),
    ];
    for (const r of cases) {
      const res = await createAdminGateway(rpcClient({ am_i_platform_admin: r })).amIPlatformAdmin();
      assert.equal(res.isAdmin, false);
      assert.equal(res.ok, false);
      assert.ok(res.code);
    }
  });

  test('llama sólo a las funciones RPC de admin, sin argumentos (ni email ni organizationId)', async () => {
    const client = rpcClient({ am_i_platform_admin: { data: true }, admin_overview: { data: {} }, admin_users: { data: [] } });
    const gw = createAdminGateway(client);
    await gw.amIPlatformAdmin();
    await gw.overview();
    await gw.users();
    assert.deepEqual(client.calls, [
      { name: 'am_i_platform_admin', args: undefined },
      { name: 'admin_overview', args: undefined },
      { name: 'admin_users', args: undefined },
    ]);
  });

  test('admin_users: sólo pasan los campos de metadata permitidos (nunca state, ids ni tokens)', async () => {
    const row = {
      full_name: 'Ana', email: 'ana@example.com', email_confirmed: true, organization_name: 'Norte', organization_role: 'OWNER',
      workspace_revision: 3, workspace_bytes: 1200, is_platform_admin: false,
      state: { quotes: [{ commercialRate: 123 }] }, user_id: 'uuid-1', organization_id: 'uuid-2', access_token: 'jwt', password: 'x',
    };
    const res = await createAdminGateway(rpcClient({ admin_users: { data: [row] } })).users();
    assert.equal(res.ok, true);
    assert.equal(res.users.length, 1);
    for (const k of ['state', 'user_id', 'organization_id', 'access_token', 'password']) assert.equal(k in res.users[0], false, k);
    assert.equal(res.users[0].email, 'ana@example.com');
  });

  test('admin_overview: sólo conteos conocidos; rechazo de la base = forbidden', async () => {
    const ok = await createAdminGateway(rpcClient({ admin_overview: { data: { users_total: 4, secret: 'x', state: {} } } })).overview();
    assert.deepEqual(ok.overview, { users_total: 4 });
    const no = await createAdminGateway(rpcClient({ admin_overview: forbidden })).overview();
    assert.deepEqual(no, { ok: false, code: 'forbidden' });
    const noUsers = await createAdminGateway(rpcClient({ admin_users: forbidden })).users();
    assert.deepEqual(noUsers, { ok: false, code: 'forbidden' });
  });

  test('createCloud expone la puerta de admin junto a las de Auth y workspace', () => {
    const cloud = createCloud({ client: { rpc: async () => ({}), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, from: () => ({}) }, clearLocalSession: () => {} });
    assert.equal(typeof cloud.adminGateway.amIPlatformAdmin, 'function');
  });
});

describe('admin-service: indicadores y filas (sólo metadata)', () => {
  test('los 4 indicadores pedidos, en orden y sin NaN', () => {
    const s = adminSummary({ users_total: 12, users_confirmed: 10, users_7d: 2, users_30d: 5, organizations_total: 11, workspaces_total: 11, workspaces_active_30d: 4 });
    assert.deepEqual(s.map((x) => x.label), ['Usuarios totales', 'Organizaciones totales', 'Usuarios registrados (7 / 30 días)', 'Workspaces activos']);
    assert.deepEqual(s.map((x) => x.value), [12, 11, '2 / 5', 4]);
    const empty = adminSummary({ users_total: 'abc', users_7d: -1, organizations_total: Infinity });
    for (const x of empty) {
      assert.equal(x.value, null, x.key);
      assert.doesNotMatch(String(x.hint), /NaN|Infinity/);
    }
    assert.equal(adminSummary().length, 4);
  });

  test('filas: rol de empresa en castellano, separado de RATEOS ADMIN', () => {
    const rows = adminRows([
      { full_name: ' Joaquín ', email: 'j@example.com', email_confirmed: true, organization_name: 'DOVA', organization_role: 'OWNER', is_platform_admin: true, organization_members: 1 },
      { full_name: '', email: 'b@example.com', email_confirmed: false, organization_role: 'VIEWER', is_platform_admin: 'true' },
      { organization_role: 'RATEOS_ADMIN' },
    ]);
    assert.equal(rows[0].name, 'Joaquín');
    assert.equal(rows[0].role, 'Dueño/a');
    assert.equal(rows[0].platformAdmin, true);
    assert.equal(rows[1].name, '—');
    assert.equal(rows[1].role, 'Sólo lectura');
    assert.equal(rows[1].emailConfirmed, false);
    assert.equal(rows[1].platformAdmin, false, 'sólo true literal');
    assert.equal(rows[2].role, '—', 'RATEOS_ADMIN no es un rol de empresa');
    assert.deepEqual(adminRows(null), []);
  });

  test('load(): si la base rechaza, no hay datos y el mensaje es el de sin permisos', async () => {
    let usersCalled = false;
    const svc = createAdminService({ overview: async () => ({ ok: false, code: 'forbidden' }), users: async () => { usersCalled = true; return { ok: true, users: [] }; } });
    const res = await svc.load();
    assert.deepEqual(res, { ok: false, code: 'forbidden', message: ADMIN_NO_ACCESS });
    assert.equal(usersCalled, false, 'sin permiso no se pide la lista de usuarios');
    assert.equal(ADMIN_NO_ACCESS, 'No tenés permisos para acceder a esta sección.');
    assert.match(adminErrorMessage('network'), /conexión/);
    assert.match(adminErrorMessage('cualquier cosa'), /Reintentá/);
  });

  test('load(): panel completo con la fecha de la base', async () => {
    const svc = createAdminService({
      overview: async () => ({ ok: true, overview: { users_total: 1, organizations_total: 1, users_7d: 1, users_30d: 1, workspaces_active_30d: 0, generated_at: '2026-10-05T12:00:00Z' } }),
      users: async () => ({ ok: true, users: [{ full_name: 'Ana', organization_role: 'ADMIN' }] }),
    });
    const res = await svc.load();
    assert.equal(res.ok, true);
    assert.equal(res.summary.length, 4);
    assert.equal(res.rows[0].role, 'Administrador/a');
    assert.equal(res.generatedAt, '2026-10-05T12:00:00Z');
    assert.equal(PLATFORM_ADMIN_LABEL, 'RATEOS ADMIN');
  });
});

describe('cuenta: RATEOS_ADMIN separado del rol de empresa', () => {
  async function open(server, id, { withAdmin = true, adminGateway } = {}) {
    return createAccountContext({
      user: { id, email: `${id}@example.com`, fullName: '' },
      workspaceGateway: server.gatewayFor(id),
      adminGateway: adminGateway !== undefined ? adminGateway : withAdmin ? server.adminGatewayFor(id) : null,
      cacheStorage: new SpyStorage(),
    });
  }

  test('OWNER de su empresa y RATEOS_ADMIN a la vez: ninguno reemplaza al otro', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'master', fullName: 'Joaquín', company: 'DOVA' });
    server.admins.add('master');
    const ctx = await open(server, 'master');
    assert.equal(ctx.account.platformAdmin, true);
    assert.equal(ctx.account.role, 'OWNER');
    assert.equal(ctx.account.roleLabel, 'Dueño/a');
    assert.equal(ctx.account.organization.name, 'DOVA');
    assert.equal(canOpenAdmin(ctx), true);
    ctx.dispose();
  });

  test('usuario normal (incluso OWNER): no es admin, no ve el menú ni puede abrir el panel', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'ana', company: 'Norte' });
    const ctx = await open(server, 'ana');
    assert.equal(ctx.account.role, 'OWNER');
    assert.equal(ctx.account.platformAdmin, false);
    assert.equal(canOpenAdmin(ctx), false);
    ctx.dispose();
  });

  test('sin puerta de admin, con error o con excepción: no es admin (y la cuenta abre igual)', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const variants = [
      null,
      { amIPlatformAdmin: async () => ({ ok: false, code: 'network', isAdmin: false }) },
      { amIPlatformAdmin: async () => { throw new Error('boom'); } },
      { amIPlatformAdmin: async () => ({ ok: true, isAdmin: 'true' }) },
    ];
    for (const adminGateway of variants) {
      const ctx = await open(server, 'a', { adminGateway });
      assert.equal(ctx.account.platformAdmin, false);
      assert.equal(ctx.account.role, 'OWNER');
      ctx.dispose();
    }
  });

  test('manipular el frontend no da acceso: la base vuelve a decir que no', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'ana', company: 'Norte' });
    server.addUser({ id: 'master', company: 'DOVA' });
    server.admins.add('master');
    const ctx = await open(server, 'ana');
    // Como si alguien lo cambiara desde DevTools (o con localStorage / metadata).
    ctx.account.platformAdmin = true;
    assert.equal(canOpenAdmin(ctx), true, 'la UI intentaría abrir el panel…');
    const res = await ctx.admin.load();
    assert.deepEqual(res, { ok: false, code: 'forbidden', message: ADMIN_NO_ACCESS }, '…pero la base no entrega nada');
    ctx.dispose();
  });

  test('RATEOS_ADMIN ve metadata de otras empresas, pero su cuenta sigue sin acceso a sus workspaces', async () => {
    const server = createFakeServer();
    const orgNorte = server.addUser({ id: 'ana', company: 'Norte' });
    server.externalSave(orgNorte, { quotes: [{ name: 'Secreta', commercialRate: 999 }] });
    server.addUser({ id: 'master', company: 'DOVA' });
    server.admins.add('master');
    const ctx = await open(server, 'master');
    const res = await ctx.admin.load();
    assert.equal(res.ok, true);
    const norte = res.rows.find((r) => r.organization === 'Norte');
    assert.ok(norte);
    assert.equal(norte.revision, 1);
    assert.doesNotMatch(JSON.stringify(res), /Secreta|999|commercialRate/);
    // Su puerta de workspace sigue limitada a su propia organización (RLS).
    const foreign = await server.gatewayFor('master').loadWorkspace(orgNorte);
    assert.deepEqual(foreign, { ok: false, code: 'not_found' });
    assert.equal((await ctx.quotes.listQuotes()).length, 0);
    ctx.dispose();
  });
});

describe('ruta #/admin y menú condicional', () => {
  test('#/admin existe, requiere sesión y no está en el menú general', () => {
    const route = ROUTES.find((r) => r.name === 'admin');
    assert.ok(route);
    assert.equal(route.access, 'auth');
    assert.equal(matchRoute('#/admin').route.name, 'admin');
    assert.equal(NAV_ITEMS.some((i) => i.key === 'admin' || i.href === '#/admin'), false, 'la entrada no existe para usuarios normales');
    assert.deepEqual({ ...ADMIN_NAV_ITEM }, { key: 'admin', href: '#/admin', label: 'RATEOS Admin', icon: 'lock' });
  });

  test('canOpenAdmin: sólo con platformAdmin === true y el servicio de admin', () => {
    const load = async () => ({});
    assert.equal(canOpenAdmin(null), false);
    assert.equal(canOpenAdmin({}), false);
    assert.equal(canOpenAdmin({ account: { platformAdmin: 'true' }, admin: { load } }), false);
    assert.equal(canOpenAdmin({ account: { platformAdmin: 1 }, admin: { load } }), false);
    assert.equal(canOpenAdmin({ account: { platformAdmin: true }, admin: null }), false, 'demo / sin nube');
    assert.equal(canOpenAdmin({ mode: 'demo', account: { role: 'OWNER' } }), false);
    assert.equal(canOpenAdmin({ account: { platformAdmin: true }, admin: { load } }), true);
  });
});
