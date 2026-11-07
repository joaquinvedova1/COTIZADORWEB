/**
 * "Reportar un problema" (PLAN-2026-020): el reporte lleva sólo lo escrito y
 * contexto técnico; nunca ids, montos ni datos de la cuenta.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute } from '../../js/ui/router.js';
import {
  buildReportPayload,
  createFeedbackService,
  describeLocation,
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

describe('buildReportPayload / reportText / githubIssueUrl', () => {
  const location = { label: 'Cotización › Equipos', route: '/cotizaciones/:id/equipment' };
  const version = { version: '0.8.1', commit: 'abc1234', buildDate: '2026-11-07' };
  const tech = { browser: 'Mozilla/5.0 Test', viewport: '1280×800', language: 'es-AR' };

  test('limpia caracteres de control, recorta y sólo manda campos conocidos', () => {
    const p = buildReportPayload({ whatHappened: '  No avanza\u0007 al tocar Siguiente  ', expected: 'x'.repeat(5000) }, { location, version, mode: 'cuenta', tech });
    assert.equal(p.what_happened, 'No avanza al tocar Siguiente');
    assert.equal(p.expected.length, 2000);
    assert.deepEqual(Object.keys(p).sort(), ['app_commit', 'app_version', 'browser', 'context', 'expected', 'route', 'viewport', 'what_happened', 'where_label'].sort());
    assert.deepEqual(p.context, { mode: 'cuenta', language: 'es-AR' });
    assert.equal(buildReportPayload({ whatHappened: 'abcde' }, { location, mode: 'otro' }).context.mode, 'cuenta');
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

  test('envía por la RPC, devuelve la referencia y avisa al puente de GitHub con el id', async () => {
    const client = fakeClient({ rpcResult: { data: { id: ID, reference: 'R-0B6F5C' }, error: null } });
    const service = createFeedbackService(createFeedbackGateway(client));
    const res = await service.submit({ what_happened: 'No avanza', context: {} });
    assert.deepEqual(res, { ok: true, message: null, reference: 'R-0B6F5C' });
    assert.equal(client.calls.rpc[0].name, 'submit_bug_report');
    assert.equal(client.calls.rpc[0].args.p_report.what_happened, 'No avanza');
    assert.deepEqual(client.calls.invoke, [{ name: 'bug-report-github', opts: { body: { id: ID } } }]);
  });

  test('si el puente a GitHub falla, el reporte igual figura como recibido', async () => {
    const client = fakeClient({ rpcResult: { data: { id: ID, reference: 'R-0B6F5C' }, error: null }, invoke: () => Promise.reject(new Error('down')) });
    const res = await createFeedbackService(createFeedbackGateway(client)).submit({ what_happened: 'No avanza' });
    assert.equal(res.ok, true);
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

  test('una respuesta con id o referencia inválidos no dispara el puente', async () => {
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
});
