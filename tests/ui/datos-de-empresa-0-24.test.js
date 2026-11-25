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

import { COMPANY_LABELS, COMPANY_SETUP_FIELDS, COMPANY_VAT_FIELDS, companySetupPatch, companyIsExample, fuelPriceLabel, fuelPriceVatHint, companySetupDismissed } from '../../js/ui/company-defaults.js';
import { undefinedVatRecoveryRows, recoverAllVatConfirm, companyValuesDiff, applyCompanyValues } from '../../js/ui/views/quote-editor.js';
import { resetIds, service, external } from '../lab/lib/build.js';
import { defaultSettings, createEmptyQuote } from '../../js/domain/quote-factory.js';

const code = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('"Datos de tu empresa" (W-10)', () => {
  test('se pide mientras la Configuración sea de ejemplo', () => {
    assert.equal(companyIsExample(defaultSettings('org')), true);
    assert.equal(companyIsExample({ ...defaultSettings('org'), illustrative: false }), false);
  });

  test('pide combustible, plazo de cobro, tasa, imprevistos, margen y la condición frente al IVA', () => {
    assert.deepEqual(COMPANY_SETUP_FIELDS.map((f) => f.key), ['fuelPricePerLiter', 'defaultPaymentTermDays', 'financeMonthlyRatePct', 'defaultContingencyPct', 'defaultTargetMarginPct', 'defaultStructurePct', 'billingTaxesPct']);
    const src = code('js/ui/company-defaults.js');
    assert.match(src, /label: COMPANY_LABELS\.vatCondition/);
    // Los valores de ejemplo van como texto de muestra, no cargados.
    assert.match(src, /value: null,\n\s+rule: f\.rule/);
    assert.match(src, /placeholder: isFiniteNumber\(example\[f\.key\]\) \? `Ej\.: /);
    assert.match(src, /'Ahora no'/);
  });

  test('"Guardar" guarda los cinco números con illustrative: false; con uno vacío no guarda', () => {
    const numbers = { fuelPricePerLiter: 1850, defaultPaymentTermDays: 45, financeMonthlyRatePct: 4, defaultContingencyPct: 3, defaultTargetMarginPct: 15, defaultStructurePct: 12 };
    const values = { ...numbers, billingTaxesPct: 4.5, vatCondition: 'monotributo' };
    // 0.25.1: también la estructura y los impuestos sobre lo que se factura (siete números).
    assert.deepEqual(companySetupPatch(values), { ...numbers, defaultBillingTaxes: { mode: 'combined', notApplicable: false, combinedPct: 4.5, items: [] }, vatCondition: 'monotributo', illustrative: false });
    assert.equal(companySetupPatch({ ...values, billingTaxesPct: 0 }).defaultBillingTaxes.notApplicable, true);
    assert.equal(companySetupPatch({ ...values, defaultStructurePct: null }), null);
    const nq = createEmptyQuote({ organizationId: 'org', settings: { ...defaultSettings('org'), ...companySetupPatch(values) }, id: 'q-est', now: '2026-11-25T00:00:00.000Z' });
    assert.equal(nq.indirect.pct, 12);
    assert.equal(nq.billingTaxes.combinedPct, 4.5);
    assert.equal(companySetupPatch({ ...values, defaultContingencyPct: null }), null);
    assert.equal(companySetupPatch({ ...values, vatCondition: 'otra' }).vatCondition, null);
  });

  test('C7: con responsable inscripto también guarda el IVA y los días en defaultVat; sin ellos no guarda', () => {
    const base = { fuelPricePerLiter: 1850, defaultPaymentTermDays: 45, financeMonthlyRatePct: 4, defaultContingencyPct: 3, defaultTargetMarginPct: 15, defaultStructurePct: 12, billingTaxesPct: 4.5, vatCondition: 'registered' };
    assert.equal(companySetupPatch(base), null);
    const patch = companySetupPatch({ ...base, vatRatePct: 21, vatPayLagDays: 20 });
    assert.deepEqual(patch.defaultVat, { ratePct: 21, payLagDays: 20 });
    assert.equal(patch.vatCondition, 'registered');
    assert.equal(patch.vatRatePct, undefined);
    // La cotización nueva nace con el IVA de la empresa (no pregunta).
    const q = createEmptyQuote({ organizationId: 'org', settings: { ...defaultSettings('org'), ...patch }, id: 'q-c7', now: '2026-11-20T00:00:00.000Z' });
    assert.deepEqual(q.finance.vat, { applies: true, ratePct: 21, payLagDays: 20 });
    assert.deepEqual(COMPANY_VAT_FIELDS.map((f) => f.key), ['vatRatePct', 'vatPayLagDays']);
  });

  test('C9: "Margen que querés ganar (sobre el precio)" en la tarjeta, en Configuración y en "El precio"', () => {
    assert.equal(COMPANY_LABELS.targetMarginPct, 'Margen que querés ganar (sobre el precio)');
    assert.match(code('js/ui/views/quote-steps/margin.js'), /label: COMPANY_LABELS\.targetMarginPct/);
    assert.match(code('js/ui/views/settings.js'), /num\('defaultTargetMarginPct', COMPANY_LABELS\.targetMarginPct/);
  });

  test('C-5: el combustible "con IVA" para monotributo y exento', () => {
    assert.equal(fuelPriceLabel({ vatCondition: 'monotributo' }), 'Precio del combustible (con IVA)');
    assert.equal(fuelPriceLabel({ vatCondition: 'exempt' }), 'Precio del combustible (con IVA)');
    assert.equal(fuelPriceLabel({ vatCondition: 'registered' }), 'Precio del combustible (sin IVA)');
    assert.equal(fuelPriceLabel(null), 'Precio del combustible (sin IVA)');
    assert.match(fuelPriceVatHint({ vatCondition: 'monotributo' }), /cargá el precio con IVA/);
    assert.match(fuelPriceVatHint({ vatCondition: 'registered' }), /descontalo/);
  });

  test('C8: "Ahora no" se recuerda en la sesión; en "Nuevo servicio" la tarjeta va después de las opciones', () => {
    assert.equal(companySetupDismissed({ mode: 'demo-x' }), false);
    assert.match(code('js/ui/company-defaults.js'), /dismissedBy\.add\(sessionOwner\(app\.ctx\)\)/);
    const list = code('js/ui/views/quotes-list.js');
    assert.ok(list.indexOf("h('div', { class: 'quote-choice-grid' }, blank, ...first)") < list.indexOf('      companyCard,'));
  });

  test('la cotización siguiente nace con esos valores y sin marca de ejemplo', () => {
    const values = { fuelPricePerLiter: 1850, defaultPaymentTermDays: 45, financeMonthlyRatePct: 4, defaultContingencyPct: 3, defaultTargetMarginPct: 15, defaultStructurePct: 0, billingTaxesPct: 0 };
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
    assert.match(editor, /if \(isPlainObject\(qq\.fuel\)\) qq\.fuel\.illustrative = false;/);
    assert.match(editor, /if \(isPlainObject\(qq\.finance\)\) qq\.finance\.illustrative = false;/);
  });

  test('C-4: el aviso muestra los dos valores; si difieren, "Usar los de mi empresa" y "Dejar estos"', () => {
    const info = { fuel: true, finance: true };
    const q = { fuel: { pricePerLiter: 1500, illustrative: true }, finance: { monthlyRatePct: 4, illustrative: true } };
    const differ = companyValuesDiff(q, { fuelPricePerLiter: 1300, financeMonthlyRatePct: 3 }, info);
    assert.equal(differ.same, false);
    assert.match(differ.quoteText, /1\.500\/L · 4 %/);
    assert.match(differ.companyText, /1\.300\/L · 3 %/);
    assert.equal(companyValuesDiff(q, { fuelPricePerLiter: 1500, financeMonthlyRatePct: 4 }, info).same, true);
    const used = applyCompanyValues(structuredClone(q), { fuelPricePerLiter: 1300, financeMonthlyRatePct: 3 }, info);
    assert.deepEqual([used.fuel.pricePerLiter, used.fuel.illustrative, used.finance.monthlyRatePct, used.finance.illustrative], [1300, false, 3, false]);
    // Sólo la parte marcada de ejemplo.
    const fuelOnly = applyCompanyValues(structuredClone(q), { fuelPricePerLiter: 1300, financeMonthlyRatePct: 3 }, { fuel: true, finance: false });
    assert.equal(fuelOnly.finance.monthlyRatePct, 4);
    const editor = code('js/ui/views/quote-editor.js');
    assert.match(editor, /`Usar los de mi empresa \(\$\{company\.companyText\}\)`/);
    assert.match(editor, /keep\(`Dejar estos \(\$\{company\.quoteText\}\)`\)/);
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
    for (const key of ['paymentTermDays', 'monthlyRatePct', 'contingencyPct', 'roundingStep']) {
      assert.match(settings, new RegExp(`COMPANY_LABELS\\.${key}`), key);
    }
    // C-5: el combustible, según la condición frente al IVA, con la misma función en los tres lados.
    assert.match(settings, /num\('fuelPricePerLiter', fuelPriceLabel\(settings\)/);
    assert.match(code('js/ui/views/quote-steps/logistics.js'), /label: fuelPriceLabel\(ctx\.settings\)/);
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
