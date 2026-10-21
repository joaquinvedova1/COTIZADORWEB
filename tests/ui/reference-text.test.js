/**
 * DESIGN-02 (PLAN-2026-025) · Precio de referencia y fechas del PDF.
 * - VAL-G4 (VAL-01): la beta dice que el precio sale de los costos y supuestos
 *   de la empresa y que no es un precio de mercado.
 * - AUD-T1 C-E2-11: el PDF lleva la fecha de la oferta, no sólo la de impresión.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { REFERENCE_PRICE_NOTE, documentDatesText } from '../../js/ui/reference-text.js';

describe('DESIGN-02 · precio de referencia (VAL-G4)', () => {
  test('dice con qué se calcula y que no es un precio de mercado', () => {
    assert.equal(REFERENCE_PRICE_NOTE, 'Calculado con tus costos y tus supuestos: no es un precio de mercado.');
  });
});

describe('DESIGN-02 · fechas del PDF (AUD-T1 C-E2-11)', () => {
  test('la fecha de la oferta y, aparte, la de impresión', () => {
    assert.equal(documentDatesText({ offerDate: '2026-10-01', printedAt: new Date(2026, 9, 20, 9, 15) }), 'Oferta del 01/10/2026 · impreso el 20/10/2026');
  });

  test('la fecha de la oferta no se corre un día por la zona horaria (de noche, en Argentina)', () => {
    assert.equal(documentDatesText({ offerDate: '2026-10-16', printedAt: new Date(2026, 9, 20, 23, 59) }), 'Oferta del 16/10/2026 · impreso el 20/10/2026');
  });

  test('sin fecha de oferta válida, sólo la de impresión (nunca una fecha inventada)', () => {
    const printedAt = new Date(2026, 9, 20);
    for (const offerDate of [null, undefined, '', '2026-13-01', '2026-02-30', '01/10/2026', 20261001]) {
      assert.equal(documentDatesText({ offerDate, printedAt }), 'Impreso el 20/10/2026', String(offerDate));
    }
  });
});
