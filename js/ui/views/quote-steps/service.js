/**
 * Paso 1 — Tipo de servicio.
 * Datos generales de la cotización y tipo de servicio a cotizar.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, icon } from '../../components.js';
import { SERVICE_TYPES, QUOTE_STATUSES } from '../../../domain/catalogs.js';

/** Qué conviene revisar según el tipo de servicio (orientativo, sin normativa). */
const TYPE_TIPS = Object.freeze({
  on_call: 'En "Modalidad" definí la disponibilidad (24/7 o franja), el tiempo de respuesta y cuántos días por mes esperás trabajar. En "Margen y reglas comerciales" definí standby, call-out y minimum call.',
  permanent: 'Pensá en POSICIONES CUBIERTAS, no en personas: en "Personal" cargá cuántas personas necesitás por posición para cubrir francos, vacaciones y relevos.',
  crew: 'Cargá cada puesto en "Personal" y los traslados de la cuadrilla en "Logística".',
  equipment_with_operator: 'Cargá el equipo en "Equipos" (posesión + operación) y el operador en "Personal".',
  equipment_only: 'Alquiler sin operador: el costo principal está en "Equipos". No hace falta cargar personal.',
  per_unit: 'Los cálculos se expresan por día, hora o mes de actividad: estimá cuántos días activos necesitás para la producción pedida.',
  transport: 'Cargá los vehículos en "Equipos" (posesión y operación) y los recorridos en "Logística".',
  turnkey: 'Revisá todo el alcance: personal, supervisión, materiales menores, HSE, QA/QC, dossier, seguros, garantías y contingencia.',
  time_materials: 'Cargá las horas en "Personal" y los materiales con su markup de reventa (informativo) en "Materiales".',
  lump_sum: 'Precio global: usá "Riesgo / contingencia" para cubrir la incertidumbre del alcance.',
  configurable: 'Armá la estructura a medida con "Otros costos directos" en el paso Materiales.',
});

export function render(container, ctx) {
  const { quote, kit } = ctx;

  const general = card(
    { title: 'Datos de la cotización', subtitle: 'Identificá la cotización para encontrarla después.' },
    formGrid(
      2,
      kit.text('name', { label: 'Nombre de la cotización', required: true, maxLength: 120, placeholder: 'Ej.: Hidrogrúa on-call — Añelo' }),
      kit.text('client', { label: 'Cliente', maxLength: 120, placeholder: 'Ej.: Operadora' }),
      kit.staticField('Código', quote.code, 'Se asigna automáticamente y no se puede cambiar.'),
      kit.select('status', { label: 'Estado', options: QUOTE_STATUSES.map((s) => ({ value: s.id, label: s.label })) }),
      kit.num('contractMonths', {
        label: 'Duración del contrato',
        rule: 'months',
        unit: 'meses',
        hint: 'Se usa para el descuento por continuidad (paso Margen).',
      }),
    ),
  );

  const tip = TYPE_TIPS[quote.serviceType];
  const type = card(
    { title: 'Tipo de servicio', subtitle: 'Define qué controles de completitud aplican y cómo se nombran algunos datos.' },
    kit.choice('serviceType', {
      label: '¿Qué tipo de servicio vas a cotizar?',
      options: SERVICE_TYPES.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
      structural: true,
    }),
    tip ? h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, tip)) : null,
  );

  const notes = card(
    { title: 'Notas' },
    kit.text('notes', {
      label: 'Notas internas',
      multiline: true,
      maxLength: 2000,
      hint: 'Supuestos, alcance, exclusiones o aclaraciones. No se envían a ningún lado: quedan en este navegador.',
    }),
  );

  mount(container, general, type, notes);
  return { update() {} };
}
