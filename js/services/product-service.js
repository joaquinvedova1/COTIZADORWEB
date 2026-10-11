/**
 * ProductService — casos de uso de productos (PLAN-2026-008).
 * Usa StorageRepository (nunca localStorage) y el motor de productos.
 */

import { createId } from '../core/ids.js';
import { deepClone } from '../core/object.js';
import { track } from '../core/events.js';
import { computeProduct, summarizeProduct } from '../engines/product-engine.js';
import { createEmptyProduct, exampleProduct } from '../domain/product-factory.js';

export function createProductService({ repository, clock = () => new Date().toISOString(), idFactory = createId }) {
  return {
    /** Productos con su resumen (costo por unidad, precio sugerido), más recientes primero. */
    async listProducts() {
      const products = await repository.getProducts();
      return products
        .map((p) => ({ product: p, summary: summarizeProduct(p) }))
        .sort((a, b) => String(b.product.updatedAt).localeCompare(String(a.product.updatedAt)));
    },

    async getProduct(id) {
      return repository.getProduct(id);
    },

    /** Crea un producto vacío o el ejemplo ILUSTRATIVO ("Chipá"). */
    async createProduct({ example = false } = {}) {
      const [org, settings] = await Promise.all([repository.getOrganization(), repository.getSettings()]);
      const options = { organizationId: org.id, settings, now: clock(), id: idFactory() };
      const product = example ? exampleProduct({ ...options, idFactory }) : createEmptyProduct(options);
      const saved = await repository.saveProduct(product);
      track('product_created', { source: example ? 'example' : 'blank' });
      return saved;
    },

    /** Guarda el producto completo (reemplazo). */
    async saveProduct(product) {
      return repository.saveProduct(product);
    },

    async duplicateProduct(id) {
      const original = await repository.getProduct(id);
      if (!original) return null;
      const copy = deepClone(original);
      copy.id = idFactory();
      copy.name = `${original.name} (copia)`;
      copy.createdAt = clock();
      const saved = await repository.saveProduct(copy);
      track('product_duplicated', {});
      return saved;
    },

    async deleteProduct(id) {
      const ok = await repository.deleteProduct(id);
      if (ok) track('product_deleted', {});
      return ok;
    },

    /** Calcula un producto. */
    compute(product) {
      return computeProduct(product);
    },
  };
}
