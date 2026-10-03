/**
 * Tests de js/core/validation.js — validación de inputs (Prompt 2 "Inputs").
 * cantidad >= 0, distancia >= 0, horas >= 0, margen válido (< 100 %),
 * utilización > 0 y <= 100; vacío opcional vs requerido; coma decimal.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RULES, validateNumber, validateQuote, sanitizeText } from '../../js/core/validation.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { deepClone, setPath } from '../../js/core/object.js';

/**
 * Tabla de bordes por regla: [válidos, inválidos].
 * Si se agrega una regla nueva a RULES, este test obliga a cubrirla.
 */
const BOUNDARIES = {
  money: [[0, 0.01, 1e12, '1500,50'], [-0.01, -1]],
  quantity: [[0, 1, 2.5], [-1, -0.001]],
  distance: [[0, 110, 1500.5], [-1]],
  hours: [[0, 176, 744], [-1, 744.01]],
  hoursPerDay: [[0, 12, 24], [-0.5, 24.01]],
  days: [[0, 30, 366], [-1, 366.5]],
  daysInMonth: [[0, 22, 31], [-1, 31.1]],
  availableDays: [[0.5, 1, 31], [0, -1, 32]],
  positiveDays: [[0.5, 1, 366], [0, -1, 367]],
  paymentDays: [[0, 90, 720], [-1, 721]],
  percent: [[0, 50, 100], [-0.01, 100.01]],
  percentOpen: [[0, 100, 1000], [-1, 1000.5]],
  margin: [[0, 10, 99.99], [100, 100.5, -1, -0.01]],
  utilization: [[0.01, 50, 100], [0, -1, 100.01]],
  positive: [[0.0001, 1, 1e9], [0, -1]],
  years: [[0.5, 10, 100], [0, -1, 101]],
  months: [[0, 12, 600], [-1, 601]],
  integer: [[0, 1, 42], [1.5, -1, 0.1]],
};

describe('RULES', () => {
  test('todas las reglas tienen mínimo y mensaje en español', () => {
    for (const [name, rule] of Object.entries(RULES)) {
      assert.equal(typeof rule.min, 'number', name);
      assert.equal(typeof rule.message, 'string', name);
      assert.ok(rule.message.length > 5, name);
    }
    assert.ok(Object.isFrozen(RULES));
  });

  test('la tabla de bordes cubre todas las reglas', () => {
    assert.deepEqual(Object.keys(BOUNDARIES).sort(), Object.keys(RULES).sort());
  });

  for (const [name, [valid, invalid]] of Object.entries(BOUNDARIES)) {
    test(`regla "${name}": bordes válidos e inválidos`, () => {
      for (const v of valid) {
        const r = validateNumber(v, name);
        assert.equal(r.ok, true, `${name}(${v}) debería ser válido: ${r.error}`);
        assert.equal(r.error, null);
        assert.ok(Number.isFinite(r.value));
      }
      for (const v of invalid) {
        const r = validateNumber(v, name);
        assert.equal(r.ok, false, `${name}(${v}) debería ser inválido`);
        assert.equal(r.value, null);
        assert.equal(r.error, RULES[name].message);
      }
    });
  }
});

describe('validateNumber — casos de negocio explícitos', () => {
  test('margen 100 % es inválido (precio infinito); 99,99 es válido', () => {
    assert.equal(validateNumber(100, 'margin').ok, false);
    assert.equal(validateNumber('100', 'margin').ok, false);
    assert.equal(validateNumber('99,99', 'margin').ok, true);
    assert.equal(validateNumber(0, 'margin').ok, true, 'margen 0 es válido');
  });

  test('utilización 0 es inválida y 100 es válida', () => {
    assert.equal(validateNumber(0, 'utilization').ok, false);
    assert.equal(validateNumber('0', 'utilization').ok, false);
    assert.equal(validateNumber(100, 'utilization').ok, true);
    assert.equal(validateNumber(0.01, 'utilization').ok, true, 'cercana a 0 es válida');
  });

  test('negativos inválidos en cantidades, distancias, horas y montos', () => {
    for (const rule of ['quantity', 'distance', 'hours', 'hoursPerDay', 'money', 'days', 'percent']) {
      assert.equal(validateNumber(-1, rule).ok, false, rule);
      assert.equal(validateNumber('-1', rule).ok, false, rule);
    }
  });
});

describe('validateNumber — vacíos, texto y coma decimal', () => {
  test('vacío es válido si es opcional (value null)', () => {
    for (const empty of ['', '   ', null, undefined]) {
      assert.deepEqual(validateNumber(empty, 'money'), { ok: true, value: null, error: null });
    }
  });

  test('vacío es inválido si es requerido', () => {
    for (const empty of ['', '  ', null, undefined]) {
      assert.deepEqual(validateNumber(empty, 'money', { required: true }), { ok: false, value: null, error: 'Campo obligatorio.' });
    }
  });

  test('acepta coma decimal (teclado es-AR)', () => {
    assert.deepEqual(validateNumber('12,5', 'percent'), { ok: true, value: 12.5, error: null });
    assert.equal(validateNumber(' 1500,75 ', 'money').value, 1500.75);
    assert.equal(validateNumber('0,5', 'utilization').value, 0.5);
  });

  test('acepta strings numéricos con punto y números', () => {
    assert.equal(validateNumber('12.5', 'percent').value, 12.5);
    assert.equal(validateNumber(42, 'integer').value, 42);
  });

  test('texto no numérico, NaN e Infinity son inválidos', () => {
    for (const bad of ['abc', '12abc', NaN, Infinity, -Infinity, 'Infinity', true, {}, []]) {
      const r = validateNumber(bad, 'money');
      assert.equal(r.ok, false, String(bad));
      assert.equal(r.value, null);
      assert.equal(r.error, 'Ingresá un número válido.');
    }
  });

  test('una regla desconocida usa "money" (>= 0)', () => {
    assert.equal(validateNumber(-1, 'no-existe').ok, false);
    assert.equal(validateNumber(5, 'no-existe').ok, true);
  });
});

