/**
 * RATEOS Test Lab — reportes JSON (estructurado) y Markdown (humano).
 *
 * Los reportes pesados son artefactos de CI (reports/lab/, ignorado por git).
 * Antes de escribirlos se verifica que no contengan nada con forma de secreto
 * o dato personal (los escenarios son sintéticos, pero el control es barato).
 */

const SECRET_PATTERNS = [
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'clave secreta de Supabase'],
  [/service_role[\w-]*["']?\s*[=:]\s*["'][A-Za-z0-9._-]{20,}/, 'clave service_role'],
  [/\b(?:password|contraseña)\s*[=:]\s*\S{4,}/i, 'contraseña'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/, 'email'],
  [/postgres(?:ql)?:\/\/[^\s:/@]+:[^\s@/]{6,}@/, 'connection string'],
];

/** Falla si el texto contiene algo con forma de secreto o dato personal. */
export function assertSafeReport(text) {
  for (const [re, name] of SECRET_PATTERNS) {
    if (re.test(text)) throw new Error(`El reporte contiene algo con forma de ${name}: no se escribe.`);
  }
  return text;
}

const fmt = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: Math.abs(v) < 100 ? 4 : 2 }).format(v) : String(v);
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== false).map(([k, x]) => `${k} ${fmt(x)}`).join(' · ');
  return String(v);
};
const cell = (v) => fmt(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** JSON del reporte (Sets → listas; sin funciones). */
export function toJSON(campaign, meta = {}) {
  const replacer = (key, value) => (value instanceof Set ? [...value] : typeof value === 'function' ? undefined : value);
  return assertSafeReport(JSON.stringify({ ...campaign, meta: { ...campaign.meta, ...meta } }, replacer, 2));
}

/** Markdown legible por personas. */
export function toMarkdown(campaign, meta = {}) {
  const c = campaign;
  const m = { ...c.meta, ...meta };
  const lines = [];
  const push = (...xs) => lines.push(...xs);
  const cov = (label, kind) => {
    const g = c.coverage.summary.find((x) => x.label === label && x.kind === kind);
    return g ? `${g.covered}/${g.total}` : '—';
  };
  push('# RATEOS TEST LAB', '');
  push(`Run: \`${m.runId || '—'}\` · ${m.date || ''} · commit \`${m.commit || '—'}\` · modo ${m.mode === 'extended' ? `extendido (seed ${m.seed}, ${m.count} generados)` : 'estable'}`, '');
  push('## Resumen', '', '```');
  push('RATEOS TEST LAB', `Run: ${m.runId || '—'}`, '', `Scenarios: ${m.scenarios} (+ ${m.probes} sondas de contradicción + 1 auditoría de terminología)`, '');
  push(`PASS: ${c.perScenario.PASS}`);
  for (const k of ['P0 ECONOMIC', 'P0 CONSISTENCY', 'P1 COMPLETENESS', 'P1 UX', 'P2 PRESENTATION', 'MARKET REVIEW', 'HUMAN DECISION REQUIRED']) push(`${k === 'HUMAN DECISION REQUIRED' ? 'HUMAN DECISION' : k}: ${c.perScenario[k]}`);
  push('', 'Golden:', `${c.goldens.passed}/${c.goldens.total} PASS · candado ${c.goldens.lock.ok ? 'OK' : `FALLA (${c.goldens.lock.problems.length})`}`, '');
  push('Coverage:', `Tipos de servicio: ${cov('Tipos de servicio', 'service')}`, `Unidades: ${cov('Unidades comerciales', 'service')}`, `Unidades de externos: ${cov('Unidades de externos', 'service')}`, `Productos (unidades de venta): ${cov('Unidades de venta de productos', 'product')}`, `Productos (unidades de medida): ${cov('Unidades de medida (masa, volumen, conteo)', 'product')}`, '');
  push(`Gate: ${c.gate.ok ? 'OK' : `FALLA — ${c.gate.reasons.join(' · ')}`}`, '```', '');
  push('Por escenario cuenta la peor clasificación (la suma da el total). Abajo, la lista de hallazgos únicos.', '');

  push('## Hallazgos', '');
  if (!c.findings.length) push('Sin hallazgos.', '');
  else {
    push('| Clasificación | Código | Escenario | Hallazgo | Detalle | Decisión / fix |', '|---|---|---|---|---|---|');
    const order = ['P0 ECONOMIC', 'P0 CONSISTENCY', 'P1 COMPLETENESS', 'P1 UX', 'P2 PRESENTATION', 'MARKET REVIEW', 'HUMAN DECISION REQUIRED'];
    [...c.findings].sort((a, b) => order.indexOf(a.classification) - order.indexOf(b.classification) || a.subject.localeCompare(b.subject)).forEach((f) => {
      push(`| ${f.classification} | ${cell(f.code)} | ${cell(f.subject)} | ${cell(f.title)} | ${cell(f.detail)} | ${cell(f.known ? `${f.known.id} ${f.known.status}${f.known.decision ? `: ${f.known.decision}` : ''}${f.known.fix ? ` · fix: ${f.known.fix}` : ''}` : '—')} |`);
    });
    push('');
  }

  push('## Fixes realizados', '');
  if (!c.fixes.length) push('Ninguno en esta corrida.', '');
  else c.fixes.forEach((f) => push(`- **${f.id}** [${f.classification}] \`${f.key || f.code}\` — ${f.title}. Causa raíz: ${f.rootCause} Fix: ${f.fix} Test: ${f.test || '—'}.${f.stillPresent ? ' **(VOLVIÓ A APARECER)**' : ' Verificado: no aparece en esta corrida.'}`));
  push('');

  push('## Decisiones pendientes del dueño (HUMAN DECISION REQUIRED)', '');
  if (!c.decisions.length && !c.findings.some((f) => f.classification === 'HUMAN DECISION REQUIRED')) push('Ninguna.', '');
  else {
    const seen = new Set();
    c.decisions.forEach((d) => { if (d.key) seen.add(d.key); push(`- **${d.id}**${d.key || d.code ? ` (\`${d.key || d.code}\`)` : ''} — ${d.title}. ${d.decision}`); });
    c.findings.filter((f) => f.classification === 'HUMAN DECISION REQUIRED' && !seen.has(f.key)).forEach((f) => push(`- **${f.key}** — ${f.title}. ${f.detail}`));
    push('');
  }

  push('## Aceptados por el dueño', '');
  if (!(c.accepted || []).length) push('Ninguno.', '');
  else {
    (c.accepted || []).forEach((d) => push(`- **${d.id}**${d.key || d.code ? ` (\`${d.key || d.code}\`)` : ''} — ${d.title}. ${d.decision}`));
    push('');
  }

  push('## Huecos de la especificación (decisiones del oráculo)', '');
  if (!c.docGaps.length) push('Ninguno.');
  c.docGaps.forEach((g) => push(`- ${g.rule}: ${g.text}`));
  // PLAN-2026-014 (LAB-D6): huecos anteriores que ya son reglas escritas (el oráculo las sigue desde la documentación).
  (c.confirmedRules || []).forEach((g) => push(`- Confirmada en ${g.rule}: ${g.text}`));
  push('');

  push('## Mercado', '', 'El mercado nunca define la fórmula: una diferencia pide revisar los inputs.', '');
  const market = c.scenarios.flatMap((s) => (s.market || []).map((x) => ({ ...x, id: s.id })));
  if (!market.length) push('Sin conceptos de mercado en esta corrida.', '');
  else {
    push('| Escenario | Concepto | Valor | Estado | Detalle |', '|---|---|---|---|---|');
    market.forEach((x) => push(`| ${x.id} | ${x.concept} | ${cell(x.value)} | MARKET: ${x.status} | ${cell(x.message)} |`));
    push('');
  }

  push('## Cobertura', '', '| Dimensión | Valor | Escenarios |', '|---|---|---|');
  c.coverage.rows.forEach((r) => push(`| ${r.label} | ${r.value} | ${r.covered.length ? r.covered.slice(0, 6).join(', ') + (r.covered.length > 6 ? ` (+${r.covered.length - 6})` : '') : r.optional ? `opcional: ${r.optional}` : '**SIN ESCENARIO**'} |`));
  push('');

  push('## Golden cases', '', `${c.goldens.passed}/${c.goldens.total} en verde. Candado de huellas: ${c.goldens.lock.ok ? 'sin cambios' : 'CON CAMBIOS'}.`, '');
  c.goldens.failed.forEach((g) => push(`- FAIL ${g.id}: ${g.error}`));
  c.goldens.lock.problems.forEach((p) => push(`- CANDADO ${p.id} (${p.kind}): ${p.message}`));
  push('');

  push('## Escenarios', '');
  for (const s of c.scenarios) {
    push(`### ${s.id} — ${s.status}`, '', `${s.title}`, '');
    push(`- ${s.kind === 'product' ? `Producto · se vende por ${s.saleUnit}` : `Servicio ${s.serviceType} · unidad ${s.unit}`}${s.seed !== null && s.seed !== undefined ? ` · seed ${s.seed}` : ''}`);
    push(`- Inputs: ${cell(s.inputs)}`);
    const keys = Object.keys(s.actual || {});
    push(`- Esperado (oráculo) vs real (motor): ${keys.map((k) => `${k} ${fmt(s.expected ? s.expected[k] : null)} / ${fmt(s.actual[k])}`).join(' · ')}`);
    push(`- Deltas: ${s.deltas && s.deltas.length ? s.deltas.map((d) => `${d.path} Δ ${fmt(d.delta)}`).join(' · ') : 'ninguno'}`);
    if (s.businessExpect && s.businessExpect.length) push(`- Valores de negocio: ${s.businessExpect.map((e) => `${e.path} ${e.ok ? '✓' : `✗ (esperado ${fmt(e.expected)}, motor ${fmt(e.actual)})`}`).join(' · ')}`);
    push(`- Drivers: ${(s.drivers || []).join(' → ')}`);
    push(`- Invariantes: ${s.invariants.total - s.invariants.notApplicable} aplicables, ${s.invariants.failed.length} fallas${s.invariants.failed.length ? `: ${s.invariants.failed.map((x) => `${x.id} ${x.detail}`).join(' · ')}` : ''}`);
    if (s.completeness) push(`- Completitud: ${fmt(s.completeness.scorePct)} % · pendientes: ${s.completeness.pending.length ? s.completeness.pending.join(', ') : 'ninguno'}${s.completeness.notices.length ? ` · avisos: ${s.completeness.notices.join(', ')}` : ''}`);
    if (s.issues) push(`- Avisos del producto: ${s.issues.length ? s.issues.join(', ') : 'ninguno'}`);
    if (s.market && s.market.length) push(`- Mercado: ${s.market.map((x) => `${x.concept} ${x.status}`).join(' · ')}`);
    push(`- Hallazgos: ${s.findings.length ? s.findings.map((f) => `[${f.classification}] ${f.code}${f.known && f.known.rootCause ? ` (causa: ${f.known.rootCause})` : ''}`).join(' · ') : 'ninguno'}`);
    push('');
  }

  if (c.terminology) {
    push('## Terminología de la interfaz', '', `${c.terminology.title}: ${c.terminology.status}.`, '');
    c.terminology.findings.forEach((f) => push(`- [${f.classification}] ${f.code}: ${f.title}. ${f.detail}`));
    push('');
  }

  push('## Sondas de contradicción, campos redundantes y cero silencioso', '', '| Sonda | Qué prueba | Espera | Respuesta de RATEOS | Estado |', '|---|---|---|---|---|');
  c.probes.forEach((p) => push(`| ${p.id} | ${cell(p.title)} | ${p.expect} | ${p.response}: ${cell(p.evidence).slice(0, 220)} | ${p.status}${p.findings.length ? ` (${p.findings[0].classification})` : ''} |`));
  push('');
  return assertSafeReport(`${lines.join('\n')}\n`);
}
