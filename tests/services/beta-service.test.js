/**
 * Créditos de prueba y reportes de errores (PLAN-2026-029): gateways,
 * servicios y listas fijas del reporte. La autoridad está en Postgres
 * (supabase/tests/credits_reports_test.sql); acá: contrato del cliente,
 * textos y que nada de lo que se envía lleve datos económicos o ids.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { betaErrorCode, BETA_ERRORS, createBetaGateway, normalizeCredits } from '../../js/data/beta-gateway.js';
import { createAdminGateway } from '../../js/data/admin-gateway.js';
import { createBugReportService, createCreditsService, creditsNotice, reportErrorMessage, reportRow, CREDITS_EXHAUSTED_MESSAGE } from '../../js/services/beta-service.js';
import { adminReportRow, createAdminService, reviewErrorMessage } from '../../js/services/admin-service.js';
import { BUG_CATEGORIES, BUG_SCREENS, BUG_TEXT_MAX, bugScreenFromHash, cleanBugText, validateBugReport } from '../../js/domain/bug-report.js';
import { reportOrigin, reportHrefFrom } from '../../js/ui/views/report-bug.js';
import { matchRoute } from '../../js/ui/router.js';

/** Cliente de Supabase falso: registra cada RPC y responde lo que se le diga. */
function fakeClient(responses = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      const r = responses[name];
      return typeof r === 'function' ? r(args) : r || { data: null, error: { code: 'PGRST202', message: 'Could not find the function', status: 404 } };
    },
  };
}

describe('beta: errores de las RPC', () => {
  test('mensajes propios de la base → códigos; función inexistente → unsupported', () => {
    assert.equal(betaErrorCode({ code: 'P0001', message: 'rateos_report_rate_limited' }), BETA_ERRORS.rateLimited);
    assert.equal(betaErrorCode({ code: 'P0001', message: 'rateos_report_duplicate' }), BETA_ERRORS.duplicate);
    assert.equal(betaErrorCode({ code: 'P0001', message: 'rateos_report_final' }), BETA_ERRORS.final);
    assert.equal(betaErrorCode({ code: '42501', message: 'rateos_report_self_review' }), BETA_ERRORS.selfReview);
    assert.equal(betaErrorCode({ code: 'PGRST202', message: 'Could not find the function public.get_my_credits', status: 404 }), BETA_ERRORS.unsupported);
    assert.equal(betaErrorCode({ code: '42501', message: 'forbidden' }), 'forbidden');
  });

  test('el saldo sólo trae los campos esperados y nunca negativos', () => {
    assert.deepEqual(normalizeCredits({ enabled: true, balance: 7, initial: 10, used: 3, rewarded: 0, report_reward: 2, state: { x: 1 } }), { enabled: true, balance: 7, initial: 10, used: 3, rewarded: 0, reportReward: 2 });
    assert.deepEqual(normalizeCredits({ enabled: false, balance: 5 }), { enabled: false });
    assert.equal(normalizeCredits({ enabled: true, balance: -3 }).balance, 0);
    assert.deepEqual(normalizeCredits(null), { enabled: false });
  });
});

describe('beta: gateway', () => {
  test('cada RPC con su nombre y sus argumentos (la organización la verifica la base)', async () => {
    const client = fakeClient({
      get_my_credits: { data: { enabled: true, balance: 4, initial: 10, used: 6, rewarded: 0, report_reward: 2 }, error: null },
      credit_preview: { data: { enabled: true, balance: 4, chargeable: 2 }, error: null },
      submit_bug_report: { data: { id: 'r1', status: 'received', created_at: 'x', extra: 'no' }, error: null },
      my_bug_reports: { data: [{ id: 'r1', status: 'received', did: 'a', reporter: 'nunca' }], error: null },
    });
    const gw = createBetaGateway(client);
    assert.equal((await gw.credits('org')).credits.balance, 4);
    assert.equal((await gw.preview('org', { quoteIds: ['a'], productIds: [] })).chargeable, 2);
    const sent = await gw.submitReport('org', { category: 'calculo', did: 'd', expected: 'e', happened: 'h', screen: 'inicio', appVersion: '0.9.0' });
    assert.deepEqual(sent.report, { id: 'r1', status: 'received', created_at: 'x' });
    const mine = await gw.myReports('org');
    assert.equal(mine.reports[0].reporter, undefined, 'sólo campos de la lista');
    assert.deepEqual(client.calls.map((c) => c.name), ['get_my_credits', 'credit_preview', 'submit_bug_report', 'my_bug_reports']);
    assert.deepEqual(Object.keys(client.calls[2].args).sort(), ['p_app_version', 'p_category', 'p_did', 'p_expected', 'p_happened', 'p_org', 'p_screen']);
  });

  test('sin la migración aplicada: unsupported y la app sigue (sin créditos ni reportes)', async () => {
    const client = fakeClient();
    const credits = createCreditsService({ gateway: createBetaGateway(client), organizationId: 'org' });
    assert.deepEqual(await credits.status(), { enabled: false });
    assert.deepEqual(await credits.status({ refresh: true }), { enabled: false });
    assert.equal(client.calls.length, 1, 'después de "unsupported" no vuelve a preguntar');
    assert.equal(credits.canCreate(), true);
  });
});

