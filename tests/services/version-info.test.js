/**
 * version.json → loadVersionInfo: la versión visible y el canal (PLAN-2026-005).
 * En staging (/preview/) el canal "staging" activa la confirmación antes de
 * actualizar el formato de los datos de la cuenta (comparten la base con producción).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadVersionInfo } from '../../js/services/settings-service.js';

const fetchJson = (data, ok = true) => async () => ({ ok, json: async () => data });

describe('loadVersionInfo', () => {
  test('devuelve versión, commit corto, fecha, ref y canal staging', async () => {
    const info = await loadVersionInfo(fetchJson({ version: '0.2.0', commit: 'abcdef0123456789', buildDate: '2026-10-05T12:00:00Z', ref: 'claude/x', channel: 'staging' }));
    assert.deepEqual(info, { version: '0.2.0', commit: 'abcdef012345', buildDate: '2026-10-05T12:00:00Z', ref: 'claude/x', channel: 'staging' });
  });

  test('canal desconocido o ausente → null (producción no pide confirmación)', async () => {
    assert.equal((await loadVersionInfo(fetchJson({ version: '0.2.0', channel: 'otra' }))).channel, null);
    assert.equal((await loadVersionInfo(fetchJson({ version: '0.2.0' }))).channel, null);
    assert.equal((await loadVersionInfo(fetchJson({ version: '0.2.0', channel: 'production' }))).channel, 'production');
  });

  test('sin version.json o con error: valores por defecto, nunca lanza', async () => {
    assert.equal((await loadVersionInfo(fetchJson({}, false))).version, 'dev');
    assert.equal((await loadVersionInfo(async () => { throw new Error('offline'); })).channel, null);
    assert.equal((await loadVersionInfo(null)).commit, 'local');
  });
});
