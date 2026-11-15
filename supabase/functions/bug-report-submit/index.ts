/**
 * RATEOS — Edge Function "bug-report-submit".
 *
 * Recibe "Reportar un problema" de quien NO tiene sesión (demo, sitio
 * público) y lo guarda en private.bug_reports con service_role. La base no
 * le da ningún permiso a anon: esta función es la única puerta.
 *
 * - El límite por origen usa un hash del IP (nunca se guarda el IP).
 * - Límites y validación los aplica private.submit_public_bug_report.
 * - Sin secretos propios (usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).
 * Se despliega con verify_jwt = false.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ALLOWED_ORIGINS = new Set([
  'https://joaquinvedova1.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const MAX_BODY = 16_000;

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

async function sourceKey(req: Request): Promise<string> {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'sin-ip';
  const ip = forwarded.split(',')[0].trim();
  const data = new TextEncoder().encode(`rateos-bug-report:${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);

  let report: unknown = null;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { ok: false, error: 'invalid_report' }, origin);
    const body = JSON.parse(raw);
    report = body && typeof body === 'object' ? body.report : null;
  } catch {
    report = null;
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) return json(400, { ok: false, error: 'invalid_report' }, origin);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc('submit_public_bug_report', { p_report: report, p_source_key: await sourceKey(req) });
  if (error) {
    const msg = String(error.message || '');
    if (error.code === '54000' || /rate_limited/.test(msg)) return json(429, { ok: false, error: 'rate_limited' }, origin);
    if (error.code === '22023' || /invalid_report/.test(msg)) return json(400, { ok: false, error: 'invalid_report' }, origin);
    console.error('submit_public_bug_report_failed', error.code);
    return json(500, { ok: false, error: 'unknown' }, origin);
  }
  return json(200, { ok: true, id: data?.id ?? null, reference: data?.reference ?? null }, origin);
});
