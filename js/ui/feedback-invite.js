/**
 * Invitación discreta a dejar un comentario (PLAN-2026-029), DESPUÉS de
 * completar una tarea (imprimir o guardar el PDF de una cotización), nunca
 * antes ni en un modal (NN/g, gov.uk: pedir feedback al final de una tarea,
 * sin interrumpirla). Cuándo mostrarla lo decide
 * js/services/feedback-invite-policy.js (no se repite).
 */

import { h } from './dom.js';
import { button, linkButton } from './components.js';
import { claimInvite, snoozeInvite } from '../services/feedback-invite-policy.js';

/**
 * Nodo de la invitación, o null si no corresponde mostrarla.
 * @param {{ screen?: string, onDismiss?: () => void, storage?: object|null, now?: number }} [options]
 *   onDismiss: después de "Ahora no" (por ejemplo, devolver el foco).
 */
export function feedbackInvite({ screen = 'resultado', onDismiss = null, ...policy } = {}) {
  if (!claimInvite(policy)) return null;
  const node = h(
    'aside',
    { class: 'feedback-invite no-print', 'aria-label': 'Ayudanos a mejorar RATEOS' },
    h('p', { class: 'feedback-invite-text' },
      h('strong', {}, '¿Te sirvió? '),
      'Si algo no funcionó o se podría entender mejor, contanos: nos ayuda a priorizar mejoras.'),
    h('div', { class: 'feedback-invite-actions' },
      linkButton('Sugerir una mejora', `#/mejorar?tipo=sugerencia&desde=${screen}`, { size: 'sm', icon: 'idea' }),
      linkButton('Reportar un problema', `#/mejorar?tipo=problema&desde=${screen}`, { size: 'sm', variant: 'ghost', icon: 'alert' }),
      button('Ahora no', {
        size: 'sm',
        variant: 'ghost',
        onClick: () => {
          snoozeInvite(policy.storage === undefined ? {} : { storage: policy.storage });
          node.remove();
          if (typeof onDismiss === 'function') onDismiss();
        },
      })),
  );
  return node;
}
