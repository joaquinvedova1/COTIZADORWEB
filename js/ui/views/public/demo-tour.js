/**
 * Demo guiada (#/demo): "Hidrogrúa on-call — Añelo" en 4 pasos, ANTES del
 * resultado completo. Todos los valores son ILUSTRATIVOS.
 *
 * 1. El servicio · 2. Lo que cuesta prestarlo · 3. El resultado · 4. Probalo vos
 *
 * Usa la cotización de ejemplo guardada (ctx.quotes.ensureDemoQuote) y el
 * motor (ctx.quotes.compute). Si no se puede guardar (p. ej. modo sólo
 * lectura), usa la demo en memoria con computeQuote y deshabilita "Ver el
 * análisis completo". El paso 4 recalcula sobre una COPIA de la cotización
 * (días activos distintos) y nunca guarda nada.
 *
 * Abre directo en un paso con #/demo?paso=2 (1 a 4).
 */

import { h, mount, uniqueId } from '../../dom.js';
import { bigStat, button, disclosure, stepIndicator, traceButton } from '../../components.js';
import { computeQuote } from '../../../engines/quote-engine.js';
import { demoHydroCraneQuote } from '../../../domain/demo-data.js';
import { defaultSettings } from '../../../domain/quote-factory.js';
import { DEFAULT_MATRIX_DAYS } from '../../../config.js';
import { formatMoney, formatMoneyCeil, formatNumber, formatPercent, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber, roundPercentagesToTotal } from '../../../core/money.js';
import { deepClone } from '../../../core/object.js';
import { logger } from '../../../core/logger.js';
import { flowHeader, focusHeading, headerLink, illustrativeLabel, pubLink, publicIcon } from './public-chrome.js';

const STEPS = Object.freeze(['El servicio', 'Lo que cuesta prestarlo', 'El resultado', 'Probalo vos']);
const NEXT_LABELS = Object.freeze({ 1: 'Ver lo que cuesta', 2: 'Ver el resultado', 3: 'Probalo vos' });

/** Rubros agrupados para una lectura simple (el detalle completo vive en el resultado). */
const COST_GROUPS = Object.freeze([
  { label: 'Mano de obra', hint: 'Sueldos, cargas sociales, horas extra y viandas.', categories: ['labor'] },
  { label: 'Equipos', hint: 'Amortización, seguro, patente, mantenimiento y neumáticos.', categories: ['equipment'] },
  { label: 'Combustible', hint: 'Lo que consumen los equipos y los traslados.', categories: ['fuel'] },
  { label: 'Logística', hint: 'Kilómetros, peajes y viáticos de cada viaje.', categories: ['logistics'] },
  { label: 'Otros', hint: 'Materiales, estructura de la empresa, costo financiero e imprevistos.', categories: ['materials', 'structure', 'financial', 'contingency'] },
]);

/** Paso inicial pedido en el hash (#/demo?paso=2). */
function initialStep() {
  try {
    const query = String(window.location.hash || '').split('?')[1] || '';
    const n = Number(new URLSearchParams(query).get('paso'));
    return Number.isInteger(n) && n >= 1 && n <= STEPS.length ? n : 1;
  } catch {
    return 1;
  }
}

