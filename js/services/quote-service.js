/**
 * QuoteService — casos de uso de cotizaciones.
 * Usa StorageRepository (nunca localStorage) y los motores económicos.
 */

import { createId } from '../core/ids.js';
import { deepClone } from '../core/object.js';
import { track } from '../core/events.js';
import { computeQuote, summarizeQuote, rateUpdateOf } from '../engines/quote-engine.js';
import { previewRateUpdate } from '../engines/rate-update-engine.js';
import { normalizeRateUpdate, normalizeUpdatePcts, isValidUpdatePct, MAX_RATE_UPDATE_STEPS, MAX_RATE_UPDATE_NOTE, MAX_PREVIOUS_RATE_HISTORIES } from '../domain/rate-update.js';
import { isValidPeriod } from '../domain/economic-base.js';
import { createBlankQuote, createQuoteFromTemplate, withTimeCostBasis } from '../domain/quote-factory.js';
import { DEMO_IDS, demoHydroCraneQuote } from '../domain/demo-data.js';
import { ACTIVE_QUOTE_STATUSES, SERVICE_TYPES } from '../domain/catalogs.js';
import { logger } from '../core/logger.js';
import { isFiniteNumber } from '../core/money.js';

/**
 * Resumen de una cotización que nunca lanza: si una cotización tiene datos
 * inválidos, se marca con error en lugar de romper el dashboard o el listado.
 */
function safeSummary(quote, settings) {
  try {
    return summarizeQuote(quote, { settings });
  } catch (error) {
    logger.warn('No se pudo calcular una cotización', { name: error && error.name });
    return { error: true, atRisk: true, belowFloor: false, incomplete: true, revenue: null, totalCost: null, marginPct: null, completenessPct: 0, issuesCount: 1 };
  }
}

/** serviceType seguro para eventos internos (sólo valores del catálogo). */
function eventServiceType(serviceType) {
  return SERVICE_TYPES.some((t) => t.id === serviceType) ? serviceType : 'unknown';
}

/**
 * Indicadores de un conjunto de cotizaciones ({ quote, summary } de
 * listQuotes()). Única regla para Inicio: activas = borrador, enviada o
 * ganada; margen promedio sólo sobre márgenes finitos (sin márgenes → null,
 * nunca NaN); riesgo y bajo piso según el resumen del motor.
 * @param {{ quote: object, summary: object }[]} items
 */
export function indicatorsFor(items) {
  const list = Array.isArray(items) ? items : [];
  const active = list.filter((i) => i && i.quote && ACTIVE_QUOTE_STATUSES.includes(i.quote.status));
  const margins = active.map((i) => i.summary && i.summary.marginPct).filter(isFiniteNumber);
  return {
    totalCount: list.length,
    activeCount: active.length,
    totalQuotedMonthly: active.reduce((s, i) => s + (i.summary && isFiniteNumber(i.summary.revenue) ? i.summary.revenue : 0), 0),
    averageMarginPct: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
    atRiskCount: active.filter((i) => i.summary && i.summary.atRisk).length,
    belowFloorCount: active.filter((i) => i.summary && i.summary.belowFloor).length,
    items: list,
  };
}

