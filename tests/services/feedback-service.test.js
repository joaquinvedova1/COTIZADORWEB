/**
 * Feedback de la beta (PLAN-2026-029): gateways, servicios, listas fijas,
 * pantalla e invitación después de exportar. La autoridad está en Postgres
 * (supabase/tests/feedback_test.sql); acá: contrato del cliente, textos y
 * que nada de lo que se envía lleve datos económicos o ids. Sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { feedbackErrorCode, FEEDBACK_ERRORS, createFeedbackGateway } from '../../js/data/feedback-gateway.js';
import { createAdminGateway } from '../../js/data/admin-gateway.js';
import { createFeedbackService, feedbackErrorMessage, feedbackRow, FEEDBACK_THANKS } from '../../js/services/feedback-service.js';
import { adminFeedbackRow, createAdminService, reviewErrorMessage } from '../../js/services/admin-service.js';
import {
  FEEDBACK_CATEGORIES, FEEDBACK_KINDS, FEEDBACK_REVIEW_STATUSES, FEEDBACK_SCREENS, FEEDBACK_STATUS_IDS, FEEDBACK_TEXT_MAX,
  cleanFeedbackText, feedbackKindFromParam, feedbackScreenFromHash, feedbackStatus, validateFeedback,
} from '../../js/domain/feedback.js';
import { feedbackParams, FEEDBACK_INTRO } from '../../js/ui/views/feedback.js';
import { claimInvite, shouldInvite, snoozeInvite, INVITE_EVERY_DAYS, INVITE_SNOOZE_DAYS } from '../../js/services/feedback-invite-policy.js';
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

/** localStorage en memoria (y uno que falla, como en una ventana privada estricta). */
function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}
const brokenStorage = { getItem: () => { throw new Error('denegado'); }, setItem: () => { throw new Error('denegado'); } };

describe('feedback: errores de las RPC', () => {
  test('mensajes propios de la base → códigos; función inexistente → unsupported', () => {
    assert.equal(feedbackErrorCode({ message: 'rateos_feedback_rate_limited' }), FEEDBACK_ERRORS.rateLimited);
    assert.equal(feedbackErrorCode({ message: 'rateos_feedback_duplicate' }), FEEDBACK_ERRORS.duplicate);
    assert.equal(feedbackErrorCode({ message: 'rateos_feedback_too_many_open' }), FEEDBACK_ERRORS.tooManyOpen);
    assert.equal(feedbackErrorCode({ message: 'rateos_feedback_invalid' }), FEEDBACK_ERRORS.invalid);
    assert.equal(feedbackErrorCode({ message: 'rateos_feedback_not_found' }), FEEDBACK_ERRORS.notFound);
    assert.equal(feedbackErrorCode({ code: 'PGRST202', message: 'Could not find the function public.submit_feedback' }), FEEDBACK_ERRORS.unsupported);
    assert.equal(feedbackErrorCode(null), null);
  });
});