/** Cotización de ejemplo + función de cálculo (guardada o, si no se puede, en memoria). */
async function loadDemo(app) {
  try {
    const quote = await app.ctx.quotes.ensureDemoQuote();
    const compute = (q, options = {}) => app.ctx.quotes.compute(q, options);
    return { quote, result: await compute(quote), persisted: true, compute };
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
    return { quote, result: await compute(quote), persisted: false, compute };
  }
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

  const { quote, result, persisted, compute } = await loadDemo(app);
  const k = result.kpis || {};
  const unit = unitText(result);
  const estimatedDays = k.activeDays;
  const baseRate = isFiniteNumber(k.commercialListRate) && k.commercialListRate > 0 ? k.commercialListRate : null;
  const isSuggested = k.commercialSource === 'suggested';
  const rateName = isSuggested ? 'tarifa sugerida' : 'tarifa ofrecida';

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
    const out = { floor: r.kpis.floorListRate, profit: baseRate !== null ? r.kpis.profit : null, totalCost: r.kpis.totalCost };
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
    const rows = (result.eecc && Array.isArray(result.eecc.rows) ? result.eecc.rows : []).filter((r) => isFiniteNumber(r.amount));
    const groups = COST_GROUPS.map((g) => ({ ...g, amount: rows.filter((r) => g.categories.includes(r.category)).reduce((sum, r) => sum + Math.max(0, r.amount), 0) }));
    const total = groups.reduce((sum, g) => sum + g.amount, 0);
    const pcts = roundPercentagesToTotal(groups.map((g) => g.amount), 0, 100);
    const fixedShare = isFiniteNumber(k.fixedCosts) && isFiniteNumber(k.totalCost) && k.totalCost > 0 ? (k.fixedCosts / k.totalCost) * 100 : null;
    return [
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, 'Esto es lo que necesitás para prestarlo.'),
      h('p', { class: 'pub-flow-text' }, `Costos de un mes, con ${isFiniteNumber(estimatedDays) ? formatDays(estimatedDays, { decimals: 1 }) : EMPTY} de trabajo previstos.`),
      h(
        'ul',
        { class: 'pub-costs' },
        ...groups.map((g, i) =>
          h(
            'li',
            { class: 'pub-cost' },
            h('div', { class: 'pub-cost-text' }, h('span', { class: 'pub-cost-label' }, g.label), h('span', { class: 'pub-cost-hint' }, g.hint)),
            h('div', { class: 'pub-cost-figures' }, h('span', { class: 'pub-cost-amount' }, formatMoney(g.amount)), h('span', { class: 'pub-cost-pct' }, `${pcts[i]} %`)),
            h('div', { class: 'pub-cost-track', 'aria-hidden': 'true' }, h('span', { class: 'pub-cost-fill', style: { width: `${total > 0 ? (g.amount / total) * 100 : 0}%` } })),
          ),
        ),
      ),
      h(
        'div',
        { class: 'pub-cost-total' },
        h('div', {}, h('p', { class: 'pub-cost-total-label' }, 'Costo esperado del mes'), result.traces && result.traces.totalCost ? traceButton(result.traces.totalCost) : null),
        h('p', { class: 'pub-cost-total-value' }, formatMoney(k.totalCost)),
      ),
      fixedShare !== null
        ? h('p', { class: 'pub-insight' }, publicIcon('info', { size: 18 }), h('span', {}, h('strong', {}, `El ${formatPercent(fixedShare, { decimals: 0 })} del costo es fijo: `), 'lo pagás aunque no te llamen. Por eso importa cuántos días trabajás.'))
        : null,
      h('p', { class: 'pub-footnote' }, 'Todos los valores son ILUSTRATIVOS: no son sueldos, cargas, precios ni costos reales.'),
    ];
  }

  function stepResult() {
    const traces = result.traces || {};
    const be = result.breakEven || {};
    const sentence =
      be.reachable && isFiniteNumber(k.breakEvenDays)
        ? h(
            'p',
            { class: 'pub-sentence' },
            'Con esta tarifa necesitás aproximadamente ',
            h('strong', {}, `${formatNumber(k.breakEvenDays, { decimals: 1 })} días activos por mes`),
            ' para cubrir todos tus costos.',
          )
        : h('p', { class: 'pub-sentence' }, be.reason || 'Con estos datos no se puede calcular cuántos días necesitás para no perder plata.');
    return [
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, 'Así se ve el resultado.'),
      h('p', { class: 'pub-flow-text' }, 'Cuatro números para decidir. Cada uno se puede auditar con “Ver cálculo”.'),
      h(
        'div',
        { class: 'pub-stats' },
        bigStat({ label: 'Costo esperado', value: formatMoney(k.totalCost), unit: '/ mes', hint: `Con ${isFiniteNumber(estimatedDays) ? formatDays(estimatedDays, { decimals: 1 }) : EMPTY} de trabajo.`, trace: traces.totalCost, className: 'pub-stat' }),
        bigStat({ label: 'Tarifa piso', value: formatMoneyCeil(k.floorListRate), unit: `/ ${unit}`, hint: 'El precio mínimo para no perder plata.', trace: traces.floorRate, className: 'pub-stat' }),
        bigStat({
          label: isSuggested ? 'Tarifa sugerida' : 'Tu tarifa',
          value: formatMoneyCeil(k.commercialListRate),
          unit: `/ ${unit}`,
          hint: isSuggested ? `Para ganar el ${formatPercent(k.targetMarginPct)} de margen objetivo.` : 'La tarifa ofrecida en la cotización.',
          trace: isSuggested ? traces.targetRate : traces.expectedResult,
          className: 'pub-stat pub-stat-accent',
        }),
        bigStat({ label: 'Margen', value: formatPercent(k.marginPct), hint: 'Sobre el precio de venta (no es markup).', tone: marginTone(k), trace: traces.expectedResult, className: 'pub-stat' }),
      ),
      h('div', { class: 'pub-sentence-wrap' }, sentence, traces.breakEven && be.reachable ? traceButton(traces.breakEven) : null),
      disclosure(
        { summary: '¿Qué significa cada número?', className: 'pub-glossary' },
        h(
          'dl',
          { class: 'pub-glossary-list' },
          h('div', {}, h('dt', {}, 'Costo esperado'), h('dd', {}, 'Todo lo que cuesta prestar el servicio en el mes: personal, equipos, combustible, viajes, estructura e imprevistos.')),
          h('div', {}, h('dt', {}, 'Tarifa piso'), h('dd', {}, 'El precio mínimo por día para no perder plata. Debajo de este número, perdés.')),
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
    const errorEl = h('p', { class: 'pub-sim-error', id: errorId, hidden: true });
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
      mount(
        output,
        h('p', { class: 'pub-sim-label' }, `Tarifa piso con ${formatDays(days, { decimals: 1 })} de trabajo por mes`),
        h('p', { class: 'pub-sim-value' }, formatMoneyCeil(floor), h('span', { class: 'pub-sim-unit' }, `/ ${unit}`)),
        delta ? h('p', { class: 'pub-sim-delta' }, delta) : null,
        verdict,
      );
    }

    custom.addEventListener('input', () => {
      const raw = custom.value.trim();
      if (raw === '') {
        errorEl.hidden = true;
        custom.removeAttribute('aria-invalid');
        return;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > maxDays) {
        errorEl.textContent = `Ingresá un número entero de días entre 1 y ${maxDays}.`;
        errorEl.hidden = false;
        custom.setAttribute('aria-invalid', 'true');
        return;
      }
      errorEl.hidden = true;
      custom.removeAttribute('aria-invalid');
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
        errorEl.hidden = true;
        custom.removeAttribute('aria-invalid');
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

    const analysisAction = persisted
      ? pubLink('Ver el análisis completo', `#/cotizaciones/${encodeURIComponent(quote.id)}/result`, { tone: 'primary', iconAfter: 'arrowRight' })
      : button('Ver el análisis completo', { variant: 'primary', size: 'lg', disabled: true, attrs: { class: 'btn btn-primary btn-lg pub-btn', 'aria-describedby': 'pub-demo-unavailable' } });

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
        h('div', { class: 'pub-demo-final-actions' }, analysisAction, pubLink('Crear mi propia cotización', '#/cotizaciones/nueva', { tone: 'secondary' })),
        persisted
          ? null
          : h('p', { class: 'pub-footnote', id: 'pub-demo-unavailable' }, 'El ejemplo no se pudo guardar en este navegador (por ejemplo, porque tus datos están en modo sólo lectura), así que no se puede abrir completo.'),
      ),
    ];
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
      flowHeader({ brandHref: '#/', actions: [headerLink('Salir del ejemplo', '#/', { iconBefore: 'close' })] }),
      body,
    ),
  );
}
