/**
 * Servicio moldeable por componentes (PLAN-2026-019).
 *
 * Pedido del dueño: "¿Qué incluye?" no puede ser 3 opciones fijas; un
 * servicio es cualquier combinación (una persona con camioneta e insumos, una
 * cuadrilla con químicos, un tercero…). Los componentes no cambian fórmulas:
 * derivan las marcas personal / equipos que ya usaba el motor.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { createEmptyQuote, defaultSettings, createOtherCost } from '../../js/domain/quote-factory.js';
import {
  SERVICE_COMPONENTS, SERVICE_TEMPLATES, componentsOf, contractOf, contractWithComponents, contractUsesMaterials,
  serviceTypeForContract, templateOf, componentsLabel, contractLabel, componentsServiceLabel, contractUnits,
} from '../../js/domain/contract.js';

function quoteWith(contract, { unit = 'call' } = {}) {
  const settings = { ...defaultSettings('org'), illustrative: false, defaultBillingTaxes: null };
  const q = createEmptyQuote({ organizationId: 'org', settings, now: '2026-11-01T00:00:00.000Z', id: 'q-comp' });
  q.contract = contract;
  q.serviceType = serviceTypeForContract(contract);
  q.unit = unit;
  q.pricingMode = 'known_rate';
  q.billingTaxes = { mode: 'combined', notApplicable: true, combinedPct: null, items: [] };
  q.finance.monthlyRatePct = 0;
  q.risk.generalPct = 0;
  q.logistics.notApplicable = true;
  q.materialsNotApplicable = true;
  q.fuel.requiresConfirmation = false;
  q.activity = { ...q.activity, billableQuantityPerMonth: 8, daysPerActivation: 1 };
  q.pricing = { ...q.pricing, knownRate: 1300000, targetMarginPct: 15, roundingStep: 0 };
  q.indirect = { ...q.indirect, method: 'percent_direct', pct: 0 };
  q.otherCosts = [createOtherCost({ id: 'f', description: 'Fijo', category: 'labor', behavior: 'fixed_monthly', amount: 3000000 })];
  return q;
}

describe('Componentes del servicio (PLAN-2026-019)', () => {
  test('el catálogo cubre personal, vehículos, equipos, terceros, insumos, químicos, residuos y viáticos', () => {
    const ids = SERVICE_COMPONENTS.map((c) => c.id);
    ['labor', 'vehicle', 'machinery', 'subcontract', 'tools', 'supplies', 'chemicals', 'materials', 'ppe', 'waste', 'travel', 'other'].forEach((id) => assert.ok(ids.includes(id), id));
    SERVICE_COMPONENTS.forEach((c) => assert.ok(['labor', 'equipment', 'materials', 'logistics'].includes(c.step), `${c.id} → ${c.step}`));
    SERVICE_TEMPLATES.forEach((t) => t.components.forEach((id) => assert.ok(ids.includes(id), `${t.id}: ${id}`)));
  });

  test('una persona con camioneta e insumos: personal y equipos, on call', () => {
    const c = contractWithComponents({ mode: 'on_demand' }, ['supplies', 'vehicle', 'labor', 'tools']);
    assert.deepEqual(c.components, ['labor', 'vehicle', 'tools', 'supplies'], 'orden del catálogo');
    assert.equal(c.labor, true);
    assert.equal(c.equipment, true);
    assert.equal(serviceTypeForContract(c), 'on_call');
    assert.equal(templateOf(c.components).id, 'tech_pickup');
    assert.equal(contractUsesMaterials(c), true);
    assert.equal(componentsLabel(c), 'Personal + Vehículo + Herramientas + Insumos y consumibles');
  });

  test('equipo o vehículo sin personal = alquiler sin operador (igual que antes)', () => {
    const c = contractWithComponents({ mode: 'on_demand' }, ['machinery']);
    assert.deepEqual(contractOf({ contract: c }), { mode: 'on_demand', labor: false, equipment: true, legacy: false });
    assert.equal(serviceTypeForContract(c), 'equipment_only');
    assert.equal(contractUsesMaterials(c), false);
  });

  test('sólo un tercero cuenta como recurso con costo de proveedor', () => {
    const c = contractWithComponents({ mode: 'closed' }, ['subcontract']);
    assert.equal(c.equipment, true);
    assert.equal(c.labor, false);
    assert.equal(serviceTypeForContract(c), 'lump_sum');
  });

  test('sin personal ni equipos (sólo insumos u otros costos): no exige ninguno de los dos', () => {
    const c = contractWithComponents({ mode: 'on_demand' }, ['supplies', 'other']);
    assert.deepEqual(contractOf({ contract: c }), { mode: 'on_demand', labor: false, equipment: false, legacy: false });
    assert.equal(serviceTypeForContract(c), 'configurable');
    const r = computeQuote(quoteWith(c));
    const ids = r.completeness.items.map((i) => i.id);
    assert.ok(!ids.includes('equipment_cost'), 'no exige equipos');
    assert.ok(!r.completeness.items.some((i) => i.id === 'labor' && i.status === 'missing'), 'no exige personal');
    assert.ok(contractUnits(c).includes('call'));
  });

  test('cuadrilla con químicos sin equipos cargados: el vehículo pide su costo', () => {
    const c = contractWithComponents({ mode: 'on_demand' }, SERVICE_TEMPLATES.find((t) => t.id === 'crew_chemicals').components);
    const r = computeQuote(quoteWith(c));
    const item = r.completeness.items.find((i) => i.id === 'equipment_cost');
    assert.ok(item && item.status === 'missing', 'pide cargar el vehículo');
  });

  test('mismos números con marcas viejas y con los componentes equivalentes', () => {
    const pairs = [
      [{ mode: 'on_demand', labor: true, equipment: false }, ['labor']],
      [{ mode: 'on_demand', labor: true, equipment: true }, ['labor', 'machinery']],
      [{ mode: 'monthly', labor: false, equipment: true }, ['vehicle']],
    ];
    for (const [old, comps] of pairs) {
      const a = computeQuote(quoteWith(old, { unit: old.mode === 'monthly' ? 'month' : 'call' }));
      const b = computeQuote(quoteWith(contractWithComponents({ mode: old.mode }, comps), { unit: old.mode === 'monthly' ? 'month' : 'call' }));
      assert.deepEqual(b.kpis, a.kpis, comps.join('+'));
      assert.deepEqual(b.completeness.items.map((i) => [i.id, i.status]), a.completeness.items.map((i) => [i.id, i.status]), comps.join('+'));
    }
  });

  test('contratos guardados antes (marcas, sin lista) se leen igual y muestran sus componentes', () => {
    const old = { mode: 'on_demand', labor: true, equipment: false };
    assert.deepEqual(contractOf({ contract: old }), { mode: 'on_demand', labor: true, equipment: false, legacy: false });
    assert.deepEqual(componentsOf(old), ['labor']);
    assert.deepEqual(componentsOf({ mode: 'monthly', labor: false, equipment: false }), ['labor', 'machinery'], 'sin marcas = los dos (como antes)');
    assert.equal(contractUsesMaterials(old), null);
    assert.equal(componentsServiceLabel({ contract: old }), null, 'el listado sigue con el tipo de servicio');
  });

  test('componentes propios: se guardan limpios y cuentan como otros costos', () => {
    const c = contractWithComponents({ mode: 'monthly' }, ['labor', 'nope'], ['  Baño químico ', 'baño químico', '', 42, 'Laboratorio']);
    assert.deepEqual(c.components, ['labor']);
    assert.deepEqual(c.customComponents, ['Baño químico', 'Laboratorio']);
    assert.equal(contractUsesMaterials(c), true);
    assert.equal(contractLabel({ contract: c }), 'Fijo mensual · personal + baño químico + laboratorio');
    assert.equal(componentsServiceLabel({ contract: c }), 'Fijo mensual · personal + baño químico + laboratorio');
    assert.equal(templateOf(['labor', 'vehicle']).id, 'vehicle_driver');
    assert.equal(templateOf(['labor', 'chemicals']), null);
  });
});
