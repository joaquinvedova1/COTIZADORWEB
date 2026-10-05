# Modelo de recursos de RATEOS

> **RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN.**
> Recursos es el maestro de la empresa. Cada cotización guarda una copia de los valores que usó (snapshot). Cambiar un recurso **nunca** cambia una cotización hecha: la cotización avisa y la persona decide.

Plan: [PLAN-2026-005](../.agent/PLANS.md). Fórmulas: [CALCULATION_RULES.md](CALCULATION_RULES.md) §4.1, §5.1, §6.1 y §19. Esquema: [DATA_MODEL.md](DATA_MODEL.md) (v3).

## 1. Qué es cada cosa

| Concepto | Dónde vive | Para qué |
| --- | --- | --- |
| **Recurso maestro** | `resources.laborProfiles`, `resources.equipment` (Mis equipos), `resources.externalServices`, `resources.materials` | Los valores vigentes de la empresa. Se cargan una vez y se reutilizan. |
| **Línea de cotización** | `quote.labor[]`, `quote.equipment[]`, `quote.materials[]` | Los valores con los que se calculó ESA oferta. Se pueden ajustar sólo para esa oferta. |
| **Snapshot** | `line.snapshot` | Qué tenía el recurso cuando se copió (o al migrar). Sirve para detectar cambios en el maestro. |
| **Base económica** | `base` (y `costsBase` en equipos propios) | De qué mes, en qué moneda y de qué fuente es un valor. |
| **Catálogo de familias** | `js/domain/equipment-catalog.js` (código, público) | Qué TIPO de equipo es (vactor, carretón, retro…) y su movilidad típica. Sin precios ni datos de clientes. |
| **Modelos propios** | `resources.equipmentModels` (privado de la organización) | Marca y modelo que usa la empresa. Sólo descriptivo, sin precios. |
| **Mis equipos (unidad / legajo)** | `resources.equipment` | La unidad real: interno, dominio, modelo, obtención, valor, costos, base y movilidad. |

## 2. Base económica

```js
base = { period: 'AAAA-MM' | null, currency: 'ARS' | 'USD' | 'EUR' | null, source: 'company' | 'supplier' | 'agreement' | 'index' | 'other' | null, note: '' }
```

- Se muestra como **"Base: sep-26"**. Sin período: **"Base no definida"**.
- **Nunca se inventa una fecha**: un dato sin base queda sin base (no se asume "hoy"). La migración v2 → v3 deja todo en "Base no definida".
- Sueldos y costos de tener/usar un equipo propio van en la moneda de la empresa. El valor de reposición de un equipo, una tarifa externa o un material pueden estar en otra moneda: se convierten con el **tipo de cambio de la cotización** (lo carga la empresa; RATEOS no lo busca). Sin tipo de cambio, el valor no se suma y la cotización queda en rojo.
- **Base económica de la oferta**: base general = mes de `quote.offerDate`. Por rubro: la base más vieja y la más nueva. Advertencias (no bloquean): "Esta cotización usa valores con diferentes fechas base" (más de `BASE_SPREAD_MONTHS` = 3 meses entre la más vieja y la más nueva), valores con base de más de `BASE_STALE_MONTHS` = 6 meses antes de la oferta, valores sin base. Se compara contra la fecha de la OFERTA, nunca contra "hoy".

## 3. Snapshot y actualización manual

```js
line.snapshot = { resourceType, resourceId, resourceName, takenAt, legacy, values, dismissed }
```

- `values`: los campos económicos del recurso (ver `SNAPSHOT_FIELDS` en `js/domain/resource-snapshot.js`) + su base, obtención, condiciones externas y consumo/desgaste en ruta.
- Estado de una línea (`lineSyncStatus`): `unlinked` (cargada a mano), `missing` (el recurso ya no existe: la cotización conserva sus valores), `current`, `changed`, `dismissed`; y `adjusted` si la línea tiene valores distintos de los que copió.
- Si el maestro cambió: "El costo de X fue actualizado desde que hiciste esta cotización." con **valor utilizado** y **valor actual en Recursos** (con su base) y dos botones:
  - **Actualizar en esta cotización**: la línea toma los valores actuales y un snapshot nuevo; conserva lo operativo (id, cantidad, horas, posiciones, operador asignado, cómo llega al servicio).
  - **Conservar valor original**: se recuerda la versión del recurso descartada (`dismissed` = huella); si el maestro vuelve a cambiar, se avisa de nuevo.
- Nunca se actualiza sola: ni al abrir, ni al migrar, ni al duplicar. Las cotizaciones migradas de v2 tienen un snapshot `legacy` (los valores que ya usaban).
- Preparado para "Actualizar costos de esta oferta a valores actuales" (`resourceChanges` devuelve todos los cambios) e índices: no está en esta iteración.

## 4. Propio, alquilado o tercerizado

