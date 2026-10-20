/**
 * "Marcar como enviada" con la misma regla en el Resultado, la lista de
 * cotizaciones y el editor (ECO-02). La regla vive en js/domain/quote-risk.js
 * (sendCheck): acá sólo los textos y los diálogos.
 *
 *   - resultado NO CONFIABLE o que no se pudo calcular → no se puede (se dice
 *     por qué y se ofrece "Ver qué falta");
 *   - pendientes críticos → se puede, confirmando (se nombran);
 *   - sin nada de eso → se marca directo.
 */

import { h } from './dom.js';
import { button, confirmDialog, linkButton, openDialog } from './components.js';
import { joinList } from './result-text.js';
import { QUOTE_STATUSES, labelOf } from '../domain/catalogs.js';

/** "enviada" / "ganada" (minúscula, para el medio de una frase). */
function targetWord(status) {
  return labelOf(QUOTE_STATUSES, status, 'Enviada').toLowerCase();
}

/**
 * Textos del aviso para un `sendCheck()`; null si se puede marcar sin preguntar.
 * Funciones puras (sin DOM) para poder probarlas.
 * @param {{ allowed: boolean, confirm: boolean, reason: string|null, items: string[] }} check
 * @param {{ status?: string }} [options]  estado al que se quiere pasar ('sent' o 'won')
 * @returns {{ kind: 'blocked'|'confirm', title: string, message: string, confirmLabel?: string, cancelLabel?: string }|null}
 */
export function sendGuardText(check, { status = 'sent' } = {}) {
  if (!check || (check.allowed && !check.confirm)) return null;
  const word = targetWord(status);
  if (!check.allowed) {
    if (check.reason === 'unreliable') {
      const what = check.items.length ? ` (${joinList(check.items)})` : '';
      return {
        kind: 'blocked',
        title: `No se puede marcar como ${word}`,
        message: `El resultado de esta cotización NO ES CONFIABLE${what}. Los números se calculan, pero no son reales: resolvé lo pendiente antes de mandarla al cliente.`,
      };
    }
    return {
      kind: 'blocked',
      title: `No se puede marcar como ${word}`,
      message: 'Esta cotización tiene datos que no se pueden calcular. Abrila y revisá los valores antes de mandarla al cliente.',
    };
  }
  return {
    kind: 'confirm',
    title: `¿Marcarla como ${word} con pendientes críticos?`,
    message: `Faltan datos que cambian el costo o el precio: ${joinList(check.items)}. Con esos pendientes, la tarifa puede no cubrir tus costos.`,
    confirmLabel: `Marcar como ${word} igual`,
    cancelLabel: 'Revisar primero',
  };
}

/** Texto corto (visible junto al botón) de por qué no se puede marcar como enviada; null si se puede. */
export function sendBlockedNote(check) {
  const t = sendGuardText(check);
  return t && t.kind === 'blocked' ? `${t.title}: ${t.message.charAt(0).toLowerCase()}${t.message.slice(1)}` : null;
}

/**
 * Pregunta (o avisa) antes de pasar una cotización a Enviada / Ganada.
 * @param {{ allowed: boolean, confirm: boolean, reason: string|null, items: string[] }} check  sendCheck()
 * @param {{ status?: string, reviewHref?: string|null }} [options]  reviewHref: dónde ver qué falta
 * @returns {Promise<boolean>} true si se puede seguir
 */
export async function guardSending(check, { status = 'sent', reviewHref = null } = {}) {
  const t = sendGuardText(check, { status });
  if (!t) return true;
  if (t.kind === 'confirm') {
    return confirmDialog({ title: t.title, message: t.message, confirmLabel: t.confirmLabel, cancelLabel: t.cancelLabel });
  }
  await new Promise((resolve) => {
    let close = () => {};
    const actions = [button('Cerrar', { variant: 'secondary', onClick: () => close() })];
    if (reviewHref) actions.push(linkButton('Ver qué falta', reviewHref, { variant: 'primary', onClick: () => close() }));
    ({ close } = openDialog({ title: t.title, content: h('p', {}, t.message), actions, onClose: () => resolve() }));
  });
  return false;
}
