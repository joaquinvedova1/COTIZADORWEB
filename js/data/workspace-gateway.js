/**
 * Acceso al workspace en Supabase (tablas de supabase/migrations/…).
 *
 * La SEGURIDAD la da Row Level Security en Postgres: estos filtros por
 * organización son comodidad, no control de acceso. Aunque alguien cambie
 * un organizationId desde DevTools, la base no devuelve ni acepta filas de
 * organizaciones de las que no es miembro.
 *
 * Errores como { ok: false, code }:
 *   network          sin conexión / Supabase no respondió
 *   session_expired  el JWT venció o fue revocado
 *   conflict         la revisión cambió (otro dispositivo guardó antes)
 *   forbidden        el rol no permite guardar (p. ej. VIEWER) o no es miembro
 *   not_found        no hay organización para este usuario
 *   too_large        el estado supera el límite de la base (5 MB)
 *   unknown
 */

export const WORKSPACE_ERRORS = Object.freeze({
  network: 'network',
  sessionExpired: 'session_expired',
  conflict: 'conflict',
  forbidden: 'forbidden',
  notFound: 'not_found',
  tooLarge: 'too_large',
  unknown: 'unknown',
});

/** Código propio a partir de un error de PostgREST / fetch (sin exponer detalles). */
export function workspaceErrorCode(error) {
  if (!error) return null;
  const code = String(error.code || '');
  const status = Number(error.status);
  const message = String(error.message || '');
  if (error.name === 'TypeError' || /Failed to fetch|NetworkError|network/i.test(message) || status === 0) return WORKSPACE_ERRORS.network;
  if (code === 'PGRST301' || code === 'PGRST303' || status === 401 || /JWT/i.test(message)) return WORKSPACE_ERRORS.sessionExpired;
  if (code === '42501' || status === 403) return WORKSPACE_ERRORS.forbidden;
  if (code === '23514' && /max_size/.test(message)) return WORKSPACE_ERRORS.tooLarge;
  if (status === 413) return WORKSPACE_ERRORS.tooLarge;
  return WORKSPACE_ERRORS.unknown;
}

async function run(fn) {
  try {
    const res = await fn();
    if (res && res.error) return { ok: false, code: workspaceErrorCode({ ...res.error, status: res.status }), data: null };
    return { ok: true, code: null, data: res ? res.data : null };
  } catch (error) {
    return { ok: false, code: workspaceErrorCode(error) || WORKSPACE_ERRORS.unknown, data: null };
  }
}

/**
 * @param {object} client cliente de Supabase
 */
export function createWorkspaceGateway(client) {
  if (!client || typeof client.from !== 'function') throw new Error('Cliente de Supabase inválido.');
  return {
    /**
     * Organización activa del usuario (la primera por antigüedad; con
     * FEATURES.multiOrganization apagado hay una sola), su rol y su perfil.
     */
    async loadMembership(userId) {
      const members = await run(() => client
        .from('organization_members')
        .select('organization_id, role, created_at, organizations ( id, name )')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1));
      if (!members.ok) return { ok: false, code: members.code };
      const row = Array.isArray(members.data) ? members.data[0] : null;
      if (!row || !row.organizations) return { ok: false, code: WORKSPACE_ERRORS.notFound };
      const profile = await run(() => client.from('profiles').select('full_name').eq('id', userId).maybeSingle());
      return {
        ok: true,
        code: null,
        organization: { id: row.organizations.id, name: row.organizations.name },
        role: row.role,
        profile: { fullName: profile.ok && profile.data ? profile.data.full_name || '' : '' },
      };
    },

    /** Estado guardado de la organización: { state (objeto o null), revision, schemaVersion, updatedAt }. */
    async loadWorkspace(organizationId) {
      const res = await run(() => client
        .from('workspace_states')
        .select('state, revision, schema_version, updated_at')
        .eq('organization_id', organizationId)
        .maybeSingle());
      if (!res.ok) return { ok: false, code: res.code };
      if (!res.data) return { ok: false, code: WORKSPACE_ERRORS.notFound };
      return { ok: true, code: null, state: res.data.state, revision: Number(res.data.revision), schemaVersion: res.data.schema_version, updatedAt: res.data.updated_at };
    },

    /**
     * Guarda SÓLO si la revisión del servidor sigue siendo `baseRevision`
     * (control de concurrencia optimista: nunca pisa en silencio una versión
     * más nueva). La base incrementa la revisión con un trigger.
     */
    async saveWorkspace(organizationId, { state, schemaVersion, baseRevision }) {
      const res = await run(() => client
        .from('workspace_states')
        .update({ state, schema_version: schemaVersion })
        .eq('organization_id', organizationId)
        .eq('revision', baseRevision)
        .select('revision, updated_at'));
      if (!res.ok) return { ok: false, code: res.code };
      const row = Array.isArray(res.data) ? res.data[0] : null;
      if (row) return { ok: true, code: null, revision: Number(row.revision), updatedAt: row.updated_at };
      // 0 filas: o cambió la revisión (conflicto) o RLS no deja guardar.
      const current = await run(() => client.from('workspace_states').select('revision').eq('organization_id', organizationId).maybeSingle());
      if (!current.ok) return { ok: false, code: current.code };
      if (current.data && Number(current.data.revision) !== Number(baseRevision)) {
        return { ok: false, code: WORKSPACE_ERRORS.conflict, serverRevision: Number(current.data.revision) };
      }
      return { ok: false, code: WORKSPACE_ERRORS.forbidden };
    },

    /** Nombre de la organización (OWNER / ADMIN; RLS lo controla). */
    async renameOrganization(organizationId, name) {
      const res = await run(() => client.from('organizations').update({ name }).eq('id', organizationId).select('id'));
      if (!res.ok) return { ok: false, code: res.code };
      return Array.isArray(res.data) && res.data.length ? { ok: true, code: null } : { ok: false, code: WORKSPACE_ERRORS.forbidden };
    },

    async updateProfileName(userId, fullName) {
      const res = await run(() => client.from('profiles').update({ full_name: fullName }).eq('id', userId).select('id'));
      if (!res.ok) return { ok: false, code: res.code };
      return Array.isArray(res.data) && res.data.length ? { ok: true, code: null } : { ok: false, code: WORKSPACE_ERRORS.forbidden };
    },
  };
}