| Obtención | Qué calcula RATEOS | Qué NO hace |
| --- | --- | --- |
| **Propio** | Posesión (amortización, seguro, patente, certificaciones, otros, costo de capital) + operación (mantenimiento, neumáticos, combustible por hora). | — |
| **Alquilado** | Tarifa neta del proveedor por unidad (hora, día, mes, viaje, km, llamado, global) con mínimo; lo opera tu personal. | No amortiza ni asegura: el equipo no es tuyo. |
| **Tercerizado** | Igual que alquilado; normalmente con operador del proveedor. | Ídem. |

Qué incluye la tarifa (Sí / No / Sin definir): operador, combustible (si no, litros/h que pagás vos), movilización (si no, monto por llamado), seguro.

### Tratamiento fiscal de los externos

RATEOS **no trae alícuotas** y **no suma impuestos indiscriminadamente**:

- precio **neto** (sin IVA) + IVA del proveedor + ¿es recuperable? (Sí / No / Parcial %) + percepciones / retenciones + otros cargos no recuperables + plazo de pago;
- **costo económico** (entra al costo) = neto + IVA que no recuperás + cargos no recuperables;
- **salida de caja** = neto + IVA + percepciones + cargos (informativo);
- **crédito fiscal** = IVA recuperable + percepciones: caja que se adelanta, **no es costo**;
- sin definir si es recuperable → se usa el neto y se avisa;
- Ganancias no se carga como % sobre un alquiler; el IIBB del proveedor ya está en su precio (el propio se calcula sobre la facturación, en "Impuestos sobre lo que facturás").

## 5. Movilización del recurso principal vs logística auxiliar

**¿Cómo llega cada equipo al lugar del servicio?** (por línea de equipo):

| Modo | Costo en la línea | Dónde está el costo |
| --- | --- | --- |
| Por sus propios medios | km de ruta × cantidad; combustible en ruta (L/100 km × precio); desgaste por km (mantenimiento y neumáticos, **sin** combustible ni amortización) | Combustible y Logística |
| Lo transporta otro equipo | 0 | En la línea del carretón / batea / camión (propio, alquilado o tercerizado) |
| Con un vehículo de apoyo | 0 | En ese vehículo de la logística auxiliar |
| No requiere | 0 | — |
| Externo con movilización incluida | 0 | En la tarifa del proveedor |

- **Quién maneja**: si maneja su operador (asignado desde Personal), **no se suma otra persona**; si maneja otra persona, tiene que estar en Personal (RATEOS no la agrega sola).
- **Logística auxiliar**: camionetas, traslado de personal y vehículos de apoyo, por km recorrido; peajes y viáticos.
- La familia del catálogo sugiere el modo al agregar un equipo (autopropulsado y apto para ruta → por sus medios; requiere transporte → lo transporta otro equipo). Es editable.

## 6. Riesgos de doble conteo (y cómo se cubren)

| Riesgo | Cobertura |
| --- | --- |
| Mismo equipo como equipo y como vehículo auxiliar | Regla de completitud `duplicates` + texto en "Logística auxiliar". |
| Operador incluido en la tarifa y además asignado de Personal | Aviso en la línea + regla `duplicates`. |
| Chofer agregado cuando maneja el operador | "Maneja su operador" no suma mano de obra; la traza lo explica. |
| Amortización también en $/km | El desgaste por km excluye amortización (texto y traza). |
| Combustible trabajando (L/h) y en ruta (L/100 km) | Son consumos distintos y se muestran separados; un alquilado con combustible incluido no suma combustible. |
| Movilización del proveedor y modo propio a la vez | Externo con movilización incluida → 0 en movilización; si no está incluida, se suma su monto y el modo propio sólo agrega ruta si se eligió. |
| IVA como costo | Sólo el IVA no recuperable es costo; el resto se informa aparte. |
| Alquiler como activo propio | Un externo no tiene amortización, seguro ni costo de capital. |

## 7. Catálogo: qué puede tener y qué no

- El catálogo de familias está en el código (público): sólo descripción general y movilidad típica (autopropulsado, apto para ruta, requiere transporte, requiere conductor) y el tipo de consumo. **Nunca** precios, especificaciones técnicas que no tengamos, nombres de clientes ni contratos.
- Marca y modelo son datos privados de cada organización (`resources.equipmentModels`).

## 8. Migración v2 → v3 (resumen)

- Todo valor existente queda con "Base no definida" y la moneda de la empresa.
- Equipos de Recursos: familia desde el tipo anterior, obtención "propio", movilidad sin definir.
- Líneas de cotizaciones: snapshot `legacy` con los valores que ya usaban, movilización sin definir, sin operador asignado. **Ningún número cambia** (los viajes existentes siguen en la logística auxiliar).
- Cotizaciones: moneda de la empresa, fecha de la oferta = fecha de creación, sin tipos de cambio.
- Copia de recuperación previa. En staging (`/preview/`) se pide confirmación antes de actualizar el formato de los datos de la cuenta; si no, se abren en sólo lectura sin escribir nada.
