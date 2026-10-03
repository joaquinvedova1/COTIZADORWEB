# Reglas de cálculo de RATEOS

Este documento describe **todas** las fórmulas del motor económico tal como están implementadas en `js/engines/` (v0.1.0). Es parte de la especificación funcional: si una fórmula cambia, este documento, los tests y el [CHANGELOG](../CHANGELOG.md) cambian en el mismo Pull Request (ver [AGENTS.md](../AGENTS.md), "Protección del motor").

> **Valores ILUSTRATIVOS.** Los ejemplos numéricos usan los datos demo de *Patagonia Servicios SRL* (empresa ficticia) o casos de referencia sintéticos. No son escalas salariales, cargas patronales, alícuotas, precios ni costos reales.

Convenciones:

- Los porcentajes se expresan en **puntos** (`10` = 10 %). `x%` en una fórmula significa `x / 100`.
- `D` = días activos (facturables) del mes. `F` = costos fijos mensuales. `v` = costo variable por día activo.
- Los motores calculan con valores internos **sin redondear**. El redondeo sólo se aplica al mostrar (ver [Redondeos y precisión](#18-redondeos-y-precisión)).
- Todas las funciones son puras: mismos inputs → mismos outputs. Ninguna devuelve `NaN`, `Infinity` ni `-Infinity`; cuando un resultado no existe devuelven `null` y la UI muestra "—".

## Índice

1. [Modelo económico general](#1-modelo-económico-general)
2. [Actividad y on-call](#2-actividad-y-on-call)
3. [Personal](#3-personal)
4. [Equipos](#4-equipos)
5. [Logística](#5-logística)
6. [Materiales y otros costos](#6-materiales-y-otros-costos)
7. [Estructura (costos indirectos)](#7-estructura-costos-indirectos)
8. [Financiero y capital de trabajo](#8-financiero-y-capital-de-trabajo)
9. [Contingencia](#9-contingencia)
10. [Costo total y estructura de costos (EECC)](#10-costo-total-y-estructura-de-costos-eecc)
11. [Margen vs markup](#11-margen-vs-markup)
12. [Unidades, reglas comerciales y facturación](#12-unidades-reglas-comerciales-y-facturación)
13. [Tarifa piso, precio objetivo y precio comercial](#13-tarifa-piso-precio-objetivo-y-precio-comercial)
14. [Descuentos por volumen y continuidad](#14-descuentos-por-volumen-y-continuidad)
15. [Break-even y días para margen objetivo](#15-break-even-y-días-para-margen-objetivo)
16. [Utilización y matriz tarifa × utilización](#16-utilización-y-matriz-tarifa--utilización)
17. [Sensibilidad, escenarios y comparador de modelos](#17-sensibilidad-escenarios-y-comparador-de-modelos)
18. [Redondeos y precisión](#18-redondeos-y-precisión)
19. [Cost Completeness Score](#19-cost-completeness-score)
20. [Indicadores y alertas](#20-indicadores-y-alertas)
21. [Casos extremos](#21-casos-extremos)
22. [Golden cases](#22-golden-cases)

---

## 1. Modelo económico general

Archivo: `js/engines/cost-engine.js` (`buildCostModel`, `costAtActivity`, `monthsFactor`).

Toda la economía de un servicio se reduce a **costos fijos mensuales** (existen aunque no haya actividad) y **costos variables por día activo**:

```
Costo(D) = F × factorMeses(D) + v × D

factorMeses(D) = 1                        si D ≤ díasDisponibles
               = D / díasDisponibles      si D > díasDisponibles
```

`factorMeses` sólo es mayor a 1 cuando los días activos superan los días disponibles del mes: se interpreta como trabajo de más de un mes y se prorratean los fijos (la traza "Costo total mensual" lo muestra como "Meses de costo fijo" y lo aclara con una nota).

Orden de cálculo dentro de `buildCostModel(quote)`:

1. Costos directos: personal, standby, equipos (posesión, operación y combustible), logística, materiales, otros costos.
2. Estructura (costos indirectos) según el método de absorción.
3. Financiero, sobre los costos que son salida de caja (directos + estructura).
4. Contingencia = % × (directos + estructura + financiero).

Cada línea del modelo (`model.lines`) tiene `category` (categoría de la EECC), `payGroup` (grupo de pago para el financiero), `fixedMonthly`, `variablePerActiveDay` y su parte en efectivo (`cashFixedMonthly`, `cashVariablePerActiveDay`). `F` y `v` son la suma de las 8 categorías (incluidos financiero y contingencia).

**Ejemplo (demo Hidrogrúa on-call — Añelo, ILUSTRATIVO):** `F ≈ 9.031.407`, `v ≈ 843.136/día`, `D = 8` → `Costo(8) ≈ 9.031.407 + 6.745.091 = 15.776.498`.

## 2. Actividad y on-call

Archivo: `js/engines/cost-engine.js` (`normalizeActivity`).

| Dato | Regla |
|---|---|
| Días disponibles del mes | `min(availableDaysPerMonth, 31)`; si es 0, negativo o vacío se usa **30** (y `validateQuote` informa el error con la regla `availableDays`). |
| Días activos `D` | `activeDaysPerMonth`; negativo o vacío → 0. Una cotización nueva en blanco empieza con `null` (es un dato de cada cotización, no un default): hasta que se carga, se calcula con 0 días y el Cost Completeness Score marca la actividad en rojo (§19). |
| Días por activación | `daysPerActivation`; si es ≤ 0 o vacío → 1. |
| Horas por día activo | `min(hoursPerActiveDay, 24)`. |
| Activaciones por mes | `D / díasPorActivación` |
| Utilización % | `D / díasDisponibles × 100` |

**On-call.** Un servicio on-call reserva recursos (costos fijos) y se activa por llamado. Todo lo que ocurre "por activación" se convierte a "por día activo" dividiendo por los días por activación:

```
activaciones/mes          = días activos / días por activación
costo por día activo      = costo por activación / días por activación
ingreso por activación    → × activaciones/mes (call-out, movilización, km adicional)
```

Ejemplo demo: 8 días activos, 2 días por activación → **4 activaciones/mes**.

## 3. Personal

Archivo: `js/engines/labor-engine.js` (`laborLoadFactor`, `computeLaborLine`, `computeLabor`).

Por persona y por mes:

```
remunerativo          = básico + adicionales
SAC                   = remunerativo × SAC%
vacaciones            = remunerativo × vacaciones%
base de cargas        = remunerativo + SAC + vacaciones
cargas patronales     = base de cargas × cargasPatronales%
ART                   = base de cargas × ART%
remunerativo cargado  = base de cargas + cargas patronales + ART
                      = remunerativo × factorCargas

factorCargas          = (1 + SAC% + vacaciones%) × (1 + cargasPatronales% + ART%)

no remunerativo       = seguros + EPP + capacitación + traslado      (sin cargas)
fijo mensual/persona  = remunerativo cargado + no remunerativo
```

Por día activo y por **posición**:

```
valor hora            = básico / horas normales del mes      (sólo el básico)
valor hora extra      = valor hora × (1 + recargoHE%)
horas extra cargadas  = horasExtraPorDíaActivo × valor hora extra × factorCargas
variable/día/posición = horas extra cargadas + vianda
```

**Relevos y posiciones cubiertas.** RATEOS piensa en posiciones cubiertas, no en cantidad de personas:

```
dotación                 = posiciones × personas por posición
fijo mensual de la línea = fijo mensual/persona × dotación       (todos cobran sueldo)
variable por día activo  = variable/día/posición × posiciones    (en un día activo trabaja
                                                                    una persona por posición)
```

`personas por posición` vacío o negativo se toma como 1. Informativo: costo hora cargado = fijo mensual/persona / horas normales.

**Standby (costo).** Los días de standby de las reglas comerciales (`rules.standbyDaysPerMonth`) se costean como días en locación sin operar: `standby mensual = días de standby × variable por día activo del personal` (vianda + horas extra). Es un costo **fijo mensual** en la categoría Mano de obra. Si se marcó "No aplica standby" (`rules.standbyNotApplicable = true`), los días de standby se toman como 0: no hay costo ni ingreso de standby (§12).

**Ejemplo (operador demo, parámetros genéricos ILUSTRATIVOS):** básico 1.800.000, adicionales 400.000, SAC 8,33 %, vacaciones 4 %, cargas 24 %, ART 6 %, 176 h normales, 4 h extra/día activo con recargo 50 %, vianda 25.000, seguros 30.000, EPP 40.000, capacitación 25.000, traslado 60.000.

| Concepto | Valor |
|---|---:|
| factorCargas = 1,1233 × 1,30 | 1,46029 |
| Remunerativo cargado = 2.200.000 × 1,46029 | 3.212.638 |
| No remunerativo | 155.000 |
| **Fijo mensual por persona** | **3.367.638** |
| Valor hora = 1.800.000 / 176 | 10.227,27 |
| Valor hora extra (+50 %) | 15.340,91 |
| Horas extra cargadas = 4 × 15.340,91 × 1,46029 | 89.608,70 |
| **Variable por día activo por posición** (+ vianda) | **114.608,70** |

Con 2 personas por posición (relevo) el fijo pasa a 6.735.276 y el variable por día sigue en 114.608,70.

## 4. Equipos

Archivo: `js/engines/equipment-engine.js` (`computeOwnership`, `computeOperation`, `computeEquipmentUnit`, `computeEquipmentLine`).

RATEOS separa **costo de posesión** (existe aunque el equipo no trabaje) de **costo de operación** (sólo cuando trabaja).

Posesión mensual de una unidad:

```
residual           = min(valor residual, valor de reposición)
amortización       = (reposición − residual) / (vida útil años × 12)       (0 si vida útil = 0)
seguro             = seguro anual / 12
patente            = patente anual / 12
certificaciones    = certificaciones anual / 12
inversión media    = (reposición + residual) / 2
costo de capital   = inversión media × tasa anual% / 12
posesión en efectivo   = seguro + patente + certificaciones
posesión no efectivo   = amortización + costo de capital       (no son salidas de caja mensuales)
posesión total         = efectivo + no efectivo
```

Operación por hora de uso:

```
combustible/h  = litros/h × precio del combustible      (precio = 0 si el combustible lo provee el cliente)
operación/h    = mantenimiento/h + neumáticos/h + combustible/h
```

**En una cotización** (`computeEquipmentLine`), con `horas por día activo` de la línea (si está vacío se usan las horas por día activo de la actividad):

| Parte | Fórmula | Categoría EECC |
|---|---|---|
| Fijo mensual | posesión total × cantidad | Equipos |
| Variable no combustible / día | (mantenimiento/h + neumáticos/h) × horas/día × cantidad | Equipos |
| Combustible / día | combustible/h × horas/día × cantidad | **Combustible** |

Sólo la posesión en efectivo entra al cálculo financiero (ver §8).

**Ficha de biblioteca ($/hora, $/día, $/mes según utilización)** — `computeEquipmentUnit`:

```
utilización          = min(utilización %, 100)
horas usadas/mes     = horas disponibles/mes × utilización%
días usados/mes      = días disponibles/mes × utilización%
$/mes                = posesión total + operación/h × horas usadas
$/hora usada         = $/mes / horas usadas
$/día usado          = $/mes / días usados
posesión por hora    = posesión total / horas usadas
```

**Ejemplo (hidrogrúa demo, ILUSTRATIVO):** reposición 250.000.000, residual 50.000.000, vida útil 10 años, seguro 6.000.000/año, patente 2.400.000/año, certificaciones 1.800.000/año, tasa de capital 0 %, mantenimiento 15.000/h, neumáticos 5.000/h, 12 L/h, combustible 1.500/L.

| Concepto | Valor |
|---|---:|
| Amortización = 200.000.000 / 120 | 1.666.666,67 |
| Seguro + patente + certificaciones | 850.000 |
| **Posesión total mensual** | **2.516.666,67** |
| Operación/h = 15.000 + 5.000 + 12 × 1.500 | 38.000 |
| Ficha: 300 h y 30 días disponibles, utilización 27 % → 81 h y 8,1 días usados | |
| $/mes = 2.516.666,67 + 38.000 × 81 | 5.594.666,67 |
| $/hora usada | 69.069,96 |
| $/día usado | 690.699,59 |

En la cotización demo (10 h por día activo): variable no combustible 200.000/día (Equipos) y combustible 180.000/día (Combustible).

## 5. Logística

Archivo: `js/engines/logistics-engine.js` (`computeLogistics`).

```
km de ruta por viaje        = distancia × (ida y vuelta ? 2 : 1)
km de ruta por activación   = km por viaje × viajes por activación
por vehículo:
  km por activación         = km de ruta por activación × cantidad de vehículos
  litros                    = km × consumo (L/100 km) / 100
  combustible               = litros × precio del combustible       (0 si lo provee el cliente)
  desgaste                  = km × costo por km (no combustible)
costo por activación        = Σ combustible + Σ desgaste + peajes + alojamiento/viáticos
activaciones/mes            = días activos / días por activación
costo mensual               = costo por activación × activaciones/mes
costo por día activo        = costo por activación / días por activación
km mensuales                = km de vehículos por activación × activaciones/mes
incidencia logística %      = costo logístico mensual / costo total × 100
```

- Viajes por activación vacío → 1. Ida y vuelta es el valor por defecto.
- "Sin traslados" (`notApplicable`) → todo en 0.
- La logística es 100 % **variable por día activo** (no tiene parte fija).
- En la EECC, el **combustible de traslados** se informa en **Combustible**; desgaste, peajes y viáticos en **Logística**. El indicador "Costo logístico mensual" y su incidencia incluyen ambos.

**Ejemplo demo (ILUSTRATIVO):** Neuquén Capital → Añelo 110 km, ida y vuelta, 1 viaje por activación, combustible 1.500/L.

| Vehículo | km | Litros | Combustible | Desgaste |
|---|---:|---:|---:|---:|
| Hidrogrúa (35 L/100 km, 150 $/km) | 220 | 77,0 | 115.500 | 33.000 |
| Vehículo de apoyo (12 L/100 km, 80 $/km) | 220 | 26,4 | 39.600 | 17.600 |
| **Por activación** | 440 | 103,4 | 155.100 | 50.600 |

Costo por activación 205.700; con 2 días por activación → 102.850 por día activo; con 4 activaciones → **822.800 por mes**.

## 6. Materiales y otros costos

Archivo: `js/engines/materials-engine.js` (`computeMaterialLine`, `computeMaterials`, `computeOtherCostLine`).

Materiales:

```
costo bruto          = cantidad × costo unitario × (1 + merma%) × (1 + logística%)
costo para nosotros  = 0              si lo provee el cliente
                     = costo bruto    si lo proveemos nosotros, un tercero contratado o no está definido
precio de reventa    = costo para nosotros × (1 + markup de reventa%)       (informativo, no suma ingresos)
```

Base de cálculo:

| Base | Resultado |
|---|---|
| `per_month` (por mes, valor por defecto) | fijo mensual |
| `per_active_day` | variable por día activo |
| `per_activation` | variable por día = costo / días por activación |

- Material sin responsable: se costea igual (criterio conservador) y el Cost Completeness Score lo marca en rojo.
- "El servicio no usa materiales" (`materialsNotApplicable`) → se ignoran las líneas.
- Ejemplo: electrodos 10 kg × 18.000 × 1,10 (merma) × 1,05 (logística) = **207.900 por día activo**; con markup de reventa 20 % el precio de reventa informativo sería 249.480.

**Otros costos** (terceros, subcontratos, montos manuales):

| Comportamiento | Resultado |
|---|---|
| `fixed_monthly` | fijo mensual = monto |
| `per_active_day` | variable por día = monto |
| `per_activation` | variable por día = monto / días por activación |

La categoría debe ser una de `labor`, `equipment`, `fuel`, `materials`, `logistics`, `structure` (si no, se usa `materials`). El grupo de pago sale de `CATEGORY_PAY_GROUP` (`js/domain/catalogs.js`).

## 7. Estructura (costos indirectos)

Archivo: `js/engines/cost-engine.js` (dentro de `buildCostModel`).

**Base directa** = todas las líneas de costo directo **excepto** las cargadas con categoría Estructura (personal, standby, equipos, combustible, logística, materiales y otros costos). **Base de mano de obra** = líneas de categoría Mano de obra (incluye standby y otros costos de categoría personal).

| Método (`indirect.method`) | Fijo mensual | Variable por día activo |
|---|---|---|
| `percent_direct` — % sobre costo directo | directos fijos × % | directos variables × % |
| `percent_labor` — % sobre mano de obra | mano de obra fija × % | mano de obra variable × % |
| `per_employee` — monto por empleado | monto × dotación (personas de las líneas de personal) | 0 |
| `per_contract` — monto por contrato | monto | 0 |
| `per_hour` — monto por hora operativa | 0 | monto × horas por día activo |
| `manual` — monto mensual manual | monto | 0 |

La estructura es salida de caja (grupo de pago "Estructura y alquileres") y por lo tanto se financia.

Ejemplo demo: `percent_direct` 12 % sobre directos fijos 7.259.304,67 y directos variables 658.458,70/día → estructura **871.116,56 fijo + 79.015,04 por día activo**.

## 8. Financiero y capital de trabajo

Archivo: `js/engines/finance-engine.js` (`financingDays`, `simpleFinancialCost`, `computeFinance`).

Cada costo en efectivo se paga X días después de incurrido; el servicio se factura Z días (promedio) después de prestado y el cliente paga Y días después de facturado. Para cada grupo de pago `g` (salarios, combustible, proveedores, materiales, estructura):

```
días financiados_g   = max(0, Z + Y − X_g)
                       Z = días promedio hasta facturar   (finance.invoiceLagDays)
                       Y = plazo de cobro del cliente     (finance.paymentTermDays)
                       X_g = días de pago del grupo       (finance.payDays[g])

capital de trabajo   = Σ costo en efectivo_g × días financiados_g / 30
costo financiero     = Σ costo en efectivo_g × tasa mensual% × días financiados_g / 30
impacto en margen    = costo financiero / facturación total × 100        (puntos de margen)
```

- **Interés simple**, mes financiero de 30 días (`DAYS_PER_MONTH_FINANCE`).
- **No se financian**: la amortización ni el costo de capital de equipos (no son salidas de caja) ni la **contingencia** (es una reserva, no un pago).
- Se calcula por separado para la parte fija y la parte variable por día, así que el costo financiero también escala con `D`.
- Plazo de cobro vacío: se calcula con 0 días, y el Cost Completeness Score lo marca en rojo ("Plazo de pago sin definir").
- Una cotización nueva en blanco toma el plazo por defecto de la configuración (`settings.defaultPaymentTermDays`) **sólo si la configuración es propia** (`settings.illustrative !== true`). Con la configuración ILUSTRATIVA de la demo el plazo queda en `null` (sin definir) para que el usuario lo cargue.

**Ejemplo demo (ILUSTRATIVO):** facturación a 15 días, cobro a 90 días, tasa 3 % mensual.

| Grupo | Días de pago | Días financiados |
|---|---:|---:|
| Salarios y cargas | 20 | 15 + 90 − 20 = 85 |
| Combustible | 0 | 105 |
| Proveedores | 30 | 75 |
| Materiales | 30 | 75 |
| Estructura y alquileres | 20 | 85 |

Ejemplo de un grupo: salarios fijos 3.367.638 × 3 % × 85/30 = 286.249. Total del caso demo con 8 días: costo financiero ≈ **995.025/mes**, capital de trabajo ≈ 33.167.510, impacto ≈ 5,68 puntos de margen.

## 9. Contingencia

Archivo: `js/engines/cost-engine.js` (`contingencyPctOf`).

```
contingencia %  = contingencia general % + Σ % de los ítems de riesgo habilitados
contingencia    = contingencia % × (directos + estructura + financiero)      (fijo y variable por separado)
```

Ítems de riesgo (`RISK_ITEMS`): variación de actividad, improductivos, clima, retrabajos, rotura de equipos, variación de precios, inflación, logística, penalidades, garantía, accidentes, incertidumbre del alcance. Ejemplo demo: 2 + 1 + 1 + 1 = **5 %**.

En una cotización nueva en blanco, la contingencia general toma `settings.defaultContingencyPct` sólo si la configuración es propia; con la configuración ILUSTRATIVA de la demo empieza en **0 %** y el Cost Completeness Score la marca en naranja hasta que se defina.

## 10. Costo total y estructura de costos (EECC)

Archivo: `js/engines/cost-engine.js` (`costAtActivity`, `costStructure`, `traceTotalCost`).

```
monto_c      = fijo_c × factorMeses(D) + variable_c × D          para cada categoría c
costo total  = Σ monto_c
costo/día    = costo total / D                                    (null si D = 0)
incidencia_c = monto_c / costo total × 100
```

Mapeo de categorías:

| Categoría | Incluye |
|---|---|
| Mano de obra | personal (fijo y variable), standby, otros costos "personal" |
| Equipos | posesión, mantenimiento y neumáticos, otros costos "equipos" |
| Combustible | combustible operativo de equipos + **combustible de traslados**, otros costos "combustible" |
| Materiales | materiales, otros costos "materiales" |
| Logística | desgaste por km, peajes, alojamiento/viáticos, otros costos "logística" |
| Estructura | absorción de estructura + otros costos "estructura" |
| Financiero | costo financiero (§8) |
| Contingencia | contingencia (§9) |

**Incidencia mostrada = 100 %.** `displayPct` se redondea a 2 decimales con el **método del mayor resto** (`roundPercentagesToTotal` en `js/core/money.js`): se reparten centésimas enteras proporcionalmente, se asignan los pisos y las centésimas faltantes van a las categorías con mayor resto (desempate por orden). Así la suma mostrada es exactamente 100,00 %. Ejemplo: tres categorías iguales → 33,34 % + 33,33 % + 33,33 %. Si el costo total es 0, todas las incidencias son 0 % y el total es 0 %.

EECC del caso demo con 8 días (ILUSTRATIVO):

| Categoría | Monto | Incidencia |
|---|---:|---:|
| Mano de obra | 4.284.508 | 27,16 % |
| Equipos | 5.335.667 | 33,82 % |
| Combustible | 2.204.400 | 13,97 % |
| Materiales | 500.000 | 3,17 % |
| Logística | 202.400 | 1,28 % |
| Estructura | 1.503.237 | 9,53 % |
| Financiero | 995.025 | 6,31 % |
| Contingencia | 751.262 | 4,76 % |
| **Total** | **15.776.498** | **100,00 %** |

## 11. Margen vs markup

Archivo: `js/engines/pricing-engine.js`. **Margen y markup NUNCA son sinónimos.**

```
Margen (sobre precio de venta)   margen = (precio − costo) / precio
                                 precio = costo / (1 − margen)
Markup (sobre costo)             markup = (precio − costo) / costo
                                 precio = costo × (1 + markup)
Conversiones                     markup = margen / (1 − margen)
                                 margen = markup / (1 + markup)
```

| Costo | Porcentaje | Precio por margen | Precio por markup |
|---:|---:|---:|---:|
| 100 | 10 % | **111,11** | **110,00** |

Margen 10 % ≡ markup 11,11 %. Markup 10 % ≡ margen 9,09 %.

Validaciones (`isValidMarginPct`): el margen debe cumplir `0 ≤ margen < 100`; fuera de ese rango `priceFromMargin` y `marginToMarkup` devuelven `null`. `priceFromMarkup` acepta markup ≥ −100. `marginFromPrice` devuelve `null` si el precio es 0; `markupFromPrice`, si el costo es 0.

Escalera de precios (`priceLadder`): tarifa piso (margen 0), margen 5 %, 10 %, 15 % (`DEFAULT_MARGIN_LADDER` o `settings.marginLadder`) y margen personalizado (si es válido, mayor a 0 y no está en la escalera). Para costo 100: 100,00 / 105,26 / 111,11 / 117,65 / personalizado 20 % → 125,00 (markups equivalentes 0 / 5,26 / 11,11 / 17,65 / 25 %).

`traceMarginVsMarkup(costo, %)` arma la traza "Margen vs markup" con ambos precios y la diferencia, con **2 decimales** (formato `money2`) para que se vea la regla protegida: costo $ 100,00 → margen 10 % $ 111,11, markup 10 % $ 110,00, diferencia $ 1,11.

## 12. Unidades, reglas comerciales y facturación

Archivo: `js/engines/commercial-rules-engine.js` (`billableUnits`, `normalizeRules`, `computeRevenue`, `discountFactor`).

### Unidades facturables

```
activaciones = D / días por activación
```

| Unidad (`quote.unit`) | Unidades por activación | Unidades facturables |
|---|---|---|
| `day` ($/día) | días por activación | activaciones × max(unidades por activación, minimum call) |
| `hour` ($/hora) | días por activación × horas por día activo | activaciones × max(unidades por activación, minimum call) |
| `month` ($/mes, abono) | — | meses = max(1, D / días disponibles); sin minimum call ni tramos |

Los "días facturables" (para elegir el tramo de descuento) son las unidades en `day`, y unidades / horas por día en `hour`.

**Minimum call** (`rules.minimumCallUnits`): mínimo de unidades facturables **por activación**. Ejemplo: tarifa por hora, 1 día por activación de 4 h, minimum call 8 h, 8 días activos → 8 activaciones × 8 h = **64 h facturables** (en vez de 32).

### Facturación del mes con D días

```
meses              = max(1, D / días disponibles)
factor descuentos  = (1 − tramo%) × (1 − continuidad%) × (1 − comercial%)
tarifa neta        = tarifa de lista × factor descuentos

base               = tarifa neta × unidades facturables
fee disponibilidad = fee mensual × meses
call-out           = fee por activación × activaciones
movilización       = monto por activación × activaciones
km adicional       = max(0, km de ruta por activación − km incluidos) × $/km × activaciones
standby (ingreso)  = días de standby × tarifa standby × meses
otros ingresos     = fee disponibilidad + call-out + movilización + km adicional + standby
subtotal           = base + otros ingresos
mínimo garantizado = mínimo mensual × meses
ajuste por mínimo  = max(0, mínimo garantizado − subtotal)
facturación total  = subtotal + ajuste por mínimo
```

- Los descuentos se **multiplican**, no se suman: 5 % de tramo, 3 % de continuidad y 2 % comercial dan un factor 0,90307 (no 0,90).
- El km adicional usa los km **de ruta** (no se multiplica por la cantidad de vehículos).
- Todas las reglas son opcionales: 0 = no aplica. Valores negativos o vacíos se toman como 0; los descuentos se limitan a 0–100 %.

### Reglas comerciales soportadas

| Regla | Campo | Efecto |
|---|---|---|
| Minimum call | `minimumCallUnits` | mínimo de unidades facturables por activación |
| Standby | `standbyDaysPerMonth`, `standbyRatePerDay`, `standbyNotApplicable` | ingreso = días × tarifa × meses; costo = días × variable de personal (§3). Con "No aplica standby" (`standbyNotApplicable = true`) días y tarifa se toman como 0: ni costo ni ingreso, aunque los campos tengan valores |
| Call-out fee | `calloutFeePerActivation` | monto × activaciones |
| Movilización | `mobilizationFeePerActivation` | monto × activaciones |
| Km adicional | `includedKmPerActivation`, `extraKmRate` | (km de ruta − km incluidos) × $/km × activaciones |
| Descuento por cantidad de días | `volumeTiers` | ver §14 |
| Descuento por continuidad | `continuityMinMonths`, `continuityDiscountPct` | ver §14 |
| Mínimo mensual garantizado | `minimumMonthlyGuarantee` | la facturación del mes nunca es menor (× meses) |
| Fee de disponibilidad | `availabilityFeeMonthly` | monto mensual fijo (× meses) |
| Descuento comercial | `pricing.commercialDiscountPct` | multiplica el factor de descuentos |

## 13. Tarifa piso, precio objetivo y precio comercial

Archivos: `js/engines/commercial-rules-engine.js` (`requiredNetRate`, `listRateFromNet`), `js/engines/economics-engine.js` (`requiredRatesAt`, `evaluateAt`), `js/engines/quote-engine.js` (`computeQuote`).

| Concepto | Definición |
|---|---|
| **COSTO** | Costo(D) del mes (§10). |
| **TARIFA PISO** | Tarifa **neta** por unidad que iguala la facturación con el costo (margen 0). |
| **PRECIO OBJETIVO** | Tarifa por unidad que logra el margen objetivo (`pricing.targetMarginPct`). |
| **PRECIO COMERCIAL** | Tarifa **de lista** finalmente ofrecida al cliente. |

Tarifa neta necesaria para un margen `m` sobre la facturación total:

```
facturación necesaria = Costo(D) / (1 − m)
tarifa neta(m)        = (facturación necesaria − otros ingresos(D)) / unidades facturables(D)
tarifa de lista(m)    = tarifa neta(m) / factor de descuentos
tarifa piso           = tarifa neta(0)
```

- Si las unidades facturables son 0 (por ejemplo, 0 días), la tarifa es `null` ("—").
- Si los otros ingresos ya cubren la facturación necesaria, la tarifa es 0 y se marca `coveredByOtherRevenue`.
- Si el factor de descuentos es 0 (descuento 100 %), la tarifa de lista es `null`.
- El **mínimo garantizado NO se usa** para calcular tarifas necesarias (criterio conservador: no se cuenta con un ingreso que sólo aparece si la actividad es baja). Sí se usa al evaluar el resultado y el break-even con una tarifa dada; por eso la alerta `belowFloor` exige además que el mes dé pérdida (§20).
- Margen objetivo inválido (vacío, < 0 o ≥ 100) → se usa 0. Margen personalizado inválido o 0 → no se muestra.

**Tarifa comercial sugerida** = tarifa objetivo de lista redondeada **hacia arriba** al múltiplo de `pricing.roundingStep` (`commercialRound`; paso 0 = sin redondeo). Nunca baja el margen. Ejemplo demo: 2.258.948,79 → **2.259.000** con paso 1.000.

**Tarifa comercial (de lista) usada para evaluar**, en orden de prioridad (`kpis.commercialSource`):

1. `override`: tarifa forzada por el motor de sensibilidad (tarifa fija, §17).
2. `known_rate`: modalidad "Conozco la tarifa" → `pricing.knownRate` (si es > 0).
3. `offered`: `pricing.offeredRateOverride` (si es > 0).
4. `suggested`: tarifa comercial sugerida.
5. `none`: no hay tarifa (también cuando la fuente elegida no da una tarifa mayor a 0, por ejemplo "Conozco la tarifa" sin tarifa cargada).

Con esa tarifa: tarifa neta comercial = lista × factor de descuentos (con el tramo que corresponda a la actividad estimada), facturación, `resultado = facturación − costo`, margen = resultado / facturación y markup = resultado / costo.

Equivalencias informativas (`result.equivalents`):

| Unidad | $/hora | $/día | $/mes |
|---|---|---|---|
| `day` | tarifa / horas por día activo | tarifa | facturación total |
| `hour` | tarifa | tarifa × horas por día activo | facturación total |
| `month` | — | tarifa / D | facturación total |

**Modo A — "Conozco la tarifa"** (`known_rate`): se ingresa la tarifa y RATEOS calcula días mínimos (break-even), días para el margen objetivo, resultado y margen esperados. **Modo B — "Conozco la actividad"** (`known_activity`): se ingresa la actividad estimada y RATEOS calcula tarifa piso y tarifas con margen 5 %, 10 %, 15 % y personalizado.

Ejemplo demo (modo B, 8 días, ILUSTRATIVO): tarifa piso neta ≈ 1.972.062/día; con el tramo 8–15 días (3 % de descuento) la piso de lista ≈ 2.033.054; objetivo 10 % neta ≈ 2.191.180, de lista ≈ 2.258.949; sugerida 2.259.000; facturación ≈ 17.529.840; resultado ≈ 1.753.342; margen ≈ 10,00 %; markup ≈ 11,11 %.

**Neta y de lista.** La tarifa que se escribe en la cotización es la **de lista**; la neta es lo que efectivamente se cobra después de descuentos (`neta = lista × factor de descuentos`). Para comparar con la tarifa conocida o la ofrecida hay que usar la tarifa de lista: cobrar como lista la tarifa piso **neta** (1.972.062 en la demo) deja un resultado negativo porque después se le aplica el descuento del tramo (resultado ≈ −473.297, margen ≈ −3,09 %).

**Traza "Tarifa piso"** (`traces.floorRate`): entradas costo total, otros ingresos, unidades facturables y factor de descuentos (tramo × continuidad × comercial); paso intermedio "Tarifa piso neta"; resultado "Tarifa piso de lista". Fórmula: `Tarifa piso neta = (Costo total − Otros ingresos) / Unidades facturables · Tarifa piso de lista = neta / factor de descuentos`. Así el "Ver cálculo" termina en el mismo número que se muestra como tarifa piso de lista (2.033.054 en la demo).

**Presentación hacia arriba.** Las tarifas mínimas (piso, objetivo y sugerida) que se muestran sin decimales se redondean **hacia arriba** con `formatMoneyCeil` (`js/core/format.js`): cobrar la cifra que se ve nunca deja debajo del piso o del objetivo. Ejemplo con redondeo comercial 0 (caso de referencia con 10 días): tarifa objetivo 4.444.444,44 → se muestra **$ 4.444.445** (con `formatMoney` se vería $ 4.444.444, que cobrado da un margen de 9,99999 %, "debajo del objetivo", y 11 días enteros para el margen objetivo en lugar de 10). El valor interno del motor no cambia.

## 14. Descuentos por volumen y continuidad

Archivos: `js/engines/commercial-rules-engine.js` (`DEFAULT_VOLUME_TIERS` —definidos en `js/domain/catalogs.js` y re-exportados—, `normalizeTiers`, `findVolumeTier`, `tierLabel`, `classifyDiscount`, `continuityApplies`), `js/engines/quote-engine.js` (`evaluateDiscountTiers`, `minActiveDaysForBillableDays`).

**Tramos por defecto** (0 % de descuento): 1 día · 2–7 días · 8–15 días · 16–30 días · +30 días (`fromDays` 31, `toDays` vacío).

**Búsqueda del tramo** (`findVolumeTier`): los tramos se ordenan por "desde"; aplica **el último tramo cuyo "desde" sea ≤ días facturables** (tolerancia 1e-9). Con 0 días no hay tramo. El "hasta" sólo se usa para la etiqueta: 7,5 días cae en el tramo 2–7. Con unidad `month` no se aplican tramos. Los tramos que no son objetos se ignoran; si no queda ninguno se usan los tramos por defecto.

**Evaluación de cada tramo** (`evaluateDiscountTiers`): cada tramo se evalúa en su **peor caso**: la **menor cantidad de días activos** con la que ya se alcanza el "desde" del tramo en días **facturables**. Con menos días activos los fijos se reparten entre menos unidades. Como el tramo se elige por días facturables y, con minimum call, cada activación factura más días de los que se trabajan, el peor caso puede tener menos días activos que el "desde" del tramo (`minActiveDaysForBillableDays`):

```
b   = max(desde del tramo, 1)                 días facturables que activan el tramo
dpa = días por activación · h = horas por día activo · mc = minimum call (unidades por activación)

unidad day:   días evaluados = b × dpa / max(dpa, mc)
unidad hour:  días evaluados = b × dpa × h / max(dpa × h, mc)      (si h = 0: b)
```

Sin minimum call efectivo (`mc ≤ unidades por activación`) los días evaluados son `b`. Con el tramo forzado se calculan:

```
tarifa neta del tramo  = tarifa de lista × factor (tramo × continuidad × comercial)
tarifa piso neta       = tarifa neta(0) con esos días
tarifa objetivo neta   = tarifa neta(margen objetivo) con esos días
```

Cada tramo informa `evaluatedDays`, la tarifa neta, la piso y la objetivo netas, el resultado y el margen con esos días, y el semáforo.

**Ejemplo con minimum call** (caso de referencia: fijos 30.000.000, variable 1.000.000/día, lista 4.000.000/día, 1 día por activación, minimum call 2 días, tramos 8–15 y 16–30 con 20 %): el tramo 8–15 se aplica desde 8 días **facturables**, que se alcanzan con sólo **4 días activos** (4 activaciones × 2 días facturables). Evaluado con 4 días: resultado −8.400.000, margen −32,81 % → **rojo**. (Antes se evaluaba con 8 días activos —16 facturables, que en realidad caen en el tramo 16–30— y salía verde.) El tramo 16–30 se evalúa con 8 días activos: resultado 13.200.000 → verde.

**Semáforo** (`classifyDiscount`), con tolerancia `max(1e-6, |piso| × 1e-9)`:

| Color | Condición |
|---|---|
| Verde | tarifa neta ≥ tarifa objetivo neta → mantiene el margen objetivo |
| Naranja | tarifa piso neta ≤ tarifa neta < tarifa objetivo neta → debajo del margen objetivo |
| Rojo | tarifa neta < tarifa piso neta → debajo de break-even (pierde dinero) |
| `unknown` | no hay tarifa o piso calculable |

Ejemplo demo (lista 2.259.000; tramos 3 % / 5 % / 8 % ILUSTRATIVOS; minimum call 1 día con 2 días por activación, así que no cambia los días evaluados):

| Tramo | Días evaluados | Desc. | Neta | Piso neta | Objetivo neta | Estado |
|---|---:|---:|---:|---:|---:|---|
| 1 día | 1 | 0 % | 2.259.000 | 9.874.544 | 10.971.715 | Rojo |
| 2–7 días | 2 | 0 % | 2.259.000 | 5.358.840 | 5.954.267 | Rojo |
| 8–15 días | 8 | 3 % | 2.191.230 | 1.972.062 | 2.191.180 | Verde |
| 16–30 días | 16 | 5 % | 2.146.050 | 1.407.599 | 1.563.999 | Verde |
| +30 días | 31 | 8 % | 2.078.280 | 1.144.183 | 1.271.315 | Verde |

**Descuento por continuidad** (`continuityApplies`): aplica si `continuityDiscountPct > 0`, `continuityMinMonths > 0` y `contractMonths ≥ continuityMinMonths`. Se multiplica en el factor de descuentos. Si aplica y hay tarifa, `result.continuity.status` usa el mismo semáforo comparando la tarifa neta con la piso y la objetivo de la actividad estimada.

## 15. Break-even y días para margen objetivo

Archivo: `js/engines/break-even-engine.js` (`breakEvenSimple`, `minimumRateForDays`, `findBreakEvenDays`, `traceBreakEven`), `js/engines/economics-engine.js` (`linearDecomposition`).

### Fórmula cerrada

```
contribución por día = tarifa por día − costo variable por día
break-even (días)    = costos fijos / contribución por día
días enteros         = ceilTolerant(break-even)       (10,0000000001 → 10, no 11)
```

- Fijos = 0 → break-even 0 días.
- Contribución ≤ 0 → **inalcanzable**: "La tarifa no cubre el costo variable por día: nunca se alcanza el equilibrio."

**Problema inverso** (`minimumRateForDays`): `tarifa mínima = costos fijos / días + costo variable por día`. Ejemplo: fijos 30.000.000, variable 1.000.000, 6 días → **6.000.000/día** (D ≤ 0 → `null`).

### Algoritmo numérico robusto (el que usa `computeQuote`)

Con reglas comerciales (mínimo garantizado, tramos, minimum call, fees) el resultado deja de ser lineal en D. `findBreakEvenDays(resultado(D), { maxDays })`:

1. Evalúa una grilla de paso **0,1 día** entre 0 y `maxDays` (= días disponibles del mes).
2. Toma el **último** punto con resultado negativo (tolerancia `PROFIT_TOLERANCE` = 1e-6).
3. Refina por **bisección** entre ese punto y el siguiente (hasta 80 iteraciones o 1e-10).
4. Si el resultado está a menos de 1e-7 de un entero que cumple, devuelve el entero exacto.

**Definición:** break-even = menor D **a partir del cual ya no se pierde**: resultado(D) ≥ 0 y se mantiene ≥ 0 hasta los días disponibles. Casos:

- Ningún punto negativo → 0 días.
- El último punto (días disponibles) es negativo → **inalcanzable**: "No se alcanza el equilibrio dentro de los N días disponibles del mes."
- Unidad `month` → no aplica ("Con abono mensual la facturación no depende de los días activos").
- Sin tarifa → no se puede calcular.

**Ejemplos de la definición robusta** (golden cases):

- Fee de disponibilidad 6.000.000/mes sobre el caso básico: break-even = (30.000.000 − 6.000.000) / (4.000.000 − 1.000.000) = **8 días**.
- Mínimo garantizado 35.000.000/mes sobre el caso básico: facturación = max(35.000.000, 4.000.000 × D). Con menos de 5 días se gana (el mínimo cubre los costos), entre 5 y 10 días se pierde y desde 10 días ya no se pierde → break-even robusto **10 días** (no 0). Con 8 días se facturan 35.000.000 y se pierden 3.000.000.

**Días para margen objetivo** (`kpis.targetMarginDays`): misma búsqueda sobre `resultado(D) − margen objetivo × facturación(D) ≥ 0`. Caso básico con margen 10 %: 2,6 × D − 30 ≥ 0 (en millones) → ≈ 11,54 días (12 enteros).

**Traza "Ver cálculo"** (`traceBreakEven` + `linearDecomposition`): muestra costos fijos, ingresos fijos (fee de disponibilidad + standby), ingreso por tarifa por día activo (tarifa neta por unidad × unidades del día; con unidad hora es un valor **por día**, no por hora), otros ingresos por día activo, costo variable por día y contribución:

```
break-even = (costos fijos − ingresos fijos) / (ingreso por día − costo variable por día)
```

La descomposición (`result.linear`) se evalúa **en el punto de equilibrio** (`max(break-even, 1)` días) cuando el break-even se alcanza y es mayor a 0, porque ahí rige el tramo de descuento que realmente aplica; si no, se evalúa con la actividad estimada. Así las entradas de la traza dan el resultado informado. Si hay reglas no lineales (mínimo garantizado, minimum call aplicado o algún tramo con descuento), la traza lo aclara: el resultado se calculó día a día, no sólo con la fórmula.

**Ejemplo demo (ILUSTRATIVO):** el equilibrio cae en ≈ 6,38 días, dentro del tramo **2–7 días (0 % de descuento)**: tarifa neta = lista = 2.259.000/día. Fijos ≈ 9.031.407, variable ≈ 843.136/día → contribución ≈ 1.415.864/día → break-even = 9.031.407 / 1.415.864 ≈ **6,38 días** (7 días enteros). Con los 8 días estimados (tramo 8–15, neta 2.191.230) la contribución sería 1.348.094 y la fórmula daría 6,70: por eso la traza no usa la actividad estimada. Días para margen 10 % ≈ 7,59 (8 enteros).

## 16. Utilización y matriz tarifa × utilización

Archivo: `js/engines/utilization-engine.js` (`utilizationPct`, `activeDaysFromUtilization`, `matrixDays`, `buildRateUtilizationMatrix`).

```
utilización %                = días activos / días disponibles × 100      (null si no hay disponibilidad)
días activos (utilización u) = min(max(u, 0), 100) / 100 × días disponibles
tarifa necesaria(D, m)       = (Costo(D) / (1 − m) − otros ingresos(D)) / unidades(D)
```

Con tarifa por día o por hora, a mayor utilización, menor tarifa unitaria necesaria (los fijos se reparten entre más días); a menor utilización, mayor tarifa. **Con abono mensual (`month`) es al revés:** se factura 1 abono por mes sea cual sea D (hasta los días disponibles), así que el abono necesario `Costo(D) / (1 − m)` **crece** con los días porque crece el costo variable. Ejemplo (caso de referencia en $/mes): piso 35.000.000 / 38.000.000 / 40.000.000 / 45.000.000 / 50.000.000 para 5 / 8 / 10 / 15 / 20 días.

**Días de la matriz** (`matrixDays`): los configurados (`settings.matrixDays`, por defecto `DEFAULT_MATRIX_DAYS` = 5, 8, 10, 15, 20) + la actividad estimada si es > 0; sin duplicados, ordenados. Márgenes: `settings.marginLadder` (por defecto 5, 10, 15) + el personalizado.

Cada fila tiene: días, utilización %, tarifa piso neta, tarifas neta y de lista por margen (con el tramo de esos días), costo y, si hay tarifa comercial, facturación, resultado, margen y descuento del tramo. Marca la fila de la actividad estimada (`isEstimate`) y las que superan los días disponibles (`exceedsAvailability`).

Ejemplo (caso de referencia: fijos 30.000.000, variable 1.000.000/día, tarifa 4.000.000/día, sin reglas):

| Días | Utilización | Tarifa piso | Tarifa margen 10 % | Facturación | Costo | Resultado |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 16,67 % | 7.000.000 | 7.777.778 | 20.000.000 | 35.000.000 | −15.000.000 |
| 8 | 26,67 % | 4.750.000 | 5.277.778 | 32.000.000 | 38.000.000 | −6.000.000 |
| 10 | 33,33 % | 4.000.000 | 4.444.444 | 40.000.000 | 40.000.000 | 0 |
| 15 | 50,00 % | 3.000.000 | 3.333.333 | 60.000.000 | 45.000.000 | 15.000.000 |
| 20 | 66,67 % | 2.500.000 | 2.777.778 | 80.000.000 | 50.000.000 | 30.000.000 |

## 17. Sensibilidad, escenarios y comparador de modelos

Archivo: `js/engines/scenario-engine.js`.

### Sensibilidad (`applySensitivity`, `runSensitivity`, `sensitivityTable`)

Regla clave: **la tarifa comercial se mantiene fija** (la del caso base, vía `listRateOverride`) para ver el impacto real de cada variable. Si el caso base no tiene tarifa, el escenario usa su propia tarifa sugerida.

| Variable (`SENSITIVITY_VARIABLES`) | Qué modifica (sobre una copia de la cotización) |
|---|---|
| `salariesPct` | básico y adicionales × (1 + Δ%) (no los conceptos no remunerativos) |
| `fuelPct` | precio del combustible × (1 + Δ%) |
| `materialsPct` | costo unitario de materiales y otros costos de categoría materiales × (1 + Δ%) |
| `activityPct` | sólo si Δ ≠ 0: días activos × (1 + Δ%), con tope en `max(días disponibles, días activos base)` (nunca recorta una base que ya supera los disponibles). Con Δ = 0 los días activos no se tocan |
| `paymentTermDays` | plazo de cobro + Δ días (mínimo 0) |
| `commercialDiscountPct` | descuento comercial + Δ puntos (entre 0 y 100) |

El factor nunca es negativo: `max(0, 1 + Δ%)`. Rangos de los sliders: `SENSITIVITY_RANGES` en `js/config.js`. Los días disponibles son los mismos que usa el motor (0 o inválido → 30).

**Sin variaciones, el escenario es idéntico a la base**, aun si los días activos superan los disponibles. Ejemplo (caso de referencia con 35 días activos y 30 disponibles): `runSensitivity(q, {})` da Δ resultado = 0 (antes recortaba a 30 días y daba −10.000.000); con +20 % de actividad los días siguen en 35 (tope = max(30, 35)); con −20 % bajan a 28; el escenario optimista (+25 %) da el mismo resultado que la base (70.000.000), nunca menos.

- `runSensitivity(quote, deltas)` devuelve el caso base, el caso sensibilizado (costo total, tarifa piso, tarifa objetivo, facturación, resultado, margen, break-even, días para margen objetivo, utilización, tarifa efectiva) y la diferencia de cada indicador.
- `sensitivityTable(quote)` (tipo tornado) mueve cada variable por separado, hacia abajo y hacia arriba (por defecto ±10 % salarios, combustible y materiales; ±20 % actividad; ±30 días de plazo; ±5 puntos de descuento, omitiendo el descuento negativo si el del caso base es 0) y reporta los indicadores de cada variante y la variación del resultado.

### Escenarios (`runScenarios`)

Pesimista / base / optimista con `settings.scenarios` o `DEFAULT_SCENARIOS`:

| Escenario | Actividad | Salarios | Combustible | Materiales | Plazo de cobro |
|---|---:|---:|---:|---:|---:|
| Pesimista | −25 % | +10 % | +10 % | +10 % | +30 días |
| Base | — | — | — | — | — |
| Optimista | +25 % | −5 % | −5 % | −5 % | +0 días |

Cada escenario informa costo total, facturación, resultado, margen, utilización, tarifa efectiva por día activo (facturación / días activos), break-even y días para margen objetivo, con la tarifa comercial del caso base.

### Comparador de modelos comerciales (`compareCommercialModels`)

Compara cuatro formas de cobrar el mismo servicio (tarifa por día). Requiere actividad estimada `De > 0` y margen objetivo válido. Con `k = 1 − margen`, `C(D)` = costo total con D días, `Fijos = C(0)`, `v` = costo variable por día y `Dp = max(0, De × (1 + actividad pesimista%))` (por defecto −25 %), cada modelo se **calibra** para lograr el margen objetivo con la actividad estimada:

| Modelo | Facturación R(D) | Calibración |
|---|---|---|
| Sólo tarifa por día | `p × D` | `p = C(De) / (k × De)` |
| Fee de disponibilidad + tarifa por día | `Fee × factorMeses(D) + q × D` | `Fee = Fijos / k`, `q = v / k` |
| Mínimo garantizado + tarifa por día | `max(G × factorMeses(D), p × D)` | `G = Fijos` |
| Paquete mensual + excedentes | `Paquete + p × max(0, D − De)` | `Paquete = C(De) / k` |

El fee y el mínimo garantizado son montos mensuales: igual que los costos fijos (§1) y que `computeRevenue` (§12), se multiplican por `factorMeses(D)` cuando los días superan los disponibles. Así `R(D) = C(D) / k` también con `De` mayor a los días disponibles y los cuatro modelos logran el margen objetivo con la actividad estimada (ejemplo: caso de referencia con De = 35 y 30 disponibles → los 4 modelos dan margen 10 % y facturan ≈ 77.777.778; antes "Fee + tarifa" daba 3,08 %).

Para cada modelo: ingreso, resultado y margen esperados (con `De`), ingreso, resultado y margen pesimistas (con `Dp`), **ingreso mínimo asegurado** = R(0), break-even con el algoritmo numérico (§15) y **riesgo**: alto si el resultado pesimista es negativo; medio si el margen pesimista es menor a la mitad del objetivo; bajo en otro caso. El comparador usa una facturación simplificada (sin tramos, fees ni descuentos de la cotización) para comparar los modelos entre sí.

Ejemplo (caso de referencia, margen 10 %, De = 8, Dp = 6): `p ≈ 5.277.778`, `Fee ≈ 33.333.333` + `q ≈ 1.111.111`, `G = 30.000.000`, `Paquete ≈ 42.222.222`. Todos facturan ≈ 42.222.222 con 8 días; break-even ≈ 7,01 días para "sólo tarifa" y "mínimo garantizado" (riesgo alto) y 0 días para "fee + tarifa" y "paquete" (riesgo bajo).

## 18. Redondeos y precisión

Archivo: `js/core/money.js` (cálculo) y `js/core/format.js` (presentación).

| Función | Uso | Precisión |
|---|---|---|
| `roundMoney` | montos | 2 decimales |
| `roundRate` | tarifas y costos unitarios ($/hora, $/km, $/L) | 4 decimales |
| `roundPercentage` | porcentajes en puntos | 2 decimales |
| `roundDays` | días | 2 decimales |
| `roundTo` | base de las anteriores | "half away from zero", robusto a errores binarios (1,005 → 1,01) |
| `ceilTolerant` | días enteros | `ceil(x − 1e-9)` |
| `roundUpToStep` | redondeo comercial | múltiplo superior de un paso |
| `roundPercentagesToTotal` | incidencias de la EECC | mayor resto, suma exacta 100 |
| `safeDivide` | divisiones | divisor 0 o no finito → `null` (o el fallback indicado) |

- **Valor interno vs valor mostrado:** los motores nunca redondean resultados intermedios. `formatMoney` muestra montos sin decimales (redondeando `roundMoney`), `formatValue(v, 'money2')` con 2 decimales, `formatValue(v, 'rate')` 2 decimales si el valor es menor a 100, `formatPercent` 2 decimales y `formatDays` hasta 2 decimales.
- **Tarifas mínimas hacia arriba:** `formatMoneyCeil(v)` (o `formatValue(v, 'moneyCeil')`) muestra sin decimales redondeando **hacia arriba** (`ceil(v − 1e-9)`): 4.444.444,44 → $ 4.444.445; 2.258.948,79 → $ 2.258.949; 2.259.000 → $ 2.259.000. Se usa para piso, objetivo y sugerida, para que la cifra que se ve nunca quede debajo del mínimo (misma regla que el redondeo comercial: nunca baja el margen).
- **Números ingresados por el usuario:** `parseDecimalInput` (`js/core/validation.js`) interpreta el formato argentino: punto = miles, coma = decimal. `"1.800.000"` → 1.800.000; `"1.800.000,50"` y `"1800000,50"` → 1.800.000,5; `"8,5"` y `"8.5"` → 8,5; `"1.800"` → 1.800 (un punto seguido de grupos de 3 dígitos es separador de miles); `"$ 250.000"` → 250.000 (se ignoran `$`, `%` y espacios). Formatos ambiguos o inválidos (`"1,234.56"`, `"1.2.3"`, `"1e5"`) → error "Ingresá un número válido (usá coma para decimales y punto para miles, p. ej. 1.800.000,50)". Los campos muestran el valor guardado con coma decimal y sin separador de miles (`numberToInputText`), para que se vuelva a leer igual.
- Tolerancia numérica de los motores: `NUMERIC_EPSILON = 1e-9` (`js/config.js`).
- Cualquier valor no finito se muestra como "—" (`EMPTY`).

## 19. Cost Completeness Score

Archivo: `js/engines/completeness-engine.js` (`evaluateCompleteness`). Reglas determinísticas con peso y estado:

| Estado | Color | Aporta |
|---|---|---|
| `ok` | verde | 100 % del peso |
| `warning` | naranja | 50 % del peso |
| `missing` | rojo | 0 |
| no aplica | — | no participa |

```
score % = Σ peso obtenido / Σ peso aplicable × 100
```

| # | Regla (`id`) | Aplica cuando | Peso | Estado |
|---|---|---|---:|---|
| 1 | `modality` | siempre | 2 | ok si el tipo de servicio y la modalidad son válidos; si no, rojo |
| 2 | `rate` | modalidad "Conozco la tarifa" | 2 | ok si tarifa > 0; si no, rojo |
| 3 | `utilization` | on-call o "Conozco la actividad" | 2 | ok si días activos > 0; si no, rojo |
| 4 | `labor` | tipo distinto de "Equipo sin operador" | 2 | ok si alguna línea tiene básico > 0 y posiciones > 0; si no, rojo |
| 5 | `relief` | servicio permanente, u on-call 24/7, con personal cargado | 1 | ok si todas las líneas tienen más de 1 persona por posición; si no, naranja |
| 6 | `equipment_cost` | tipo con equipos (on-call, equipo con/sin operador, transporte) o hay equipos | 2 | ok si hay equipos y todos tienen reposición > 0 y vida útil > 0; si no, rojo |
| 7 | `fuel` | hay equipos o vehículos de traslado | 2 | rojo sin responsable; rojo si lo pagamos y falta precio o consumo; naranja si lo pagamos y el precio es el valor ILUSTRATIVO por defecto (`fuel.illustrative = true`: "confirmalo con tu precio actual"); si no, ok |
| 8 | `materials` | siempre | 1 / 2 | "no usa materiales" → ok (1); sin líneas → naranja (1); con líneas → ok si todas tienen responsable, si no rojo (2) |
| 9 | `logistics` | siempre | 1 / 2 | "sin traslados" → ok (1); si no, ok si distancia > 0 y algún vehículo con cantidad > 0, si no rojo (2) |
| 10 | `structure` | siempre | 1 | ok si el % (métodos porcentuales) o el monto es > 0; si no, naranja |
| 11 | `payment_term` | siempre | 2 | ok si el plazo de cobro está definido (número, incluido 0); si está vacío o `null`, rojo |
| 12 | `contingency` | siempre | 1 | ok si la contingencia total > 0; si no, naranja |
| 13 | `margin` | siempre | 2 | rojo si está vacío o es inválido (≥ 100 %, negativo o no numérico); naranja si es 0; ok si es > 0 |
| 14 | `standby` | on-call | 1 | ok si hay tarifa de standby o se marcó "no aplica"; si no, naranja |

Los pendientes (`pending`) se ordenan rojos primero. Ejemplos: demo Hidrogrúa **95,45 %** (pendientes en naranja: relevos y standby); caso de referencia **78,57 %** (personal en rojo; estructura y contingencia en naranja).

**Colores del puntaje** (`completenessTone`, `js/engines/completeness-engine.js`), iguales en el editor, el resultado y el listado: **verde ≥ 85 %** (`COMPLETENESS_GREEN_THRESHOLD`), **naranja ≥ 60 %**, **rojo < 60 %** (`COMPLETENESS_RISK_THRESHOLD`, el mismo límite que marca `incomplete` y `atRisk`, §20).

**Defaults ILUSTRATIVOS no cuentan como definidos.** Un valor que nadie cargó no puede dar un ítem en verde. Al crear una cotización en blanco con la configuración ILUSTRATIVA de la demo (`settings.illustrative = true`, ver `createEmptyQuote` en `js/domain/quote-factory.js`):

| Dato | Cotización nueva | Regla |
|---|---|---|
| Días activos (`activity.activeDaysPerMonth`) | `null` (siempre, también con configuración propia) | `utilization` en rojo |
| Plazo de cobro (`finance.paymentTermDays`) | `null` | `payment_term` en rojo |
| Contingencia general (`risk.generalPct`) | 0 | `contingency` en naranja |
| Precio del combustible (`fuel.pricePerLiter`) | el de la configuración, con `fuel.illustrative = true` | `fuel` en naranja (si hay equipos o vehículos) |
| Margen objetivo (`pricing.targetMarginPct`) | el de la configuración (10 % en la demo) | `margin` en verde |

Con una configuración propia (`settings.illustrative !== true`), el plazo y la contingencia toman los valores de la configuración y el combustible no queda marcado. Las plantillas pueden traer sus propios valores (por ejemplo, la plantilla Hidrogrúa on-call carga 8 días activos y 90 días de plazo). Ejemplo: una cotización en blanco con la configuración demo da **33,33 %** (rojos: actividad, personal, equipos, logística y plazo de pago; naranjas: materiales, estructura, contingencia y standby).

## 20. Indicadores y alertas

`computeQuote(quote, { settings })` devuelve `kpis` con, entre otros: días activos, utilización, costo total, fijos, variables, costo por día activo, tarifas piso/objetivo/sugerida/comercial (neta y de lista), facturación, resultado, margen, markup, break-even y días para margen objetivo (exactos y enteros), completitud, costo financiero, impacto financiero en margen, capital de trabajo, costo logístico mensual e incidencia.

**Margen y markup de la cotización sólo con tarifa comercial.** `kpis.marginPct` y `kpis.markupPct` son `null` si no hay tarifa comercial (`commercialSource = 'none'`), aunque haya otros ingresos (fee, standby, call-out). Ejemplo: caso de referencia en "Conozco la tarifa" sin tarifa y con fee de disponibilidad 6.000.000/mes → facturación 6.000.000, margen y markup `null` (antes figuraba un margen de −533,33 % que entraba al promedio del dashboard). La facturación y el resultado se siguen informando.

| Alerta | Regla |
|---|---|
| `belowFloorRate` | hay tarifa y la tarifa neta comercial < tarifa piso neta (tolerancia 1e-6). Informativo: la tarifa sola no cubre el costo |
| `belowFloor` ("bajo piso: perdés dinero") | `belowFloorRate` **y** resultado del mes < 0 |
| `belowTarget` | hay tarifa y el margen < margen objetivo |
| `incomplete` | completitud < `COMPLETENESS_RISK_THRESHOLD` (60 %) |
| `atRisk` | sin tarifa, **o** resultado < 0, **o** margen < objetivo, **o** completitud < 60 % |

**`belowFloor` vs `belowFloorRate`.** La tarifa piso no cuenta el mínimo garantizado (§13), así que una tarifa neta debajo del piso no siempre implica pérdida: si un mínimo garantizado cubre la diferencia, el mes da ganancia. Ejemplo: caso de referencia + mínimo garantizado 40.000.000/mes, tarifa 4.000.000/día, 8 días → facturación 40.000.000, costo 38.000.000, resultado **+2.000.000** (margen 5 %), break-even 0 días: `belowFloorRate = true` (la tarifa está debajo del piso de 4.750.000) pero `belowFloor = false` (no se pierde dinero con esa actividad; sí hay riesgo si la actividad cambia, y `atRisk` es `true` porque el margen queda debajo del objetivo). En el caso de referencia sin mínimo (resultado −6.000.000) ambas son `true`.

El Dashboard (`QuoteService.dashboardStats`) suma sólo cotizaciones activas (`ACTIVE_QUOTE_STATUSES`: borrador, enviada, ganada): valor total cotizado (Σ facturación mensual finita), margen promedio (promedio simple de los márgenes finitos: las cotizaciones sin tarifa comercial, con margen `null`, no entran), cotizaciones con riesgo (`atRisk`) y servicios bajo piso (`belowFloor`). Si una cotización guardada no se puede calcular, su resumen es `{ error: true, atRisk: true, belowFloor: false, marginPct: null, … }`: cuenta como "con riesgo" y no rompe el dashboard ni el listado.

## 21. Casos extremos

| Caso | Tratamiento |
|---|---|
| 0 días activos | `Costo(0) = F`; costo por día y tarifas necesarias `null` ("—") porque no hay unidades; la traza de tarifa piso lo explica; activaciones 0. |
| Días activos > días disponibles | `factorMeses > 1` (prorrateo de fijos, y también del fee de disponibilidad, el standby y el mínimo garantizado); filas marcadas `exceedsAvailability`; `validateQuote` advierte utilización > 100 %. La sensibilidad sin variaciones no cambia la base y el comparador de modelos prorratea fee y mínimo igual que los fijos (§17). |
| Actividad sin cargar (`activeDaysPerMonth = null`) | Se calcula con 0 días (ver fila siguiente) y el Cost Completeness Score marca la actividad en rojo. |
| Utilización 100 % | `D = días disponibles`, factor 1. |
| Utilización cercana a 0 | Tarifas muy altas pero finitas; en 0 son `null`. |
| Días disponibles 0, vacío o negativo | Se usan 30; `validateQuote` informa el error. |
| Días por activación ≤ 0 o vacío | Se usa 1. |
| Margen ≥ 100, < 0 o no numérico | `priceFromMargin` → `null`; margen objetivo inválido → se calcula con 0; personalizado inválido → se omite; `validateQuote` informa y el Cost Completeness Score lo marca en rojo. |
| Margen 0 | Tarifa objetivo = tarifa piso; completitud en naranja. |
| Precio inferior al costo | Margen y markup negativos, `belowFloorRate` y `belowFloor` (si el mes da pérdida), semáforo rojo, `atRisk`. |
| Tarifa neta bajo piso con mínimo garantizado que cubre el costo | `belowFloorRate = true`, `belowFloor = false`; el resultado se informa positivo (§20). |
| Sin tarifa comercial pero con otros ingresos | Margen y markup de la cotización `null`; facturación y resultado se informan; `atRisk`. |
| "No aplica standby" con días o tarifa de standby cargados | Días y tarifa de standby se toman como 0: sin costo ni ingreso de standby. |
| Línea de costo que no es un objeto (`null`, número, texto) o colección que no es una lista | Los motores la ignoran (`objectList`: aporta 0); la importación la rechaza (`validateState`). |
| Descuento con margen negativo | Semáforo rojo en el tramo; el resultado se informa negativo (nunca se oculta). |
| Descuento 100 % | Factor 0 → tarifa de lista `null`. |
| Valores vacíos | `toNumber('')` → valor por defecto (0, o 1/30 en los campos indicados). |
| Valores negativos | `nonNegative` los reemplaza por el valor por defecto en los motores; `validateQuote` los informa (`RULES` en `js/core/validation.js`). |
| Valores fuera de rango (montos > 1.000 billones, cantidades > 1.000 millones, distancias > 100.000 km, horas por día > 24…) | `validateQuote` informa el error con la regla correspondiente de `RULES`; los motores calculan igual con el valor saneado. |
| Residual > reposición | Se toma residual = reposición; advertencia de validación. |
| Vida útil 0 | Amortización 0; completitud en rojo. |
| Combustible provisto por el cliente | Precio del combustible 0 en equipos y traslados. |
| Material provisto por el cliente | Costo 0 (se lista igual). |
| Unidad `month` | Sin tramos ni minimum call; break-even no aplica. |
| Contribución ≤ 0 | Break-even inalcanzable con motivo explícito. |
| Cualquier división por 0 | `safeDivide` → `null`; nunca `NaN` ni `Infinity`. |

## 22. Golden cases

Casos de referencia que deben seguir valiendo aunque cambie la interfaz. Son **reglas de negocio**, no sólo tests técnicos (ver [AGENTS.md](../AGENTS.md)). Viven en `tests/golden-cases/`: cada caso es un archivo `.json` con `{ id, title, rule, engine, inputs, expected, tolerance }` y `tests/golden-cases/golden-cases.test.js` los ejecuta contra los motores (`npm test`). Si un cambio de fórmula rompe un golden case, es un cambio de regla de negocio: se documenta y se discute antes de tocar el caso.

| Archivo | Entradas | Resultado esperado |
|---|---|---|
| `on-call-basico.json` | fijos 30.000.000; variable 1.000.000/día; tarifa 4.000.000/día | contribución 3.000.000/día; **break-even 10 días** |
| `on-call-basico-cotizacion.json` | el mismo caso calculado con `computeQuote` | break-even 10 días; contribución 3.000.000/día |
| `on-call-tarifa-minima-6-dias.json` | fijos 30.000.000; variable 1.000.000/día; 6 días | tarifa mínima 6.000.000/día |
| `on-call-fee-disponibilidad.json` | caso básico + fee de disponibilidad 6.000.000/mes | break-even (30M − 6M) / (4M − 1M) = **8 días** |
| `minimo-garantizado-break-even-robusto.json` | caso básico + mínimo garantizado 35.000.000/mes; 8 días | break-even robusto **10 días** (se gana con menos de 5 días, se pierde entre 5 y 10, no se pierde desde 10); con 8 días factura 35.000.000 y pierde 3.000.000 |
| `break-even-inalcanzable.json` | tarifa = variable = 1.000.000/día | inalcanzable, contribución 0, días `null` (sin `Infinity`) |
| `margen-10-sobre-precio.json` | costo 100; margen 10 % | precio **111,11…** (NO 110) |
| `markup-10-sobre-costo.json` | costo 100; markup 10 % | precio **110** |
| `conversion-margen-a-markup.json` | margen 10 % | markup 11,11 % |
| `conversion-markup-a-margen.json` | markup 11,11 % | margen 10 % |
| `tarifa-piso-8-dias.json` | fijos 30.000.000; variable 1.000.000/día; 8 días | costo 38.000.000; tarifa piso 4.750.000/día |
| `tarifa-margen-10-con-10-dias.json` | mismo caso, 10 días, margen 10 % | tarifa objetivo 4.444.444,44/día; piso 4.000.000 |
| `modo-b-margen-objetivo.json` | mismo caso, 8 días, "Conozco la actividad", margen 10 % | tarifa sugerida 5.277.777,78; margen 10 %; markup 11,11 % |
| `costo-financiero-simple.json` | 10.000.000 × 3 % mensual × 90 días | 900.000 |
| `caso-demo-referencia.json` | cotización demo "Caso de referencia on-call" | break-even 10 días; piso 4.750.000; facturación 32.000.000; costo 38.000.000; resultado −6.000.000; bajo piso y con riesgo |

El caso on-call básico también existe como cotización demo "Caso de referencia on-call (prueba del motor)" (`demoReferenceQuote` en `js/domain/demo-data.js`): fijos cargados como otro costo fijo mensual, variable como otro costo por día activo, modalidad "Conozco la tarifa" con 4.000.000/día, sin financiero, contingencia ni reglas → break-even exactamente 10 días. Además, toda EECC con costo > 0 debe mostrar incidencias que suman exactamente 100,00 % (tests de `costStructure`).
