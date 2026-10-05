/**
 * Shell de la aplicación: rutas (hash routing), navegación y helpers puros
 * de las pantallas generales. No necesita DOM: sólo funciones puras.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { APP_HOME, LIBRARY_TABS, RESOURCE_TABS, ROUTES, SETTINGS_TABS, hashToPath, matchRoute } from '../../js/ui/router.js';
import { NAV_ITEMS, NEW_QUOTE_HREF, organizationInitial } from '../../js/ui/layout.js';
import { filterQuoteItems, quoteDetailHref, quoteHref, summaryFailed } from '../../js/ui/views/quotes-list.js';
import { SETTINGS_SECTIONS, parseMarginLadder, parseMatrixDays } from '../../js/ui/views/settings.js';
import { RESOURCE_TAB_IDS } from '../../js/ui/views/library.js';

describe('router: hashToPath', () => {
  test('normaliza vacíos, barras finales y query', () => {
    assert.equal(hashToPath(''), '/');
    assert.equal(hashToPath('#'), '/');
    assert.equal(hashToPath('#/'), '/');
    assert.equal(hashToPath('#/inicio/'), '/inicio');
    assert.equal(hashToPath('#/cotizaciones?x=1'), '/cotizaciones');
  });
});

describe('router: matchRoute', () => {
  const route = (hash) => matchRoute(hash);

  test('la raíz es la landing pública y #/inicio es el inicio de la app', () => {
    assert.equal(APP_HOME, '#/inicio');
    for (const hash of ['', '#', '#/']) {
      const m = route(hash);
      assert.equal(m.route.name, 'landing');
      assert.equal(m.route.shell, 'public');
    }
    const home = route('#/inicio');
    assert.equal(home.route.name, 'home');
    assert.equal(home.route.shell, 'app');
    assert.equal(home.nav, 'home');
  });

  test('rutas públicas usan el shell público', () => {
    for (const [hash, name] of [['#/login', 'login'], ['#/registro', 'register'], ['#/bienvenida', 'onboarding'], ['#/demo', 'demo']]) {
      const m = route(hash);
      assert.equal(m.route.name, name);
      assert.equal(m.route.shell, 'public');
      assert.equal(m.nav, null);
    }
  });

  test('"cotizaciones/nueva" gana sobre "cotizaciones/:id" y el editor recibe id y paso', () => {
    assert.equal(route('#/cotizaciones/nueva').route.name, 'new-quote');
    const editor = route('#/cotizaciones/abc-123');
    assert.equal(editor.route.name, 'quote-editor');
    assert.deepEqual(editor.params, { step: 'service', id: 'abc-123' });
    const step = route('#/cotizaciones/abc-123/result');
    assert.equal(step.route.name, 'quote-editor-step');
    assert.deepEqual(step.params, { id: 'abc-123', step: 'result' });
    assert.equal(step.nav, 'quotes');
  });

  test('decodifica segmentos y rechaza codificaciones inválidas', () => {
    assert.equal(route('#/cotizaciones/a%20b').params.id, 'a b');
    assert.equal(route('#/cotizaciones/%E0%A4%A').notFound, true);
  });

  test('Recursos: pestaña por defecto "personal" y sólo pestañas válidas', () => {
    assert.deepEqual(route('#/recursos').params, { tab: 'personal' });
    for (const tab of RESOURCE_TABS) {
      const m = route(`#/recursos/${tab}`);
      assert.equal(m.route.name, 'resources-tab');
      assert.equal(m.params.tab, tab);
      assert.equal(m.nav, 'resources');
    }
    assert.equal(route('#/recursos/xyz').notFound, true);
    // La vista de Recursos muestra exactamente las mismas pestañas que acepta el router.
    assert.deepEqual([...RESOURCE_TAB_IDS], [...RESOURCE_TABS]);
  });

  test('Configuración: pestaña por defecto "empresa" y sus secciones (incluida Cuenta)', () => {
    assert.deepEqual(route('#/configuracion').params, { tab: 'empresa' });
    for (const tab of SETTINGS_TABS) assert.equal(route(`#/configuracion/${tab}`).params.tab, tab);
    assert.equal(route('#/configuracion/otra').notFound, true);
    assert.deepEqual(SETTINGS_SECTIONS.map((s) => s.id), [...SETTINGS_TABS]);
  });

  test('Escenarios: lista sin id y análisis con id', () => {
    assert.equal(route('#/escenarios').route.name, 'scenarios');
    const m = route('#/escenarios/q-1');
    assert.equal(m.route.name, 'scenarios-quote');
    assert.equal(m.params.id, 'q-1');
    assert.equal(m.nav, 'scenarios');
  });

  test('redirecciones de enlaces viejos', () => {
    const target = (hash) => {
      const m = route(hash);
      return typeof m.route.redirect === 'function' ? m.route.redirect(m.params) : null;
    };
    assert.equal(target('#/dashboard'), '#/inicio');
    assert.equal(target('#/biblioteca'), '#/recursos/personal');
    assert.equal(target('#/biblioteca/convenios'), '#/configuracion/convenios');
    assert.equal(target('#/recursos/convenios'), '#/configuracion/convenios');
    for (const tab of LIBRARY_TABS.filter((t) => t !== 'convenios')) assert.equal(target(`#/biblioteca/${tab}`), `#/recursos/${tab}`);
    assert.equal(route('#/biblioteca/otra').notFound, true);
  });

  test('un ancla que no empieza con "/" no es una ruta', () => {
    assert.equal(route('#contenido').notFound, true);
  });

  test('cada ruta declara su shell y las de la app tienen título', () => {
    for (const r of ROUTES) {
      assert.ok(r.shell === 'public' || r.shell === 'app', `${r.name}: shell inválido`);
      if (r.shell === 'app') assert.ok(r.title, `${r.name}: falta título`);
      assert.ok(typeof r.redirect === 'function' || typeof r.load === 'function', `${r.name}: sin vista ni redirección`);
    }
  });
});

describe('layout: navegación', () => {
  test('el menú tiene Inicio, Cotizaciones, Recursos, Servicios, Escenarios y, separado, Configuración', () => {
    assert.deepEqual(NAV_ITEMS.map((i) => i.label), ['Inicio', 'Cotizaciones', 'Recursos', 'Servicios', 'Escenarios', 'Configuración']);
    assert.deepEqual(NAV_ITEMS.filter((i) => i.separated).map((i) => i.key), ['settings']);
  });

  test('todos los enlaces del menú son rutas de la app que existen (nunca la raíz "/")', () => {
    for (const item of [...NAV_ITEMS, { href: NEW_QUOTE_HREF, key: 'quotes' }]) {
      assert.match(item.href, /^#\/[a-z]/);
      const m = matchRoute(item.href);
      assert.equal(m.notFound, false, item.href);
      assert.equal(m.route.shell, 'app', item.href);
      assert.equal(m.nav, item.key, item.href);
    }
  });

  test('inicial de la empresa para el pie del menú', () => {
    assert.equal(organizationInitial('patagonia servicios'), 'P');
    assert.equal(organizationInitial('  Ñandú SRL'), 'Ñ');
    assert.equal(organizationInitial(''), 'R');
    assert.equal(organizationInitial(null), 'R');
    assert.equal(organizationInitial({}), 'R');
  });
});

describe('cotizaciones: helpers de listado', () => {
  const items = [
    { quote: { id: '1', name: 'Hidrogrúa on-call — Añelo', client: 'Operadora', code: 'COT-0001', status: 'draft' }, summary: {} },
    { quote: { id: '2', name: 'Cuadrilla', client: 'Minera', code: 'COT-0002', status: 'sent' }, summary: {} },
    { quote: { id: '3', name: 'Transporte', client: null, code: 'COT-0003', status: 'won' }, summary: {} },
  ];

  test('filtra por texto sin distinguir acentos ni mayúsculas, y por estado', () => {
    assert.deepEqual(filterQuoteItems(items, { query: 'anelo' }).map((i) => i.quote.id), ['1']);
    assert.deepEqual(filterQuoteItems(items, { query: 'MINERA' }).map((i) => i.quote.id), ['2']);
    assert.deepEqual(filterQuoteItems(items, { query: 'cot-000' }).map((i) => i.quote.id), ['1', '2', '3']);
    assert.deepEqual(filterQuoteItems(items, { status: 'won' }).map((i) => i.quote.id), ['3']);
    assert.deepEqual(filterQuoteItems(items, { query: 'cuadrilla', status: 'draft' }), []);
    assert.equal(filterQuoteItems(items).length, 3);
  });

  test('"Ver detalle" abre el resultado; si no se pudo calcular, el editor', () => {
    const quote = { id: 'a b' };
    assert.equal(quoteHref(quote), '#/cotizaciones/a%20b');
    assert.equal(quoteDetailHref(quote, { marginPct: 10 }), '#/cotizaciones/a%20b/result');
    assert.equal(quoteDetailHref(quote, { error: true }), '#/cotizaciones/a%20b');
    assert.equal(quoteDetailHref(quote, null), '#/cotizaciones/a%20b');
    assert.equal(summaryFailed(undefined), true);
    assert.equal(matchRoute(quoteDetailHref({ id: 'x' }, {})).route.name, 'quote-editor-step');
  });
});

describe('configuración: listas de parámetros', () => {
  test('días de la matriz: enteros 1–31, sin repetidos y ordenados', () => {
    assert.deepEqual(parseMatrixDays('20, 5 8;10 10').value, [5, 8, 10, 20]);
    assert.equal(parseMatrixDays('').ok, false);
    assert.equal(parseMatrixDays('0').ok, false);
    assert.equal(parseMatrixDays('32').ok, false);
    assert.equal(parseMatrixDays('7.5').ok, false);
    assert.equal(parseMatrixDays('1,2,3,4,5,6,7,8,9,10,11,12,13').ok, false);
  });

  test('márgenes a comparar: mayores a 0 y menores a 100 (sobre el precio)', () => {
    assert.deepEqual(parseMarginLadder('15, 5, 7.5').value, [5, 7.5, 15]);
    assert.equal(parseMarginLadder('0').ok, false);
    assert.equal(parseMarginLadder('100').ok, false);
    // La coma separa valores (los decimales van con punto): "7,5" son dos márgenes, 5 y 7.
    assert.deepEqual(parseMarginLadder('7,5').value, [5, 7]);
    assert.equal(parseMarginLadder('-5').ok, false);
    assert.equal(parseMarginLadder('abc').ok, false);
  });
});

// ------------------------------------------------- plantillas y ejemplos

import { orderTemplates } from '../../js/ui/views/quotes-list.js';
import { templateContents } from '../../js/ui/views/services.js';
import { demoServiceTemplates } from '../../js/domain/demo-data.js';

describe('Nueva cotización: plantillas', () => {
  test('templateContents dice lo que trae la plantilla (o sólo tipo y actividad)', () => {
    const templates = demoServiceTemplates();
    const withResources = templates.find((t) => t.defaults && Array.isArray(t.defaults.labor) && t.defaults.labor.length > 0);
    assert.ok(withResources);
    const c = templateContents(withResources);
    assert.match(c.resources, /puesto/);
    assert.equal(c.hasContent, true);
    const empty = templateContents({ id: 'x', name: 'Vacía', defaults: {} });
    assert.equal(empty.resources, 'Sólo tipo de servicio y actividad');
    assert.equal(empty.hasContent, false);
    // Una plantilla guardada desde una cotización también cuenta otros costos y vehículos.
    const saved = templateContents({ defaults: { otherCosts: [{}], logistics: { vehicles: [{}, {}] } } });
    assert.match(saved.resources, /1 otro costo · 2 vehículos/);
  });

  test('orderTemplates: primero las que traen recursos, orden estable, sin perder ninguna', () => {
    const templates = demoServiceTemplates();
    const ordered = orderTemplates(templates);
    assert.equal(ordered.length, templates.length);
    assert.deepEqual(new Set(ordered.map((t) => t.id)), new Set(templates.map((t) => t.id)));
    const firstEmptyIndex = ordered.findIndex((t) => !templateContents(t).hasContent);
    if (firstEmptyIndex >= 0) {
      ordered.slice(firstEmptyIndex).forEach((t) => assert.equal(templateContents(t).hasContent, false, t.name));
    }
    assert.deepEqual(orderTemplates(null), []);
  });
});