describe('feedback: listas fijas, estados y pantalla', () => {
  test('las claves coinciden con las de la base', () => {
    assert.deepEqual(FEEDBACK_KINDS.map((k) => k.id), ['problem', 'suggestion']);
    assert.deepEqual(FEEDBACK_CATEGORIES.map((c) => c.id), ['calculo', 'guardado', 'pdf', 'cuenta', 'pantalla', 'otro']);
    const server = ['inicio', 'nuevo', 'cotizacion', 'resultado', 'escenarios', 'cotizaciones', 'productos', 'producto', 'recursos', 'plantillas', 'configuracion', 'cuenta', 'registro', 'pdf', 'otra'];
    assert.deepEqual(FEEDBACK_SCREENS.map((s) => s.id).sort(), [...server].sort());
    assert.deepEqual(FEEDBACK_STATUS_IDS, ['received', 'in_review', 'confirmed', 'resolved', 'not_applicable', 'duplicate']);
    assert.deepEqual(FEEDBACK_REVIEW_STATUSES, ['in_review', 'confirmed', 'resolved', 'not_applicable', 'duplicate']);
  });

  test('estados: los del dueño para un problema; en una sugerencia, sin implicar promesas ni premios', () => {
    assert.deepEqual(FEEDBACK_STATUS_IDS.map((s) => feedbackStatus(s, 'problem').label), ['Recibido', 'En revisión', 'Confirmado', 'Resuelto', 'No corresponde', 'Duplicado']);
    assert.deepEqual(FEEDBACK_STATUS_IDS.map((s) => feedbackStatus(s, 'suggestion').label), ['Recibida', 'En revisión', 'La tenemos en cuenta', 'Ya está disponible', 'No corresponde', 'Duplicada']);
    const all = FEEDBACK_STATUS_IDS.flatMap((s) => [feedbackStatus(s, 'problem').label, feedbackStatus(s, 'suggestion').label]).join(' ');
    assert.doesNotMatch(all, /\+|crédito|premio|aprobado/i);
    assert.equal(feedbackStatus('approved').label, 'Recibido', 'un estado desconocido no se inventa');
  });

  test('la pantalla sale del hash SIN ids ni parámetros; la ruta y sus parámetros', () => {
    const id = '7d0b1f0e-0000-4000-8000-123456789abc';
    assert.equal(feedbackScreenFromHash(`#/cotizaciones/${id}/result`), 'resultado');
    assert.equal(feedbackScreenFromHash(`#/cotizaciones/${id}/labor`), 'cotizacion');
    assert.equal(feedbackScreenFromHash('#/cotizaciones'), 'cotizaciones');
    assert.equal(feedbackScreenFromHash('#/cotizaciones/nueva'), 'nuevo');
    assert.equal(feedbackScreenFromHash(`#/productos/${id}/precio`), 'producto');
    assert.equal(feedbackScreenFromHash('#/recursos/equipos?x=1'), 'recursos');
    assert.equal(feedbackScreenFromHash('#/configuracion/cuenta'), 'cuenta');
    assert.equal(feedbackScreenFromHash('#/algo-raro'), 'otra');
    assert.equal(matchRoute('#/mejorar?tipo=sugerencia').route.name, 'feedback');
    assert.deepEqual(feedbackParams('#/mejorar?tipo=sugerencia&desde=resultado'), { kind: 'suggestion', screen: 'resultado', about: false });
    assert.deepEqual(feedbackParams('#/mejorar?desde=<script>&acerca=1'), { kind: 'problem', screen: 'otra', about: true });
    assert.equal(feedbackKindFromParam('problema'), 'problem');
    assert.equal(matchRoute('#/reportar').route.name, 'not-found', 'la ruta vieja de reportes ya no existe');
  });

  test('textos para la empresa: pedido breve y agradecimiento sin promesas', () => {
    assert.match(FEEDBACK_INTRO, /Revisamos cada comentario/);
    assert.equal(FEEDBACK_THANKS, 'Gracias por ayudarnos a mejorar RATEOS. Recibimos tu comentario y vas a poder seguir su estado acá abajo.');
    assert.doesNotMatch(`${FEEDBACK_INTRO} ${FEEDBACK_THANKS}`, /premio|beneficio|crédito|gratis para siempre/i);
  });
});

describe('feedback: validación', () => {
  test('un solo campo obligatorio; lo demás opcional y con tope; texto limpio', () => {
    assert.equal(cleanFeedbackText('  hola\u0007 mundo\n  '), 'hola mundo');
    assert.equal(cleanFeedbackText('línea 1\nlínea 2\tfin'), 'línea 1\nlínea 2\tfin');
    assert.equal(cleanFeedbackText('pago​‮ ok\u0085﻿'), 'pago ok', 'sin invisibles ni controles de dirección');
    const bad = validateFeedback({ kind: 'problem', message: 'a', details: 'x'.repeat(FEEDBACK_TEXT_MAX + 1), screen: 'cotizaciones/123', category: 'hack' });
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['details', 'message']);
    assert.equal(bad.feedback.screen, 'otra');
    assert.equal(bad.feedback.category, 'otro');
    const onlyMessage = validateFeedback({ kind: 'problem', message: 'El total no cambió' });
    assert.equal(onlyMessage.ok, true);
    assert.equal(onlyMessage.feedback.details, null);
    assert.equal(onlyMessage.feedback.expected, null);
    const suggestion = validateFeedback({ kind: 'suggestion', message: 'Ordenar por cliente', expected: 'no va', details: '  ' });
    assert.equal(suggestion.ok, true);
    assert.equal(suggestion.feedback.expected, null, 'una sugerencia no lleva "qué esperabas"');
    assert.equal(suggestion.feedback.details, null);
    assert.match(validateFeedback({ kind: 'suggestion', message: '' }).errors.message, /idea/);
  });
});

