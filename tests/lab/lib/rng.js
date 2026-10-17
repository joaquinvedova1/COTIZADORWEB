/**
 * RATEOS Test Lab — azar REPRODUCIBLE (PLAN-2026-013).
 *
 * Nada de Math.random(): cada escenario generado sale de un seed. El mismo
 * seed arma siempre la misma campaña, en cualquier máquina.
 */

/** mulberry32: PRNG de 32 bits, rápido y determinístico. */
export function createRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    seed: Number(seed) >>> 0,
    next,
    /** Entero en [min, max]. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** Real en [min, max) redondeado a `decimals`. */
    real: (min, max, decimals = 2) => Math.round((min + next() * (max - min)) * 10 ** decimals) / 10 ** decimals,
    /** Monto "redondo" (múltiplo de step) en [min, max]. */
    money: (min, max, step = 1000) => Math.round((min + next() * (max - min)) / step) * step,
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
  return rng;
}

/** Seed derivado de un texto (para que cada escenario tenga su propia secuencia). */
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Combinaciones "de a pares" (all-pairs): cada par de valores de cada par de
 * factores aparece al menos una vez, con muchas menos filas que el producto
 * cartesiano. Greedy determinístico (el seed desempata).
 * @param {Record<string, any[]>} factors
 * @param {object} rng createRng(...)
 * @returns {Record<string, any>[]}
 */
export function pairwise(factors, rng) {
  const names = Object.keys(factors);
  const uncovered = new Set();
  const key = (i, vi, j, vj) => `${i}:${vi}|${j}:${vj}`;
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      factors[names[i]].forEach((_, vi) => factors[names[j]].forEach((__, vj) => uncovered.add(key(i, vi, j, vj))));
    }
  }
  const rows = [];
  while (uncovered.size > 0 && rows.length < 500) {
    let best = null;
    let bestGain = -1;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const pick = names.map((n) => rng.int(0, factors[n].length - 1));
      // Mejora local: cada factor toma el valor que más pares nuevos cubre.
      for (let i = 0; i < names.length; i += 1) {
        let bestV = pick[i];
        let bestCount = -1;
        for (let v = 0; v < factors[names[i]].length; v += 1) {
          let count = 0;
          for (let j = 0; j < names.length; j += 1) {
            if (j === i) continue;
            const k = i < j ? key(i, v, j, pick[j]) : key(j, pick[j], i, v);
            if (uncovered.has(k)) count += 1;
          }
          if (count > bestCount) { bestCount = count; bestV = v; }
        }
        pick[i] = bestV;
      }
      let gain = 0;
      for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) if (uncovered.has(key(i, pick[i], j, pick[j]))) gain += 1;
      if (gain > bestGain) { bestGain = gain; best = pick; }
    }
    for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) uncovered.delete(key(i, best[i], j, best[j]));
    rows.push(Object.fromEntries(names.map((n, i) => [n, factors[n][best[i]]])));
  }
  return rows;
}
