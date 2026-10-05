/**
 * Configuración → Tu empresa: "Empezar con mi empresa en limpio" conserva el
 * sector y la actividad / especialidad que cargó la persona.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { freshOrgFrom } from '../../js/ui/views/settings.js';

describe('freshOrgFrom: sector y actividad', () => {
  test('conserva sector y actividad (saneada)', () => {
    assert.deepEqual(freshOrgFrom({ name: 'Mi SA', baseLocation: 'Añelo', industry: 'oil_gas', activity: '  Servicios al pozo ' }), { name: 'Mi SA', baseLocation: 'Añelo', industry: 'oil_gas', activity: 'Servicios al pozo' });
  });

  test('sin actividad, el resultado es el de siempre (sin campo nuevo)', () => {
    assert.deepEqual(freshOrgFrom({ name: 'Mi SA', industry: 'transport' }), { name: 'Mi SA', baseLocation: '', industry: 'transport' });
    assert.deepEqual(freshOrgFrom(null), { name: '', baseLocation: '', industry: '' });
  });
});
