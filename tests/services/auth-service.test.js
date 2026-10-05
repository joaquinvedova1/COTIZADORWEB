/**
 * Tests de AuthService (modo local, sin cuentas).
 * Contrato: no autentica, no recibe ni guarda credenciales y lo dice.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createAuthService, AUTH_MODES, AUTH_NOT_AVAILABLE } from '../../js/services/auth-service.js';
import { createAppContext } from '../../js/services/app-context.js';
import { MemoryStorage } from '../../js/data/memory-storage.js';
import { configureLogger } from '../../js/core/logger.js';

configureLogger({ consoleImpl: null });

describe('AuthService (modo local)', () => {
  test('no hay cuentas disponibles: modo local, sin sesión', async () => {
    const auth = createAuthService();
    assert.equal(auth.mode, AUTH_MODES.local);
    assert.equal(auth.available, false);
    assert.equal(await auth.getSession(), null);
    assert.ok(Object.isFrozen(auth));
  });

  test('ingreso y registro responden "not_available" y no persisten nada', async () => {
    const storage = new MemoryStorage();
    const ctx = await createAppContext({ storage, appVersion: 'test' });
    const before = storage.getItem('rateos.state');
    const keysBefore = storage.length;
    assert.deepEqual(await ctx.auth.signIn({ email: 'a@b.c', password: 'secreto' }), AUTH_NOT_AVAILABLE);
    assert.deepEqual(await ctx.auth.signUp({ email: 'a@b.c', password: 'secreto' }), AUTH_NOT_AVAILABLE);
    assert.equal(storage.getItem('rateos.state'), before);
    assert.equal(storage.length, keysBefore);
    for (let i = 0; i < storage.length; i += 1) {
      const value = storage.getItem(storage.key(i)) || '';
      assert.ok(!value.includes('secreto'), 'nunca se guarda una contraseña');
      assert.ok(!value.includes('a@b.c'), 'nunca se guarda el email de ingreso');
    }
  });
});
