/**
 * "Editar sueldo" de un perfil de personal (RES-02, PLAN-2026-023).
 *
 * - El bruto mensual remunerativo se descompone en básico + adicionales (los
 *   dos campos de siempre): no se puede sumar dos veces y el motor no cambia.
 * - Horas extra: si el perfil o una cotización que lo usa las tiene, sin el
 *   básico hay que confirmar que se valúan sobre el bruto completo.
 * - Mes base obligatorio si cambia el sueldo.
 * - Vista previa del costo empresa por persona antes → después.
 * - Nunca cambia cotizaciones: cada una avisa "El recurso cambió" y la persona
 *   decide si la actualiza.
 */

import { h, mount } from './dom.js';
import { banner, button, checkboxField, formGrid, numberField, openDialog, periodField, selectField, textField, traceButton } from './components.js';
import { formatMoney, formatPercent } from '../core/format.js';
import { isFiniteNumber, toNumber } from '../core/money.js';
import { sanitizeText } from '../core/validation.js';
import { BASE_SOURCES } from '../domain/catalogs.js';
import { normalizeBase } from '../domain/economic-base.js';
import { grossOf, overtimeUse, splitGross } from '../domain/labor-groups.js';
import { illustrativeTag, userErrorMessage } from './layout.js';
import { CURRENCY } from '../config.js';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * @param {object} options
 * @param {object} options.profile        el perfil guardado
 * @param {object[]} [options.quotes]      cotizaciones guardadas (horas extra de las que lo usan)
 * @param {number} [options.quotesUsing]   cotizaciones en curso o ganadas que lo usan
 * @param {(p: object) => object} options.costOf   costo del perfil (laborProfileCost)
 * @param {(p: object, cost: object) => object} options.traceOf  traza de "Ver cálculo"
 * @param {(entity: object) => Promise<void>} options.onSave
 * @param {(() => void)|null} [options.onEditProfile]  abre el formulario completo
 */
