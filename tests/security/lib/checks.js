/**
 * RATEOS — Beta Security Gate (PLAN-2026-015): controles reproducibles de
 * seguridad, tenancy, integridad y privacidad que corren SIN la base y sin red.
 *
 * - Estáticos sobre el repo (lo que se publica, las migraciones, el test SQL
 *   de negación, cómo el cliente usa Supabase, logs y eventos).
 * - Dinámicos sobre módulos reales con un gateway falso en memoria (datos
 *   sintéticos): la nube nunca se pisa con datos "recuperados", una pestaña
 *   nunca borra los cambios sin subir de otra, el organizationId del cliente
 *   nunca decide, logs y eventos sin datos de negocio, auth sólo PKCE.
 *
 * La negación REAL entre empresas la prueba la base: supabase/tests/
 * beta_security_test.sql, rls_test.sql y rls_admin_test.sql (se corren con el
 * plugin/MCP de Supabase o psql; ver docs/BETA_SECURITY.md).
 *
 * Cada control: { id, title, severity: 'P0'|'P1'|'P2', category, status:
 * 'pass'|'fail'|'human', details: string[] }. 'human' = decisión del dueño
 * (no bloquea el gate, siempre se informa).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));

function walk(relDir, { skip = [] } = {}) {
  const out = [];
  const abs = path.join(ROOT, relDir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = path.posix.join(relDir, name);
    if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) out.push(...walk(rel, { skip }));
    else out.push(rel);
  }
  return out;
}

const check = (id, title, severity, category, findings, { pass = 'OK' } = {}) => ({
  id,
  title,
  severity,
  category,
  status: findings.length ? 'fail' : 'pass',
  details: findings.length ? findings : [pass],
});

// ------------------------------------------------------------- detectores

const SECRET_PATTERNS = Object.freeze([
  { name: 'secret key de Supabase (sb_secret_)', re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: 'clave privada PEM', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'connection string con contraseña', re: /postgres(?:ql)?:\/\/[^\s'"`/:@]+:[^\s'"`@]+@/g },
]);

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function decodeJwtPayload(part) {
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** Secretos en un texto: secret keys, claves privadas, connection strings y JWT de service_role. */
export function findSecrets(text) {
  const hits = [];
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    if (p.re.test(String(text))) hits.push(p.name);
  }
  JWT_RE.lastIndex = 0;
  let m;
  while ((m = JWT_RE.exec(String(text)))) {
    const payload = decodeJwtPayload(m[1]);
    if (payload && (payload.role === 'service_role' || payload.role === 'supabase_admin')) hits.push(`JWT con rol ${payload.role}`);
  }
  return hits;
}

/** Llamadas al logger cuyo mensaje es un template literal (el mensaje SÍ sale en producción). */
export function loggerTemplateCalls(text) {
  const out = [];
  const re = /logger\.(?:debug|info|warn|error)\(\s*`([^`]*)`/g;
  let m;
  while ((m = re.exec(String(text)))) out.push(m[1]);
  return out;
}

/** DELETE fuera de un bloque que espera insufficient_privilege (un DELETE real necesitaría confirmación y podría borrar). */
export function unguardedDeletes(sqlText) {
  const lines = String(sqlText).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!/\bdelete\s+from\b/i.test(line) || /^\s*--/.test(line)) return;
    const before = lines.slice(Math.max(0, i - 2), i).join('\n');
    const after = lines.slice(i + 1, i + 4).join('\n');
    if (!/\bbegin\s*$/im.test(before) || !/exception when insufficient_privilege/i.test(after)) out.push(`línea ${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  return out;
}

