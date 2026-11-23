/**
 * "Reportar un problema" (PLAN-2026-020): el reporte lleva sólo lo escrito y
 * contexto técnico; nunca ids, montos ni datos de la cuenta.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute } from '../../js/ui/router.js';
import {
  REPORT_KINDS,
  buildReportPayload,
  createFeedbackService,
  describeLocation,
  defaultStep,
  stepOptions,
  STEP_OTHER,
  STEP_GENERAL,
  feedbackErrorMessage,
  githubIssueUrl,
  reportText,
  technicalContext,
  validateReport,
} from '../../js/services/feedback-service.js';
import { createFeedbackGateway, feedbackErrorCode } from '../../js/data/feedback-gateway.js';

describe('describeLocation', () => {
  test('cotización en un paso: título › paso, y la ruta sin el id real', () => {
    const loc = describeLocation(matchRoute('#/cotizaciones/q_8f3a2b91/equipment'));
    assert.equal(loc.label, 'Cotización › Equipos');
    assert.equal(loc.route, '/cotizaciones/:id/equipment');
    assert.ok(!loc.route.includes('8f3a'));
  });

  test('pestañas fijas sí se conservan; la landing tiene nombre', () => {
    assert.equal(describeLocation(matchRoute('#/configuracion/convenios')).route, '/configuracion/convenios');
    assert.equal(describeLocation(matchRoute('#/')).label, 'Página principal');
    assert.equal(describeLocation(null).label, 'Pantalla desconocida');
  });

  test('un paso con forma rara no se manda', () => {
    const loc = describeLocation(matchRoute('#/cotizaciones/abc/Equipos%20YPF'));
    assert.equal(loc.route, '/cotizaciones/:id/:step');
  });
});

describe('¿En qué paso fue?', () => {
  test('ofrece los 11 pasos y dos opciones generales; sugiere el paso actual', () => {
    const opts = stepOptions();
    assert.equal(opts.length, 13);
    assert.equal(opts[1].value, 'Personal'); // los recursos van antes que "Cómo se cobra" (PLAN-2026-025)
    assert.equal(defaultStep(describeLocation(matchRoute('#/cotizaciones/q_1/labor'))), 'Personal');
    assert.equal(defaultStep(describeLocation(matchRoute('#/configuracion/convenios'))), STEP_OTHER);
    assert.equal(defaultStep(describeLocation(matchRoute('#/'))), STEP_GENERAL);
  });

  test('el paso elegido viaja en el reporte y en el texto', () => {
    const p = buildReportPayload({ whatHappened: 'No entiendo días disponibles', step: 'Cómo se cobra' }, { location: { label: 'Cotización › Cómo se cobra', route: '/cotizaciones/:id/modality' } });
    assert.equal(p.step, 'Cómo se cobra');
    assert.match(reportText(p), /Paso que eligió: Cómo se cobra/);
  });
});

describe('buildReportPayload / reportText / githubIssueUrl', () => {
  const location = { label: 'Cotización › Equipos', route: '/cotizaciones/:id/equipment' };
  const version = { version: '0.8.1', commit: 'abc1234', buildDate: '2026-11-07' };
  const tech = { browser: 'Mozilla/5.0 Test', viewport: '1280×800', language: 'es-AR' };

  test('limpia caracteres de control, recorta y sólo manda campos conocidos', () => {
    const p = buildReportPayload({ whatHappened: '  No avanza\u0007 al tocar Siguiente  ', expected: 'x'.repeat(5000) }, { location, version, mode: 'cuenta', tech });
    assert.equal(p.what_happened, 'No avanza al tocar Siguiente');
    assert.equal(p.expected.length, 2000);
    assert.deepEqual(Object.keys(p).sort(), ['app_commit', 'app_version', 'browser', 'context', 'expected', 'kind', 'route', 'step', 'viewport', 'what_happened', 'where_label'].sort());
    assert.deepEqual(p.context, { mode: 'cuenta', language: 'es-AR', kind: 'error' });
    assert.equal(p.kind, 'error');
    assert.equal(buildReportPayload({ whatHappened: 'abcde' }, { location, mode: 'otro' }).context.mode, 'cuenta');
  });

  test('el tipo elegido viaja en el reporte; un tipo raro cae en "Algo no funciona"', () => {
    const p = buildReportPayload({ whatHappened: 'El total me da el doble', kind: 'calculo' }, { location, version, mode: 'cuenta', tech });
    assert.equal(p.kind, 'calculo');
    assert.equal(p.context.kind, 'calculo');
    assert.match(reportText(p), /Tipo: Un cálculo no me cierra/);
    assert.equal(buildReportPayload({ whatHappened: 'abcde', kind: '<script>' }, { location }).kind, 'error');
    assert.equal(REPORT_KINDS.length, 5);
    assert.deepEqual(REPORT_KINDS.map((k) => k.value), ['error', 'calculo', 'texto', 'no_encuentro', 'sugerencia']);
  });

  test('el texto del informe incluye lo escrito y el contexto', () => {
    const p = buildReportPayload({ whatHappened: 'No avanza', expected: '' }, { location, version, mode: 'demo', tech });
    const text = reportText(p);
    assert.match(text, /> No avanza/);
    assert.match(text, /Cotización › Equipos/);
    assert.match(text, /0\.8\.1 · build abc1234/);
    assert.match(text, /Modo: demo/);
  });

  test('URL de GitHub con plantilla, label y título', () => {
    const p = buildReportPayload({ whatHappened: 'No avanza al tocar Siguiente' }, { location, version, mode: 'publico', tech });
    const url = new URL(githubIssueUrl(p));
    assert.equal(url.origin + url.pathname, 'https://github.com/joaquinvedova1/COTIZADORWEB/issues/new');
    assert.equal(url.searchParams.get('template'), 'reporte-app.yml');
    assert.equal(url.searchParams.get('title'), '[Reporte] No avanza al tocar Siguiente');
    assert.equal(url.searchParams.get('que-paso'), 'No avanza al tocar Siguiente');
    assert.match(url.searchParams.get('donde'), /Cotización › Equipos/);
    assert.match(url.searchParams.get('version'), /0\.8\.1 · build abc1234 · publico/);
  });

  test('validación: al menos 5 letras', () => {
    assert.equal(validateReport({ whatHappened: ' no ' }).ok, false);
    assert.equal(validateReport({ whatHappened: 'no anda' }).ok, true);
  });

  test('contexto técnico sin datos raros', () => {
    const t = technicalContext({ navigator: { userAgent: 'UA', language: 'es-AR' }, innerWidth: 390.4, innerHeight: 844 });
    assert.deepEqual(t, { browser: 'UA', viewport: '390×844', language: 'es-AR' });
    assert.deepEqual(technicalContext({}), { browser: '', viewport: '', language: '' });
  });
});

describe('gateway y servicio', () => {
  const fakeClient = ({ rpcResult, invoke } = {}) => {
    const calls = { rpc: [], invoke: [] };
    return {
      calls,
      rpc: async (name, args) => {
        calls.rpc.push({ name, args });
        return typeof rpcResult === 'function' ? rpcResult(name, args) : rpcResult;
      },
      functions: {
        invoke: async (name, opts) => {
          calls.invoke.push({ name, opts });
          if (invoke) return invoke();
          return { data: { ok: true }, error: null };
        },
      },
    };
  };
  const ID = '0b6f5c1e-1234-4abc-8def-1234567890ab';

  test('envía por la RPC y devuelve la referencia; nunca publica en GitHub (S-04)', async () => {
    const client = fakeClient({ rpcResult: { data: { id: ID, reference: 'R-0B6F5C' }, error: null } });
    const service = createFeedbackService(createFeedbackGateway(client));
    const res = await service.submit({ what_happened: 'No avanza', context: {} });
    assert.deepEqual(res, { ok: true, message: null, reference: 'R-0B6F5C' });
    assert.equal(client.calls.rpc[0].name, 'submit_bug_report');
    assert.equal(client.calls.rpc[0].args.p_report.what_happened, 'No avanza');
    assert.deepEqual(client.calls.invoke, []);
  });

  test('sin sesión va por la Edge Function bug-report-submit (sin RPC ni puente a GitHub)', async () => {
    const client = fakeClient({ invoke: () => ({ data: { ok: true, id: ID, reference: 'R-0B6F5C' }, error: null }) });
    const res = await createFeedbackService(createFeedbackGateway(client)).submit({ what_happened: 'No avanza', step: 'Personal' }, { signedIn: false });
    assert.deepEqual(res, { ok: true, message: null, reference: 'R-0B6F5C' });
    assert.equal(client.calls.rpc.length, 0);
    assert.equal(client.calls.invoke.length, 1);
    assert.equal(client.calls.invoke[0].name, 'bug-report-submit');
    assert.equal(client.calls.invoke[0].opts.body.report.step, 'Personal');
  });

  test('sin sesión: límite (429) y caída de red con mensajes claros', async () => {
    const limited = fakeClient({ invoke: () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 429 } } }) });
    const r1 = await createFeedbackService(createFeedbackGateway(limited)).submit({ what_happened: 'No avanza' }, { signedIn: false });
    assert.equal(r1.ok, false);
    assert.equal(r1.rateLimited, true);
    const down = fakeClient({ invoke: () => ({ data: null, error: { name: 'FunctionsFetchError' } }) });
    const r2 = await createFeedbackService(createFeedbackGateway(down)).submit({ what_happened: 'No avanza' }, { signedIn: false });
    assert.equal(r2.ok, false);
    assert.match(r2.message, /conectarnos/);
  });

  test('errores: límite, red y sesión con mensajes en español; nada de detalles de Postgres', async () => {
    assert.equal(feedbackErrorCode({ code: '54000', message: 'rate_limited' }), 'rate_limited');
    assert.equal(feedbackErrorCode({ code: '42501' }), 'forbidden');
    const client = fakeClient({ rpcResult: { data: null, error: { code: '54000', message: 'rate_limited' } } });
    const res = await createFeedbackService(createFeedbackGateway(client)).submit({ what_happened: 'No avanza' });
    assert.equal(res.ok, false);
    assert.match(res.message, /varios reportes seguidos/);
    assert.equal(res.rateLimited, true);
    assert.equal(client.calls.invoke.length, 0);
    assert.match(feedbackErrorMessage('network'), /conexión/);
    assert.doesNotMatch(feedbackErrorMessage('unknown'), /postgres|54000/i);
  });

  test('no llama a la base si el texto es muy corto', async () => {
    const client = fakeClient({ rpcResult: { data: null, error: null } });
    const res = await createFeedbackService(createFeedbackGateway(client)).submit({ what_happened: 'no' });
    assert.equal(res.ok, false);
    assert.equal(client.calls.rpc.length, 0);
  });

  test('una respuesta con referencia inválida no se muestra', async () => {
    const client = fakeClient({ rpcResult: { data: { id: 'x', reference: '<b>' }, error: null } });
    const res = await createFeedbackService(createFeedbackGateway(client)).submit({ what_happened: 'No avanza' });
    assert.deepEqual(res, { ok: true, message: null, reference: null });
    assert.equal(client.calls.invoke.length, 0);
  });

  test('admin: sólo los campos previstos', async () => {
    const client = fakeClient({ rpcResult: { data: [{ reference: 'R-AAAAAA', what_happened: 'x', reporter_id: 'secreto', email: 'a@b' }], error: null } });
    const res = await createFeedbackService(createFeedbackGateway(client)).listForAdmin();
    assert.deepEqual(res.reports, [{ reference: 'R-AAAAAA', what_happened: 'x' }]);
  });

  test('admin: seguimiento por la RPC, sólo campos previstos y id válido', async () => {
    const client = fakeClient({ rpcResult: { data: { id: ID, status: 'resuelto' }, error: null } });
    const service = createFeedbackService(createFeedbackGateway(client));
    const res = await service.updateForAdmin(ID, { status: 'resuelto', fixed_in_version: '0.22.0', severity: '', reporter_id: 'x' });
    assert.equal(res.ok, true);
    assert.equal(client.calls.rpc[0].name, 'admin_update_bug_report');
    assert.deepEqual(client.calls.rpc[0].args, { p_id: ID, p_changes: { status: 'resuelto', fixed_in_version: '0.22.0', severity: '' } });
    const bad = await service.updateForAdmin('no-es-uuid', { status: 'resuelto' });
    assert.equal(bad.ok, false);
    assert.equal(client.calls.rpc.length, 1);
  });

  test('admin: sin la migración de seguimiento avisa qué falta', async () => {
    const client = fakeClient({ rpcResult: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } });
    const res = await createFeedbackService(createFeedbackGateway(client)).updateForAdmin(ID, { status: 'resuelto' });
    assert.equal(res.ok, false);
    assert.match(res.message, /migración/);
  });
});
