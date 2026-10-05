/**
 * Dobles de prueba de las puertas de Supabase (sin red). Imitan el contrato
 * de js/data/workspace-gateway.js y js/data/auth-gateway.js, incluido el
 * control de revisión y el aislamiento por organización (como RLS).
 */

/** Storage tipo Web Storage en memoria que registra escrituras. */
export class SpyStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
    this.writes = [];
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
    this.writes.push(k);
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

/**
 * Servidor falso: organizaciones, membresías y workspaces. Cada "sesión"
 * (gateway) sólo ve las organizaciones de su usuario.
 */
export function createFakeServer() {
  const orgs = new Map();
  const members = [];
  const workspaces = new Map();
  const profiles = new Map();
  const server = {
    orgs,
    members,
    workspaces,
    profiles,
    failNext: null,
    /** Alta como el trigger de la base. */
    addUser({ id, fullName = '', company = 'Mi empresa', orgId = `org-${id}`, role = 'OWNER' }) {
      orgs.set(orgId, { id: orgId, name: company });
      members.push({ organization_id: orgId, user_id: id, role });
      workspaces.set(orgId, { state: null, revision: 0, schemaVersion: 2 });
      profiles.set(id, { full_name: fullName });
      return orgId;
    },
    /** Otro dispositivo guarda (sube la revisión). */
    externalSave(orgId, state) {
      const ws = workspaces.get(orgId);
      ws.state = state;
      ws.revision += 1;
    },
    gatewayFor(userId) {
      const isMember = (orgId) => members.some((m) => m.organization_id === orgId && m.user_id === userId);
      const fail = () => {
        const code = server.failNext;
        server.failNext = null;
        return code;
      };
      return {
        calls: [],
        async loadMembership(uid) {
          const code = fail();
          if (code) return { ok: false, code };
          const m = members.find((x) => x.user_id === uid && x.user_id === userId);
          if (!m) return { ok: false, code: 'not_found' };
          return { ok: true, organization: { ...orgs.get(m.organization_id) }, role: m.role, profile: { fullName: (profiles.get(uid) || {}).full_name || '' } };
        },
        async loadWorkspace(orgId) {
          const code = fail();
          if (code) return { ok: false, code };
          if (!isMember(orgId)) return { ok: false, code: 'not_found' };
          const ws = workspaces.get(orgId);
          return { ok: true, state: ws.state ? JSON.parse(JSON.stringify(ws.state)) : null, revision: ws.revision, schemaVersion: ws.schemaVersion };
        },
        async saveWorkspace(orgId, { state, schemaVersion, baseRevision }) {
          this.calls.push({ orgId, baseRevision });
          const code = fail();
          if (code) return { ok: false, code };
          if (!isMember(orgId)) return { ok: false, code: 'forbidden' };
          const m = members.find((x) => x.organization_id === orgId && x.user_id === userId);
          if (m.role === 'VIEWER') return { ok: false, code: 'forbidden' };
          const ws = workspaces.get(orgId);
          if (ws.revision !== baseRevision) return { ok: false, code: 'conflict', serverRevision: ws.revision };
          ws.state = JSON.parse(JSON.stringify(state));
          ws.schemaVersion = schemaVersion;
          ws.revision += 1;
          return { ok: true, revision: ws.revision };
        },
        async renameOrganization(orgId, name) {
          if (!isMember(orgId)) return { ok: false, code: 'forbidden' };
          orgs.get(orgId).name = name;
          return { ok: true };
        },
        async updateProfileName(uid, fullName) {
          if (uid !== userId) return { ok: false, code: 'forbidden' };
          profiles.set(uid, { full_name: fullName });
          return { ok: true };
        },
      };
    },
  };
  return server;
}

/** Puerta de Auth falsa: usuarios en memoria, sin guardar contraseñas en ningún storage. */
export function createFakeAuthGateway({ users = [], confirmEmail = true } = {}) {
  let session = null;
  let listener = null;
  const registry = new Map(users.map((u) => [u.email, { ...u }]));
  const gw = {
    exchanged: [],
    emit(event) {
      if (listener) listener(event, session ? { ...session } : null);
    },
    async getUser() {
      return { ok: true, user: session ? { ...session } : null };
    },
    onChange(cb) {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    async signUp({ email, password, fullName, company, redirectTo }) {
      gw.lastSignUp = { email, fullName, company, redirectTo, passwordLength: password.length };
      if (registry.has(email)) return { ok: false, code: 'email_taken' };
      const user = { id: `u-${registry.size + 1}`, email, fullName, emailConfirmed: !confirmEmail, password };
      registry.set(email, user);
      if (confirmEmail) return { ok: true, needsConfirmation: true, user: null };
      session = { id: user.id, email, fullName, emailConfirmed: true };
      return { ok: true, needsConfirmation: false, user: { ...session } };
    },
    async signIn({ email, password }) {
      const u = registry.get(email);
      if (!u || u.password !== password) return { ok: false, code: 'invalid_credentials' };
      if (!u.emailConfirmed) return { ok: false, code: 'email_not_confirmed' };
      session = { id: u.id, email, fullName: u.fullName, emailConfirmed: true };
      return { ok: true, user: { ...session } };
    },
    async signOut() {
      session = null;
      return { ok: true };
    },
    /** refresh(): con gw.refreshFails = 'session_missing' | 'network' simula que no se puede renovar. */
    async refresh() {
      if (gw.refreshFails) return { ok: false, code: gw.refreshFails };
      return session ? { ok: true, user: { ...session } } : { ok: false, code: 'session_missing' };
    },
    async requestPasswordReset(email, redirectTo) {
      gw.lastReset = { email, redirectTo };
      return { ok: true };
    },
    async updatePassword(password) {
      if (!session) return { ok: false, code: 'session_missing' };
      const u = [...registry.values()].find((x) => x.id === session.id);
      u.password = password;
      return { ok: true };
    },
    async exchangeCode(code) {
      gw.exchanged.push(code);
      if (code === 'bad') return { ok: false, code: 'link_invalid' };
      const u = [...registry.values()][0];
      if (!u) return { ok: false, code: 'link_invalid' };
      u.emailConfirmed = true;
      session = { id: u.id, email: u.email, fullName: u.fullName, emailConfirmed: true };
      return { ok: true, user: { ...session } };
    },
    async verifyEmailToken() {
      return { ok: false, code: 'link_invalid' };
    },
    /** Simula que la sesión venció o se revocó en el servidor. */
    expire() {
      session = null;
      gw.emit('SIGNED_OUT');
    },
  };
  return gw;
}
