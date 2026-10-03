/**
 * Tests de js/core/logger.js — logging centralizado (Prompt 4 §22).
 * En producción: no se emite info/debug y NUNCA se emite contexto
 * (puede contener información empresarial sensible).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { logger, configureLogger, addLogSink } from '../../js/core/logger.js';
import { detectEnvironment } from '../../js/config.js';

/** Consola falsa que registra cada llamada. */
function fakeConsole() {
  const calls = [];
  const make = (level) => (...args) => calls.push({ level, args });
  return { calls, debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error'), log: make('log') };
}

const SENSITIVE = { client: 'Operadora X', monthlyLaborCost: 85000000 };

let cons;
beforeEach(() => {
  cons = fakeConsole();
});
afterEach(() => {
  configureLogger({ environment: 'development', consoleImpl: null });
});

describe('logger en producción', () => {
  beforeEach(() => configureLogger({ environment: 'production', consoleImpl: cons }));

  test('no emite info ni debug a la consola', () => {
    logger.info('info', SENSITIVE);
    logger.debug('debug', SENSITIVE);
    assert.deepEqual(cons.calls, []);
  });

  test('emite warn y error SIN contexto', () => {
    logger.warn('advertencia', SENSITIVE);
    logger.error('falla', SENSITIVE);
    assert.deepEqual(cons.calls, [
      { level: 'warn', args: ['[RATEOS] advertencia'] },
      { level: 'error', args: ['[RATEOS] falla'] },
    ]);
    assert.equal(JSON.stringify(cons.calls).includes('85000000'), false);
    assert.equal(JSON.stringify(cons.calls).includes('Operadora'), false);
  });

  test('los sinks tampoco reciben el contexto', () => {
    const entries = [];
    const remove = addLogSink((e) => entries.push(e));
    try {
      logger.info('info', SENSITIVE);
      logger.error('falla', SENSITIVE);
    } finally {
      remove();
    }
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      assert.equal(entry.context, undefined);
      assert.equal(typeof entry.timestamp, 'string');
    }
    assert.deepEqual(entries.map((e) => [e.level, e.message]), [['info', 'info'], ['error', 'falla']]);
  });
});

describe('logger en desarrollo', () => {
  beforeEach(() => configureLogger({ environment: 'development', consoleImpl: cons }));

  test('emite todos los niveles con su contexto', () => {
    logger.debug('d', { a: 1 });
    logger.info('i', { b: 2 });
    logger.warn('w');
    logger.error('e', { c: 3 });
    assert.deepEqual(cons.calls, [
      { level: 'debug', args: ['[RATEOS] d', { a: 1 }] },
      { level: 'info', args: ['[RATEOS] i', { b: 2 }] },
      { level: 'warn', args: ['[RATEOS] w'] },
      { level: 'error', args: ['[RATEOS] e', { c: 3 }] },
    ]);
  });

  test('convierte el mensaje a texto', () => {
    logger.warn(42);
    assert.deepEqual(cons.calls[0].args, ['[RATEOS] 42']);
  });
});

describe('logger — robustez', () => {
  test('un sink que lanza no rompe la app', () => {
    configureLogger({ environment: 'development', consoleImpl: cons });
    const remove = addLogSink(() => {
      throw new Error('sink roto');
    });
    try {
      assert.doesNotThrow(() => logger.error('x'));
    } finally {
      remove();
    }
    assert.equal(cons.calls.length, 1);
  });

  test('sin consola disponible no lanza', () => {
    configureLogger({ environment: 'development', consoleImpl: null });
    assert.doesNotThrow(() => logger.error('x', { a: 1 }));
  });

  test('consola sin el método del nivel usa console.log', () => {
    const calls = [];
    configureLogger({ environment: 'development', consoleImpl: { log: (...args) => calls.push(args) } });
    logger.info('hola');
    assert.deepEqual(calls, [['[RATEOS] hola']]);
  });

  test('desregistrar un sink deja de enviarle logs', () => {
    configureLogger({ environment: 'development', consoleImpl: null });
    const entries = [];
    const remove = addLogSink((e) => entries.push(e));
    logger.warn('uno');
    remove();
    logger.warn('dos');
    assert.equal(entries.length, 1);
  });

  test('el logger es inmutable', () => {
    assert.ok(Object.isFrozen(logger));
  });
});

describe('detectEnvironment (config.js)', () => {
  test('localhost y sin host → development; cualquier otro host → production', () => {
    assert.equal(detectEnvironment({ hostname: 'localhost' }), 'development');
    assert.equal(detectEnvironment({ hostname: '127.0.0.1' }), 'development');
    assert.equal(detectEnvironment({ hostname: '' }), 'development');
    assert.equal(detectEnvironment(undefined), 'development');
    assert.equal(detectEnvironment({ hostname: 'joaquinvedova1.github.io' }), 'production');
  });
});