describe('validateQuote', () => {
  test('las cotizaciones demo y una vacía no tienen errores', () => {
    for (const q of createDemoState(1).quotes) {
      const errors = validateQuote(q).filter((i) => i.severity === 'error');
      assert.deepEqual(errors, [], q.name);
    }
    assert.deepEqual(validateQuote(createEmptyQuote({ organizationId: 'o' })).filter((i) => i.severity === 'error'), []);
  });

  test('entrada inválida devuelve un error', () => {
    for (const bad of [null, undefined, 'x', 5]) {
      assert.deepEqual(validateQuote(bad), [{ path: '', message: 'Cotización inválida.', severity: 'error' }]);
    }
  });

  const NEGATIVE_PATHS = [
    'activity.activeDaysPerMonth',
    'activity.hoursPerActiveDay',
    'labor.0.positions',
    'labor.0.peoplePerPosition',
    'labor.0.basicMonthly',
    'labor.0.normalHoursPerMonth',
    'labor.0.overtimeHoursPerActiveDay',
    'labor.0.sacPct',
    'labor.0.artPct',
    'labor.0.overtimePremiumPct',
    'equipment.0.quantity',
    'equipment.0.replacementValue',
    'equipment.0.residualValue',
    'equipment.0.hoursPerActiveDay',
    'logistics.distanceKm',
    'logistics.tripsPerActivation',
    'finance.paymentTermDays',
    'finance.monthlyRatePct',
    'pricing.targetMarginPct',
    'pricing.customMarginPct',
    'pricing.knownRate',
    'pricing.commercialDiscountPct',
    'rules.volumeTiers.0.discountPct',
    'rules.continuityDiscountPct',
  ];

  for (const path of NEGATIVE_PATHS) {
    test(`detecta negativo en ${path}`, () => {
      const quote = deepClone(createDemoState(1).quotes[0]);
      setPath(quote, path, -1);
      const issues = validateQuote(quote);
      assert.ok(
        issues.some((i) => i.path === path && i.severity === 'error'),
        `issues: ${JSON.stringify(issues)}`,
      );
    });
  }

  test('detecta días disponibles y días por activación en 0', () => {
    const quote = deepClone(createDemoState(1).quotes[0]);
    quote.activity.availableDaysPerMonth = 0;
    quote.activity.daysPerActivation = 0;
    const paths = validateQuote(quote).filter((i) => i.severity === 'error').map((i) => i.path);
    assert.ok(paths.includes('activity.availableDaysPerMonth'));
    assert.ok(paths.includes('activity.daysPerActivation'));
  });

  test('margen objetivo 100 % es un error', () => {
    const quote = deepClone(createDemoState(1).quotes[0]);
    quote.pricing.targetMarginPct = 100;
    assert.ok(validateQuote(quote).some((i) => i.path === 'pricing.targetMarginPct' && i.severity === 'error'));
  });

  test('advierte días activos mayores que los disponibles (utilización > 100 %)', () => {
    const quote = deepClone(createDemoState(1).quotes[0]);
    quote.activity.activeDaysPerMonth = 31;
    quote.activity.availableDaysPerMonth = 30;
    const issue = validateQuote(quote).find((i) => i.path === 'activity.activeDaysPerMonth' && i.severity === 'warning');
    assert.ok(issue);
    assert.match(issue.message, /100 %/);
  });

  test('advierte valor residual mayor que el de reposición', () => {
    const quote = deepClone(createDemoState(1).quotes[0]);
    quote.equipment[0].residualValue = quote.equipment[0].replacementValue + 1;
    assert.ok(validateQuote(quote).some((i) => i.path === 'equipment.0.residualValue' && i.severity === 'warning'));
  });

  test('texto en campos numéricos es un error; vacío opcional no', () => {
    const quote = deepClone(createDemoState(1).quotes[0]);
    quote.logistics.distanceKm = 'lejos';
    quote.pricing.customMarginPct = '';
    const issues = validateQuote(quote);
    assert.ok(issues.some((i) => i.path === 'logistics.distanceKm'));
    assert.equal(issues.some((i) => i.path === 'pricing.customMarginPct'), false);
  });

  test('cotización sin secciones no rompe', () => {
    assert.deepEqual(validateQuote({}), []);
  });
});

describe('sanitizeText', () => {
  test('recorta, reemplaza caracteres de control y limita longitud', () => {
    assert.equal(sanitizeText('  Añelo  '), 'Añelo');
    assert.equal(sanitizeText('a\u0000b\u0007c\nd'), 'a b c d');
    assert.equal(sanitizeText('x'.repeat(300)).length, 200);
    assert.equal(sanitizeText('abcdef', 3), 'abc');
    assert.equal(sanitizeText(null), '');
    assert.equal(sanitizeText(undefined), '');
    assert.equal(sanitizeText(123), '123');
  });

  test('no interpreta HTML (sólo texto)', () => {
    assert.equal(sanitizeText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
  });
});
