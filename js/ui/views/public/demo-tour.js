/**
 * Demo guiada (#/demo): "Hidrogrúa on-call — Añelo" en 4 pasos, ANTES del
 * resultado completo. Todos los valores son ILUSTRATIVOS.
 *
 * 1. El servicio · 2. Lo que cuesta prestarlo · 3. El resultado · 4. Probalo vos
 *
 * Recorrerla NO escribe nada: muestra la cotización de ejemplo guardada si
 * existe o, si se borró, la demo en memoria (ctx.quotes.getDemoQuote) y la
 * calcula con el motor (ctx.quotes.compute). Recién "Ver el análisis
 * completo" la guarda (ensureDemoQuote), porque es una acción explícita. En
 * modo sólo lectura, si el ejemplo no está guardado, ese botón queda
 * deshabilitado. El paso 4 recalcula sobre una COPIA de la cotización (días
 * activos distintos) y nunca guarda nada.
 *
 * #/demo?paso=2 abre directo en un paso (1 a 4). #/demo?desde=app (desde la
 * aplicación) cambia "Salir del ejemplo" por "Volver a RATEOS" (→ #/inicio) y
 * #/demo?desde=bienvenida, por "Volver a la bienvenida" (→ #/bienvenida, que
 * retoma las respuestas que la persona ya había dado).
 */

