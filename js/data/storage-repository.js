/**
 * StorageRepository — contrato de la capa de datos.
 *
 * Toda la aplicación (servicios y pantallas) usa ESTA interfaz. Nadie fuera
 * de js/data/ accede a localStorage. Todos los métodos son asíncronos para
 * que una implementación futura (SupabaseRepository) pueda reemplazar a
 * LocalStorageRepository sin cambiar servicios, pantallas ni motores.
 *
 * Implementaciones:
 *   - LocalStorageRepository (hoy)
 *   - SupabaseRepository (futuro, ver docs/SUPABASE_PLAN.md)
 */

export class RepositoryError extends Error {
  constructor(message, code = 'repository_error', cause = undefined) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class StorageRepository {
  /** Inicializa (carga, migra o siembra datos). @returns {Promise<{status: string, messages: string[]}>} */
  async init() { throw notImplemented('init'); }

  /** @returns {Promise<object>} */
  async getOrganization() { throw notImplemented('getOrganization'); }
  /** @param {object} organization @returns {Promise<object>} */
  async saveOrganization(organization) { throw notImplemented('saveOrganization'); }

  /** @param {string} [type] @returns {Promise<object|object[]>} */
  async getResources(type) { throw notImplemented('getResources'); }
  /** @returns {Promise<object|null>} */
  async getResource(type, id) { throw notImplemented('getResource'); }
  /** Crea o reemplaza un recurso. @returns {Promise<object>} */
  async saveResource(type, resource) { throw notImplemented('saveResource'); }
  /** Aplica cambios parciales. @returns {Promise<object>} */
  async updateResource(type, id, patch) { throw notImplemented('updateResource'); }
  /** @returns {Promise<boolean>} */
  async deleteResource(type, id) { throw notImplemented('deleteResource'); }

  /** @returns {Promise<object[]>} */
  async getQuotes() { throw notImplemented('getQuotes'); }
  /** @returns {Promise<object|null>} */
  async getQuote(id) { throw notImplemented('getQuote'); }
  /** Crea o reemplaza una cotización. @returns {Promise<object>} */
  async saveQuote(quote) { throw notImplemented('saveQuote'); }
  /** @returns {Promise<object>} */
  async updateQuote(id, patch) { throw notImplemented('updateQuote'); }
  /** @returns {Promise<boolean>} */
  async deleteQuote(id) { throw notImplemented('deleteQuote'); }

  /** Plantillas de servicio. @returns {Promise<object[]>} */
  async getServices() { throw notImplemented('getServices'); }
  /** @returns {Promise<object>} */
  async saveService(service) { throw notImplemented('saveService'); }
  /** @returns {Promise<boolean>} */
  async deleteService(id) { throw notImplemented('deleteService'); }

  /** @returns {Promise<object>} */
  async getSettings() { throw notImplemented('getSettings'); }
  /** @returns {Promise<object>} */
  async saveSettings(settings) { throw notImplemented('saveSettings'); }

  /** Backup completo en formato versionado. @returns {Promise<object>} */
  async exportBackup() { throw notImplemented('exportBackup'); }
  /** Reemplaza los datos por un backup validado. @returns {Promise<object>} */
  async importBackup(data) { throw notImplemented('importBackup'); }
}

function notImplemented(method) {
  return new RepositoryError(`${method}() no implementado en esta implementación de StorageRepository.`, 'not_implemented');
}
