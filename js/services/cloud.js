/**
 * Conexión con Supabase para los servicios (la UI nunca importa js/data).
 */

import { clearLocalAuthSession, getSupabaseClient } from '../data/supabase-client.js';
import { createAuthGateway } from '../data/auth-gateway.js';
import { createWorkspaceGateway } from '../data/workspace-gateway.js';

/** @param {{ client?: object, clearLocalSession?: () => void }} [options] */
export function createCloud({ client, clearLocalSession = clearLocalAuthSession } = {}) {
  const c = client || getSupabaseClient();
  return { authGateway: createAuthGateway(c, { clearLocalSession: () => clearLocalSession() }), workspaceGateway: createWorkspaceGateway(c) };
}