import { h, mount, uniqueId } from '../../dom.js';
import { bigStat, button, disclosure, stepIndicator, traceButton } from '../../components.js';
import { computeQuote } from '../../../engines/quote-engine.js';
import { demoHydroCraneQuote } from '../../../domain/demo-data.js';
import { defaultSettings } from '../../../domain/quote-factory.js';
import { APP_NAME, DEFAULT_MATRIX_DAYS } from '../../../config.js';
import { formatMoney, formatMoneyCeil, formatNumber, formatPercent, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { deepClone } from '../../../core/object.js';
import { logger } from '../../../core/logger.js';
import { costBreakdown } from '../../cost-breakdown.js';
import { userErrorMessage } from '../../layout.js';
import { costGroupLabel, flowHeader, focusHeading, hashParams, headerLink, illustrativeLabel, isReadOnly, pubLink, publicIcon } from './public-chrome.js';

const STEPS = Object.freeze(['El servicio', 'Lo que cuesta prestarlo', 'El resultado', 'Probalo vos']);
const NEXT_LABELS = Object.freeze({ 1: 'Ver lo que cuesta', 2: 'Ver el resultado', 3: 'Probalo vos' });

/** Qué incluye cada rubro (para la lectura simple del paso 2). */
const CATEGORY_HINTS = Object.freeze({
  labor: 'Sueldos, cargas sociales, horas extra y viandas.',
  equipment: 'Amortización, seguro, patente, mantenimiento y neumáticos.',
  fuel: 'Lo que consumen los equipos y los traslados.',
  logistics: 'Kilómetros, peajes y viáticos de cada viaje.',
  materials: 'Insumos y repuestos que se consumen en el servicio.',
  structure: 'La parte de los gastos de la empresa (oficina, administración) que absorbe el servicio.',
  financial: 'Lo que cuesta financiar el servicio hasta que te pagan.',
  contingency: 'Un colchón para imprevistos.',
});

/** Nombres en minúscula para describir lo que agrupa "Otros". */
const CATEGORY_NAMES = Object.freeze({
  labor: 'mano de obra',
  equipment: 'equipos',
  fuel: 'combustible',
  logistics: 'viajes',
  materials: 'materiales',
  structure: 'gastos de estructura',
  financial: 'costo financiero',
  contingency: 'imprevistos',
});

/** "a, b y c" */
function listText(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function groupHint(group) {
  if (group.categories.length === 1 && CATEGORY_HINTS[group.categories[0]]) return CATEGORY_HINTS[group.categories[0]];
  const names = group.categories.map((c) => CATEGORY_NAMES[c] || c);
  const text = listText(names);
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : '';
}

/** Paso inicial pedido en el hash (#/demo?paso=2). */
function initialStep() {
  const n = Number(hashParams().get('paso'));
  return Number.isInteger(n) && n >= 1 && n <= STEPS.length ? n : 1;
}

/**
 * De dónde se abrió la demo (#/demo?desde=…): cambia la salida del
 * encabezado para volver a donde estaba la persona. Sin origen conocido, la
 * salida es "Salir del ejemplo" (→ la página principal).
 */
const ORIGINS = Object.freeze({
  app: { exitLabel: 'Volver a RATEOS', exitHref: '#/inicio', brandHref: '#/inicio', brandLabel: `${APP_NAME}: ir al inicio` },
  bienvenida: { exitLabel: 'Volver a la bienvenida', exitHref: '#/bienvenida', brandHref: '#/', brandLabel: undefined },
});

function demoOrigin() {
  const from = hashParams().get('desde');
  return Object.prototype.hasOwnProperty.call(ORIGINS, from) ? ORIGINS[from] : null;
}

/**
 * Cotización de ejemplo + función de cálculo. NO escribe: la guardada si
 * existe o la demo en memoria (stored: false). Si ni siquiera se puede leer,
 * usa la demo en memoria con el motor directamente (available: false).
 */
async function loadDemo(app) {
  try {
    const { quote, stored } = await app.ctx.quotes.getDemoQuote();
    const compute = (q, options = {}) => app.ctx.quotes.compute(q, options);
    return { quote, result: await compute(quote), stored: Boolean(stored), available: true, compute };
  } catch (error) {
    logger.info('Demo guiada: se usa la cotización de ejemplo en memoria', { name: error && error.name });
    let settings;
    try {
      settings = await app.getSettings();
    } catch {
      settings = defaultSettings();
    }
    const quote = demoHydroCraneQuote();
    const compute = async (q, options = {}) => computeQuote(q, { settings, ...options });
    return { quote, result: await compute(quote), stored: false, available: false, compute };
  }
}

/**
 * Línea "Neta, después del descuento…" cuando la tarifa piso de lista y la
 * neta difieren (tramo de días, permanencia o descuento comercial).
 * @returns {string|null}
 */
function netFloorText({ floorList, floorNet, tier, discountFactor }) {
  if (!isFiniteNumber(floorList) || !isFiniteNumber(floorNet) || floorNet <= 0) return null;
  if (formatMoneyCeil(floorList) === formatMoneyCeil(floorNet)) return null;
  const tierPct = tier && isFiniteNumber(tier.discountPct) ? tier.discountPct : 0;
  const onlyTier = tierPct > 0 && isFiniteNumber(discountFactor) && Math.abs(discountFactor - (1 - tierPct / 100)) < 1e-9;
  if (onlyTier) {
    const from = Number(tier.fromDays);
    const to = Number(tier.toDays);
    const range = isFiniteNumber(from) && isFiniteNumber(to) && to > from ? `${formatNumber(from)}–${formatNumber(to)} días` : formatDays(from, { decimals: 1 });
    return `Neta, después del descuento del tramo de ${range} (${formatPercent(tierPct, { decimals: 0 })}): ${formatMoneyCeil(floorNet)}`;
  }
  return `Neta, después de los descuentos: ${formatMoneyCeil(floorNet)}`;
}

function unitText(result) {
  return (result && result.unitLabel) || 'día';
}

function chargeText(unit) {
  if (unit === 'hour') return 'Por hora trabajada';
  if (unit === 'month') return 'Abono mensual';
  return 'Por día trabajado';
}

function profitTone(value) {
  if (!isFiniteNumber(value)) return null;
  if (value > 0.5) return 'green';
  if (value < -0.5) return 'red';
  return 'orange';
}

function marginTone(k) {
  if (!isFiniteNumber(k.marginPct)) return null;
  if (k.marginPct < 0) return 'red';
  if (k.marginPct < k.targetMarginPct - 1e-9) return 'orange';
  return 'green';
}

/** Días que se ofrecen en el paso 4: los de la matriz de la cotización (incluye los previstos). */
function dayOptions(result) {
  const available = result && result.activity && isFiniteNumber(result.activity.availableDaysPerMonth) ? result.activity.availableDaysPerMonth : 30;
  const fromMatrix = Array.isArray(result && result.matrix) ? result.matrix.map((r) => r.activeDays) : [];
  const base = fromMatrix.length ? fromMatrix : [...DEFAULT_MATRIX_DAYS];
  return [...new Set(base.filter((d) => isFiniteNumber(d) && d > 0 && d <= available))].sort((a, b) => a - b).slice(0, 7);
}

export async function render(root, app) {
  app.setHeader({ title: 'Probar con un ejemplo' });

  const origin = demoOrigin();
  const demo = await loadDemo(app);
  const { quote, result, compute } = demo;
  const readOnly = isReadOnly(app);
  const k = result.kpis || {};
  const unit = unitText(result);
  const estimatedDays = k.activeDays;
  const baseRate = isFiniteNumber(k.commercialListRate) && k.commercialListRate > 0 ? k.commercialListRate : null;
  // "Tu tarifa" sólo si la cotización ofrece una; sin ninguna tarifa (p. ej. sin
  // días previstos o sin costos) no se habla de una tarifa ofrecida.
  const isOwnRate = baseRate !== null && k.commercialSource !== 'suggested';
  const rateName = isOwnRate ? 'tarifa ofrecida' : 'tarifa sugerida';
  const rates = result.ratesAtEstimate || {};

  const options = dayOptions(result);
  const state = { step: initialStep(), days: isFiniteNumber(estimatedDays) && estimatedDays > 0 ? estimatedDays : options[0] || DEFAULT_MATRIX_DAYS[0] };
  const simCache = new Map();
  let showToken = 0;

  /** Recalcula sobre una COPIA con otros días activos (no se guarda). */
  async function simulate(days) {
    if (simCache.has(days)) return simCache.get(days);
    const copy = deepClone(quote);
    copy.activity = { ...(copy.activity || {}), activeDaysPerMonth: days };
    const r = await compute(copy, baseRate !== null ? { listRateOverride: baseRate } : {});
    const at = r.ratesAtEstimate || {};
    const out = {
      floor: r.kpis.floorListRate,
      floorNet: r.kpis.floorNetRate,
      tier: at.tier || null,
      discountFactor: at.discountFactor,
      profit: baseRate !== null ? r.kpis.profit : null,
      totalCost: r.kpis.totalCost,
    };
    simCache.set(days, out);
    return out;
  }

  const optionValues = new Map();
  for (const d of options) {
    try {
      optionValues.set(d, await simulate(d));
    } catch (error) {
      logger.warn('Demo guiada: no se pudo simular', { name: error && error.name });
    }
  }

  const body = h('div', { class: 'pub-flow-body pub-container pub-container-demo' });

  // ---------------------------------------------------------------- pasos

  function stepService() {
    const a = quote.activity || {};
    const lg = quote.logistics || {};
    const route = lg.baseName && lg.destinationName ? `${lg.baseName} → ${lg.destinationName}${isFiniteNumber(lg.distanceKm) && lg.distanceKm > 0 ? ` · ${formatNumber(lg.distanceKm)} km` : ''}` : EMPTY;
    const facts = [
      ['Cómo se cobra', chargeText(result.unit)],
      ['Disponibilidad', a.availability === '24/7' ? '24 horas, todos los días' : a.availability || EMPTY],
      ['Recorrido', route],
      ['Días de trabajo previstos', isFiniteNumber(estimatedDays) ? `${formatNumber(estimatedDays, { decimals: 1 })} por mes` : EMPTY],
    ];
    return [
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, 'Una hidrogrúa disponible las 24 horas para una operadora en Añelo.'),
      h('p', { class: 'pub-flow-text' }, 'Es un servicio ', h('strong', {}, 'on-call'), ': está disponible todo el mes, pero sólo cobrás los días que te llaman.'),
      h('dl', { class: 'pub-facts' }, ...facts.map(([label, value]) => h('div', { class: 'pub-fact' }, h('dt', {}, label), h('dd', {}, value)))),
      h(
        'div',
        { class: 'pub-question' },
        h('p', { class: 'pub-question-kicker' }, 'La pregunta clave'),
        h('p', { class: 'pub-question-text' }, '¿Cuánto cobrar por día si no sabés cuántos días vas a trabajar?'),
        h('p', { class: 'pub-question-hint' }, 'RATEOS lo responde en los próximos pasos.'),
      ),
    ];
  }

  function stepCosts() {
    const groups = costBreakdown(result.eecc, { top: 4, decimals: 0 });
    const total = groups.reduce((sum, g) => sum + g.amount, 0);
    const fixedShare = isFiniteNumber(k.fixedCosts) && isFiniteNumber(k.totalCost) && k.totalCost > 0 ? (k.fixedCosts / k.totalCost) * 100 : null;
    return [
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, 'Esto es lo que necesitás para prestarlo.'),
      h('p', { class: 'pub-flow-text' }, `Costos de un mes, con ${isFiniteNumber(estimatedDays) ? formatDays(estimatedDays, { decimals: 1 }) : EMPTY} de trabajo previstos.`),
      h(
        'ul',
        { class: 'pub-costs', 'aria-label': '¿En qué se va el costo?' },
        ...groups.map((g) =>
          h(
            'li',
            { class: 'pub-cost' },
            h('div', { class: 'pub-cost-text' }, h('span', { class: 'pub-cost-label' }, costGroupLabel(g)), h('span', { class: 'pub-cost-hint' }, groupHint(g))),
            h('div', { class: 'pub-cost-figures' }, h('span', { class: 'pub-cost-amount' }, formatMoney(g.amount)), h('span', { class: 'pub-cost-pct' }, `${g.pct} %`)),
            h('div', { class: 'pub-cost-track', 'aria-hidden': 'true' }, h('span', { class: 'pub-cost-fill', style: { width: `${total > 0 ? (g.amount / total) * 100 : 0}%` } })),
          ),
        ),
      ),
      h(
        'div',
        { class: 'pub-cost-total' },
        h('div', {}, h('p', { class: 'pub-cost-total-label' }, 'Costo del mes'), result.traces && result.traces.totalCost ? traceButton(result.traces.totalCost) : null),
        h('p', { class: 'pub-cost-total-value' }, formatMoney(k.totalCost)),
      ),
      fixedShare !== null
        ? h('p', { class: 'pub-insight' }, publicIcon('info', { size: 18 }), h('span', {}, h('strong', {}, `El ${formatPercent(fixedShare, { decimals: 0 })} del costo es fijo: `), 'lo pagás aunque no te llamen. Por eso importa cuántos días trabajás.'))
        : null,
      h('p', { class: 'pub-footnote' }, 'Todos los valores son ILUSTRATIVOS: no son sueldos, cargas, precios ni costos reales.'),
    ];
  }

  /** Por qué todavía no hay tarifa (en vez de mostrar "— / día"). */
  function missingRateHint() {
    if (quote.pricingMode === 'known_rate') return 'Falta cargar la tarifa en la cotización.';
    if (!isFiniteNumber(k.activeDays) || k.activeDays <= 0) return 'Se calcula cuando hay días de trabajo previstos.';
    if (!isFiniteNumber(k.totalCost) || k.totalCost <= 0) return 'Se calcula cuando hay costos cargados.';
    return 'Con estos datos todavía no se puede calcular.';
  }

  function rateStat(traces) {
    if (baseRate === null) {
      const knownRate = quote.pricingMode === 'known_rate';
      return bigStat({
        label: knownRate ? 'Tu tarifa' : 'Tarifa sugerida',
        value: EMPTY,
        hint: missingRateHint(),
        trace: knownRate ? traces.expectedResult : traces.targetRate,
        className: 'pub-stat pub-stat-accent',
      });
    }
    return bigStat({
      label: isOwnRate ? 'Tu tarifa' : 'Tarifa sugerida',
      value: formatMoneyCeil(baseRate),
      unit: `/ ${unit}`,
      hint: isOwnRate ? 'La tarifa ofrecida en la cotización.' : `Para ganar el ${formatPercent(k.targetMarginPct)} de margen objetivo.`,
      trace: isOwnRate ? traces.expectedResult : traces.targetRate,
      className: 'pub-stat pub-stat-accent',
    });
  }

  function stepResult() {
    const traces = result.traces || {};
    const be = result.breakEven || {};
    const hasFloor = isFiniteNumber(k.floorListRate);
    const floorStat = bigStat({ label: 'Tarifa piso (de lista)', value: formatMoneyCeil(k.floorListRate), unit: hasFloor ? `/ ${unit}` : null, hint: 'El precio mínimo para no perder plata.', trace: traces.floorRate, className: 'pub-stat' });
    const netText = netFloorText({ floorList: k.floorListRate, floorNet: k.floorNetRate, tier: rates.tier, discountFactor: rates.discountFactor });
    if (netText) {
      const hint = floorStat.querySelector('.big-stat-hint');
      const net = h('div', { class: 'pub-stat-net' }, `${netText}.`);
      if (hint) hint.after(net);
      else floorStat.appendChild(net);
    }
    const rateLead = isOwnRate ? 'Con tu tarifa' : 'Con la tarifa sugerida';
    let sentence;
    if (be.reachable && isFiniteNumber(k.breakEvenDays)) {
      sentence = h(
        'p',
        { class: 'pub-sentence' },
        baseRate !== null ? `${rateLead} (${formatMoneyCeil(baseRate)}/${unit}) necesitás aproximadamente ` : 'Necesitás aproximadamente ',
        h('strong', {}, `${formatNumber(k.breakEvenDays, { decimals: 1 })} días activos por mes`),
        ' para cubrir todos tus costos.',
      );
    } else if (baseRate === null) {
      sentence = h('p', { class: 'pub-sentence' }, 'Sin una tarifa no se puede calcular cuántos días necesitás para no perder plata.');
    } else {
      sentence = h('p', { class: 'pub-sentence' }, be.reason || 'Con estos datos no se puede calcular cuántos días necesitás para no perder plata.');
    }
    return [
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, 'Así se ve el resultado.'),
      h('p', { class: 'pub-flow-text' }, 'Cuatro números para decidir. Cada uno se puede auditar con “Ver cálculo”.'),
      h(
        'div',
        { class: 'pub-stats' },
        bigStat({ label: 'Costo del mes', value: formatMoney(k.totalCost), unit: '/ mes', hint: `Con ${isFiniteNumber(estimatedDays) ? formatDays(estimatedDays, { decimals: 1 }) : EMPTY} de trabajo.`, trace: traces.totalCost, className: 'pub-stat' }),
        floorStat,
        rateStat(traces),
        bigStat({ label: 'Margen', value: formatPercent(k.marginPct), hint: 'Sobre el precio de venta (no es markup).', tone: marginTone(k), trace: traces.expectedResult, className: 'pub-stat' }),
      ),
      h('div', { class: 'pub-sentence-wrap' }, sentence, traces.breakEven && be.reachable ? traceButton(traces.breakEven) : null),
      disclosure(
        { summary: '¿Qué significa cada número?', className: 'pub-glossary' },
        h(
          'dl',
          { class: 'pub-glossary-list' },
          h('div', {}, h('dt', {}, 'Costo del mes'), h('dd', {}, 'Todo lo que cuesta prestar el servicio en el mes: personal, equipos, combustible, viajes, gastos de estructura e imprevistos.')),
          h('div', {}, h('dt', {}, 'Tarifa piso'), h('dd', {}, 'El precio mínimo por día para no perder plata. Debajo de este número, perdés. La “de lista” es la que escribís en la cotización; la “neta”, lo que te queda después de los descuentos (por ejemplo, por cantidad de días).')),
          h('div', {}, h('dt', {}, 'Tarifa sugerida'), h('dd', {}, 'El precio para lograr el margen que buscás, redondeado hacia arriba.')),
          h('div', {}, h('dt', {}, 'Margen'), h('dd', {}, 'Lo que ganás sobre el precio de venta. No es lo mismo que el markup, que se calcula sobre el costo: con un costo de $ 100, un margen del 10 % da un precio de $ 111,11 y un markup del 10 %, de $ 110.')),
        ),
      ),
    ];
  }

  function stepTry() {
    const output = h('div', { class: 'pub-sim-output', 'aria-live': 'polite' });
    const errorId = uniqueId('pub-sim-err');
    const customId = uniqueId('pub-sim-custom');
    // Región de alerta siempre presente (vacía si no hay error): así los
    // lectores de pantalla anuncian el mensaje cuando aparece.
    const errorEl = h('p', { class: 'pub-sim-error', id: errorId, role: 'alert' });
    const setError = (message) => {
      errorEl.textContent = message || '';
      if (message) custom.setAttribute('aria-invalid', 'true');
      else custom.removeAttribute('aria-invalid');
    };
    const groupName = uniqueId('pub-days');
    const maxDays = result.activity && isFiniteNumber(result.activity.availableDaysPerMonth) ? Math.floor(result.activity.availableDaysPerMonth) : 30;
    const maxFloor = Math.max(0, ...[...optionValues.values()].map((v) => (isFiniteNumber(v.floor) ? v.floor : 0)));
    const radios = [];

    const custom = h('input', {
      id: customId,
      type: 'number',
      inputmode: 'numeric',
      min: '1',
      max: String(maxDays),
      step: '1',
      value: options.includes(state.days) ? '' : String(state.days),
      placeholder: 'Ej.: 12',
      'aria-describedby': errorId,
    });

    async function showFor(days) {
      state.days = days;
      const token = ++showToken;
      let sim = null;
      try {
        sim = await simulate(days);
      } catch (error) {
        logger.warn('Demo guiada: no se pudo simular', { name: error && error.name });
      }
      const base = optionValues.get(estimatedDays) || (isFiniteNumber(estimatedDays) ? await simulate(estimatedDays).catch(() => null) : null);
      if (token !== showToken) return;
      const floor = sim ? sim.floor : null;
      let delta = null;
      if (isFiniteNumber(estimatedDays) && Math.abs(days - estimatedDays) < 1e-9) {
        delta = `Es la cantidad prevista en la cotización (${formatDays(estimatedDays, { decimals: 1 })}).`;
      } else if (base && isFiniteNumber(base.floor) && base.floor > 0 && isFiniteNumber(floor)) {
        const change = (floor / base.floor - 1) * 100;
        delta = `${formatPercent(Math.abs(change), { decimals: 0 })} ${change >= 0 ? 'más alta' : 'más baja'} que con los ${formatDays(estimatedDays, { decimals: 1 })} previstos.`;
      }
      const profit = sim ? sim.profit : null;
      const tone = profitTone(profit);
      let verdict = null;
      if (baseRate !== null && isFiniteNumber(profit)) {
        const outcome = tone === 'green' ? ['ganás ', formatMoney(profit)] : tone === 'red' ? ['perdés ', formatMoney(-profit)] : ['no ganás ni perdés', ''];
        verdict = h(
          'p',
          { class: ['pub-sim-verdict', tone ? `is-${tone}` : null] },
          `Si mantenés la ${rateName} de ${formatMoneyCeil(baseRate)}/${unit} y trabajás ${formatDays(days, { decimals: 1 })}, en el mes `,
          h('strong', {}, outcome[0], outcome[1]),
          '.',
        );
      }
      const netText = sim ? netFloorText({ floorList: sim.floor, floorNet: sim.floorNet, tier: sim.tier, discountFactor: sim.discountFactor }) : null;
      mount(
        output,
        h('p', { class: 'pub-sim-label' }, `Tarifa piso (de lista) con ${formatDays(days, { decimals: 1 })} de trabajo por mes`),
        h('p', { class: 'pub-sim-value' }, formatMoneyCeil(floor), h('span', { class: 'pub-sim-unit' }, `/ ${unit}`)),
        netText ? h('p', { class: 'pub-sim-net' }, `${netText}.`) : null,
        delta ? h('p', { class: 'pub-sim-delta' }, delta) : null,
        verdict,
      );
    }

    custom.addEventListener('input', () => {
      const raw = custom.value.trim();
      if (raw === '') {
        setError('');
        return;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > maxDays) {
        setError(`Ingresá un número entero de días entre 1 y ${maxDays}.`);
        return;
      }
      setError('');
      radios.forEach((r) => {
        r.checked = Number(r.value) === n;
      });
      showFor(n);
    });

    const columns = options.map((d) => {
      const id = uniqueId('pub-day');
      const v = optionValues.get(d);
      const height = v && isFiniteNumber(v.floor) && maxFloor > 0 ? Math.max(6, (v.floor / maxFloor) * 100) : 6;
      const input = h('input', { type: 'radio', id, name: groupName, value: String(d), checked: Math.abs(d - state.days) < 1e-9, class: 'pub-sim-radio' });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        custom.value = '';
        setError('');
        showFor(d);
      });
      radios.push(input);
      const isEstimate = isFiniteNumber(estimatedDays) && Math.abs(d - estimatedDays) < 1e-9;
      return h(
        'label',
        { class: ['pub-sim-col', isEstimate ? 'is-estimate' : null], for: id },
        input,
        h('span', { class: 'pub-sim-bar-area', 'aria-hidden': 'true' }, h('span', { class: 'pub-sim-bar', style: { height: `${height}%` } })),
        h('span', { class: 'pub-sim-col-label' }, `${formatNumber(d, { decimals: 1 })} días`),
        h('span', { class: 'pub-sim-col-note' }, isEstimate ? 'previsto' : ''),
      );
    });

    showFor(state.days);

    const resultHref = `#/cotizaciones/${encodeURIComponent(quote.id)}/result`;
    // Guardada: sólo se navega (no escribe, también en sólo lectura).
    // Sin guardar: se guarda recién ahora, ante esta acción explícita.
    // Sin poder guardarla (sólo lectura o datos ilegibles): deshabilitado.
    const canOpen = demo.stored || (demo.available && !readOnly);
    let analysisAction;
    if (demo.stored) {
      analysisAction = pubLink('Ver el análisis completo', resultHref, { tone: 'primary', iconAfter: 'arrowRight' });
    } else if (canOpen) {
      let busy = false;
      analysisAction = h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary btn-lg pub-btn',
          on: {
            click: async () => {
              if (busy) return;
              busy = true;
              analysisAction.disabled = true;
              try {
                const saved = await app.ctx.quotes.ensureDemoQuote();
                app.toast('Guardamos el ejemplo en tus cotizaciones para que puedas explorarlo.', 'success');
                app.navigate(`#/cotizaciones/${encodeURIComponent((saved && saved.id) || quote.id)}/result`);
              } catch (error) {
                logger.warn('Demo guiada: no se pudo guardar el ejemplo', { name: error && error.name });
                app.toast(userErrorMessage(error, 'No se pudo guardar el ejemplo en este navegador, así que no se puede abrir completo. Probá de nuevo.'), 'danger');
                busy = false;
                analysisAction.disabled = false;
              }
            },
          },
        },
        h('span', {}, 'Ver el análisis completo'),
        publicIcon('arrowRight', { size: 18 }),
      );
    } else {
      analysisAction = button('Ver el análisis completo', { variant: 'primary', size: 'lg', disabled: true, attrs: { class: 'btn btn-primary btn-lg pub-btn', 'aria-describedby': 'pub-demo-unavailable' } });
    }
    const pending = result.completeness && Array.isArray(result.completeness.pending) ? result.completeness.pending : [];

    return [
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, '¿Y si te llaman menos días?'),
      h('p', { class: 'pub-flow-text' }, 'Cuantos menos días trabajes, mayor tiene que ser la tarifa para cubrir los costos fijos. Elegí cuántos días por mes esperás trabajar.'),
      h(
        'div',
        { class: 'pub-sim' },
        h(
          'fieldset',
          { class: 'pub-sim-picker' },
          h('legend', { class: 'pub-label' }, 'Días de trabajo por mes'),
          h('div', { class: 'pub-sim-chart' }, ...columns),
          h(
            'div',
            { class: 'pub-sim-custom' },
            h('label', { class: 'pub-sim-custom-label', for: customId }, 'Otra cantidad'),
            h('span', { class: 'pub-sim-custom-control' }, custom, h('span', { class: 'pub-sim-custom-unit' }, 'días')),
          ),
          errorEl,
        ),
        output,
      ),
      h('p', { class: 'pub-footnote' }, 'Recalculamos sobre una copia del ejemplo: no se guarda ningún cambio. Valores ILUSTRATIVOS.'),
      h(
        'div',
        { class: 'pub-demo-final' },
        h('p', { class: 'pub-demo-final-title' }, 'Esto es sólo la superficie.'),
        h('p', { class: 'pub-demo-final-text' }, 'En el análisis completo ves la estructura de costos, la tarifa según días trabajados, escenarios, descuentos y cada cálculo paso a paso.'),
        pendingLine(pending),
        h(
          'div',
          { class: 'pub-demo-final-actions' },
          analysisAction,
          // Desde la bienvenida, la continuación es volver a ella: ahí se elige con qué datos empezar.
          origin === ORIGINS.bienvenida
            ? pubLink(origin.exitLabel, origin.exitHref, { tone: 'secondary', iconBefore: 'arrowLeft' })
            : pubLink('Crear mi propia cotización', '#/cotizaciones/nueva', { tone: 'secondary' }),
        ),
        canOpen
          ? null
          : h('p', { class: 'pub-footnote', id: 'pub-demo-unavailable' }, 'El ejemplo no está guardado en este navegador y no se puede guardar ahora (por ejemplo, porque tus datos están en modo sólo lectura), así que no se puede abrir completo.'),
      ),
    ];
  }

  /**
   * Los puntos "para revisar" del ejemplo se presentan como didácticos: el
   * ejemplo original deja 2 a propósito (relevos y equipo en espera).
   */
  function pendingLine(items) {
    if (!items.length) return null;
    const ids = items.map((i) => i.id).sort().join(',');
    const names = { relief: 'relevos', standby: 'equipo en espera' };
    const list = listText(items.map((i) => names[i.id] || String(i.label || '').toLocaleLowerCase('es-AR')).filter(Boolean));
    const n = items.length;
    const text =
      ids === 'relief,standby'
        ? 'El ejemplo deja 2 puntos para revisar a propósito (relevos y equipo en espera): RATEOS te avisa lo que falta.'
        : `El ejemplo tiene ${n} ${n === 1 ? 'punto' : 'puntos'} para revisar (${list}): RATEOS te avisa lo que falta.`;
    return h('p', { class: 'pub-demo-final-note' }, publicIcon('info', { size: 18 }), h('span', {}, text));
  }

  // ----------------------------------------------------------- navegación

  function navButtons() {
    const back = state.step > 1 ? button('Atrás', { variant: 'ghost', size: 'lg', icon: 'arrowLeft', onClick: () => go(state.step - 1) }) : h('span');
    const next =
      state.step < STEPS.length
        ? h(
            'button',
            { type: 'button', class: 'btn btn-primary btn-lg pub-btn', on: { click: () => go(state.step + 1) } },
            h('span', {}, NEXT_LABELS[state.step]),
            publicIcon('arrowRight', { size: 18 }),
          )
        : null;
    return h('div', { class: 'pub-flow-actions' }, back, next);
  }

  function draw() {
    const screens = { 1: stepService, 2: stepCosts, 3: stepResult, 4: stepTry };
    mount(
      body,
      h(
        'div',
        { class: 'pub-demo-top' },
        stepIndicator({ current: state.step, total: STEPS.length, label: `Paso ${state.step} de ${STEPS.length} · ${STEPS[state.step - 1]}` }),
        illustrativeLabel('Ejemplo ilustrativo'),
      ),
      h('div', { class: 'pub-flow-screen' }, ...screens[state.step]()),
      navButtons(),
    );
  }

  function go(step) {
    state.step = Math.min(STEPS.length, Math.max(1, step));
    draw();
    window.scrollTo(0, 0);
    focusHeading(body.querySelector('h1'));
  }

  draw();
  mount(
    root,
    h(
      'div',
      { class: 'pub-page pub-flow pub-demo' },
      flowHeader({
        brandHref: origin ? origin.brandHref : '#/',
        brandLabel: origin ? origin.brandLabel : undefined,
        actions: [origin ? headerLink(origin.exitLabel, origin.exitHref, { iconBefore: 'arrowLeft' }) : headerLink('Salir del ejemplo', '#/', { iconBefore: 'close' })],
      }),
      body,
    ),
  );
}
