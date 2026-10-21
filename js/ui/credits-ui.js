/**
 * Créditos de prueba en las pantallas (PLAN-2026-029).
 *
 * Esto sólo AVISA: el saldo lo decide la base, que cobra al guardar un
 * cálculo nuevo y lo rechaza sin saldo. Sin cuota (empresas existentes, demo,
 * modo local) no se muestra ni se bloquea nada.
 */

import { h } from './dom.js';
import { banner } from './components.js';
import { userErrorMessage } from './layout.js';
import { creditsNotice, isCreditsExhausted } from '../services/beta-service.js';

export const REPORT_HREF = '#/reportar';

/** Aviso del saldo para una pantalla de creación (null sin cuota). */
export function creditsBanner(credits) {
  const notice = creditsNotice(credits);
  if (!notice) return null;
  const el = banner(h('span', {}, notice.text, ' ', h('a', { href: REPORT_HREF }, 'Reportar un error')), notice.tone, { title: `${notice.title}.` });
  el.classList.add('credits-notice');
  el.dataset.credits = String(credits.balance);
  return el;
}

/** ¿Hay saldo conocido en 0? (antes de bloquear se vuelve a preguntar a la base). */
export async function creditsExhaustedNow(ctx) {
  const credits = ctx && ctx.credits;
  if (!credits) return false;
  let status = await credits.status();
  if (status.enabled && status.balance <= 0) status = await credits.status({ refresh: true });
  return status.enabled === true && status.balance <= 0;
}

/** Antes de crear o duplicar: sin saldo, avisa y no sigue. */
export async function canCreateCalculation(app) {
  if (!(await creditsExhaustedNow(app.ctx))) return true;
  app.toast(app.ctx.credits.exhaustedMessage, 'warning');
  return false;
}

/** Después de crear: actualiza el saldo y devuelve la frase para el aviso ('' sin cuota). */
export async function creditsAfterCreate(ctx) {
  const credits = ctx && ctx.credits;
  if (!credits) return '';
  const status = await credits.status({ refresh: true });
  if (!status.enabled) return '';
  return status.balance === 1 ? ' Te queda 1 cálculo nuevo de prueba.' : ` Te quedan ${status.balance} cálculos nuevos de prueba.`;
}

/** Error al crear: si fue por créditos, aviso (no error) y saldo actualizado. */
export function creationErrorToast(app, error, fallback) {
  if (isCreditsExhausted(error)) {
    if (app.ctx && app.ctx.credits) app.ctx.credits.status({ refresh: true }).catch(() => {});
    app.toast(userErrorMessage(error, fallback), 'warning');
    return;
  }
  app.toast(userErrorMessage(error, fallback), 'danger');
}