describe('feedback: envío y "Comentarios de tu empresa"', () => {
  test('el envío lleva sólo texto, dos claves y la versión; errores con textos claros', async () => {
    const client = fakeClient({
      submit_feedback: (args) => (args.p_message.includes('repetido')
        ? { data: null, error: { code: 'P0001', message: 'rateos_feedback_duplicate' } }
        : { data: { id: 'f1', kind: args.p_kind, status: 'received' }, error: null }),
      my_feedback: { data: [{ id: 'f1', created_at: 'x', kind: 'problem', category: 'calculo', screen: 'resultado', status: 'resolved', response: 'Corregido', mine: true, message: 'Dio 35 %', details: 'Cargué 20 días', expected: 'Margen 20 %', state: { quotes: [] } }], error: null },
    });
    const service = createFeedbackService({ gateway: createFeedbackGateway(client), organizationId: 'org', appVersion: '0.9.0' });
    const invalid = await service.submit({ kind: 'problem', message: 'a' });
    assert.equal(invalid.ok, false);
    assert.equal(client.calls.length, 0, 'lo inválido no se envía');
    const ok = await service.submit({ kind: 'problem', message: 'Dio 35 %', details: 'Cargué 20 días', expected: 'Margen 20 %', screen: 'resultado', category: 'calculo', costo: 999999, quoteId: 'q-1' });
    assert.equal(ok.ok, true);
    assert.deepEqual(client.calls[0], { name: 'submit_feedback', args: { p_org: 'org', p_kind: 'problem', p_category: 'calculo', p_message: 'Dio 35 %', p_details: 'Cargué 20 días', p_expected: 'Margen 20 %', p_screen: 'resultado', p_app_version: '0.9.0' } });
    const dup = await service.submit({ kind: 'suggestion', message: 'texto repetido' });
    assert.equal(dup.message, feedbackErrorMessage(FEEDBACK_ERRORS.duplicate));
    assert.equal(client.calls[1].args.p_expected, null);
    const list = await service.list();
    assert.equal(list.rows[0].statusLabel, 'Resuelto');
    assert.equal(list.rows[0].response, 'Corregido');
    assert.ok(!JSON.stringify(list).includes('quotes'), 'el gateway no deja pasar campos fuera de la lista');
  });

  test('sin la migración aplicada o en la demo: unsupported y la app sigue', async () => {
    const service = createFeedbackService({ gateway: createFeedbackGateway(fakeClient()), organizationId: 'org' });
    const res = await service.submit({ kind: 'problem', message: 'Algo pasó' });
    assert.equal(res.code, FEEDBACK_ERRORS.unsupported);
    const demo = createFeedbackService();
    assert.equal(demo.supported, false);
    assert.equal((await demo.list()).ok, false);
  });

  test('filas: tipo y estado por tipo, respuesta sólo si hay texto', () => {
    assert.equal(feedbackRow({ kind: 'suggestion', status: 'confirmed' }).statusLabel, 'La tenemos en cuenta');
    assert.equal(feedbackRow({ kind: 'problem', status: 'confirmed' }).statusLabel, 'Confirmado');
    assert.equal(feedbackRow({ status: 'received', response: '   ' }).response, null);
    assert.equal(feedbackRow({ kind: 'suggestion' }).kindLabel, 'Sugerencia');
  });
});