describe('beta: saldo en pantalla', () => {
  test('textos del saldo; con 0, el mensaje decidido por el dueño', () => {
    assert.equal(creditsNotice({ enabled: false }), null);
    const ten = creditsNotice({ enabled: true, balance: 10, reportReward: 2 });
    assert.equal(ten.title, 'Te quedan 10 cálculos nuevos de prueba');
    assert.match(ten.text, /Editar, recalcular, guardar o exportar lo que ya tenés no usa ninguno/);
    assert.match(ten.text, /te sumamos 2/);
    assert.equal(creditsNotice({ enabled: true, balance: 1, reportReward: 2 }).title, 'Te queda 1 cálculo nuevo de prueba');
    const zero = creditsNotice({ enabled: true, balance: 0, reportReward: 2 });
    assert.equal(zero.tone, 'warning');
    assert.equal(zero.text, 'Se agotaron tus cálculos de prueba; podés seguir trabajando con los que ya tenés y enviarnos feedback.');
    assert.equal(CREDITS_EXHAUSTED_MESSAGE, zero.text);
  });

  test('canCreate sólo bloquea con un saldo conocido en 0; el servicio no cambia saldos', async () => {
    let balance = 1;
    const client = fakeClient({ get_my_credits: () => ({ data: { enabled: true, balance, report_reward: 2 }, error: null }) });
    const credits = createCreditsService({ gateway: createBetaGateway(client), organizationId: 'org' });
    assert.equal(credits.canCreate(), true, 'sin saber el saldo no bloquea (decide la base)');
    await credits.status();
    assert.equal(credits.canCreate(), true);
    balance = 0;
    await credits.status({ refresh: true });
    assert.equal(credits.canCreate(), false);
    assert.ok(client.calls.every((c) => c.name === 'get_my_credits'), 'nunca llama a otra cosa');
  });

  test('demo y modo local: sin créditos', async () => {
    const credits = createCreditsService();
    assert.deepEqual(await credits.status(), { enabled: false });
    assert.deepEqual(await credits.preview({ quoteIds: ['a'] }), { enabled: false, chargeable: 0 });
  });
});

