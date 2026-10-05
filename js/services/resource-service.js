/**
 * ResourceService — bibliotecas reutilizables (convenios, perfiles de
 * personal, equipos, materiales, ubicaciones) y plantillas de servicio.
 */

import { track } from '../core/events.js';
import { RESOURCE_TYPES } from '../data/schema.js';
import { computeEquipmentUnit } from '../engines/equipment-engine.js';
import { conversionFactor, currencyOfBase } from '../engines/currency-engine.js';
import { computeLaborLine } from '../engines/labor-engine.js';

export function createResourceService({ repository }) {
  return {
    types: RESOURCE_TYPES,

    async list(type) {
      return repository.getResources(type);
    },

    async get(type, id) {
      return repository.getResource(type, id);
    },

    async save(type, resource) {
      const saved = await repository.saveResource(type, resource);
      track('resource_saved', { resourceType: type.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) });
      return saved;
    },

    async remove(type, id) {
      return repository.deleteResource(type, id);
    },

    async listServices() {
      return repository.getServices();
    },

    async saveService(service) {
      return repository.saveService(service);
    },

    async removeService(id) {
      return repository.deleteService(id);
    },

    /**
     * Ficha económica de un equipo de biblioteca ($/hora, $/día, $/mes).
     * Un valor en otra moneda se convierte con el tipo de cambio por defecto de
     * Configuración; si no hay, la ficha no se calcula (currency.converted =
     * false): nunca se suman dólares con pesos.
     */
    async equipmentCard(equipment) {
      const settings = await repository.getSettings();
      const eq = equipment && typeof equipment === 'object' ? equipment : {};
      const code = currencyOfBase(eq.base);
      const f = conversionFactor(code, settings);
      const converted = f === null || f === 1 ? eq : { ...eq, replacementValue: (Number(eq.replacementValue) || 0) * f, residualValue: (Number(eq.residualValue) || 0) * f };
      const card = computeEquipmentUnit(f === null ? { ...eq, replacementValue: 0, residualValue: 0 } : converted, { fuelPricePerLiter: settings.fuelPricePerLiter, fuelPaidByUs: true });
      return { ...card, currency: f === 1 ? null : { code, rate: f, converted: f !== null } };
    },

    /** Costo mensual de un perfil de personal (1 persona). */
    laborProfileCost(profile) {
      return computeLaborLine({ ...profile, positions: 1, peoplePerPosition: 1 });
    },
  };
}