/** Reglas de tenancy de un conjunto de migraciones (texto SQL completo). */
export function migrationFindings(sql) {
  const text = String(sql);
  const findings = [];
  const tables = [...text.matchAll(/create table (?:if not exists )?(public|private)\.([a-z_]+)/gi)].map((m) => ({ schema: m[1].toLowerCase(), name: m[2].toLowerCase() }));
  for (const t of tables) {
    const rls = new RegExp(`alter table (?:only )?${t.schema}\\.${t.name} enable row level security`, 'i');
    if (!rls.test(text)) findings.push(`${t.schema}.${t.name}: sin RLS habilitada`);
    if (t.schema === 'public') {
      const revoke = new RegExp(`revoke all on table [^;]*\\bpublic\\.${t.name}\\b[^;]*\\bfrom\\b[^;]*\\banon\\b`, 'i');
      if (!revoke.test(text)) findings.push(`public.${t.name}: no se revocan los permisos por defecto de anon`);
    }
  }
  if (/disable row level security/i.test(text)) findings.push('alguna migración deshabilita RLS');
  for (const m of text.matchAll(/grant [^;]*? to ([^;]+);/gi)) {
    if (/\b(anon|public)\b/i.test(m[1])) findings.push(`grant a anon/public: ${m[0].replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  for (const m of text.matchAll(/create policy [a-z_]+ on ([a-z_.]+)\s+for ([a-z]+)\s+to ([a-z_, ]+)/gi)) {
    if (m[3].split(',').map((s) => s.trim().toLowerCase()).some((r) => r !== 'authenticated')) findings.push(`política para un rol distinto de authenticated: ${m[1]}`);
  }
  if (/using\s*\(\s*true\s*\)/i.test(text) || /with check\s*\(\s*true\s*\)/i.test(text)) findings.push('una política usa "true" (abre la tabla a cualquier sesión)');
  const fnBlocks = text.split(/create (?:or replace )?function /i).slice(1);
  for (const block of fnBlocks) {
    const header = block.split(/\$\$/)[0];
    if (!/security definer/i.test(header)) continue;
    const name = header.match(/^([a-z_.]+)\s*\(/i);
    const fname = name ? name[1] : '(?)';
    if (!fname.startsWith('private.')) findings.push(`security definer fuera de private: ${fname}`);
    if (!/set search_path = ''/i.test(header)) findings.push(`security definer sin search_path vacío: ${fname}`);
  }
  return findings;
}

/** Uso de Supabase en el código del cliente (sin el SDK vendorizado). */
export function supabaseSurface(files) {
  const rpcNames = new Set();
  const tables = new Set();
  const mutations = [];
  const features = [];
  const dynamicRpc = [];
  const sdkImports = [];
  const clientImports = [];
  for (const { rel, text } of files) {
    for (const m of text.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)) rpcNames.add(m[1]);
    for (const m of text.matchAll(/\brpc\(\s*client\s*,\s*'([a-z_]+)'/g)) rpcNames.add(m[1]);
    // Los gateways de admin y del feedback llaman a sus RPC con rpc(client, '<nombre literal>'): el
    // .rpc(name) de su ayuda no es dinámico (los nombres se toman de esas llamadas).
    if (/\.rpc\(\s*(?!['"`])/.test(text) && rel !== 'js/data/admin-gateway.js' && rel !== 'js/data/feedback-gateway.js') dynamicRpc.push(rel);
    for (const m of text.matchAll(/\.from\(\s*'([a-z_]+)'/g)) tables.add(m[1]);
    if (/\.from\(\s*'[a-z_]+'/.test(text) && /\.(?:insert|upsert|delete)\(/.test(text)) mutations.push(rel);
    if (/\.channel\(|\.functions\.invoke\(|\bauth\.admin\b|\.storage\.from\(/.test(text)) features.push(rel);
    if (/from\s+'[^']*vendor\/supabase\.js'/.test(text) && rel !== 'js/data/supabase-client.js') sdkImports.push(rel);
    if (/from\s+'[^']*supabase-client\.js'/.test(text) && rel !== 'js/services/cloud.js') clientImports.push(rel);
  }
  return { rpcNames: [...rpcNames].sort(), tables: [...tables].sort(), mutations, features, dynamicRpc, sdkImports, clientImports };
}

const ALLOWED_RPC = Object.freeze([
  'admin_overview', 'admin_users', 'am_i_platform_admin',
  // PLAN-2026-029 (feedback de la beta: problemas y sugerencias): revisadas en SEC-19.
  'admin_feedback', 'admin_review_feedback', 'my_feedback', 'submit_feedback',
]);

/** Funciones del feedback que llama el navegador (PLAN-2026-029). */
const FEEDBACK_RPC = Object.freeze(['submit_feedback', 'my_feedback', 'admin_feedback', 'admin_review_feedback']);

/**
 * SEC-19 — feedback de la beta (PLAN-2026-029): la autoridad está en Postgres, sin cuotas ni premios.
 * @param {{ migration: string, sqlTest: string, concurrency: string, clientFiles: { rel: string, text: string }[] }} input
 * @returns {string[]} hallazgos
 */
export function feedbackFindings({ migration = '', sqlTest = '', concurrency = '', clientFiles = [] } = {}) {
  const out = [];
  const sql = String(migration);
  if (!sql) return ['falta la migración del feedback'];
  ['feedback', 'feedback_events'].forEach((t) => {
    if (!new RegExp(`create table private\\.${t}\\b`).test(sql)) out.push(`la tabla ${t} no está en private`);
    if (!new RegExp(`alter table private\\.${t} enable row level security`).test(sql)) out.push(`la tabla ${t} no tiene RLS`);
  });
  if (!/revoke all on table private\.feedback, private\.feedback_events from public, anon, authenticated/.test(sql)) out.push('las tablas del feedback no revocan los grants');
  if (/create table public\./.test(sql)) out.push('la migración crea tablas en public');
  // Sin cuotas ni premios: el feedback no toca el guardado ni las empresas.
  if (/create trigger/i.test(sql)) out.push('la migración del feedback crea un trigger (no debe tocar el guardado ni las empresas)');
  if (/workspace_states/.test(sql.replace(/^\s*--.*$/gm, ''))) out.push('la migración del feedback usa workspace_states');
  if (/credit|ledger|balance|reward/i.test(sql.replace(/^\s*--.*$/gm, ''))) out.push('la migración del feedback tiene créditos, saldos o premios');
  FEEDBACK_RPC.forEach((name) => {
    const body = (sql.match(new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\\$\\$;`)) || [''])[0];
    if (!body) out.push(`falta private.${name}`);
    else {
      if (!/security definer/.test(body) || !/set search_path = ''/.test(body)) out.push(`private.${name} no es security definer con search_path vacío`);
      if (!/raise exception 'forbidden'/.test(body)) out.push(`private.${name} no verifica quién llama`);
    }
    if (!new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?security invoker`).test(sql)) out.push(`public.${name} no es un wrapper security invoker`);
    if (new RegExp(`grant execute on function (?:public|private)\\.${name}\\([^;]*to (?:anon|public)`).test(sql)) out.push(`${name} se puede ejecutar sin sesión`);
  });
  ['admin_feedback', 'admin_review_feedback'].forEach((name) => {
    const body = (sql.match(new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\\$\\$;`)) || [''])[0];
    if (body && !/is_platform_admin\(\)/.test(body)) out.push(`private.${name} no exige RATEOS ADMIN`);
  });
  ['submit_feedback', 'my_feedback'].forEach((name) => {
    const body = (sql.match(new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\\$\\$;`)) || [''])[0];
    if (body && !/is_member\(p_org\)/.test(body)) out.push(`private.${name} no exige ser miembro de la empresa`);
  });
  const review = (sql.match(/create or replace function private\.admin_review_feedback\([\s\S]*?\$\$;/) || [''])[0];
  if (review && !/for update/.test(review)) out.push('la revisión no bloquea el comentario');
  const submit = (sql.match(/create or replace function private\.submit_feedback\([\s\S]*?\$\$;/) || [''])[0];
  // Un lock por persona (su límite vale en todas sus empresas) y otro por empresa (revisión BETA-LANZ).
  if (submit && (!/rateos_feedback_rate_limited/.test(submit) || !/pg_advisory_xact_lock\([^;]*rateos_feedback_author:[^;]*v_uid/.test(submit) || !/pg_advisory_xact_lock\([^;]*rateos_feedback:[^;]*p_org/.test(submit))) out.push('el envío no tiene límites contra el spam a prueba de envíos simultáneos');
  // El navegador nunca toca las tablas (sólo las RPC) y no quedan cuotas ni créditos en la app.
  clientFiles.forEach(({ rel, text }) => {
    if (/\.from\(\s*['"`](?:feedback|feedback_events)['"`]/.test(text)) out.push(`${rel}: nombra una tabla del feedback`);
    if (/credits_exhausted|cálculos de prueba|get_my_credits|credit_preview/.test(text)) out.push(`${rel}: quedan restos de los créditos de prueba`);
  });
  const t = String(sqlTest);
  if (!t) out.push('falta supabase/tests/feedback_test.sql');
  else {
    [
      ['act_anon', 'anon'], ['insufficient_privilege', 'acceso directo a las tablas'], ['B leyó el feedback de A', 'A↔B'],
      ['una persona sin rol', 'admin sin rol'], ['rateos_feedback_rate_limited', 'límites contra el spam'], ['rateos_feedback_duplicate', 'repetidos'],
      ['invisibles', 'caracteres invisibles'], ['15 cotizaciones', 'sin cupos en el guardado'], ['catálogo', 'catálogo'],
    ].forEach(([needle, what]) => {
      if (!t.includes(needle)) out.push(`el test SQL no cubre: ${what}`);
    });
    unguardedDeletes(t).forEach((d) => out.push(`feedback_test.sql: DELETE sin protección: ${d}`));
    if (!/raise exception 'FEEDBACK_TESTS_PASSED[\s\S]*raise exception 'FEEDBACK_TESTS_FAILED[\s\S]*end;\s*\$test\$;\s*$/.test(t)) out.push('el test SQL no termina siempre con RAISE EXCEPTION (debe deshacer todo)');
  }
  if (!/current_database\(\)/.test(String(concurrency)) || !/Se niega a correr/.test(String(concurrency))) out.push('la prueba de concurrencia no se niega a correr fuera de la base local');
  return out;
}
const ALLOWED_TABLES = Object.freeze(['organization_members', 'organizations', 'profiles', 'workspace_states']);

// ------------------------------------------------------- controles estáticos

function clientCodeFiles() {
  return walk('js', { skip: ['js/data/vendor'] }).filter((f) => f.endsWith('.js')).map((rel) => ({ rel, text: read(rel) }));
}

function publishedSurfaceFiles() {
  const files = ['index.html', 'version.json', ...walk('js'), ...walk('css')].filter((f) => exists(f));
  if (exists('dist')) files.push(...walk('dist').filter((f) => /\.(?:js|mjs|html|json|css|txt)$/.test(f)));
  return files;
}

/**
 * HD-02: ¿el workflow de deploy publica un staging en el origen de producción?
 * (una rama en /preview/ corre junto a las sesiones y los datos reales).
 * @param {string} workflow texto de .github/workflows/deploy-pages.yml
 * @param {{ stagePreviewScript?: boolean }} [opts] ¿existe scripts/stage-preview.mjs?
 */
export function stagingFindings(workflow, { stagePreviewScript = false } = {}) {
  const out = [];
  const wf = String(workflow || '');
  if (/workflow_run/.test(wf)) out.push('deploy-pages.yml se dispara con workflow_run: una rama se publicaría en el origen de producción');
  if (/preview_ref|PREVIEW_BRANCH|preview_sha|stage-preview|preview-dist/.test(wf)) out.push('deploy-pages.yml todavía arma un staging (/preview/)');
  if (!/if \[ -e dist\/preview \]; then[\s\S]*?exit 1/.test(wf)) out.push('falta la guardia del build que impide publicar dist/preview');
  if (!/\$\{PAGE_URL\}preview\/version\.json\?t=/.test(wf) || !/"\$PREVIEW_VERSION" = "404"/.test(wf)) out.push('falta la verificación posterior al deploy: /preview/ → 404');
  if (stagePreviewScript) out.push('scripts/stage-preview.mjs existe: el staging en el mismo origen está prohibido (HD-02)');
  return out;
}

function staticChecks() {
  const results = [];

  // SEC-01 — nada secreto en lo que se publica (y en dist/ si está construido).
  const secretHits = [];
  for (const rel of publishedSurfaceFiles()) findSecrets(read(rel)).forEach((h) => secretHits.push(`${rel}: ${h}`));
  const config = read('js/config.js');
  const key = (config.match(/publishableKey:\s*'([^']+)'/) || [])[1] || '';
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) secretHits.push('js/config.js: la clave del navegador no es una publishable key (sb_publishable_…)');
  results.push(check('SEC-01', 'Sin secret keys, service_role, contraseñas ni claves privadas en lo publicado (js/, index.html, css/, version.json, dist/)', 'P0', 'SECURITY', secretHits));

  // SEC-02 — el cliente usa la superficie mínima de Supabase.
  const surface = supabaseSurface(clientCodeFiles());
  const surfaceHits = [];
  surface.rpcNames.filter((n) => !ALLOWED_RPC.includes(n)).forEach((n) => surfaceHits.push(`RPC no revisada: ${n}`));
  surface.tables.filter((t) => !ALLOWED_TABLES.includes(t)).forEach((t) => surfaceHits.push(`tabla no revisada: ${t}`));
  surface.mutations.forEach((f) => surfaceHits.push(`${f}: insert/upsert/delete desde el cliente (sólo se actualiza el workspace propio)`));
  surface.features.forEach((f) => surfaceHits.push(`${f}: Storage/Realtime/Edge Functions/auth.admin desde el cliente`));
  surface.dynamicRpc.forEach((f) => surfaceHits.push(`${f}: RPC con nombre no literal`));
  surface.sdkImports.forEach((f) => surfaceHits.push(`${f}: importa el SDK fuera de js/data/supabase-client.js`));
  surface.clientImports.forEach((f) => surfaceHits.push(`${f}: usa el cliente de Supabase fuera de js/services/cloud.js`));
  results.push(check('SEC-02', `El navegador sólo usa ${ALLOWED_TABLES.length} tablas (select + update del workspace propio) y ${ALLOWED_RPC.length} RPC revisadas (admin y feedback); sin Storage, Realtime ni auth.admin`, 'P0', 'SECURITY', surfaceHits, { pass: `tablas: ${surface.tables.join(', ')} · RPC: ${surface.rpcNames.join(', ')}` }));

  // SEC-03 — migraciones: RLS, grants, políticas y security definer.
  const migrationFiles = walk('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  const migrationHits = migrationFiles.length ? migrationFindings(migrationFiles.map(read).join('\n')) : ['no hay migraciones'];
  results.push(check('SEC-03', 'Migraciones: RLS en cada tabla, nada para anon, políticas sólo para authenticated, security definer sólo en private con search_path vacío', 'P0', 'SECURITY', migrationHits, { pass: `${migrationFiles.length} migraciones revisadas` }));

  // SEC-04 — el test SQL de negación A/B existe, cubre lo pedido y nunca deja nada.
  const sqlHits = [];
  const SQL = 'supabase/tests/beta_security_test.sql';
  if (!exists(SQL)) sqlHits.push(`falta ${SQL}`);
  else {
    const sql = read(SQL);
    const required = [
      ['A→B', 'A ataca a B'], ['B→A', 'B ataca a A'], ['on conflict', 'upsert'], ['organization_id <> xo', 'filtro manipulado'],
      ['where id = yw', 'id conocido del workspace ajeno'], ['miembro QUITADO', 'miembro quitado'], ['VIEWER', 'rol VIEWER'],
      ['ESTIMATOR', 'rol ESTIMATOR'], ['RATEOS ADMIN sintético', 'admin de plataforma sin contenido'], ["set local role anon", 'anon'],
      ['JWT sin usuario', 'JWT sin usuario'], ['catálogo en vivo', 'catálogo en vivo'], ['BETA_SECURITY_TESTS_PASSED', 'resultado esperado'],
    ];
    required.forEach(([needle, what]) => {
      if (!sql.includes(needle)) sqlHits.push(`no cubre: ${what}`);
    });
    unguardedDeletes(sql).forEach((d) => sqlHits.push(`DELETE sin protección: ${d}`));
    if (!/raise exception 'BETA_SECURITY_TESTS_PASSED[\s\S]*raise exception 'BETA_SECURITY_TESTS_FAILED[\s\S]*end;\s*\$\$;\s*$/.test(sql)) sqlHits.push('el bloque no termina siempre con RAISE EXCEPTION (debe deshacer todo)');
  }
  for (const f of ['supabase/tests/rls_test.sql', 'supabase/tests/rls_admin_test.sql']) {
    if (!exists(f)) sqlHits.push(`falta ${f}`);
    else unguardedDeletes(read(f)).forEach((d) => sqlHits.push(`${f}: DELETE sin protección: ${d}`));
  }
  results.push(check('SEC-04', 'Tests de negación en la base (A→B y B→A con IDs conocidos, roles, miembro quitado, admin, anon, catálogo): presentes, completos y sin dejar nada', 'P0', 'SECURITY', sqlHits, { pass: 'beta_security_test.sql + rls_test.sql + rls_admin_test.sql (correrlos en vivo: docs/BETA_SECURITY.md)' }));

  // SEC-08 — al cerrar la cuenta no queda nada de la sesión en pantalla ni en memoria.
  const sessionHits = [];
  const app = read('js/app.js');
  const close = (app.match(/function closeAccount\(\) \{([\s\S]*?)\n  \}/) || [])[1] || '';
  if (!/account\.dispose\(\)/.test(close)) sessionHits.push('closeAccount no libera el repositorio');
  if (!/resetSessionMemory\(\)/.test(close)) sessionHits.push('closeAccount no borra la memoria de las vistas');
  if (!/layout\.clearSession\(\)/.test(close)) sessionHits.push('closeAccount no limpia el menú y la barra');
  if (!/clearSession\(\)\s*\{/.test(read('js/ui/layout.js'))) sessionHits.push('layout sin clearSession()');
  for (const f of ['js/ui/views/quote-editor.js', 'js/ui/views/product-editor.js']) {
    const t = read(f);
    if (/const unsavedDrafts = new Map\(\)/.test(t) || !/createDraftStore\(\)/.test(t)) sessionHits.push(`${f}: borradores sin dueño (deben ser por cuenta)`);
  }
  if (!/onSessionReset\(/.test(read('js/ui/views/quote-result.js'))) sessionHits.push('quote-result: la memoria de sliders no se borra al cerrar la cuenta');
  const authGw = read('js/data/auth-gateway.js');
  if (!/async signOut\(\) \{[\s\S]*?clearLocalSession\(\)/.test(authGw)) sessionHits.push('signOut no borra la sesión local del navegador');
  const client = read('js/data/supabase-client.js');
  if (!/flowType: 'pkce'/.test(client)) sessionHits.push('el cliente de Auth no usa PKCE');
  if (!/detectSessionInUrl: false/.test(client)) sessionHits.push('el cliente de Auth canjea la URL solo (detectSessionInUrl)');
  if (!/\$\{key\}-code-verifier/.test(client)) sessionHits.push('clearLocalAuthSession no borra el code_verifier de PKCE');
  results.push(check('SEC-08', 'Sesión: al cerrar o cambiar de cuenta se libera el repositorio y se borran la memoria de las vistas, el menú y la barra; borradores por cuenta; logout borra la sesión local; sólo PKCE', 'P1', 'SESSION', sessionHits));

  // SEC-10b — los mensajes del logger son literales (en producción el mensaje se emite).
  const ALLOWED_TEMPLATES = new Set(['Error inesperado (${kind})']);
  const logHits = [];
  for (const { rel, text } of clientCodeFiles()) {
    loggerTemplateCalls(text).filter((t) => !ALLOWED_TEMPLATES.has(t)).forEach((t) => logHits.push(`${rel}: logger con mensaje interpolado \`${t.slice(0, 60)}\``));
    if (rel !== 'js/core/logger.js' && /\bconsole\.(?:log|info|warn|error|debug|table|dir)\(/.test(text)) logHits.push(`${rel}: console.* fuera del logger`);
  }
  results.push(check('SEC-10b', 'Logs: mensajes literales (sin montos, nombres ni ids interpolados) y nada de console.* fuera del logger', 'P1', 'PRIVACY', logHits));

  // SEC-13 — CSP estricta y anti-framing.
  const html = read('index.html');
  const csp = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
  const cspHits = [];
  const directive = (name) => ((csp.split(';').map((s) => s.trim()).find((d) => d.startsWith(`${name} `)) || '').split(/\s+/).slice(1));
  if (!csp) cspHits.push('index.html sin CSP');
  else {
    if (directive('default-src').join(' ') !== "'self'") cspHits.push("default-src no es 'self'");
    const scripts = directive('script-src');
    if (!scripts.length || scripts.some((s) => s !== "'self'")) cspHits.push(`script-src permite más que 'self': ${scripts.join(' ')}`);
    const connect = directive('connect-src');
    const supabase = (config.match(/url:\s*'(https:\/\/[a-z0-9]+\.supabase\.co)'/) || [])[1];
    connect.filter((s) => s !== "'self'" && s !== supabase).forEach((s) => cspHits.push(`connect-src permite ${s}`));
    if (/'unsafe-(?:inline|eval)'/.test(directive('script-src').join(' '))) cspHits.push('script-src con unsafe-inline/unsafe-eval');
    if (directive('object-src').join(' ') !== "'none'") cspHits.push("object-src no es 'none'");
  }
  if (!/function isFramed\(\)/.test(app)) cspHits.push('sin protección anti-framing (GitHub Pages no permite frame-ancestors)');
  results.push(check('SEC-13', "CSP: sólo 'self' para scripts, conexiones sólo a 'self' y al proyecto de Supabase, sin objetos; anti-framing", 'P1', 'SECURITY', cspHits));

  // SEC-14 — el admin de plataforma ve metadata, nunca contenido.
  const adminHits = [];
  const adminGw = read('js/data/admin-gateway.js');
  const fields = (adminGw.match(/const USER_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\)/) || [])[1] || '';
  if (/'state'/.test(fields)) adminHits.push('admin-gateway deja pasar el state');
  ['FEEDBACK_FIELDS'].forEach((name) => {
    const list = (adminGw.match(new RegExp(`const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`)) || [])[1];
    if (list === undefined) adminHits.push(`admin-gateway sin la lista ${name}`);
    else if (/'state'/.test(list)) adminHits.push(`admin-gateway: ${name} deja pasar el state`);
  });
  const adminSql = migrationFiles.filter((f) => /platform_admin/.test(f)).map(read).join('\n');
  const usersFn = (adminSql.match(/create or replace function private\.admin_users\(\)[\s\S]*?\$\$;/) || [''])[0];
  if (!usersFn) adminHits.push('no se encontró private.admin_users');
  else if (/\bw\.state\b/.test(usersFn.replace(/pg_column_size\(w\.state\)/g, ''))) adminHits.push('admin_users devuelve w.state');
  results.push(check('SEC-14', 'RATEOS ADMIN ≠ lector de datos: las funciones de admin sólo devuelven metadata (nunca workspace_states.state)', 'P0', 'SECURITY', adminHits));

  // SEC-19 — feedback de la beta (PLAN-2026-029).
  const feedbackMigration = migrationFiles.filter((f) => /beta_feedback/.test(f)).map(read).join('\n');
  const feedbackHits = feedbackFindings({
    migration: feedbackMigration,
    sqlTest: exists('supabase/tests/feedback_test.sql') ? read('supabase/tests/feedback_test.sql') : '',
    concurrency: exists('supabase/tests/local/feedback_concurrency.sh') ? read('supabase/tests/local/feedback_concurrency.sh') : '',
    clientFiles: clientCodeFiles(),
  });
  results.push(check('SEC-19', 'Feedback de la beta: tablas en private con RLS y sin grants, envío sólo de miembros con límites contra el spam, clasificación sólo de RATEOS ADMIN, sin leer el workspace y sin cuotas, créditos ni premios; test SQL completo que se deshace', 'P0', 'SECURITY', feedbackHits, { pass: 'migración 20261022120000 + feedback_test.sql (correrlo en vivo con los otros tests SQL)' }));

  // SEC-15 — cero dependencias npm.
  const pkg = JSON.parse(read('package.json'));
  const deps = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].filter((k) => pkg[k] && Object.keys(pkg[k]).length);
  results.push(check('SEC-15', 'Sin dependencias npm (superficie de supply chain mínima; el SDK de Supabase está vendorizado con hash)', 'P1', 'SECURITY', deps.map((k) => `package.json declara ${k}`)));

  // SEC-16 — los reportes y artefactos no se versionan.
  const gitignore = read('.gitignore');
  const ignoreHits = [];
  if (!/^reports\/$/m.test(gitignore)) ignoreHits.push('reports/ no está en .gitignore');
  if (!/^dist\/$/m.test(gitignore)) ignoreHits.push('dist/ no está en .gitignore');
  results.push(check('SEC-16', 'Reportes (Test Lab, E2E, este gate) y builds fuera de git', 'P2', 'PRIVACY', ignoreHits));

  // SEC-17 — HD-02: sin staging en el origen de producción.
  const stagingHits = stagingFindings(read('.github/workflows/deploy-pages.yml'), { stagePreviewScript: exists('scripts/stage-preview.mjs') });
  results.push(check('SEC-17', 'Sin staging en el origen de producción (HD-02): el deploy publica sólo main, el artefacto nunca trae /preview/ y después de publicar se verifica que /preview/ responda 404', 'P1', 'SECURITY', stagingHits));

  return results;
}

// ------------------------------------------------------- controles dinámicos

const noTimers = Object.freeze({ setTimeout: () => 1, clearTimeout: () => {} });

class GateStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

/** Una "nube" de una sola empresa, con control de revisión (sin red). */
function fakeCloud(state = null) {
  const ws = { state, revision: 0 };
  const cloud = {
    ws,
    writes: 0,
    failNext: null,
    gateway: {
      async loadWorkspace() {
        return { ok: true, state: ws.state ? JSON.parse(JSON.stringify(ws.state)) : null, revision: ws.revision };
      },
      async saveWorkspace(_org, { state: next, baseRevision }) {
        if (cloud.failNext) {
          const code = cloud.failNext;
          cloud.failNext = null;
          return { ok: false, code };
        }
        if (baseRevision !== ws.revision) return { ok: false, code: 'conflict', serverRevision: ws.revision };
        ws.state = JSON.parse(JSON.stringify(next));
        ws.revision += 1;
        cloud.writes += 1;
        return { ok: true, revision: ws.revision };
      },
      async renameOrganization() {
        return { ok: true };
      },
    },
  };
  return cloud;
}

async function dynamicChecks() {
  const { SupabaseRepository } = await import('../../../js/data/supabase-repository.js');
  const { createDemoState } = await import('../../../js/domain/demo-data.js');
  const { createEmptyQuote } = await import('../../../js/domain/quote-factory.js');
  const { CURRENT_SCHEMA_VERSION } = await import('../../../js/data/schema.js');
  const { configureLogger, logger } = await import('../../../js/core/logger.js');
  const { sanitizeEventProps, track } = await import('../../../js/core/events.js');
  const { FEATURES, detectEnvironment } = await import('../../../js/config.js');
  const { isSafeNextPath } = await import('../../../js/services/auth-routing.js');
  const { parseAuthRedirect } = await import('../../../js/services/auth-service.js');

  const org = { id: 'org-gate', name: 'Empresa sintética' };
  const open = (cloud, storage, tabId) => new SupabaseRepository({ gateway: cloud.gateway, organization: org, userId: 'u-gate', role: 'OWNER', cacheStorage: storage, timers: noTimers, tabId });
  const results = [];
  configureLogger({ consoleImpl: null }); // los escenarios no ensucian la salida
  try {
    // SEC-05 — la nube nunca se reemplaza sola por un espacio vacío o "reparado".
    const recoveryHits = [];
    for (const [label, broken] of [['dañados', (s) => ({ ...s, schemaVersion: 'roto' })], ['con estructura inesperada', (s) => ({ ...s, settings: 'roto' })]]) {
      const base = createDemoState(CURRENT_SCHEMA_VERSION);
      base.organization = { ...base.organization, id: org.id, name: org.name };
      const cloud = fakeCloud(broken(base));
      const before = JSON.stringify(cloud.ws.state);
      const repo = open(cloud, new GateStorage());
      const init = await repo.init();
      if (init.status !== 'read_only' || !repo.readOnly) recoveryHits.push(`datos ${label}: no se abrieron en sólo lectura (${init.status})`);
      if (cloud.writes !== 0 || JSON.stringify(cloud.ws.state) !== before) recoveryHits.push(`datos ${label}: se escribió la nube`);
      await repo.reloadFromCloud();
      if (cloud.writes !== 0) recoveryHits.push(`datos ${label}: "Recargar" escribió la nube`);
    }
    results.push(check('SEC-05', 'La nube nunca se reemplaza sola por un espacio vacío o "reparado" cuando esta versión no puede leer sus datos (sólo lectura + copia local)', 'P0', 'DATA LOSS', recoveryHits));

    // SEC-06 — una pestaña nunca borra ni pisa los cambios sin subir de otra.
    const tabsHits = [];
    {
      const cloud = fakeCloud(null);
      const storage = new GateStorage();
      const t1 = open(cloud, storage, 'tab-1');
      await t1.init();
      const t2 = open(cloud, storage, 'tab-2');
      await t2.init();
      cloud.failNext = 'network';
      await t2.saveQuote({ ...createEmptyQuote({ organizationId: org.id }), name: 'Cambio sin subir de la pestaña 2' }).catch(() => undefined);
      await t1.saveQuote({ ...createEmptyQuote({ organizationId: org.id }), name: 'Guardado de la pestaña 1' });
      if (!/pestaña 2/.test(storage.getItem(t2.cacheKey) || '')) tabsHits.push('el guardado de una pestaña borró la copia sin subir de otra');
      const t3 = open(cloud, storage, 'tab-3');
      await t3.init();
      const kept = t3.listRecoverySnapshots().map((k) => t3.getRecoverySnapshot(k)).join('') + JSON.stringify(cloud.ws.state);
      if (!/pestaña 2/.test(kept)) tabsHits.push('al volver a abrir, los cambios sin subir de la otra pestaña se perdieron');
    }
    results.push(check('SEC-06', 'Varias pestañas: cada una guarda su propia copia de cambios sin subir; nunca se borra ni se pisa la de otra', 'P0', 'DATA LOSS', tabsHits));

    // SEC-07 — el organizationId del cliente (o de un archivo) nunca decide.
    const ownerHits = [];
    {
      const cloud = fakeCloud(null);
      const repo = open(cloud, new GateStorage());
      await repo.init();
      await repo.saveQuote({ ...createEmptyQuote({ organizationId: 'org-de-otra-empresa' }), name: 'Q' });
      await repo.saveResource('equipment', { name: 'Grúa', organizationId: 'org-de-otra-empresa' });
      await repo.saveSettings({ organizationId: 'org-de-otra-empresa' });
      const s = cloud.ws.state;
      if (s.quotes.some((q) => q.organizationId !== org.id) || s.resources.equipment.some((r) => r.organizationId !== org.id) || s.settings.organizationId !== org.id) ownerHits.push('un dato quedó con el organizationId que mandó el cliente');
      const foreign = createDemoState(CURRENT_SCHEMA_VERSION);
      await repo.importBackup(foreign);
      const imported = cloud.ws.state;
      const owners = new Set([...imported.quotes, ...imported.services, ...Object.values(imported.resources).flat()].map((x) => x.organizationId));
      if (owners.size !== 1 || !owners.has(org.id) || imported.organization.id !== org.id) ownerHits.push('un backup de otra empresa quedó con su organizationId');
    }
    results.push(check('SEC-07', 'El organizationId que manda el cliente o un backup nunca decide: todo queda en la organización de la cuenta (el límite real es RLS)', 'P0', 'SECURITY', ownerHits));

    // SEC-09 — auth: sólo PKCE, sin token_hash, destinos internos.
    const authHits = [];
    const link = parseAuthRedirect('https://joaquinvedova1.github.io/COTIZADORWEB/?token_hash=abc&type=recovery');
    if (!link || link.error !== 'unsupported_link' || link.code) authHits.push('un enlace con token_hash no se rechaza');
    for (const bad of ['//evil.example', 'https://evil.example', '/%2F%2Fevil.example', '/../admin', 'javascript:alert(1)', '/login', '', '/a b']) {
      if (isSafeNextPath(bad)) authHits.push(`destino inseguro aceptado: ${bad}`);
    }
    if (!isSafeNextPath('/cotizaciones/nueva')) authHits.push('un destino interno válido se rechaza');
    results.push(check('SEC-09', 'Auth: los enlaces de email sólo con PKCE (?code=), nunca ?token_hash=; ?next= sólo a rutas internas', 'P1', 'SESSION', authHits));

    // SEC-10 — logs de producción sin contexto.
    const logHits = [];
    {
      const calls = [];
      const spy = { warn: (...a) => calls.push(['warn', a]), error: (...a) => calls.push(['error', a]), info: (...a) => calls.push(['info', a]), debug: (...a) => calls.push(['debug', a]), log: (...a) => calls.push(['log', a]) };
      configureLogger({ environment: 'production', consoleImpl: spy });
      logger.info('info de prueba', { salary: 85000000 });
      logger.warn('aviso de prueba', { monthlyLaborCost: 85000000, client: 'Cliente Sintético SA' });
      logger.error('error de prueba', { price: 123456 });
      if (calls.some(([lvl]) => lvl === 'info' || lvl === 'debug')) logHits.push('producción emite info/debug');
      if (calls.some(([, args]) => args.length !== 1 || /85000000|Sintético|123456/.test(JSON.stringify(args)))) logHits.push('producción emite el contexto (puede tener datos de negocio)');
      if (calls.length !== 2) logHits.push(`se esperaban 2 líneas (warn y error), hubo ${calls.length}`);
      configureLogger({ environment: detectEnvironment(), consoleImpl: null });
    }
    results.push(check('SEC-10', 'Logs de producción: sólo warn/error y SIN contexto (salarios, tarifas, costos, clientes)', 'P1', 'PRIVACY', logHits));

    // SEC-11 — eventos sin montos, nombres ni texto libre; nada se envía.
    const eventHits = [];
    const clean = sanitizeEventProps({ amount: 85000000, monthly_labor_cost: 85000000, client: 'Cliente Sintético SA', note: 'texto libre', unit: 'COT-0001', serviceType: 'on_call', count: 3, completed: true });
    const keys = Object.keys(clean).sort().join(',');
    if (keys !== 'completed,count,serviceType') eventHits.push(`propiedades que pasan el filtro: ${keys}`);
    if (track('evento_inventado', { count: 1 }) !== false) eventHits.push('acepta un evento fuera de la lista blanca');
    if (FEATURES.analytics !== false) eventHits.push('analytics encendido');
    results.push(check('SEC-11', 'Eventos: lista blanca, sin montos, nombres ni texto libre; analytics apagado (nada sale del navegador)', 'P1', 'PRIVACY', eventHits));

    // SEC-12 — el backup no lleva sesión, tokens ni ids de usuario.
    const backupHits = [];
    {
      const cloud = fakeCloud(null);
      const storage = new GateStorage();
      storage.setItem('rateos.auth', JSON.stringify({ access_token: 'token-sintetico', refresh_token: 'refresh-sintetico' }));
      const repo = open(cloud, storage);
      await repo.init();
      const backup = JSON.stringify(await repo.exportBackup());
      if (/token-sintetico|refresh-sintetico|access_token|refresh_token|rateos\.auth/.test(backup)) backupHits.push('el backup incluye la sesión');
      if (backup.includes('u-gate')) backupHits.push('el backup incluye el id del usuario');
    }
    results.push(check('SEC-12', 'Backup exportado: sólo datos de la empresa (sin sesión, tokens ni id de usuario)', 'P1', 'PRIVACY', backupHits));

    // SEC-18 — registro público (HD-03, decisión del dueño del 2026-10-20): ni el
    // registro ni los correos de Auth revelan qué emails tienen cuenta.
    const enumHits = [];
    {
      const { createAuthService } = await import('../../../js/services/auth-service.js');
      const { createFakeAuthGateway } = await import('../../helpers/fake-supabase.js');
      const site = 'https://joaquinvedova1.github.io/COTIZADORWEB/';
      const users = [
        { id: 'u-conf', email: 'confirmada@example.com', password: 'clave-sintetica-1', emailConfirmed: true },
        { id: 'u-pend', email: 'pendiente@example.com', password: 'clave-sintetica-2', emailConfirmed: false },
      ];
      const svc = () => {
        const location = { href: `${site}#/registro` };
        return createAuthService({ gateway: createFakeAuthGateway({ users }), siteUrl: site, location, history: { replaceState() {} }, publicSignup: true });
      };
      const emails = ['nueva@example.com', 'confirmada@example.com', 'pendiente@example.com'];
      const same = async (label, run) => {
        const outs = [];
        for (const email of emails) outs.push(JSON.stringify(await run(svc(), email)));
        if (new Set(outs).size !== 1) enumHits.push(`${label}: la respuesta cambia según el email tenga cuenta o no`);
      };
      await same('registro', (a, email) => a.signUp({ fullName: 'Persona', company: 'Empresa sintética', email, password: 'clave-sintetica-9' }));
      await same('reenvío de la confirmación', (a, email) => a.resendConfirmation(email));
      await same('"¿Olvidaste tu contraseña?"', (a, email) => a.requestPasswordReset(email));
      // HD-03 R3: si el proveedor rechaza el correo, el reenvío dice que no salió (nunca "enviado"). Como Supabase
      // sólo intenta enviar con una cuenta sin confirmar, la excepción se limita a eso: sin cuenta y confirmada
      // siguen respondiendo igual entre sí, y el mensaje no lleva el email.
      {
        const broken = () => createAuthService({ gateway: createFakeAuthGateway({ users, mailFailure: 'email_not_authorized' }), siteUrl: site, location: { href: `${site}#/login` }, history: { replaceState() {} }, publicSignup: true });
        const nueva = JSON.stringify(await broken().resendConfirmation('nueva@example.com'));
        const confirmada = JSON.stringify(await broken().resendConfirmation('confirmada@example.com'));
        const pendiente = await broken().resendConfirmation('pendiente@example.com');
        if (nueva !== confirmada) enumHits.push('reenvío con el envío roto: una cuenta confirmada responde distinto que un email sin cuenta');
        if (pendiente.ok !== false || /enviado|te llega/i.test(pendiente.message || '')) enumHits.push('reenvío con el envío roto: dice que el correo salió (o no avisa que falló)');
        if (/pendiente@example\.com/.test(JSON.stringify(pendiente))) enumHits.push('reenvío con el envío roto: la respuesta lleva el email');
      }
      const a = svc();
      const wrong = await a.signIn({ email: 'pendiente@example.com', password: 'otra-clave-sintetica' });
      const unknown = await a.signIn({ email: 'nadie@example.com', password: 'otra-clave-sintetica' });
      if (JSON.stringify(wrong) !== JSON.stringify(unknown)) enumHits.push('ingreso: con la contraseña equivocada, una cuenta sin confirmar responde distinto que un email sin cuenta');
      if (!FEATURES.publicSignup) enumHits.push('FEATURES.publicSignup no coincide con la decisión del dueño (registro público)');
    }
    results.push(check('SEC-18', 'Registro público sin enumeración de cuentas: registro, reenvío de la confirmación y "¿Olvidaste tu contraseña?" responden igual haya o no cuenta; "sin confirmar" sólo con la contraseña correcta; con el envío roto el reenvío dice que no salió (excepción documentada, sólo con una cuenta sin confirmar)', 'P1', 'PRIVACY', enumHits));
  } finally {
    configureLogger({ consoleImpl: globalThis.console });
  }
  return results;
}

// -------------------------------------------------- decisiones del dueño

/**
 * Riesgos que no se "arreglan" solos: decide el dueño (no bloquean el gate).
 * `requiredBeforeRealUsers`: el dueño ya decidió que es un requisito obligatorio
 * antes de habilitar usuarios reales (2026-10-17); se informa como pendiente
 * hasta que se cumpla en la infraestructura (no es un control del código).
 */
export const HUMAN_DECISIONS = Object.freeze([
  {
    id: 'HD-01',
    severity: 'P1',
    category: 'SECURITY',
    requiredBeforeRealUsers: true,
    title: 'Origen compartido joaquinvedova1.github.io: todo sitio de GitHub Pages de esa cuenta comparte localStorage con RATEOS (sesión de Supabase incluida)',
    recommendation: 'Requisito obligatorio antes de habilitar usuarios reales (decisión del dueño, 2026-10-17): dominio propio para producción. Mientras tanto, verificar que ningún otro repo de la cuenta publique Pages.',
  },
  {
    id: 'HD-02',
    severity: 'P1',
    category: 'SECURITY',
    requiredBeforeRealUsers: true,
    title: 'Staging (/preview/) comparte origen y base de datos con producción: el código de cualquier rama con CI verde corre junto a las sesiones y los datos reales',
    recommendation: 'Requisito obligatorio antes de habilitar usuarios reales (decisión del dueño, 2026-10-17): staging separado de producción en origen y en base de datos, o /preview/ deshabilitado temporalmente. Estado: /preview/ deshabilitado en el código (SEC-17, PLAN-2026-016); se cumple cuando ese cambio se despliega y el workflow verifica /preview/ → 404.',
  },
  {
    id: 'HD-03',
    severity: 'P1',
    category: 'SECURITY',
    requiredBeforeRealUsers: true,
    title: 'Registro público (decisión del dueño, 2026-10-20): cualquiera crea su cuenta y su propia empresa (aislada por RLS). Sin SMTP propio nadie de afuera recibe la confirmación, así que todavía no funciona para terceros',
    recommendation: 'Requisito obligatorio antes de habilitar usuarios reales (decisión del dueño, 2026-10-20: registro público con confirmación de email): "Allow new users to sign up" y "Confirm email" encendidos (node scripts/check-auth-perimeter.mjs), SMTP propio con remitente verificado y seguimiento de clics apagado, y las pruebas reales de docs/BETA_PERIMETER.md §2.4. Sin enumeración de cuentas: SEC-18. Antiabuso: límites de Supabase Auth (Rate Limits) y, si aparece abuso, CAPTCHA (decisión aparte: suma un tercero a la CSP).',
  },
  {
    id: 'HD-04',
    severity: 'P2',
    category: 'SECURITY',
    title: 'Protección de contraseñas filtradas de Supabase Auth apagada (advisor auth_leaked_password_protection)',
    recommendation: 'Activarla requiere el plan Pro de Supabase.',
  },
  {
    id: 'HD-05',
    severity: 'P2',
    category: 'PRIVACY',
    title: 'Al cerrar sesión quedan en el navegador las copias de cambios sin subir y las de recuperación de la cuenta (no se muestran a otra cuenta, pero en una computadora compartida se leen con DevTools)',
    recommendation: 'Decidir si se ofrece "Cerrar sesión y borrar las copias de este navegador" (sólo cuando no hay cambios sin subir: si no, se perderían).',
  },
  {
    id: 'HD-06',
    severity: 'P2',
    category: 'PRIVACY',
    title: 'El email de la cuenta master está en una migración del repo público (bootstrap de RATEOS ADMIN): identifica a quién atacar',
    recommendation: 'Aceptarlo o, en una próxima migración, cargar el bootstrap por fuera del repo (AGENTS.md hoy pide el alta de admins por migración).',
  },
  {
    id: 'HD-07',
    severity: 'P2',
    category: 'PRIVACY',
    title: 'La auditoría registra ADMIN_PANEL_OPEN (admin_overview) pero no cada lectura de admin_users (emails y nombres de todos los usuarios)',
    recommendation: 'Decidir si se audita también admin_users (migración nueva).',
  },
  {
    id: 'HD-09',
    severity: 'P2',
    category: 'SESSION',
    title: 'Un miembro quitado de una empresa sigue viendo lo que ya tenía en pantalla hasta que la app vuelve a hablar con la nube (al guardar se cierra la cuenta; no hay aviso en tiempo real porque Realtime está apagado a propósito)',
    recommendation: 'Hoy las membresías no se pueden quitar desde la app (sólo por SQL). Revisarlo cuando existan invitaciones.',
  },
]);

/** Corre todos los controles. */
export async function runSecurityChecks() {
  const results = [...staticChecks(), ...(await dynamicChecks())];
  const human = HUMAN_DECISIONS.map((d) => ({
    id: d.id, title: d.title, severity: d.severity, category: d.category, status: 'human',
    requiredBeforeRealUsers: d.requiredBeforeRealUsers === true, details: [d.recommendation],
  }));
  return [...results, ...human].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** ¿El gate pasa? Ningún control P0/P1 en "fail". */
export function gateVerdict(results) {
  const blocking = results.filter((r) => r.status === 'fail' && (r.severity === 'P0' || r.severity === 'P1'));
  const warnings = results.filter((r) => r.status === 'fail' && r.severity === 'P2');
  const human = results.filter((r) => r.status === 'human');
  return { ok: blocking.length === 0, blocking, warnings, human, requiredBeforeRealUsers: human.filter((r) => r.requiredBeforeRealUsers) };
}
