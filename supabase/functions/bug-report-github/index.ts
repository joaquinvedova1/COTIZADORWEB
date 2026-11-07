/**
 * RATEOS — Edge Function "bug-report-github".
 *
 * Convierte un reporte de "Reportar un problema" (private.bug_reports) en un
 * issue del repositorio de GitHub, para revisarlos todos en un solo lugar.
 *
 * Flujo: la app guarda el reporte con public.submit_bug_report (fuente de
 * verdad) y después llama acá con { id }. Esta función:
 *   1. verifica la sesión (JWT de Supabase Auth) de quien llama;
 *   2. reserva el reporte SÓLO si es de esa persona y no tiene issue
 *      (public.claim_bug_report_for_github, sólo service_role);
 *   3. crea el issue con el label "reporte-app" y guarda número y URL.
 *
 * El issue NUNCA lleva nombre, email, empresa ni id de quien reporta (el
 * repositorio es público): sólo lo que escribió, la pantalla y datos técnicos.
 * Sin el secreto GITHUB_ISSUES_TOKEN el reporte queda guardado igual en la
 * base y esta función responde github: "not_configured".
 *
 * Secretos (Supabase → Edge Functions → Secrets), nunca en el repo:
 *   GITHUB_ISSUES_TOKEN  token fine-grained, sólo este repo, Issues: Read and write
 *   GITHUB_REPO          opcional, "dueño/repo" (por defecto joaquinvedova1/COTIZADORWEB)
 * SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ALLOWED_ORIGINS = new Set([
  'https://joaquinvedova1.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LABEL = 'reporte-app';

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

/** Texto del usuario dentro del issue: sin menciones (@alguien) ni HTML activo. */
function safe(value: unknown, max = 4000): string {
  const text = typeof value === 'string' ? value : '';
  return text
    .slice(0, max)
    .replace(/@/g, '@​')
    .replace(/</g, '&lt;')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function quote(text: string): string {
  return text ? text.split('\n').map((l) => `> ${l}`).join('\n') : '> —';
}

function issueTitle(report: Record<string, unknown>): string {
  const first = safe(report.what_happened, 200).split('\n')[0].replace(/\s+/g, ' ').trim();
  const short = first.length > 70 ? `${first.slice(0, 67)}…` : first;
  return `[${report.reference}] ${short || 'Reporte desde la app'}`;
}

function issueBody(report: Record<string, unknown>): string {
  const ctx = report.context && typeof report.context === 'object' ? (report.context as Record<string, unknown>) : {};
  const row = (label: string, value: unknown) => `| ${label} | ${safe(value, 300).replace(/\|/g, '\\|').replace(/\n/g, ' ') || '—'} |`;
  return [
    '<!-- creado por la Edge Function bug-report-github desde "Reportar un problema" -->',
    `**Referencia:** \`${report.reference}\` · **Recibido:** ${safe(report.created_at, 40)}`,
    '',
    '### ¿Qué pasó?',
    quote(safe(report.what_happened)),
    '',
    '### ¿Qué esperaba que pasara?',
    quote(safe(report.expected, 2000)),
    '',
    '### Contexto técnico (automático)',
    '| Dato | Valor |',
    '| --- | --- |',
    row('Dónde', report.where_label),
    row('Pantalla (ruta)', report.route),
    row('Versión', report.app_version),
    row('Build (commit)', report.app_commit),
    row('Modo', ctx.mode),
    row('Navegador', report.browser),
    row('Ventana', report.viewport),
    row('Idioma', ctx.language),
    '',
    '_Sin nombre, email ni empresa de quien reporta (el repositorio es público). El reporte completo queda en la base, en `private.bug_reports`._',
  ].join('\n');
}

async function createIssue(repo: string, token: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'rateos-bug-report',
    },
    body: JSON.stringify(payload),
  });
  return res;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return json(401, { ok: false, error: 'unauthorized' }, origin);

  let id = '';
  try {
    const body = await req.json();
    id = typeof body?.id === 'string' ? body.id : '';
  } catch {
    id = '';
  }
  if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid_id' }, origin);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user || user.is_anonymous) return json(401, { ok: false, error: 'unauthorized' }, origin);

  const token = Deno.env.get('GITHUB_ISSUES_TOKEN') ?? '';
  const repoEnv = Deno.env.get('GITHUB_REPO') ?? 'joaquinvedova1/COTIZADORWEB';
  const repo = REPO_RE.test(repoEnv) ? repoEnv : 'joaquinvedova1/COTIZADORWEB';
  if (!token) return json(200, { ok: true, github: 'not_configured' }, origin);

  const { data: report, error: claimError } = await admin.rpc('claim_bug_report_for_github', { p_id: id, p_reporter: user.id });
  if (claimError) return json(200, { ok: true, github: 'failed' }, origin);
  if (!report) return json(200, { ok: true, github: 'skipped' }, origin);

  const payload: Record<string, unknown> = { title: issueTitle(report), body: issueBody(report), labels: [LABEL] };
  let res = await createIssue(repo, token, payload);
  // Si el token no puede crear el label, se crea el issue sin label.
  if (res.status === 422 || res.status === 403) {
    delete payload.labels;
    res = await createIssue(repo, token, payload);
  }
  if (!res.ok) {
    console.error('github_issue_failed', res.status);
    return json(200, { ok: true, github: 'failed' }, origin);
  }
  const issue = await res.json();
  const number = Number(issue?.number);
  const url = typeof issue?.html_url === 'string' ? issue.html_url : null;
  if (Number.isInteger(number) && url) {
    await admin.rpc('set_bug_report_github', { p_id: id, p_number: number, p_url: url });
  }
  return json(200, { ok: true, github: 'created', issueNumber: Number.isInteger(number) ? number : null }, origin);
});
