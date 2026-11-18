/**
 * "Actualizar tarifa" (0.11): lleva la tarifa de una cotización a un período nuevo con un % por
 * categoría de la EECC, ponderado por la incidencia de cada categoría. La cotización no cambia:
 * el paso queda en su historial y se puede deshacer.
 */

import { h, uniqueId } from './dom.js';
import { banner, button, openDialog, periodField, confirmDialog } from './components.js';
import { formatMoney, formatPercent, formatPeriod, formatPeriodLong, EMPTY } from '../core/format.js';
import { isFiniteNumber } from '../core/money.js';
import { validateNumber } from '../core/validation.js';
import { previewRateUpdate } from '../engines/rate-update-engine.js';
import { monthsBetween, periodIndex } from '../domain/economic-base.js';
import { billingUnitOf } from '../domain/billing-units.js';
import { userErrorMessage } from './layout.js';

/** Período siguiente a otro ("2026-10" → "2026-11"). */
export function nextPeriod(period) {
  const i = periodIndex(period);
  if (i === null) return null;
  const n = i + 1;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

/** Período del mes actual según el reloj del navegador ("AAAA-MM"). */
function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Destino propuesto: este mes si es posterior al vigente; si no, el mes siguiente al vigente. */
export function defaultTargetPeriod(period, today = currentPeriod()) {
  if (!period) return today;
  return monthsBetween(period, today) > 0 ? today : nextPeriod(period);
}

function pctText(value) {
  if (!isFiniteNumber(value)) return EMPTY;
  const v = Math.abs(value) < 0.005 ? 0 : value;
  return `${v > 0 ? '+' : ''}${formatPercent(v)}`;
}

/** "$ 1.000.000 /hora" */
function rateWithUnit(rate, unitShort) {
  return isFiniteNumber(rate) ? h('span', { class: 'nowrap' }, formatMoney(rate), h('span', { class: 'unit-suffix' }, ` /${unitShort}`)) : h('span', { class: 'muted' }, 'Sin tarifa');
}

/** Celda de período: "nov-26" con "base oct-26" debajo si ya se actualizó. */
export function ratePeriodNode(state) {
  if (!state || !state.period) return h('span', { class: 'muted', title: 'Sin fecha de la oferta: cargala en "Contrato".' }, 'Sin período');
  return h(
    'span',
    { class: 'rate-period' },
    h('span', { class: 'nowrap' }, formatPeriod(state.period)),
    state.updated ? h('span', { class: 'cell-sub nowrap' }, `base ${formatPeriod(state.basePeriod)}`) : null,
  );
}

/**
 * Abre el cuadro "Actualizar tarifa".
 * @param {{ app: object, quote: object, summary: object, onSaved?: () => void }} options
 */
export function openRateUpdateDialog({ app, quote, summary, onSaved = null }) {
  const { ctx } = app;
  const state = summary && summary.rateUpdate ? summary.rateUpdate : null;
  const unit = billingUnitOf(quote || {});
  const unitShort = unit.short || 'unidad';
  const title = `Actualizar tarifa: ${typeof quote.name === 'string' && quote.name.trim() ? quote.name : 'cotización'}`;

  if (!state || !state.weights.length || !isFiniteNumber(state.rate)) {
    const { close } = openDialog({
      title,
      content: h(
        'div',
        { class: 'stack' },
        banner(
          !state || !state.weights.length
            ? 'Esta cotización todavía no tiene costos cargados: la actualización se pondera con su estructura de costos.'
            : 'Esta cotización todavía no tiene tarifa: completá "El precio" para poder actualizarla.',
          'info',
        ),
      ),
      actions: [button('Cerrar', { variant: 'secondary', onClick: () => close() }), h('a', { class: 'btn btn-primary', href: `#/cotizaciones/${encodeURIComponent(quote.id)}` }, 'Abrir la cotización')],
    });
    return;
  }

  const local = {
    basePeriod: state.basePeriod,
    toPeriod: defaultTargetPeriod(state.period),
    pcts: {},
    invalid: new Set(),
  };
  const locked = state.updated;
  // Período desde el que se actualiza (el vigente; antes de la primera, el base elegido).
  const fromPeriod = () => (locked ? state.period : local.basePeriod);

  const sumEl = h('div', { class: 'rate-update-sum' });
  const liveEl = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  // Resumen compacto en el pie (se ve en el celular mientras se cargan los %).
  const footSum = h('span', { class: 'rate-update-foot-sum mono', 'aria-hidden': 'true' });
  const contributionEls = new Map();
  const periodNote = h('p', { class: 'field-error', hidden: true });
  const applyBtn = button('Aplicar actualización', { variant: 'primary', icon: 'check' });

  function refresh() {
    const preview = previewRateUpdate({ ...state, period: fromPeriod() }, local.pcts, local.toPeriod);
    preview.rows.forEach((r) => {
      const el = contributionEls.get(r.id);
      if (el) el.textContent = r.pct ? pctText(r.contributionPct) : EMPTY;
    });
    const terms = preview.rows.filter((r) => r.pct).map((r) => `${formatPercent(r.sharePct, { decimals: 0 })} × ${formatPercent(r.pct)}`);
    sumEl.replaceChildren(
      h(
        'div',
        { class: 'rate-update-sum-main' },
        h('span', {}, 'Aumento de la tarifa'),
        h('strong', { class: 'rate-update-sum-pct' }, pctText(preview.stepPct)),
      ),
      terms.length ? h('p', { class: 'muted small mono' }, `${terms.join(' + ')} = ${pctText(preview.stepPct)}`) : h('p', { class: 'muted small' }, 'Cargá cuánto aumentó cada categoría entre los dos meses.'),
      h(
        'div',
        { class: 'rate-update-sum-rates' },
        h('span', {}, h('span', { class: 'muted small' }, `${formatPeriod(fromPeriod()) === EMPTY ? 'Vigente' : formatPeriod(fromPeriod())} `), rateWithUnit(preview.rateBefore, unitShort)),
        h('span', { 'aria-hidden': 'true', class: 'muted' }, '→'),
        h('span', {}, h('span', { class: 'muted small' }, `${formatPeriod(local.toPeriod) === EMPTY ? 'Nueva' : formatPeriod(local.toPeriod)} `), h('strong', {}, rateWithUnit(preview.rateAfter, unitShort))),
      ),
    );
    const noBase = !fromPeriod();
    let note = null;
    if (noBase) note = 'Elegí el período base de la tarifa: el mes de los costos con que la armaste.';
    else if (preview.periodError === 'missing') note = 'Elegí a qué mes actualizás la tarifa.';
    else if (preview.periodError === 'not_after') note = `Elegí un mes posterior a ${formatPeriodLong(fromPeriod())}.`;
    periodNote.hidden = !note;
    periodNote.textContent = note || '';
    liveEl.textContent = `Aumento de la tarifa ${pctText(preview.stepPct)}${isFiniteNumber(preview.rateAfter) ? `, nueva tarifa ${formatMoney(preview.rateAfter)} por ${unitShort}` : ''}.`;
    footSum.textContent = `${pctText(preview.stepPct)} · ${isFiniteNumber(preview.rateAfter) ? `${formatMoney(preview.rateAfter)} /${unitShort}` : EMPTY}`;
    applyBtn.disabled = noBase || local.invalid.size > 0 || !preview.canApply || !preview.rows.some((r) => r.pct);
    return preview;
  }

  const rows = state.weights.map((w) => {
    const id = uniqueId('act');
    const errId = `${id}-err`;
    const input = h('input', {
      id,
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      class: 'rate-update-input',
      placeholder: '0',
      'aria-describedby': errId,
      'aria-label': `% de aumento de ${w.label}`,
    });
    const err = h('span', { id: errId, class: 'field-error', hidden: true });
    input.addEventListener('input', () => {
      const r = validateNumber(input.value, 'updatePct');
      if (!r.ok) {
        input.setAttribute('aria-invalid', 'true');
        err.textContent = r.error;
        err.hidden = false;
        delete local.pcts[w.id];
        local.invalid.add(w.id);
      } else {
        local.invalid.delete(w.id);
        input.removeAttribute('aria-invalid');
        err.hidden = true;
        if (r.value === null || r.value === 0) delete local.pcts[w.id];
        else local.pcts[w.id] = r.value;
      }
      refresh();
    });
    const share = (w.weight * (state.indices[w.id] ?? 1)) / state.factor;
    const contribution = h('span', { class: 'mono nowrap' }, EMPTY);
    contributionEls.set(w.id, contribution);
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, h('label', { for: id, class: 'rate-update-cat' }, w.label), h('span', { class: 'cell-sub' }, w.hint)),
      h('td', { class: 'ta-right mono', 'data-label': 'Peso en el costo' }, formatPercent(share * 100, { decimals: 1 })),
      h('td', { class: 'ta-right', 'data-label': '% de aumento' }, h('span', { class: 'rate-update-pct' }, input, h('span', { 'aria-hidden': 'true' }, '%')), err),
      h('td', { class: 'ta-right', 'data-label': 'Suma a la tarifa' }, contribution),
    );
  });

  const periods = h(
    'div',
    { class: 'rate-update-periods' },
    locked
      ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Desde'), h('p', { class: 'rate-update-from' }, formatPeriodLong(state.period)))
      : periodField({
          label: 'Período base de la tarifa',
          value: local.basePeriod,
          hint: 'El mes de los costos con que armaste la cotización.',
          onChange: (p) => {
            local.basePeriod = p;
            refresh();
          },
        }),
    periodField({
      label: 'Actualizar a',
      value: local.toPeriod,
      onChange: (p) => {
        local.toPeriod = p;
        refresh();
      },
    }),
  );

  const history = state.steps.length
    ? h(
        'div',
        { class: 'stack' },
        h('h3', { class: 'rate-update-h3' }, 'Actualizaciones anteriores'),
        h(
          'ol',
          { class: 'rate-update-history' },
          ...state.steps.map((s) => h('li', {}, h('span', { class: 'nowrap' }, `${formatPeriod(s.fromPeriod)} → ${formatPeriod(s.toPeriod)}`), h('span', { class: 'mono' }, pctText(s.stepPct)), rateWithUnit(s.rateAfter, unitShort))),
        ),
      )
    : null;

  const rebaseBtn = state.stale
    ? button('Tomar la cotización actual como nueva base', {
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Nueva base de la tarifa',
            message: `La tarifa y los costos de hoy de la cotización pasan a ser la base, en ${formatPeriodLong(state.period)}. Las actualizaciones anteriores quedan archivadas.`,
            confirmLabel: 'Tomar como base',
          });
          if (!ok) return;
          try {
            await ctx.quotes.rebaseRateUpdate(quote.id);
            app.toast(`Nueva base de la tarifa: ${formatPeriod(state.period)}.`, 'success');
            dialogRef.close();
            if (typeof onSaved === 'function') onSaved();
          } catch (error) {
            app.toast(userErrorMessage(error, 'No se pudo cambiar la base.'), 'danger');
          }
        },
      })
    : null;
  const notices = [
    state.stale
      ? h(
          'div',
          { class: 'stack' },
          banner(`Cambiaste la cotización después de actualizar la tarifa. La tarifa vigente sigue calculada sobre la de ${formatPeriod(state.basePeriod)} (${formatMoney(state.baseRate)} /${unitShort}); hoy la cotización da ${formatMoney(state.liveRate)} /${unitShort}. Si ya cargaste los costos de ${formatPeriod(state.period)}, tomala como nueva base para no contar dos veces el aumento.`, 'warning'),
          rebaseBtn,
        )
      : null,
    state.otherRevenue > 0
      ? banner(`Esta cotización cobra ${formatMoney(state.otherRevenue)} por mes aparte de la tarifa (cargos o materiales revendidos): eso no se actualiza acá.`, 'info')
      : null,
  ].filter(Boolean);

  const content = h(
    'form',
    { class: 'stack rate-update', novalidate: true },
    ...notices,
    h('p', { class: 'muted' }, 'Cargá cuánto aumentó cada categoría de tu estructura de costos entre los dos meses: cada una suma según su peso en el costo. La cotización original no cambia.'),
    periods,
    periodNote,
    h(
      'div',
      { class: 'table-wrap table-cards' },
      h(
        'table',
        { class: 'table rate-update-table' },
        h('caption', { class: 'sr-only' }, 'Aumento por categoría de la estructura de costos'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Categoría'), h('th', { scope: 'col', class: 'ta-right' }, 'Peso en el costo'), h('th', { scope: 'col', class: 'ta-right' }, '% de aumento'), h('th', { scope: 'col', class: 'ta-right' }, 'Suma a la tarifa'))),
        h('tbody', {}, ...rows),
      ),
    ),
    h('p', { class: 'footnote' }, 'Costo financiero (a tasa constante) e imprevistos acompañan solos al resto, igual que la estructura si la cargaste como % del costo. El margen y los impuestos son un % del precio: no cambian.'),
    sumEl,
    liveEl,
    history,
  );
  content.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!applyBtn.disabled) applyBtn.click();
  });

  let dialogRef = null;
  applyBtn.addEventListener('click', async () => {
    const preview = refresh();
    if (!preview.canApply) return;
    applyBtn.disabled = true;
    try {
      if (!locked && local.basePeriod !== state.basePeriod) await ctx.quotes.setRateBasePeriod(quote.id, local.basePeriod);
      await ctx.quotes.applyRateUpdate(quote.id, { toPeriod: local.toPeriod, pcts: local.pcts });
      app.toast(`Tarifa actualizada a ${formatPeriod(local.toPeriod)}: ${formatMoney(preview.rateAfter)} /${unitShort}.`, 'success');
      dialogRef.close();
      if (typeof onSaved === 'function') onSaved();
    } catch (error) {
      applyBtn.disabled = false;
      app.toast(userErrorMessage(error, 'No se pudo actualizar la tarifa.'), 'danger');
    }
  });

  const undoBtn = state.steps.length
    ? button('Deshacer la última', {
        variant: 'ghost',
        onClick: async () => {
          const last = state.steps[state.steps.length - 1];
          const ok = await confirmDialog({
            title: 'Deshacer la última actualización',
            message: `La tarifa vuelve a ${formatPeriodLong(last.fromPeriod)}: ${formatMoney(last.rateBefore)} /${unitShort}.`,
            confirmLabel: 'Deshacer',
          });
          if (!ok) return;
          try {
            await ctx.quotes.undoRateUpdate(quote.id);
            app.toast('Se deshizo la última actualización.', 'success');
            dialogRef.close();
            if (typeof onSaved === 'function') onSaved();
          } catch (error) {
            app.toast(userErrorMessage(error, 'No se pudo deshacer.'), 'danger');
          }
        },
      })
    : null;

  dialogRef = openDialog({
    title,
    content,
    wide: true,
    actions: [undoBtn, footSum, h('span', { class: 'spacer' }), button('Cancelar', { variant: 'secondary', onClick: () => dialogRef.close() }), applyBtn].filter(Boolean),
  });
  refresh();
  // En pantallas táctiles no se abre el teclado solo (taparía la explicación).
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const first = content.querySelector('.rate-update-input');
  if (first && !coarse) first.focus();
}

export { rateWithUnit, pctText };
