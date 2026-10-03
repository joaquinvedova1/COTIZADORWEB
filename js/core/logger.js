/**
 * Logger centralizado. Evita console.log dispersos.
 *
 * - En producción sólo se emiten warn/error, y SIN datos de contexto
 *   (pueden contener información empresarial sensible).
 * - En desarrollo se emite todo con su contexto.
 * - Se pueden registrar "sinks" para capturar logs (tests, futuro monitoreo).
 */

import { detectEnvironment } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const state = {
  environment: detectEnvironment(),
  sinks: new Set(),
  console: globalThis.console,
};

/** Permite forzar el entorno (tests) o reemplazar la consola. */
export function configureLogger({ environment, consoleImpl } = {}) {
  if (environment) state.environment = environment;
  if (consoleImpl !== undefined) state.console = consoleImpl;
}

/** Registra un receptor de logs. Devuelve función para desregistrarlo. */
export function addLogSink(sink) {
  state.sinks.add(sink);
  return () => state.sinks.delete(sink);
}

function emit(level, message, context) {
  const isProd = state.environment === 'production';
  const entry = {
    level,
    message: String(message),
    context: isProd ? undefined : context,
    timestamp: new Date().toISOString(),
  };
  state.sinks.forEach((sink) => {
    try {
      sink(entry);
    } catch {
      /* un sink defectuoso nunca rompe la app */
    }
  });
  const minLevel = isProd ? LEVELS.warn : LEVELS.debug;
  if (LEVELS[level] < minLevel || !state.console) return;
  const fn = state.console[level] || state.console.log;
  if (typeof fn !== 'function') return;
  if (entry.context === undefined) fn.call(state.console, `[RATEOS] ${entry.message}`);
  else fn.call(state.console, `[RATEOS] ${entry.message}`, entry.context);
}

export const logger = Object.freeze({
  debug: (message, context) => emit('debug', message, context),
  info: (message, context) => emit('info', message, context),
  warn: (message, context) => emit('warn', message, context),
  error: (message, context) => emit('error', message, context),
});
