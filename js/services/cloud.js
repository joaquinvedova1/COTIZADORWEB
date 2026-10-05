/**
 * Conexión con Supabase para los servicios (la UI nunca importa js/data).
 */

import { getSupabaseClient } from '../data/supabase-client.js';
import { createAuthGateway } from '../data/auth-gateway.js';
import { createWorkspaceGateway } from '../data/workspace-gateway.js';

/** @param {{ client?: object }} [options] */
export function createCloud({ client } = {}) {
  const c = client || getSupabaseClient();
  return { authGateway: createAuthGateway(c), workspaceGateway: createWorkspaceGateway(c) };
}
