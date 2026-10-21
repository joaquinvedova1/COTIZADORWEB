/**
 * QuoteService — casos de uso de cotizaciones.
 * Usa StorageRepository (nunca localStorage) y los motores económicos.
 */

import { createId } from '../core/ids.js';
import { deepClone } from '../core/object.js';
import { track } from '../core/events.js';
import { computeQuote, summarizeQuote } from '../engines/quote-engine.js';
import { createEmptyQuote, createQuoteFromTemplate } from '../domain/quote-factory.js';
import { DEMO_IDS, demoHydroCraneQuote } from '../domain/demo-data.js';
import { ACTIVE_QUOTE_STATUSES, SERVICE_TYPES } from '../domain/catalogs.js';
import { impliesSending, isSendingStatus, isUnreliableSummary, riskSummary, sendCheck } from '../domain/quote-risk.js';
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
    return { error: true, atRisk: true, belowFloor: false, incomplete: true, revenue: null, totalCost: null, marginPct: null, completenessPct: 0, issuesCount: 1, unreliable: false, unreliableLabels: [], criticalLabels: [] };
  }
}

/**
 * Error de un guardado que la marcaría como enviada con un resultado NO CONFIABLE o que no se puede
 * calcular (ECO-02 R1). Lleva el `sendCheck()` (para el aviso) y el estado guardado (para volver a él).
 */
function sendBlockedError(check, previousStatus) {
  const error = new Error('send_blocked');
  error.code = 'send_blocked';
  error.check = check;
  error.previousStatus = typeof previousStatus === 'string' && previousStatus ? previousStatus : 'draft';
  return error;
}

/** serviceType seguro para eventos internos (sólo valores del catálogo). */
function eventServiceType(serviceType) {
  return SERVICE_TYPES.some((t) => t.id === serviceType) ? serviceType : 'unknown';
}

/** true si el resumen dice que el resultado NO ES CONFIABLE (ECO-01/02): sus números no son reales. */
const isUnreliable = (i) => isUnreliableSummary(i.summary);

/**
 * Indicadores de un conjunto de cotizaciones ({ quote, summary } de
 * listQuotes()). Única regla para Inicio: activas = borrador, enviada o
 * ganada; margen promedio sólo sobre márgenes finitos (sin márgenes → null,
 * nunca NaN); riesgo y bajo piso según el resumen del motor.
 * Una cotización con resultado NO CONFIABLE (ECO-02) cuenta como activa y en
 * riesgo, pero sus montos no entran en el valor cotizado, el margen promedio
 * ni "bajo piso": no son reales (`unreliableCount` dice cuántas quedan afuera).
 * @param {{ quote: object, summary: object }[]} items
 */
export function indicatorsFor(items) {
  const list = Array.isArray(items) ? items : [];
  const active = list.filter((i) => i && i.quote && ACTIVE_QUOTE_STATUSES.includes(i.quote.status));
  const reliable = active.filter((i) => !isUnreliable(i));
  const margins = reliable.map((i) => i.summary && i.summary.marginPct).filter(isFiniteNumber);
  return {
    totalCount: list.length,
    activeCount: active.length,
    totalQuotedMonthly: reliable.reduce((s, i) => s + (i.summary && isFiniteNumber(i.summary.revenue) ? i.summary.revenue : 0), 0),
    averageMarginPct: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
    atRiskCount: active.filter((i) => i.summary && (i.summary.atRisk || isUnreliable(i))).length,
    belowFloorCount: reliable.filter((i) => i.summary && i.summary.belowFloor).length,
    unreliableCount: active.filter(isUnreliable).length,
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

  /**
   * Guarda una cotización NUEVA con su código en una sola escritura: la
   * reserva del COT-NNNN y la cotización se guardan juntas o no se guarda
   * ninguna (en la nube, una creación rechazada por créditos no consume
   * código). PLAN-2026-029.
   */
  async function saveNewQuote(build) {
    const next = await nextCode();
    const quote = build(next.code);
    return repository.saveQuote(quote, { lastQuoteNumber: next.number });
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
      const saved = await saveNewQuote((code) => {
        const options = { organizationId: org.id, settings: s, now: clock(), id: idFactory(), code, baseName: org.baseLocation };
        return template ? createQuoteFromTemplate(template, options) : createEmptyQuote(options);
      });
      track('quote_created', { serviceType: eventServiceType(saved.serviceType), source: template ? 'template' : 'blank' });
      return saved;
    },

    /**
     * Guarda la cotización completa (reemplazo).
     * ECO-02 R1: la regla de "Enviada" también vale acá, no sólo en las pantallas. Si el guardado la pasa
     * a Enviada (o a Ganada sin haber estado enviada) respecto de lo GUARDADO y su resultado NO ES
     * CONFIABLE o no se puede calcular, se rechaza con `send_blocked` y no se guarda nada. Los demás
     * cambios de estado, y los guardados de una cotización ya enviada, ganada o perdida, pasan igual. Los
     * pendientes críticos los confirma la pantalla. El respaldo importado no pasa por acá (es historia).
     */
    async saveQuote(quote) {
      if (quote && isSendingStatus(quote.status)) {
        const stored = quote.id ? await repository.getQuote(quote.id) : null;
        const from = stored ? stored.status : undefined;
        if (impliesSending(from, quote.status)) {
          let check;
          try {
            check = sendCheck(riskSummary(computeQuote(quote, { settings: await settings() }).completeness));
          } catch {
            check = sendCheck(null);
          }
          if (!check.allowed) throw sendBlockedError(check, from);
        }
      }
      return repository.saveQuote(quote);
    },

    async duplicateQuote(id) {
      const original = await repository.getQuote(id);
      if (!original) return null;
      const saved = await saveNewQuote((code) => {
        const copy = deepClone(original);
        copy.id = idFactory();
        copy.code = code;
        copy.name = `${original.name} (copia)`;
        copy.status = 'draft';
        copy.createdAt = clock();
        return copy;
      });
      track('quote_duplicated', { serviceType: eventServiceType(saved.serviceType) });
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
      return saveNewQuote((code) => ({ ...demo, organizationId: org.id, createdAt: now, updatedAt: now, code }));
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
