#!/usr/bin/env node
/**
 * RATEOS — verificación del perímetro de Supabase Auth (HD-03, PLAN-2026-016/018).
 *
 *   node scripts/check-auth-perimeter.mjs
 *
 * Lee la configuración PÚBLICA de Auth (GET /auth/v1/settings con la
 * publishable key de js/config.js: lo mismo que puede ver cualquier navegador)
 * y verifica que coincida con lo que ofrece la app (FEATURES.publicSignup):
 * - registro público (publicSignup = true, decisión del dueño del 2026-10-20):
 *   disable_signup = false, con la confirmación de email obligatoria;
 *   beta por invitación (publicSignup = false): disable_signup = true;
 * - external.email = true      el proveedor Email sigue activo (ingreso y recuperación);
 * - mailer_autoconfirm = false se mantiene la confirmación de email;
 * - sin proveedores sociales, teléfono, SAML ni usuarios anónimos (no previstos).
 *
 * Lo que no es público (SMTP propio) no se puede leer desde acá: se lista como
 * verificación manual (MANUAL_CHECKS).
 *
 * No escribe nada, no usa credenciales privadas y no imprime datos de usuarios.
 * Código de salida 1 si algo no está como se espera (o si no se pudo leer).
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { FEATURES, SUPABASE } from '../js/config.js';

/** Requisitos de la beta que la configuración pública no muestra: se verifican a mano. */
export const MANUAL_CHECKS = Object.freeze([
  Object.freeze({
    id: 'smtp',
    label: 'SMTP propio (Authentication → Emails → SMTP Settings)',
    detail: 'con el SMTP por defecto, Supabase sólo envía correos al equipo del proyecto: nadie de afuera recibe la confirmación del registro ni el correo para elegir la contraseña (y el registro falla). Probar «Crear cuenta» y «¿Olvidaste tu contraseña?» con un email que no sea del equipo.',
  }),
]);

/**
 * Evalúa la configuración pública de Auth.
 * @param {any} settings respuesta de /auth/v1/settings
 * @param {{ publicSignup?: boolean }} [opts] lo que ofrece la app (por defecto, FEATURES.publicSignup)
 * @returns {{ ok: boolean, checks: { id: string, label: string, ok: boolean, detail: string }[] }}
 */
export function evaluateAuthSettings(settings, { publicSignup = FEATURES.publicSignup } = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const external = s.external && typeof s.external === 'object' ? s.external : {};
  const enabledOthers = Object.entries(external)
    .filter(([name, on]) => on === true && name !== 'email')
    .map(([name]) => name)
    .sort();
  const checks = [
    publicSignup
      ? {
        id: 'signup',
        label: 'Registro público abierto ("Allow new users to sign up" encendido)',
        ok: s.disable_signup === false,
        detail: s.disable_signup === false ? 'disable_signup = false' : 'el registro está cerrado: la app ofrece "Crear cuenta" pero Supabase lo rechaza',
      }
      : {
        id: 'signup',
        label: 'Registro cerrado ("Allow new users to sign up" apagado)',
        ok: s.disable_signup === true,
        detail: s.disable_signup === true ? 'disable_signup = true' : 'el registro sigue abierto: cualquiera puede crear una cuenta',
      },
    {
      id: 'email',
      label: 'Proveedor Email activo (ingreso y recuperación de contraseña)',
      ok: external.email === true,
      detail: external.email === true ? 'external.email = true' : 'el proveedor Email está apagado: nadie puede ingresar ni recuperar su contraseña',
    },
    {
      id: 'confirm',
      label: 'Confirmación de email activa (obligatoria con el registro público)',
      ok: s.mailer_autoconfirm === false,
      detail: s.mailer_autoconfirm === false ? 'mailer_autoconfirm = false' : 'los emails se confirman solos: cualquiera entraría con un email ajeno',
    },
    {
      id: 'others',
      label: 'Sin otros métodos de ingreso (social, teléfono, SAML, anónimos)',
      ok: enabledOthers.length === 0 && s.saml_enabled !== true,
      detail: enabledOthers.length || s.saml_enabled === true ? `habilitados: ${[...enabledOthers, ...(s.saml_enabled === true ? ['saml'] : [])].join(', ')}` : 'ninguno',
    },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  let settings;
  try {
    const res = await fetch(`${SUPABASE.url}/auth/v1/settings`, { headers: { apikey: SUPABASE.publishableKey } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    settings = await res.json();
  } catch (error) {
    console.error(`No se pudo leer la configuración pública de Auth (${error && error.message ? error.message : 'error de red'}).`);
    process.exitCode = 1;
    return;
  }
  const result = evaluateAuthSettings(settings);
  for (const c of result.checks) console.log(`${c.ok ? 'OK   ' : 'FALLA'} ${c.label} — ${c.detail}`);
  for (const c of MANUAL_CHECKS) console.log(`A MANO ${c.label} — ${c.detail}`);
  console.log(result.ok ? `PERÍMETRO DE AUTH: OK (${FEATURES.publicSignup ? 'registro público con confirmación' : 'beta por invitación'})` : 'PERÍMETRO DE AUTH: PENDIENTE');
  process.exitCode = result.ok ? 0 : 1;
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) await main();
