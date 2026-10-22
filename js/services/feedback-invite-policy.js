/**
 * Cuándo invitar a dejar un comentario después de una tarea (PLAN-2026-029):
 * a lo sumo una vez cada 14 días por navegador, y "Ahora no" la esconde 60.
 * Es una comodidad de este navegador (js/data/browser-preferences.js): si no
 * se puede leer o escribir, no se invita.
 */

import { browserPreferencesStorage } from '../data/browser-preferences.js';

const KEY = 'rateos.feedbackInvite.v1';
const DAY = 24 * 60 * 60 * 1000;
export const INVITE_EVERY_DAYS = 14;
export const INVITE_SNOOZE_DAYS = 60;

function readState(storage) {
  const raw = storage.getItem(KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeState(storage, patch) {
  try {
    storage.setItem(KEY, JSON.stringify({ ...readState(storage), ...patch }));
    return true;
  } catch {
    return false;
  }
}

/** ¿Toca invitar ahora? (false si no hay dónde recordar que ya se invitó). */
export function shouldInvite({ storage = browserPreferencesStorage(), now = Date.now() } = {}) {
  if (!storage) return false;
  try {
    const state = readState(storage);
    if (Number.isFinite(state.snoozedUntil) && now < state.snoozedUntil) return false;
    if (Number.isFinite(state.shownAt) && now - state.shownAt < INVITE_EVERY_DAYS * DAY) return false;
    return true;
  } catch {
    return false;
  }
}

/** Si toca, registra que se invitó y devuelve true (si no se pudo registrar, false: no se invita). */
export function claimInvite({ storage = browserPreferencesStorage(), now = Date.now() } = {}) {
  return shouldInvite({ storage, now }) && writeState(storage, { shownAt: now });
}

/** "Ahora no": no volver a invitar por 60 días. */
export function snoozeInvite({ storage = browserPreferencesStorage(), now = Date.now() } = {}) {
  return Boolean(storage) && writeState(storage, { snoozedUntil: now + INVITE_SNOOZE_DAYS * DAY });
}
