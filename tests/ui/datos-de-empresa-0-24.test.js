/**
 * 0.24.0 (PLAN-2026-028, PR 3): datos de la empresa una sola vez, IVA incluido.
 *
 * - W-10: tarjeta "Datos de tu empresa" mientras la Configuración sea de ejemplo (Inicio y
 *   "Nuevo servicio"); "Guardar" guarda con illustrative: false. "Guardar como valor de mi
 *   empresa" para el combustible y la tasa. "Son los valores de mi empresa" en el aviso de una
 *   cotización creada antes.
 * - P-11: responsable inscripto con los dos valores → una línea en vez de la pregunta del IVA.
 *   Externos guardados sin definir → "Recupero el IVA de todos (responsable inscripto)" (D6).
 * - P-19: el mismo rótulo en Configuración y en la cotización.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { COMPANY_LABELS, COMPANY_SETUP_FIELDS, companySetupPatch, companyIsExample } from '../../js/ui/company-defaults.js';
import { undefinedVatRecoveryRows, recoverAllVatConfirm } from '../../js/ui/views/quote-editor.js';
import { resetIds, service, external } from '../lab/lib/build.js';
import { defaultSettings, createEmptyQuote } from '../../js/domain/quote-factory.js';

const code = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('"Datos de tu empresa" (W-10)', () => {
  test('se pide mientras la Configuración sea de ejemplo', () => {
    assert.equal(companyIsExample(defaultSettings('org')), true);
    assert.equal(companyIsExample({ ...defaultSettings('org'), illustrative: false }), false);
  });

  test('pide combustible, plazo de cobro, tasa, imprevistos, margen y la condición frente al IVA', () => {
    assert.deepEqual(COMPANY_SETUP_FIELDS.map((f) => f.key), ['fuelPricePerLiter', 'defaultPaymentTermDays', 'financeMonthlyRatePct', 'defaultContingencyPct', 'defaultTargetMarginPct']);
    const src = code('js/ui/company-defaults.js');
    assert.match(src, /label: COMPANY_LABELS\.vatCondition/);
    // Los valores de ejemplo van como texto de muestra, no cargados.
    assert.match(src, /value: null,\n\s+rule: f\.rule/);
    assert.match(src, /placeholder: isFiniteNumber\(example\[f\.key\]\) \? `Ej\.: /);
    assert.match(src, /'Ahora no'/);
  });

  test('"Guardar" guarda los cinco números con illustrative: false; con uno vacío no guarda', () => {
    const values = { fuelPricePerLiter: 1850, defaultPaymentTermDays: 45, financeMonthlyRatePct: 4, defaultContingencyPct: 3, defaultTargetMarginPct: 15, vatCondition: 'registered' };
    assert.deepEqual(companySetupPatch(values), { ...values, illustrative: false });
    assert.equal(companySetupPatch({ ...values, defaultContingencyPct: null }), null);
    assert.equal(companySetupPatch({ ...values, vatCondition: 'otra' }).vatCondition, null);
  });

  test('la cotización siguiente nace con esos valores y sin marca de ejemplo', () => {
    const values = { fuelPricePerLiter: 1850, defaultPaymentTermDays: 45, financeMonthlyRatePct: 4, defaultContingencyPct: 3, defaultTargetMarginPct: 15 };
    const settings = { ...defaultSettings('org'), ...companySetupPatch(values) };
    const q = createEmptyQuote({ organizationId: 'org', settings, id: 'q1', now: '2026-11-20T00:00:00.000Z' });
    assert.equal(q.fuel.illustrative, false);
    assert.equal(q.finance.illustrative, false);
    assert.equal(q.fuel.pricePerLiter, 1850);
    assert.equal(q.finance.paymentTermDays, 45);
    assert.equal(q.risk.generalPct, 3);
  });

  test('la tarjeta está en Inicio y en "Nuevo servicio"', () => {
    assert.match(code('js/ui/views/dashboard.js'), /companySetupCard\(\{ app, settings, readOnly:/);
    assert.match(code('js/ui/views/quotes-list.js'), /companySetupCard\(\{ app, settings, readOnly:/);
  });

  test('"Guardar como valor de mi empresa" para el combustible y la tasa', () => {
    assert.match(code('js/ui/views/quote-steps/logistics.js'), /settingsKey: 'fuelPricePerLiter'/);
    assert.match(code('js/ui/views/quote-steps/finance.js'), /settingsKey: 'financeMonthlyRatePct'/);
    assert.match(code('js/ui/company-defaults.js'), /'Guardar como valor de mi empresa'/);
  });

  test('"Son los valores de mi empresa" quita la marca del combustible y la tasa (el número no cambia)', () => {
    const editor = code('js/ui/views/quote-editor.js');
    assert.match(editor, /'Son los valores de mi empresa'/);
    assert.match(editor, /if \(isPlainObject\(q\.fuel\)\) q\.fuel\.illustrative = false;/);
    assert.match(editor, /if \(isPlainObject\(q\.finance\)\) q\.finance\.illustrative = false;/);
  });
});

describe('IVA (P-11)', () => {
  test('responsable inscripto con los dos valores: una línea en vez de la pregunta', () => {
    const finance = code('js/ui/views/quote-steps/finance.js');
    assert.match(finance, /settings\.vatCondition === 'registered' && hasCompanyVatDefaults\(settings\)/);
    assert.match(finance, /`Facturás con IVA \$\{formatPercent\(company\.ratePct\)\} y lo pagás a \$\{formatDays\(company\.payLagDays\)\} \(tu empresa\)`/);
    assert.match(finance, /'Cambiar sólo acá'/);
  });

  test('"Recupero el IVA de todos": sólo los externos sin definir', () => {
    const q = {
      equipment: [
        { acquisition: 'owned' },
        { acquisition: 'rented', external: { fiscal: { vatRecoverable: null } } },
        { acquisition: 'outsourced', external: { fiscal: { vatRecoverable: 'no' } } },
        { acquisition: 'outsourced', external: {} },
      ],
    };
    assert.deepEqual(undefinedVatRecoveryRows(q), [1, 3]);
    assert.match(code('js/ui/views/quote-editor.js'), /'Recupero el IVA de todos \(responsable inscripto\)'/);
  });

  test('la confirmación dice cuánto baja el costo, con el motor antes y después (B-1)', () => {
    resetIds();
    const mk = (vatOn) => {
      const q = service({ id: 'q-k03', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 15, daysPerActivation: 5, hoursPerActiveDay: 8 },
        equipment: [external({ name: 'Grúa', acquisition: 'rented' }, { price: 500000, unit: 'day', fiscal: { vatPct: 21, vatRecoverable: null } })] });
      if (vatOn) q.finance.vat = { applies: true, ratePct: 21, payLagDays: 20 };
      return q;
    };
    const apply = (q) => { q.equipment[0].external.fiscal.vatRecoverable = 'yes'; };
    const on = mk(true);
    const c = recoverAllVatConfirm(on, null, apply, 1);
    assert.equal(on.equipment[0].external.fiscal.vatRecoverable, null, 'no toca la cotización');
    assert.ok(c.drop > 0 && Math.abs(c.before - c.after - c.drop) < 0.01);
    assert.match(c.message, /El costo del mes baja \$/);
    assert.match(c.message, /correcto contablemente si recuperás el IVA/);
    const off = recoverAllVatConfirm(mk(false), null, apply, 1);
    assert.equal(off.drop, 0);
    assert.match(off.message, /el costo no cambia/);
  });
});

describe('textos iguales en los dos lados (P-19)', () => {
  test('Configuración y la cotización usan los mismos rótulos', () => {
    const settings = code('js/ui/views/settings.js');
    for (const key of ['fuelPricePerLiter', 'paymentTermDays', 'monthlyRatePct', 'contingencyPct', 'roundingStep']) {
      assert.match(settings, new RegExp(`COMPANY_LABELS\\.${key}`), key);
    }
    assert.match(code('js/ui/views/quote-steps/logistics.js'), /label: COMPANY_LABELS\.fuelPricePerLiter/);
    assert.match(code('js/ui/views/quote-steps/finance.js'), /label: COMPANY_LABELS\.paymentTermDays/);
    assert.match(code('js/ui/views/quote-steps/finance.js'), /label: COMPANY_LABELS\.monthlyRatePct/);
    assert.match(code('js/ui/views/quote-steps/risk.js'), /label: COMPANY_LABELS\.contingencyPct/);
    assert.match(code('js/ui/views/quote-steps/margin.js'), /label: COMPANY_LABELS\.roundingStep/);
    assert.equal(COMPANY_LABELS.paymentTermDays, 'Plazo de cobro');
    assert.equal(COMPANY_LABELS.roundingStep, 'Redondeo');
    assert.equal(COMPANY_LABELS.contingencyPct, 'Imprevistos (contingencia)');
    assert.equal(COMPANY_LABELS.fuelPricePerLiter, 'Precio del combustible (sin IVA)');
  });

  test('el combustible "se cambia en Movilización y viajes" en los dos lados', () => {
    assert.match(code('js/ui/views/quote-steps/equipment.js'), /se cambia en "\$\{stepName\('logistics'\)\}"/);
    assert.match(code('js/ui/views/library.js'), /en cada cotización se cambia en "Movilización y viajes"/);
  });
});
