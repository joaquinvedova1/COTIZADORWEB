/**
 * CEL-02 (BETA-LANZ): un borrador que no se pudo guardar y que después la
 * sincronización subió (vuelve la red) no se recupera al abrir: no hay un
 * "Error al guardar" que ya no existe. Uno con cambios de verdad, sí.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../../js/ui/session-memory.js';

const ctx = { mode: 'local' };
const saved = { id: 'q1', name: 'Hidrogrúa', client: 'Operadora', labor: [{ role: 'Operador', basicMonthly: 1000 }], updatedAt: '2026-10-22T10:00:00.000Z' };

describe('createDraftStore().recover', () => {
  test('sin borrador: null', () => {
    assert.equal(createDraftStore().recover(ctx, 'q1', saved), null);
  });

  test('igual a lo guardado (salvo la fecha de guardado): se descarta', () => {
    const drafts = createDraftStore();
    drafts.set(ctx, 'q1', { ...saved, updatedAt: '2026-10-22T09:59:00.000Z' });
    assert.equal(drafts.recover(ctx, 'q1', saved), null);
    assert.equal(drafts.get(ctx, 'q1'), undefined, 'quedó el borrador');
  });

  test('con un cambio que no está guardado: se recupera y queda', () => {
    const drafts = createDraftStore();
    const draft = { ...saved, client: 'Otra operadora' };
    drafts.set(ctx, 'q1', draft);
    assert.equal(drafts.recover(ctx, 'q1', saved), draft);
    assert.equal(drafts.get(ctx, 'q1'), draft);
  });

  test('con la nube sin sincronizar o en conflicto: se recupera aunque el contenido sea igual', () => {
    for (const state of [{ status: 'pending', dirty: true }, { status: 'error', dirty: false }, { status: 'saved', dirty: false, conflict: true }]) {
      const cloud = { ...ctx, sync: { getState: () => state } };
      const drafts = createDraftStore();
      drafts.set(cloud, 'q1', saved);
      assert.equal(drafts.recover(cloud, 'q1', saved), saved, JSON.stringify(state));
    }
    const settled = { ...ctx, sync: { getState: () => ({ status: 'saved', dirty: false, conflict: false }) } };
    const drafts = createDraftStore();
    drafts.set(settled, 'q1', saved);
    assert.equal(drafts.recover(settled, 'q1', saved), null);
  });

  test('sin lo guardado para comparar: se recupera', () => {
    const drafts = createDraftStore();
    drafts.set(ctx, 'q1', saved);
    assert.equal(drafts.recover(ctx, 'q1', null), saved);
  });
});