/** ¿Es una cotización de ejemplo (demo ILUSTRATIVA)? */
export function isExampleQuote(quote) {
  return Boolean(quote) && quote.illustrative === true;
}

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
        .map((q) => ({ quote: q, summary: safeSummary(q, s) }))
        .sort((a, b) => String(b.quote.updatedAt).localeCompare(String(a.quote.updatedAt)));
    },

    async getQuote(id) {
      return repository.getQuote(id);
    },

    /** Cotizaciones tal como están guardadas, sin calcular ("Usado en" de Recursos, PLAN-2026-012). */
    async listQuoteRecords() {
      return repository.getQuotes();
    },

    /** Crea una cotización vacía o desde una plantilla de servicio. */
    async createQuote({ templateId = null } = {}) {
      const [org, s, services] = await Promise.all([repository.getOrganization(), settings(), repository.getServices()]);
      const template = templateId ? services.find((t) => t.id === templateId) || null : null;
      const options = { organizationId: org.id, settings: s, now: clock(), id: idFactory(), code: await reserveCode(), baseName: org.baseLocation };
      const quote = withTimeCostBasis(template ? createQuoteFromTemplate(template, options) : createBlankQuote(options));
      const saved = await repository.saveQuote(quote);
      track('quote_created', { serviceType: eventServiceType(saved.serviceType), source: template ? 'template' : 'blank' });
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
      track('quote_duplicated', { serviceType: eventServiceType(saved.serviceType) });
      return saved;
    },

    async deleteQuote(id) {
      const ok = await repository.deleteQuote(id);
      if (ok) track('quote_deleted', {});
      return ok;
    },

    /**
     * Actualiza la tarifa de una cotización a un período nuevo con un % por categoría de la
     * EECC (0.11). No toca los costos de la cotización: agrega un paso al historial.
     * @param {string} id
     * @param {{ toPeriod: string, pcts: Record<string, number>, note?: string }} input
     */
    async applyRateUpdate(id, { toPeriod, pcts, note = '' } = {}) {
      const quote = await repository.getQuote(id);
      if (!quote) throw new Error('not_found');
      const raw = pcts && typeof pcts === 'object' ? pcts : {};
      if (Object.values(raw).some((v) => v !== null && v !== undefined && !isValidUpdatePct(v))) throw new Error('rate_update_pct');
      const state = rateUpdateOf(quote, computeQuote(quote, { settings: await settings() }));
      const preview = previewRateUpdate(state, pcts, toPeriod);
      if (!state.basePeriod) throw new Error('rate_update_period');
      if (!preview.canApply) throw new Error(preview.periodError ? 'rate_update_period' : 'rate_update_no_costs');
      const ru = normalizeRateUpdate(quote.rateUpdate);
      // Foto de la tarifa y la EECC en la primera actualización; después, la guardada.
      const base = ru.steps.length && ru.base ? ru.base : state.liveBase;
      if (!base) throw new Error('rate_update_no_costs');
      if (ru.steps.length >= MAX_RATE_UPDATE_STEPS) throw new Error('rate_update_limit');
      const step = {
        id: idFactory(),
        toPeriod,
        pcts: normalizeUpdatePcts(pcts),
        appliedAt: clock(),
        note: typeof note === 'string' ? note.trim().slice(0, MAX_RATE_UPDATE_NOTE) : '',
      };
      // El período base queda fijo desde la primera actualización.
      const saved = await repository.saveQuote({ ...quote, rateUpdate: { basePeriod: state.basePeriod, base, steps: [...ru.steps, step], previous: ru.previous } });
      return saved;
    },

    /** Deshace la última actualización de tarifa. */
    async undoRateUpdate(id) {
      const quote = await repository.getQuote(id);
      if (!quote) throw new Error('not_found');
      const ru = normalizeRateUpdate(quote.rateUpdate);
      if (!ru.steps.length) return quote;
      const steps = ru.steps.slice(0, -1);
      return repository.saveQuote({ ...quote, rateUpdate: { ...ru, steps, base: steps.length ? ru.base : null } });
    },

    /**
     * La cotización cambió después de actualizar la tarifa: toma la tarifa y los costos de HOY
     * como nueva base, en el período vigente. El historial anterior queda archivado.
     */
    async rebaseRateUpdate(id) {
      const quote = await repository.getQuote(id);
      if (!quote) throw new Error('not_found');
      const ru = normalizeRateUpdate(quote.rateUpdate);
      if (!ru.steps.length) return quote;
      const state = rateUpdateOf(quote, computeQuote(quote, { settings: await settings() }));
      const previous = [...ru.previous, { basePeriod: ru.basePeriod, base: ru.base, steps: ru.steps }].slice(-MAX_PREVIOUS_RATE_HISTORIES);
      return repository.saveQuote({ ...quote, rateUpdate: { basePeriod: state.period, base: null, steps: [], previous } });
    },

    /** Período base de la tarifa (sólo antes de la primera actualización). */
    async setRateBasePeriod(id, period) {
      const quote = await repository.getQuote(id);
      if (!quote) throw new Error('not_found');
      if (period !== null && !isValidPeriod(period)) throw new Error('rate_update_period');
      const ru = normalizeRateUpdate(quote.rateUpdate);
      if (ru.steps.length) throw new Error('rate_update_locked');
      return repository.saveQuote({ ...quote, rateUpdate: { basePeriod: period, base: null, steps: [], previous: ru.previous } });
    },

    /** Calcula una cotización con la configuración vigente. */
    async compute(quote, options = {}) {
      return computeQuote(quote, { settings: await settings(), ...options });
    },

    /**
     * Cotización de ejemplo "Hidrogrúa on-call — Añelo" (ILUSTRATIVA) para la
     * demo guiada. Si existe, la devuelve tal cual (con los cambios que el
     * usuario le haya hecho). Si se borró, la vuelve a crear con el mismo id y
     * un código NUEVO (los códigos nunca se reutilizan). No toca otras
     * cotizaciones. En modo sólo lectura el repositorio rechaza la escritura:
     * la pantalla debe usar entonces la demo en memoria.
     */
    async ensureDemoQuote() {
      const existing = await repository.getQuote(DEMO_IDS.quoteHydroCrane);
      if (existing) return existing;
      const org = await repository.getOrganization();
      const now = clock();
      const demo = demoHydroCraneQuote();
      const quote = { ...demo, organizationId: org.id, createdAt: now, updatedAt: now, code: await reserveCode() };
      return repository.saveQuote(quote);
    },

    /**
     * Cotización de ejemplo para MOSTRAR (demo guiada) sin escribir nada: la
     * guardada si existe; si no, la demo en memoria (stored: false). Navegar
     * por la demo nunca agrega datos: para guardarla, usar ensureDemoQuote()
     * sólo ante una acción explícita del usuario ("Ver el análisis completo").
     * @returns {Promise<{ quote: object, stored: boolean }>}
     */
    async getDemoQuote() {
      const existing = await repository.getQuote(DEMO_IDS.quoteHydroCrane);
      if (existing) return { quote: existing, stored: true };
      const org = await repository.getOrganization();
      return { quote: { ...demoHydroCraneQuote(), organizationId: org.id }, stored: false };
    },

    /** Borrador modificado más recientemente (para "Continuar cotización"), o null. */
    async latestDraft() {
      const items = await this.listQuotes();
      return items.find((i) => i.quote.status === 'draft') || null;
    },

    /** Indicadores del dashboard (todas las cotizaciones). */
    async dashboardStats() {
      return indicatorsFor(await this.listQuotes());
    },
  };
}
