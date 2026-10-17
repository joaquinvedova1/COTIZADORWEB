/**
 * RATEOS Test Lab — campaña ESTABLE de productos (PLAN-2026-008 / 013).
 *
 * Producto simple (compra / reventa), fabricado (materiales + mano de obra),
 * con equipo (tenencia + uso), con impuestos e IVA, con moneda extranjera,
 * volumen y "descuento" (precio actual menor al sugerido). La financiación y
 * los descuentos por volumen NO existen en el motor de productos: se dejan
 * como escenarios que documentan el hueco (HUMAN DECISION REQUIRED), nunca se
 * inventan. Datos SINTÉTICOS e ILUSTRATIVOS.
 */

import { product, ingredient, worker, machine, fixedCost, taxes, base } from '../lib/build.js';
import { exampleProduct } from '../../../js/domain/product-factory.js';
import { LAB_NOW, LAB_ORG, LAB_SETTINGS } from '../lib/build.js';

export const PRODUCT_SCENARIOS = [
  {
    id: 'PRD-01-RESALE',
    title: 'Producto simple de compra / reventa: precio del paquete, una unidad por venta, alquiler compartido',
    family: 'resale',
    build: () => product({
      id: 'prd-01', saleUnit: 'unidad', unitsPerBatch: 1, monthlyUnits: 1200,
      materials: [ingredient({ description: 'Artículo comprado (caja de 24)', per: 'unit', unit: 'u', useUnit: 'u', quantity: 1, priceMode: 'pack', packPrice: 48000, packSize: 24 })],
      fixedCosts: [fixedCost({ description: 'Alquiler del local', monthlyAmount: 900000, sharePct: 20 })],
      pricing: { targetMarginPct: 30, roundingStep: 10 },
    }),
    expect: { variablePerUnit: 2000, fixedPerUnit: 150, unitCost: 2150 },
  },
  {
    id: 'PRD-02-MANUFACTURED',
    title: 'Producto fabricado: receta en kg y g, mano de obra por tanda, 5 % de pérdida, se vende por docena',
    family: 'manufactured',
    build: () => product({
      id: 'prd-02', saleUnit: 'docena', unitsPerBatch: 40, lossPct: 5, monthlyUnits: 600,
      materials: [
        ingredient({ description: 'Harina', unit: 'kg', useUnit: 'kg', quantity: 10, unitCost: 900 }),
        ingredient({ description: 'Manteca', unit: 'kg', useUnit: 'g', quantity: 2500, unitCost: 8000, wastePct: 3 }),
        ingredient({ description: 'Caja', per: 'unit', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 350 }),
      ],
      labor: [worker({ role: 'Pastelero/a', basicMonthly: 1200000, minutesPerBatch: 150, people: 2 })],
      fixedCosts: [fixedCost({ description: 'Servicios fijos', monthlyAmount: 300000, sharePct: 40 })],
      pricing: { targetMarginPct: 28, roundingStep: 50 },
    }),
  },
  {
    id: 'PRD-03-WITH-EQUIPMENT',
    title: 'Producto con máquina: tenencia asignada 50 %, uso por tanda con energía, se vende por kg',
    family: 'equipment',
    build: () => product({
      id: 'prd-03', saleUnit: 'kg', unitsPerBatch: 25, monthlyUnits: 2000,
      materials: [ingredient({ description: 'Materia prima', unit: 'kg', useUnit: 'kg', quantity: 26, unitCost: 1800 })],
      labor: [worker({ role: 'Operario', basicMonthly: 1300000, minutesPerBatch: 60 })],
      equipment: [machine({ name: 'Mezcladora', replacementValue: 18000000, usefulLifeYears: 8, insuranceAnnual: 360000, maintenancePerHour: 900, minutesPerBatch: 45, energyPerHour: 2200, fixedSharePct: 50 })],
      pricing: { targetMarginPct: 22, roundingStep: 10 },
    }),
  },
  {
    id: 'PRD-04-FINANCING-GAP',
    title: 'Producto con financiación (cobro a 60 días): el motor de productos no modela plazos → hueco documentado',
    family: 'gap',
    gap: { id: 'product-financing', text: 'El motor de productos no tiene plazos de cobro ni de pago ni costo financiero (las cotizaciones sí, §8). Un producto vendido a 60 días no carga ese costo.' },
    build: () => product({
      id: 'prd-04', saleUnit: 'unidad', unitsPerBatch: 10, monthlyUnits: 500,
      materials: [ingredient({ description: 'Componente', per: 'unit', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 5200 })],
      labor: [worker({ role: 'Armador', basicMonthly: 1250000, minutesPerBatch: 50 })],
      pricing: { targetMarginPct: 20, roundingStep: 10 },
    }),
  },
  {
    id: 'PRD-05-VOLUME',
    title: 'Producto con volumen: 10× unidades por mes reparten los fijos (fijo por unidad ÷ 10)',
    family: 'volume',
    build: () => product({
      id: 'prd-05', saleUnit: 'caja', unitsPerBatch: 12, monthlyUnits: 5000,
      materials: [ingredient({ description: 'Insumo', per: 'unit', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 700 })],
      fixedCosts: [fixedCost({ description: 'Depósito', monthlyAmount: 1500000, sharePct: 100 })],
      pricing: { targetMarginPct: 15, roundingStep: 10 },
    }),
    expect: { fixedPerUnit: 300 },
  },
  {
    id: 'PRD-06-DISCOUNTED-PRICE',
    title: 'Producto con precio actual con descuento (90 % del sugerido): margen real y equilibrio',
    family: 'discount',
    build: () => {
      const p = product({
        id: 'prd-06', saleUnit: 'bandeja', unitsPerBatch: 20, monthlyUnits: 1500,
        materials: [ingredient({ description: 'Ingredientes por tanda', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 30000 })],
        labor: [worker({ role: 'Cocina', basicMonthly: 1100000, minutesPerBatch: 40 })],
        fixedCosts: [fixedCost({ description: 'Alquiler', monthlyAmount: 600000, sharePct: 50 })],
        pricing: { targetMarginPct: 30, roundingStep: 10, currentPrice: 3000 },
      });
      return p;
    },
  },
  {
    id: 'PRD-07-CHIPA-GOLDEN',
    title: 'Producto de ejemplo Chipá (golden ILUSTRATIVO)',
    family: 'manufactured',
    build: () => exampleProduct({ organizationId: LAB_ORG, settings: LAB_SETTINGS, now: LAB_NOW, id: 'prd-07', idFactory: (() => { let i = 0; return () => `chipa-${(i += 1)}`; })() }),
  },
  {
    id: 'PRD-08-VOLUME-UNITS-ML',
    title: 'Producto con líquidos (ml ↔ l) que se vende por porción',
    family: 'manufactured',
    build: () => product({
      id: 'prd-08', saleUnit: 'porción', unitsPerBatch: 30, monthlyUnits: 900,
      materials: [
        ingredient({ description: 'Leche', unit: 'l', useUnit: 'ml', quantity: 4500, unitCost: 1300 }),
        ingredient({ description: 'Esencia', unit: 'ml', useUnit: 'ml', quantity: 30, priceMode: 'pack', packPrice: 6000, packSize: 100 }),
      ],
      labor: [worker({ role: 'Cocina', basicMonthly: 1100000, minutesPerBatch: 35 })],
      pricing: { targetMarginPct: 35, roundingStep: 10 },
    }),
  },
  {
    id: 'PRD-09-TAXES-VAT',
    title: 'Producto con impuestos sobre la venta 5 % e IVA 21 % para el precio al público',
    family: 'taxes',
    build: () => product({
      id: 'prd-09', saleUnit: 'paquete', unitsPerBatch: 50, monthlyUnits: 2500,
      materials: [ingredient({ description: 'Insumos por tanda', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 60000 })],
      labor: [worker({ role: 'Envasado', basicMonthly: 1150000, minutesPerBatch: 30 })],
      billingTaxes: taxes(5),
      pricing: { targetMarginPct: 20, roundingStep: 10, vatPct: 21 },
    }),
  },
  {
    id: 'PRD-10-CURRENCY',
    title: 'Producto con insumo en USD (tipo de cambio del producto, ILUSTRATIVO)',
    family: 'currency',
    build: () => product({
      id: 'prd-10', saleUnit: 'unidad', unitsPerBatch: 100, monthlyUnits: 3000,
      materials: [ingredient({ description: 'Componente importado', per: 'unit', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 2.5, base: base('USD') })],
      exchangeRates: [{ currency: 'USD', rate: 1000, base: base('ARS') }],
      pricing: { targetMarginPct: 25, roundingStep: 10 },
    }),
    expect: { variablePerUnit: 2500 },
  },
  {
    id: 'PRD-E01-NO-MONTHLY-UNITS',
    title: 'Extremo: sin unidades por mes con gastos fijos (costo por unidad sin calcular, error visible)',
    family: 'edge',
    build: () => product({ id: 'prd-e01', monthlyUnits: 0, materials: [ingredient({ per: 'unit', unit: 'u', useUnit: 'u', unitCost: 500 })], fixedCosts: [fixedCost({ monthlyAmount: 100000 })] }),
    expect: { unitCost: null },
  },
  {
    id: 'PRD-E02-INCOMPATIBLE-UNITS',
    title: 'Extremo: unidad incompatible (g contra precio por unidad): no suma y es error',
    family: 'edge',
    build: () => product({ id: 'prd-e02', unitsPerBatch: 10, materials: [ingredient({ description: 'Mal cargado', unit: 'u', useUnit: 'g', quantity: 500, unitCost: 100 })] }),
  },
];
