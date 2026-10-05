/**
 * Etapa 1 · El servicio — Tipo de servicio.
 * Básico: nombre, cliente y tipo de servicio.
 * Opciones avanzadas: código, estado, duración del contrato y notas.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, icon } from '../../components.js';
import { SERVICE_TYPES, QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { formatNumber, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';

/** Nombre de un paso entre comillas ("Viajes"): siempre el de QUOTE_STEPS. */
const step = (id) => `"${stepName(id)}"`;

/** Qué conviene revisar según el tipo de servicio (orientativo, sin normativa). */
const TYPE_TIPS = Object.freeze({
  on_call: `En ${step('modality')} contá cuántos días por mes esperás trabajar (y la disponibilidad 24/7 o por franja). En ${step('margin')} podés definir cuánto cobrar en espera (standby), por salida (call-out) y el mínimo por llamado.`,
  permanent: `Pensá en POSICIONES CUBIERTAS, no en personas: en ${step('labor')} cargá cuántas personas necesitás por posición para cubrir francos, vacaciones y relevos.`,
  crew: `Cargá cada puesto en ${step('labor')} y los traslados de la cuadrilla en ${step('logistics')}.`,
  equipment_with_operator: `Cargá el equipo en ${step('equipment')} (lo que cuesta tenerlo y usarlo) y el operador en ${step('labor')}.`,
  equipment_only: `Alquiler sin operador: el costo principal está en ${step('equipment')}. No hace falta cargar personal.`,
  per_unit: 'Los cálculos se expresan por día, hora o mes de actividad: estimá cuántos días activos necesitás para la producción pedida.',
  transport: `Cargá los vehículos en ${step('equipment')} (tenerlos y usarlos) y los recorridos en ${step('logistics')}.`,
  turnkey: 'Revisá todo el alcance: personal, supervisión, materiales menores, HSE, QA/QC, dossier, seguros, garantías e imprevistos.',
  time_materials: `Cargá las horas en ${step('labor')} y los materiales con su markup de reventa (recargo sobre el costo, informativo) en ${step('materials')}.`,
  lump_sum: `Precio cerrado por todo el alcance: usá ${step('risk')} (contingencia) para cubrir la incertidumbre.`,
  configurable: `Armá la estructura a medida con "Otros costos directos" en el paso ${step('materials')}.`,
});

export function render(container, ctx) {
  const { quote, kit } = ctx;

  const identity = card(
    {},
    formGrid(
      2,
      kit.text('name', { label: 'Nombre de la cotización', required: true, maxLength: 120, placeholder: 'Ej.: Hidrogrúa on-call — Añelo', hint: 'Para encontrarla después.' }),
      kit.text('client', { label: 'Cliente', maxLength: 120, placeholder: 'Ej.: Operadora' }),
    ),
  );

  const tip = TYPE_TIPS[quote.serviceType];
  const type = card(
    {},
    kit.choice('serviceType', {
      label: '¿Qué tipo de servicio es?',
      options: SERVICE_TYPES.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
      structural: true,
    }),
    tip ? h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, tip)) : null,
  );

  const more = kit.advanced(
    {
      key: 'service',
      title: 'Más datos de la cotización',
      boxed: true,
      summary: () => {
        const parts = [
          `Estado: ${labelOf(QUOTE_STATUSES, quote.status, 'sin estado').toLowerCase()}`,
          isFiniteNumber(Number(quote.contractMonths)) && quote.contractMonths !== null && quote.contractMonths !== ''
            ? `contrato de ${formatNumber(Number(quote.contractMonths))} meses`
            : 'sin duración de contrato',
          quote.code ? `código ${quote.code}` : null,
          String(quote.notes || '').trim() ? 'con notas' : null,
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : EMPTY;
      },
    },
    formGrid(
      3,
      kit.staticField('Código', quote.code, 'Se asigna automáticamente y no se puede cambiar.'),
      kit.select('status', { label: 'Estado', options: QUOTE_STATUSES.map((s) => ({ value: s.id, label: s.label })) }),
      kit.num('contractMonths', {
        label: 'Duración del contrato',
        rule: 'months',
        unit: 'meses',
        hint: `Se usa para el descuento por continuidad (en ${step('margin')}).`,
      }),
    ),
    kit.text('notes', {
      label: 'Notas internas',
      multiline: true,
      maxLength: 2000,
      hint: 'Supuestos, alcance, exclusiones o aclaraciones. No se envían a ningún lado: quedan en este navegador.',
    }),
  );

  mount(container, identity, type, more);
  return { update() {} };
}