export function openSalaryDialog({ profile, quotes = [], quotesUsing = 0, costOf, traceOf, onSave, onEditProfile = null }) {
  const role = profile.role || 'perfil';
  const initialGross = grossOf(profile) > 0 ? grossOf(profile) : null;
  const initialBasic = toNumber(profile.basicMonthly, 0) > 0 ? toNumber(profile.basicMonthly, 0) : null;
  const base = normalizeBase(profile.base, { currency: CURRENCY });
  const initial = { gross: initialGross, basic: initialBasic, period: base.period, source: base.source, note: base.note };
  const draft = { ...initial, confirmGross: false };
  const overtime = overtimeUse(profile, quotes);
  const costBefore = costOf(profile).perPerson.fixedMonthly;

  const salaryChanged = () => draft.gross !== initial.gross || draft.basic !== initial.basic;
  const baseChanged = () => (draft.period || null) !== (initial.period || null)
    || (draft.source || null) !== (initial.source || null)
    || sanitizeText(draft.note || '', 160) !== initial.note;

  const additionalsLine = h('p', { class: 'small salary-additionals', 'aria-live': 'polite' });
  const overtimeHost = h('div');
  const basicHint = h('p', { class: 'small muted salary-basic-hint', hidden: true });
  const periodHint = h('p', { class: 'small muted', hidden: true });
  const previewHost = h('div', { class: 'salary-preview', 'aria-live': 'polite' });
  // Junto a "Guardar sueldo", como en el formulario de recursos (ESC-08): al final del cuerpo quedaba
  // fuera de la vista y el botón parecía no responder (K0E-02).
  const errorEl = h('p', { class: 'dialog-form-alert salary-error', role: 'alert' });

  /** El aviso junto a "Guardar sueldo" y, si es de un campo, ese campo a la vista y con el foco. */
  const showError = (message, control = null) => {
    errorEl.textContent = message || '';
    if (!message || !control) return;
    if (typeof control.scrollIntoView === 'function') control.scrollIntoView({ block: 'center' });
    control.focus({ preventScroll: true });
  };

  const overtimeWhere = () => {
    const parts = [];
    if (overtime.inProfile) parts.push('el perfil tiene horas extra');
    if (overtime.quotesCount) parts.push(`${overtime.quotesCount === 1 ? '1 cotización que lo usa tiene' : `${overtime.quotesCount} cotizaciones que lo usan tienen`} horas extra`);
    return parts.join(' y ');
  };

  function update() {
    showError('');
    const split = isFiniteNumber(draft.gross) ? splitGross({ gross: draft.gross, basic: draft.basic }) : null;
    // Sin el básico, se dice qué se guarda: el bruto completo como básico (nunca en silencio).
    additionalsLine.textContent = !split ? 'Cargá el bruto mensual.'
      : !split.ok ? split.error
        : split.basicGiven ? `Adicionales remunerativos = bruto − básico = ${formatMoney(split.additionalsMonthly)}. Se guardan aparte del básico: no se suman dos veces.`
          : `Sin el básico, el bruto completo se guarda como básico (adicionales ${formatMoney(0)}).`;

    // Horas extra: el bruto completo como base sólo con confirmación (pedido del dueño).
    const noBasic = !isFiniteNumber(draft.basic);
    if (noBasic && overtime.any) {
      mount(overtimeHost,
        banner(`Horas extra: ${overtimeWhere()}. Se valúan sobre el básico; sin el básico, se valuarían sobre el bruto completo (${formatMoney(draft.gross)}), que puede incluir adicionales y encarecer cada hora extra.`, 'warning'),
        checkboxField({
          label: 'Valuar las horas extra sobre el bruto completo',
          name: 'salary.overtimeOnGross',
          checked: draft.confirmGross,
          hint: 'O cargá el básico arriba.',
          onChange: (v) => {
            draft.confirmGross = Boolean(v);
          },
        }));
    } else if (noBasic) {
      mount(overtimeHost, h('p', { class: 'small muted' }, 'Sin el básico, las horas extra (si después las cargás en una cotización) se valuarían sobre el bruto completo.'));
    } else {
      mount(overtimeHost, null);
    }

    // El bruto cambió y el básico no: RATEOS no lo sube solo, pero lo dice.
    const grossMoved = isFiniteNumber(initial.gross) && draft.gross !== initial.gross;
    basicHint.hidden = !(grossMoved && isFiniteNumber(initial.basic) && draft.basic === initial.basic);
    basicHint.textContent = 'El bruto cambió y el básico no. Si también cambió el básico, actualizalo: se usa para las horas extra. RATEOS no lo cambia solo.';
    periodHint.hidden = !(salaryChanged() && draft.period && draft.period === initial.period);
    periodHint.textContent = '¿El sueldo nuevo es del mismo mes base? Si no, cambiá el mes.';

    if (split && split.ok) {
      const next = { ...profile, basicMonthly: split.basicMonthly, additionalsMonthly: split.additionalsMonthly };
      const cost = costOf(next);
      const after = cost.perPerson.fixedMonthly;
      const delta = costBefore > 0 ? ((after - costBefore) / costBefore) * 100 : null;
      const deltaText = delta === null || Math.abs(delta) < 0.005 ? '' : ` (${delta > 0 ? '+' : '−'}${formatPercent(Math.abs(delta))})`;
      mount(previewHost,
        h('p', { class: 'salary-preview-line' },
          'Costo empresa por persona y por mes: ',
          h('strong', { class: 'nowrap', dataset: { costBefore: String(costBefore) } }, formatMoney(costBefore)),
          ' → ',
          h('strong', { class: 'nowrap', dataset: { costAfter: String(after) } }, formatMoney(after)),
          deltaText),
        traceButton(traceOf(next, cost)));
    } else {
      mount(previewHost, null);
    }
  }

  const grossField = numberField({
    label: 'Sueldo bruto mensual remunerativo',
    name: 'salary.gross',
    value: initial.gross,
    rule: 'money',
    unit: '$',
    required: true,
    hint: 'Todo lo remunerativo del mes, por persona: básico + adicionales (zona, presentismo, títulos…). Lo que ya está acá no se suma aparte.',
    onChange: (v) => {
      draft.gross = isFiniteNumber(v) ? v : null;
      update();
    },
  });
  const basicField = numberField({
    label: '¿Cuánto de ese bruto es el básico? (opcional)',
    name: 'salary.basic',
    value: initial.basic,
    rule: 'money',
    unit: '$',
    hint: 'Se usa para valuar las horas extra.',
    onChange: (v) => {
      draft.basic = isFiniteNumber(v) && v > 0 ? v : null;
      update();
    },
  });
  const periodInput = periodField({
    label: 'Mes base del sueldo',
    name: 'salary.period',
    value: initial.period,
    hint: 'De qué mes es este sueldo. Obligatorio si cambiás el sueldo.',
    onChange: (v) => {
      draft.period = v;
      update();
    },
  });
  const sourceInput = selectField({
    label: 'Fuente (opcional)',
    name: 'salary.source',
    value: initial.source || '',
    options: BASE_SOURCES.filter((s) => s.id !== 'offer').map((s) => ({ value: s.id, label: s.label })),
    includeEmpty: true,
    emptyLabel: 'Sin indicar',
    onChange: (v) => {
      draft.source = v || null;
    },
  });
  const noteInput = textField({
    label: 'Referencia (opcional)',
    name: 'salary.note',
    value: initial.note,
    maxLength: 160,
    placeholder: 'Ej.: recibo de septiembre…',
    onChange: (v) => {
      draft.note = v;
    },
  });

  const pct = (key) => formatPercent(toNumber(profile[key], 0));
  const paramsLine = h('p', { class: 'small' },
    `Cargas sobre la remuneración de este perfil: SAC ${pct('sacPct')} · vacaciones ${pct('vacationPct')} · contribuciones ${pct('employerContributionsPct')} · ART ${pct('artPct')}.`,
    profile.illustrative ? [' ', illustrativeTag('Parámetros ilustrativos: no son normativa; confirmalos con tu contador')] : null,
    ' No son normativa: confirmalos con tu contador.',
    onEditProfile ? [' ', button('Cambiarlos', { variant: 'link', size: 'sm', onClick: () => goEditProfile() })] : null);
  const quotesNote = banner(quotesUsing > 0
    ? `Las cotizaciones hechas no cambian. ${quotesUsing === 1 ? 'La cotización en curso o ganada que usa este perfil te va' : `Las ${quotesUsing} cotizaciones en curso o ganadas que usan este perfil te van`} a avisar "El recurso cambió" y elegís si ${quotesUsing === 1 ? 'la' : 'las'} actualizás.`
    : 'Las cotizaciones hechas no cambian. Ninguna cotización en curso o ganada usa este perfil.', 'info');

  const body = h('div', { class: 'stack salary-dialog' },
    h('p', { class: 'small muted' }, `${role}${profile.category ? ` · ${profile.category}` : ''}`),
    formGrid(2, grossField, basicField),
    additionalsLine,
    overtimeHost,
    basicHint,
    formGrid(3, periodInput, sourceInput, noteInput),
    periodHint,
    previewHost,
    paramsLine,
    quotesNote);

  const saveBtn = button('Guardar sueldo', { variant: 'primary', icon: 'check' });
  // Con UX-01 (openDialog con isDirty) cerrar con cambios pregunta; sin él, cierra como siempre.
  const isDirty = () => salaryChanged() || baseChanged() || Boolean(body.querySelector('[aria-invalid="true"]'));
  const dialogRef = openDialog({
    title: `Editar sueldo — ${role}`,
    content: body,
    wide: true,
    isDirty,
    actions: [errorEl, button('Cancelar', { variant: 'secondary', onClick: () => (typeof dialogRef.requestClose === 'function' ? dialogRef.requestClose() : dialogRef.close()) }), saveBtn],
  });
  // Los parámetros se cambian en el formulario completo; antes, se guarda o se cancela el sueldo.
  function goEditProfile() {
    if (isDirty()) {
      showError('Primero guardá el sueldo (o cancelá) y después cambiá los parámetros.');
      return;
    }
    dialogRef.close();
    onEditProfile();
  }

  saveBtn.addEventListener('click', async () => {
    showError('');
    const invalid = body.querySelector('[aria-invalid="true"]');
    if (invalid) {
      showError('Revisá los campos marcados en rojo.', invalid);
      return;
    }
    const salary = salaryChanged();
    if (!salary && !baseChanged()) {
      dialogRef.close();
      return;
    }
    let next = { ...profile };
    if (salary) {
      const split = splitGross({ gross: draft.gross, basic: draft.basic });
      if (!split.ok) {
        showError(split.error);
        return;
      }
      if (overtime.any && !split.basicGiven && !draft.confirmGross) {
        showError('Este perfil se usa con horas extra: cargá el básico o marcá "Valuar las horas extra sobre el bruto completo".');
        return;
      }
      if (!PERIOD_RE.test(draft.period || '')) {
        // El campo queda marcado hasta que se cargue un mes válido (periodField lo desmarca).
        const monthInput = periodInput.querySelector('input');
        if (monthInput) monthInput.setAttribute('aria-invalid', 'true');
        showError('Cargá el mes base del sueldo nuevo (año y mes).', monthInput);
        return;
      }
      next = { ...next, basicMonthly: split.basicMonthly, additionalsMonthly: split.additionalsMonthly };
    }
    next.base = { ...base, period: draft.period || null, source: draft.source || null, note: sanitizeText(draft.note || '', 160) };
    saveBtn.disabled = true;
    try {
      await onSave(next);
      dialogRef.close();
    } catch (error) {
      showError(userErrorMessage(error, 'No se pudo guardar el sueldo.'));
      saveBtn.disabled = false;
    }
  });

  update();
  return dialogRef;
}
