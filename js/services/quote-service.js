/**
 * QuoteService — casos de uso de cotizaciones.
 * Usa StorageRepository (nunca localStorage) y los motores económicos.
 */

import { createId } from '../core/ids.js';
import { deepClone } from '../core/object.js';
import { track } from '../core/events.js';
import { computeQuote, summarizeQuote } from '../engines/quote-engine.js';
import { createEmptyQuote, createQuoteFromTemplate } from '../domain/quote-factory.js';
import { ACTIVE_QUOTE_STATUSES } from '../domain/catalogs.js';
import { isFiniteNumber } from '../core/money.js';

export function createQuoteService({ repository, clock = () => new Date().toISOString(), idFactory = createId }) {
  async function settings() {
    return repository.getSettings();
  }

  /**
   * Próximo código COT-NNNN. Usa un contador monotónico guardado en la
   * configuración (lastQuoteNumber) para no reutilizar nunca el código de
   * una cotización eliminada (puede haber sido enviada a un cliente).
   */
  async function nextCode() {
    const [quotes, s] = await Promise.all([repository.getQuotes(), settings()]);
    const maxExisting = quotes.reduce((m, q) => {
      const match = /^COT-(\d+)$/.exec(q.code || '');
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    const last = Number.isInteger(s.lastQuoteNumber) && s.lastQuoteNumber > 0 ? s.lastQuoteNumber : 0;
    const number = Math.max(maxExisting, last) + 1;
    return { code: `COT-${String(number).padStart(4, '0')}`, number };
  }

  async function reserveCode() {
    const next = await nextCode();
    await repository.saveSettings({ lastQuoteNumber: next.number });
    return next.code;
  }

  return {
    /** Lista de cotizaciones con indicadores resumidos (más recientes primero). */
    async listQuotes() {
      const [quotes, s] = await Promise.all([repository.getQuotes(), settings()]);
      return quotes
        .map((q) => ({ quote: q, summary: summarizeQuote(q, { settings: s }) }))
        .sort((a, b) => String(b.quote.updatedAt).localeCompare(String(a.quote.updatedAt)));
    },

    async getQuote(id) {
      return repository.getQuote(id);
    },

    /** Crea una cotización vacía o desde una plantilla de servicio. */
    async createQuote({ templateId = null } = {}) {
      const [org, s, services] = await Promise.all([repository.getOrganization(), settings(), repository.getServices()]);
      const template = templateId ? services.find((t) => t.id === templateId) || null : null;
      const options = { organizationId: org.id, settings: s, now: clock(), id: idFactory(), code: await reserveCode() };
      const quote = template ? createQuoteFromTemplate(template, options) : createEmptyQuote(options);
      const saved = await repository.saveQuote(quote);
      track('quote_created', { serviceType: saved.serviceType, source: template ? 'template' : 'blank' });
      return saved;
    },

    /** Guarda la cotización completa (reemplazo). */
    async saveQuote(quote) {
      return repository.saveQuote(quote);
    },

    async duplicateQuote(id) {
      const original = await repository.getQuote(id);
      if (!original) return null;
      const copy = deepClone(original);
      copy.id = idFactory();
      copy.code = await reserveCode();
      copy.name = `${original.name} (copia)`;
      copy.status = 'draft';
      copy.createdAt = clock();
      const saved = await repository.saveQuote(copy);
      track('quote_duplicated', { serviceType: saved.serviceType });
      return saved;
    },

    async deleteQuote(id) {
      const ok = await repository.deleteQuote(id);
      if (ok) track('quote_deleted', {});
      return ok;
    },

    /** Calcula una cotización con la configuración vigente. */
    async compute(quote, options = {}) {
      return computeQuote(quote, { settings: await settings(), ...options });
    },

    /** Indicadores del dashboard. */
    async dashboardStats() {
      const items = await this.listQuotes();
      const active = items.filter((i) => ACTIVE_QUOTE_STATUSES.includes(i.quote.status));
      const margins = active.map((i) => i.summary.marginPct).filter(isFiniteNumber);
      return {
        totalCount: items.length,
        activeCount: active.length,
        totalQuotedMonthly: active.reduce((s, i) => s + (isFiniteNumber(i.summary.revenue) ? i.summary.revenue : 0), 0),
        averageMarginPct: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
        atRiskCount: active.filter((i) => i.summary.atRisk).length,
        belowFloorCount: active.filter((i) => i.summary.belowFloor).length,
        items,
      };
    },
  };
}
