/**
 * Tests de js/core/events.js — eventos internos con privacidad por diseño
 * (Prompt 4 §24-26): sólo nombres de una lista blanca; nunca montos,
 * salarios, costos, nombres de clientes ni textos libres.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_NAMES, track, sanitizeEventProps, addEventSink } from '../../js/core/events.js';
import { FEATURES } from '../../js/config.js';

function withSink(fn, options = { force: true }) {
  const events = [];
  const remove = addEventSink((e) => events.push(e), options);
  try {
    fn();
  } finally {
    remove();
  }
  return events;
}

describe('EVENT_NAMES', () => {
  test('incluye los eventos del Prompt 4 §24 y está congelada', () => {
    for (const name of ['quote_created', 'quote_completed', 'scenario_changed', 'break_even_viewed', 'backup_exported']) {
      assert.ok(EVENT_NAMES.includes(name), name);
    }
    assert.ok(Object.isFrozen(EVENT_NAMES));
    for (const name of EVENT_NAMES) assert.match(name, /^[a-z_]+$/);
  });
});

describe('track', () => {
  test('rechaza nombres desconocidos (devuelve false y no emite)', () => {
    const events = withSink(() => {
      for (const name of ['monthly_labor_cost', 'QUOTE_CREATED', '', '__proto__', 'toString', 'constructor', null, undefined, 42]) {
        assert.equal(track(name, {}), false, String(name));
      }
    });
    assert.deepEqual(events, []);
  });

  test('acepta todos los nombres de la lista blanca', () => {
    const events = withSink(() => {
      for (const name of EVENT_NAMES) assert.equal(track(name, {}), true, name);
    });
    assert.deepEqual(events.map((e) => e.name), [...EVENT_NAMES]);
  });

  test('los sinks reciben las props ya saneadas', () => {
    const events = withSink(() => {
      track('quote_created', { serviceType: 'on_call', source: 'template', client: 'YPF', monthlyCost: 85000000 });
    });
    assert.deepEqual(events, [{ name: 'quote_created', props: { serviceType: 'on_call', source: 'template' } }]);
  });

  test('analytics deshabilitado: un sink sin force no recibe nada', () => {
    assert.equal(FEATURES.analytics, false, 'hoy no se envía nada a terceros');
    const events = withSink(() => track('quote_created', { serviceType: 'on_call' }), {});
    assert.deepEqual(events, []);
  });

  test('un sink que lanza no rompe la app', () => {
    const remove = addEventSink(
      () => {
        throw new Error('sink roto');
      },
      { force: true },
    );
    try {
      assert.equal(track('quote_created', {}), true);
    } finally {
      remove();
    }
  });

  test('desregistrar un sink deja de enviarle eventos', () => {
    const events = [];
    const remove = addEventSink((e) => events.push(e), { force: true });
    track('quote_deleted', {});
    remove();
    track('quote_deleted', {});
    assert.equal(events.length, 1);
  });

  test('sin props no rompe', () => {
    const events = withSink(() => track('app_started'));
    assert.deepEqual(events[0].props, {});
  });

  // BUG detectado: sanitizeEventProps(null) lanza TypeError ("in" sobre
  // null), así que track(nombre, null) rompería la app por analytics.
  test('props null o no-objeto no rompen track (se descartan)', () => {
    for (const bad of [null, 'texto', 42, true]) {
      assert.doesNotThrow(() => track('quote_created', bad), String(bad));
      assert.deepEqual(sanitizeEventProps(bad), {});
    }
  });
});

describe('sanitizeEventProps — privacidad por diseño', () => {
  test('ejemplo Prompt 4 §26: permite completed=true, descarta monthly_labor_cost', () => {
    assert.deepEqual(sanitizeEventProps({ completed: true, monthly_labor_cost: 85000000 }), { completed: true });
  });

  test('descarta montos, salarios, costos, tarifas y márgenes', () => {
    const props = {
      amount: 1000,
      salary: 1800000,
      basicMonthly: 1800000,
      totalCost: 15776498.33,
      monthlyCost: 85000000,
      rate: 2259000,
      knownRate: 4000000,
      marginPct: 10,
      revenue: 17529840,
      fuelPricePerLiter: 1500,
    };
    assert.deepEqual(sanitizeEventProps(props), {});
  });

  test('descarta nombres de clientes, empresas y textos libres', () => {
    const props = { client: 'Operadora X', clientName: 'YPF', organization: 'Patagonia Servicios SRL', name: 'Hidrogrúa on-call — Añelo', notes: 'texto libre', email: 'a@b.c' };
    assert.deepEqual(sanitizeEventProps(props), {});
  });

  test('en claves permitidas, descarta textos libres que no son enums cortos', () => {
    const out = sanitizeEventProps({
      serviceType: 'Hidrogrúa Añelo', // espacios, mayúsculas, acentos
      pricingMode: 'known rate',
      unit: 'DAY',
      step: 'x'.repeat(41),
      traceId: '<script>',
      variable: '',
      resourceType: 'cliente@empresa.com',
      source: 'template',
    });
    assert.deepEqual(out, { source: 'template' });
  });

  test('en claves permitidas, descarta montos disfrazados de enum o contador', () => {
    assert.deepEqual(sanitizeEventProps({ serviceType: 85000000, count: 85000000 }), {});
    assert.deepEqual(sanitizeEventProps({ count: 10001 }), {});
    assert.deepEqual(sanitizeEventProps({ count: -1 }), {});
    assert.deepEqual(sanitizeEventProps({ count: 2.5 }), {});
    assert.deepEqual(sanitizeEventProps({ count: '5' }), {});
    assert.deepEqual(sanitizeEventProps({ count: NaN }), {});
  });

  test('booleanos sólo como booleanos', () => {
    assert.deepEqual(sanitizeEventProps({ completed: 'true', isDemo: 1 }), {});
    assert.deepEqual(sanitizeEventProps({ completed: false, isDemo: true }), { completed: false, isDemo: true });
  });

  test('acepta enums cortos y contadores chicos válidos', () => {
    const props = {
      serviceType: 'on_call',
      pricingMode: 'known_activity',
      unit: 'day',
      step: 'labor',
      traceId: 'break_even',
      variable: 'salaries_pct',
      resourceType: 'labor_profiles',
      source: 'blank',
      completed: true,
      isDemo: false,
      count: 10000,
    };
    assert.deepEqual(sanitizeEventProps(props), props);
  });

  test('no copia objetos anidados ni claves peligrosas', () => {
    const props = JSON.parse('{"__proto__":{"polluted":true},"constructor":"x","nested":{"serviceType":"on_call"},"serviceType":"on_call"}');
    const out = sanitizeEventProps(props);
    assert.deepEqual(out, { serviceType: 'on_call' });
    assert.equal({}.polluted, undefined);
  });

  test('no modifica las props recibidas', () => {
    const props = { serviceType: 'on_call', client: 'X' };
    sanitizeEventProps(props);
    assert.deepEqual(props, { serviceType: 'on_call', client: 'X' });
  });
});
