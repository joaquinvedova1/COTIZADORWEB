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
  /** RATEOS_ADMIN (como private.platform_admins): sólo lo cambia el "servidor". */
  const admins = new Set();
  /**
   * Créditos de prueba (como private.credit_accounts + credit_ledger y el trigger
   * workspace_states_credit_guard, PLAN-2026-029): orgId → { enabled, balance, ledger }.
   */
  const credits = new Map();
  const EXAMPLE_PRODUCT = '00000000-0000-4000-8000-000000002001';
  /** Mismo criterio que el trigger: null = aceptar; si no, el error que devolvería la base. */
  const chargeFor = (orgId, state) => {
    const acct = credits.get(orgId);
    if (!acct || !acct.enabled || !state) return { ok: true, keys: [] };
    const keys = [];
    for (const [kind, list] of [['quote', state.quotes], ['product', state.products]]) {
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) return { ok: false, code: 'invalid_calculations' };
      const seen = new Set();
      for (const item of list) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 100 || seen.has(item.id)) return { ok: false, code: 'invalid_calculations' };
        seen.add(item.id);
        if (kind === 'product' && item.id === EXAMPLE_PRODUCT) continue;
        if (!acct.ledger.has(`${kind}:${item.id}`)) keys.push(`${kind}:${item.id}`);
      }
    }
    if (keys.length > acct.balance) return { ok: false, code: 'credits_exhausted', credits: { needed: keys.length, balance: acct.balance } };
    return { ok: true, keys };
  };
  const server = {
    orgs,
    members,
    workspaces,
    profiles,
    admins,
    credits,
    /** Cuenta de créditos de una empresa tester (las demás no tienen límite). */
    enableCredits(orgId, balance = 10) {
      credits.set(orgId, { enabled: true, balance, ledger: new Set(), saves: 0 });
      return credits.get(orgId);
    },
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
    /**
     * Puerta de admin falsa, como public.am_i_platform_admin / admin_overview /
     * admin_users: decide por el id de la sesión (auth.uid()), nunca por lo que
     * mande el cliente, y jamás devuelve el contenido de un workspace.
     */
    adminGatewayFor(userId) {
      const isAdmin = () => admins.has(userId);
      return {
        calls: [],
        async amIPlatformAdmin() {
          this.calls.push('am_i_platform_admin');
          return { ok: true, code: null, isAdmin: isAdmin() };
        },
        async overview() {
          this.calls.push('admin_overview');
          if (!isAdmin()) return { ok: false, code: 'forbidden' };
          const ws = [...workspaces.values()];
          return {
            ok: true,
            code: null,
            overview: {
              users_total: profiles.size, users_confirmed: profiles.size, users_7d: profiles.size, users_30d: profiles.size,
              organizations_total: orgs.size, workspaces_total: ws.length, workspaces_active_30d: ws.filter((w) => w.revision > 0).length,
              generated_at: '2026-10-05T12:00:00.000Z',
            },
          };
        },
        async users() {
          this.calls.push('admin_users');
          if (!isAdmin()) return { ok: false, code: 'forbidden' };
          return {
            ok: true,
            code: null,
            users: members.map((m) => ({
              full_name: (profiles.get(m.user_id) || {}).full_name || '',
              email: `${m.user_id}@example.com`,
              email_confirmed: true,
              organization_name: orgs.get(m.organization_id).name,
              organization_role: m.role,
              organization_members: members.filter((x) => x.organization_id === m.organization_id).length,
              workspace_revision: workspaces.get(m.organization_id).revision,
              is_platform_admin: admins.has(m.user_id),
            })),
          };
        },
      };
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
          // Como el gateway real: si la fila ya no es visible (no es miembro), not_found.
          if (!isMember(orgId)) return { ok: false, code: 'not_found' };
          const m = members.find((x) => x.organization_id === orgId && x.user_id === userId);
          if (m.role === 'VIEWER') return { ok: false, code: 'forbidden' };
          const ws = workspaces.get(orgId);
          if (ws.revision !== baseRevision) return { ok: false, code: 'conflict', serverRevision: ws.revision };
          // El cobro va en la misma "transacción": sin saldo no se guarda nada.
          const charge = chargeFor(orgId, state);
          if (!charge.ok) return { ok: false, code: charge.code, ...(charge.credits ? { credits: charge.credits } : {}) };
          const acct = credits.get(orgId);
          if (acct && charge.keys.length) {
            charge.keys.forEach((k) => acct.ledger.add(k));
            acct.balance -= charge.keys.length;
          }
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
/**
 * `mailFailure` (opcional) simula que el proveedor de correo rechaza el envío (por ejemplo
 * 'email_not_authorized' con el SMTP por defecto). Como Supabase, el reenvío sólo intenta
 * enviar si hay una cuenta sin confirmar: sin cuenta o ya confirmada responde ok sin enviar.
 */
export function createFakeAuthGateway({ users = [], confirmEmail = true, mailFailure = null } = {}) {
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
    /** Reenvío de la confirmación: sólo "sale" si la cuenta existe y no está confirmada. */
    async resendSignupConfirmation(email, redirectTo) {
      const u = registry.get(email);
      const pending = Boolean(u && !u.emailConfirmed);
      gw.lastResend = { email, redirectTo, sent: pending && !mailFailure };
      if (pending && mailFailure) return { ok: false, code: mailFailure };
      return { ok: true };
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
    /** Como Supabase: sólo si la cuenta existe "sale" un correo (con enlace y código). */
    async requestPasswordReset(email, redirectTo) {
      gw.lastReset = { email, redirectTo };
      if (registry.has(email)) gw.codes.set(email, '123456');
      return { ok: true };
    },
    codes: new Map(),
    /** Código del correo de recuperación (verifyOtp type: 'recovery'). */
    async verifyRecoveryCode(email, code) {
      gw.lastCode = { email, length: String(code).length };
      const u = registry.get(email);
      if (!u || gw.codes.get(email) !== code) return { ok: false, code: 'link_invalid', user: null };
      gw.codes.delete(email);
      session = { id: u.id, email: u.email, fullName: u.fullName, emailConfirmed: true };
      return { ok: true, code: null, user: { ...session } };
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
    /** Simula que la sesión venció o se revocó en el servidor. */
    expire() {
      session = null;
      gw.emit('SIGNED_OUT');
    },
  };
  return gw;
}