describe('feedback: cola de RATEOS ADMIN', () => {
  test('la cola trae el texto y metadata, nunca el workspace; la revisión no suma ni descuenta nada', async () => {
    const client = fakeClient({
      admin_feedback: { data: [{ id: 'abcdef12-0000', kind: 'suggestion', status: 'in_review', organization_name: 'Empresa A', author_email: 'a@rateos.invalid', message: 'Ordenar por cliente', details: 'Para encontrar rápido', similar_count: 1, history: [{ at: 'x', actor: 'adm@rateos.invalid', from: 'received', to: 'in_review', response: null }], state: { quotes: [] } }], error: null },
      admin_review_feedback: (args) => (args.p_status === 'received'
        ? { data: null, error: { code: 'P0001', message: 'rateos_feedback_invalid' } }
        : { data: { status: args.p_status, changed: true }, error: null }),
    });
    const service = createAdminService(createAdminGateway(client));
    const res = await service.loadFeedback({ status: 'open', kind: 'suggestion' });
    assert.equal(res.ok, true);
    assert.equal(res.rows[0].ref, 'abcdef12');
    assert.equal(res.rows[0].history[0].to, 'En revisión');
    assert.equal(res.rows[0].kindLabel, 'Sugerencia');
    assert.ok(!JSON.stringify(res).includes('quotes'), 'el gateway no deja pasar campos fuera de la lista');
    assert.deepEqual(client.calls[0].args, { p_status: 'open', p_kind: 'suggestion' });
    const resolved = await service.reviewFeedback('abcdef12-0000', { status: 'resolved', response: 'Ya está' });
    assert.deepEqual(resolved, { ok: true, status: 'resolved', changed: true });
    assert.deepEqual(client.calls[1].args, { p_feedback: 'abcdef12-0000', p_status: 'resolved', p_response: 'Ya está', p_duplicate_of: null });
    const invalid = await service.reviewFeedback('abcdef12-0000', { status: 'received' });
    assert.equal(invalid.message, reviewErrorMessage(FEEDBACK_ERRORS.invalid));
    assert.equal(adminFeedbackRow({ status: 'confirmed' }).open, true);
    assert.equal(adminFeedbackRow({ status: 'resolved' }).open, false);
  });
});

describe('feedback: invitación después de exportar', () => {
  test('se muestra una vez cada 14 días; "Ahora no" la esconde 60; sin almacenamiento, no aparece', () => {
    const day = 24 * 60 * 60 * 1000;
    const storage = memoryStorage();
    const now = Date.UTC(2026, 9, 22);
    assert.equal(shouldInvite({ storage, now }), true);
    storage.setItem('rateos.feedbackInvite.v1', JSON.stringify({ shownAt: now }));
    assert.equal(shouldInvite({ storage, now: now + (INVITE_EVERY_DAYS - 1) * day }), false, 'no se repite');
    assert.equal(shouldInvite({ storage, now: now + INVITE_EVERY_DAYS * day }), true);
    storage.setItem('rateos.feedbackInvite.v1', JSON.stringify({ shownAt: now, snoozedUntil: now + INVITE_SNOOZE_DAYS * day }));
    assert.equal(shouldInvite({ storage, now: now + 30 * day }), false, '"Ahora no" la esconde');
    assert.equal(shouldInvite({ storage, now: now + 61 * day }), true);
    assert.equal(shouldInvite({ storage: brokenStorage, now }), false);
    assert.equal(shouldInvite({ storage: null, now }), false);
    storage.setItem('rateos.feedbackInvite.v1', '{no es json');
    assert.equal(shouldInvite({ storage, now }), false, 'un valor roto no rompe nada');
    const fresh = memoryStorage();
    assert.equal(claimInvite({ storage: fresh, now }), true);
    assert.equal(claimInvite({ storage: fresh, now: now + day }), false, 'la segunda vez, no');
    assert.equal(snoozeInvite({ storage: fresh, now }), true);
    assert.equal(claimInvite({ storage: fresh, now: now + 20 * day }), false);
    assert.equal(claimInvite({ storage: brokenStorage, now }), false);
  });
});
