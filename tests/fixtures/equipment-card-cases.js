/**
 * Revisión 0.25.0 (P-6 de costos): casos de la ficha de un equipo propio en una cotización
 * (equipmentCardAtQuote, "Ficha con los días de esta cotización"). Es el lugar donde las horas por
 * mes que trae la línea de Recursos (billableHoursPerMonth) no tienen que mover ningún número.
 *
 * Recibe las funciones por parámetro: la foto se sacó con las de la 0.24.0 (origin/main 2d5d483) y
 * el test corre los mismos casos con las de hoy.
 */

const isOwn = (e) => e && typeof e === 'object' && e.acquisition !== 'rented' && e.acquisition !== 'outsourced';

export function quoteCardCases({ computeQuote, createDemoState, equipmentCardAtQuote, cot0009Quote, cot0010Quote, cot0011Quote, baselineCases, serviceScenarios = [], resetIds = () => {} }) {
  const demo = createDemoState(1);
  const quotes = [
    ...demo.quotes.map((q) => ({ id: `demo:${q.id}`, quote: () => structuredClone(q), settings: demo.settings })),
    { id: 'cot-0009', quote: cot0009Quote },
    { id: 'cot-0010', quote: cot0010Quote },
    { id: 'cot-0011', quote: cot0011Quote },
    ...baselineCases().map((c) => ({ id: `baseline:${c.id}`, quote: () => structuredClone(c.quote), settings: c.settings })),
    ...serviceScenarios.map((s) => ({ id: `lab:${s.id}`, quote: () => { resetIds(); return structuredClone(s.build()); } })),
  ];
  const variants = [
    ['', (e) => e],
    // Una línea que trae horas por mes de Recursos: la ficha a la utilización no las usa.
    ['+horas-120', (e) => ({ ...e, billableHoursPerMonth: 120 })],
  ];
  const out = [];
  quotes.forEach(({ id, quote, settings }) => {
    (quote().equipment || []).forEach((line, i) => {
      if (!isOwn(line)) return;
      variants.forEach(([suffix, mod]) => {
        out.push({
          id: `ficha-cotizacion:${id}:${i}${suffix}`,
          run: () => {
            const q = quote();
            q.equipment[i] = mod(q.equipment[i]);
            const r = computeQuote(q, settings ? { settings } : undefined);
            return equipmentCardAtQuote(r, i, q.equipment[i]);
          },
        });
      });
    });
  });
  return out;
}