describe('beta: reporte de errores', () => {
  test('listas fijas: las claves coinciden con las de la base', () => {
    assert.deepEqual(BUG_CATEGORIES.map((c) => c.id), ['calculo', 'guardado', 'pdf', 'cuenta', 'pantalla', 'otro']);
    const server = ['inicio', 'nuevo', 'cotizacion', 'resultado', 'escenarios', 'cotizaciones', 'productos', 'producto', 'recursos', 'plantillas', 'configuracion', 'cuenta', 'registro', 'pdf', 'reportar', 'otra'];
    BUG_SCREENS.forEach((s) => assert.ok(server.includes(s.id), s.id));
  });

  test('la pantalla sale del hash SIN ids ni parámetros', () => {
    const id = '7d0b1f0e-0000-4000-8000-123456789abc';
    assert.equal(bugScreenFromHash(`#/cotizaciones/${id}/resultado`), 'resultado');
    assert.equal(bugScreenFromHash(`#/cotizaciones/${id}/labor`), 'cotizacion');
    assert.equal(bugScreenFromHash('#/cotizaciones'), 'cotizaciones');
    assert.equal(bugScreenFromHash('#/cotizaciones/nueva'), 'nuevo');
    assert.equal(bugScreenFromHash(`#/productos/${id}/precio`), 'producto');
    assert.equal(bugScreenFromHash('#/recursos/equipos?x=1'), 'recursos');
    assert.equal(bugScreenFromHash('#/configuracion/cuenta'), 'cuenta');
    assert.equal(bugScreenFromHash('#/servicios'), 'plantillas');
    assert.equal(bugScreenFromHash('#/algo-raro'), 'otra');
    assert.ok(!reportHrefFrom(`#/cotizaciones/${id}/resultado`).includes(id));
    assert.equal(reportOrigin('#/reportar?desde=resultado'), 'resultado');
    assert.equal(reportOrigin('#/reportar?desde=<script>'), 'otra');
    assert.equal(matchRoute('#/reportar?desde=inicio').route.name, 'report');
  });

  test('validación: categoría, 3 a 2000 caracteres y texto limpio', () => {
    assert.equal(cleanBugText('  hola\u0007 mundo\n  '), 'hola mundo');
    assert.equal(cleanBugText('línea 1\nlínea 2\tfin'), 'línea 1\nlínea 2\tfin');
    const bad = validateBugReport({ category: 'hack', did: 'a', expected: 'x'.repeat(BUG_TEXT_MAX + 1), happened: '', screen: 'cotizaciones/123' });
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['category', 'did', 'expected', 'happened']);
    assert.equal(bad.report.screen, 'otra');
    const good = validateBugReport({ category: 'calculo', did: 'Cargué 20 días', expected: 'Margen 20 %', happened: 'Dio 35 %', screen: 'resultado' });
    assert.equal(good.ok, true);
  });

  test('el envío lleva sólo texto, dos claves y la versión; errores con textos claros', async () => {
    const client = fakeClient({
      submit_bug_report: (args) => (args.p_did.includes('repetido')
        ? { data: null, error: { code: 'P0001', message: 'rateos_report_duplicate' } }
        : { data: { id: 'r1', status: 'received' }, error: null }),
      my_bug_reports: { data: [{ id: 'r1', created_at: 'x', category: 'calculo', screen: 'resultado', status: 'approved', credits_added: 2, review_note: 'Confirmado', mine: true, did: 'a', expected: 'b', happened: 'c' }], error: null },
    });
    const service = createBugReportService({ gateway: createBetaGateway(client), organizationId: 'org', appVersion: '0.9.0' });
    const invalid = await service.submit({ category: 'calculo', did: 'a' });
    assert.equal(invalid.ok, false);
    assert.equal(client.calls.length, 0, 'lo inválido no se envía');
    const ok = await service.submit({ category: 'calculo', did: 'Cargué 20 días', expected: 'Margen 20 %', happened: 'Dio 35 %', screen: 'resultado', costo: 999999, quoteId: 'q-1' });
    assert.equal(ok.ok, true);
    assert.deepEqual(client.calls[0].args, { p_org: 'org', p_category: 'calculo', p_did: 'Cargué 20 días', p_expected: 'Margen 20 %', p_happened: 'Dio 35 %', p_screen: 'resultado', p_app_version: '0.9.0' });
    const dup = await service.submit({ category: 'calculo', did: 'texto repetido', expected: 'Margen 20 %', happened: 'Dio 35 %', screen: 'resultado' });
    assert.equal(dup.message, reportErrorMessage(BETA_ERRORS.duplicate));
    const list = await service.list();
    assert.equal(list.rows[0].statusLabel, 'Validado y aprobado (+2)');
    assert.equal(list.rows[0].reviewNote, 'Confirmado');
  });

  test('estados para la empresa', () => {
    assert.equal(reportRow({ status: 'received' }).statusLabel, 'Recibido');
    assert.equal(reportRow({ status: 'in_review' }).statusLabel, 'En revisión');
    assert.equal(reportRow({ status: 'rejected' }).statusLabel, 'No corresponde');
    assert.equal(reportRow({ status: 'duplicate' }).statusLabel, 'Duplicado');
    assert.equal(reportRow({ status: 'approved', credits_added: 0 }).statusLabel, 'Validado y aprobado');
  });
});

describe('beta: cola de RATEOS ADMIN', () => {
  test('la cola trae el texto del reporte y metadata, nunca el workspace', async () => {
    const client = fakeClient({
      admin_bug_reports: { data: [{ id: 'abcdef12-0000', status: 'in_review', organization_name: 'Tester A', reporter_email: 'a@rateos.invalid', did: 'a', expected: 'b', happened: 'c', org_quota_enabled: true, org_balance: 0, similar_reports: 1, history: [{ at: 'x', actor: 'adm@rateos.invalid', from: 'received', to: 'in_review' }], state: { quotes: [] } }], error: null },
      admin_credit_accounts: { data: [{ organization_name: 'Tester A', enabled: true, balance: 0, used: 10, rewarded: 0, initial: 10, adjusted: 0 }], error: null },
      admin_review_bug_report: (args) => (args.p_status === 'rejected'
        ? { data: null, error: { code: 'P0001', message: 'rateos_report_final' } }
        : { data: { status: 'approved', already: false, credits_added: 2, balance: 2 }, error: null }),
    });
    const service = createAdminService(createAdminGateway(client));
    const res = await service.loadReports('open');
    assert.equal(res.ok, true);
    assert.equal(res.rows[0].ref, 'abcdef12');
    assert.equal(res.rows[0].history[0].to, 'En revisión');
    assert.ok(!JSON.stringify(res).includes('quotes'), 'el gateway no deja pasar campos fuera de la lista');
    assert.equal(client.calls[0].args.p_status, 'open');
    const approved = await service.reviewReport('abcdef12-0000', { status: 'approved' });
    assert.equal(approved.creditsAdded, 2);
    const final = await service.reviewReport('abcdef12-0000', { status: 'rejected' });
    assert.equal(final.message, reviewErrorMessage(BETA_ERRORS.final));
    assert.equal(adminReportRow({ status: 'approved' }).final, true);
  });
});
