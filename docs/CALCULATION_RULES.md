# Reglas de cálculo de RATEOS

Este documento describe **todas** las fórmulas del motor económico tal como están implementadas en `js/engines/` (v0.1.0 + cambios en curso del [CHANGELOG](../CHANGELOG.md), "Sin publicar"). Es parte de la especificación funcional: si una fórmula cambia, este documento, los tests y el [CHANGELOG](../CHANGELOG.md) cambian en el mismo Pull Request (ver [AGENTS.md](../AGENTS.md), "Protección del motor").

> **Valores ILUSTRATIVOS.** Los ejemplos numéricos usan los datos demo de *Patagonia Servicios SRL* (empresa ficticia) o casos de referencia sintéticos. No son escalas salariales, cargas patronales, alícuotas, precios ni costos reales.

Convenciones:

- Los porcentajes se expresan en **puntos** (`10` = 10 %). `x%` en una fórmula significa `x / 100`.
- `D` = días activos (facturables) del mes. `F` = costos fijos mensuales. `v` = costo variable por día activo.
- Los motores calculan con valores internos **sin redondear**. El redondeo sólo se aplica al mostrar (ver [Redondeos y precisión](#18-redondeos-y-precisión)).
- Todas las funciones son puras: mismos inputs → mismos outputs. Ninguna devuelve `NaN`, `Infinity` ni `-Infinity`; cuando un resultado no existe devuelven `null` y la UI muestra "—".
- **Todo es sin IVA**: costos, tarifas, facturación y resultado. `t` = impuestos que se pagan sobre lo que se factura (Ingresos Brutos, débitos y créditos, sellos…), en puntos; 0 si no aplican o están sin definir (§13.1). El margen es **antes de Ganancias**.

## Índice

1. [Modelo económico general](#1-modelo-económico-general)
2. [Actividad y on-call](#2-actividad-y-on-call)
    - [2.1 "Cada salida se cuenta completa"](#21-cada-salida-se-cuenta-completa-plan-2026-011-opcional)
3. [Personal](#3-personal)
    - [3.1 Horas extra por tramos (PLAN-2026-010)](#31-horas-extra-por-tramos-plan-2026-010)
4. [Equipos](#4-equipos)
    - [4.1 Equipos y servicios externos (alquilados y tercerizados)](#41-equipos-y-servicios-externos-alquilados-y-tercerizados)
    - [4.2 Recursos compartidos: % de los costos fijos](#42-recursos-compartidos--de-los-costos-fijos-plan-2026-012-opcional)
5. [Logística](#5-logística)
    - [5.1 Movilización del recurso principal](#51-movilización-del-recurso-principal)
    - [5.2 Viajes físicos y km de la ruta](#52-viajes-físicos-y-km-de-la-ruta-plan-2026-012)
6. [Materiales y otros costos](#6-materiales-y-otros-costos)
    - [6.1 Moneda y tipo de cambio](#61-moneda-y-tipo-de-cambio)
    - [6.2 Base económica de la oferta](#62-base-económica-de-la-oferta)
7. [Estructura (costos indirectos)](#7-estructura-costos-indirectos)
8. [Financiero y capital de trabajo](#8-financiero-y-capital-de-trabajo)
9. [Contingencia](#9-contingencia)
10. [Costo total y estructura de costos (EECC)](#10-costo-total-y-estructura-de-costos-eecc)
11. [Margen vs markup](#11-margen-vs-markup)
12. [Unidades, reglas comerciales y facturación](#12-unidades-reglas-comerciales-y-facturación)
    - [12.0 Cómo se compone la facturación del mes (ECO-01)](#120-cómo-se-compone-la-facturación-del-mes-eco-01-aud-t1-h-02)
13. [Tarifa piso, precio objetivo y precio comercial](#13-tarifa-piso-precio-objetivo-y-precio-comercial)
    - [13.1 Impuestos sobre la facturación (gross-up)](#131-impuestos-sobre-la-facturación-gross-up)
    - [13.2 Composición del precio, apropiación y total del contrato](#132-composición-del-precio-apropiación-y-total-del-contrato)
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

**Terminología de la activación (PLAN-2026-014, LAB-D8).** Internamente hay **una sola magnitud** (la activación: `activationsPerMonth`, `daysPerActivation`, costos "por activación"). En la interfaz se nombra según la cotización (`activationTerms`, `js/domain/activation-terms.js`) y, dentro de una cotización, siempre igual:

| Cotización | Nombre |
|---|---|
| unidad de facturación "llamado" | llamado |
| unidad "trabajo" o "hito" | trabajo |
| on-call | llamado |
| transporte | salida (agrupa uno o más viajes) |
| llave en mano / precio cerrado | trabajo |
| el resto (servicios técnicos, cuadrillas, equipos, **permanentes**…) | intervención |

Un servicio **permanente** usa "intervención", el término neutral: RATEOS no sabe si cada activación es un relevo o un cambio de turno (no hay un dato que lo diga), así que no lo nombra así. Ahí "días por intervención" es un intervalo ("¿Cada cuántos días hay una intervención?"), no una duración; la cuenta es la misma.

"Viaje" (un viaje físico; con la unidad "viaje", lo que se factura), "día de trabajo", "turno" (unidad) y "salida de caja" (plata que sale) son **otras** magnitudes y conservan su nombre. Una magnitud = un significado económico. Los rótulos que citan los avisos salen de la misma función que arma el campo (`activationFieldLabels`), así un aviso nunca nombra un campo que no existe.

### 2.1 "Cada salida se cuenta completa" (PLAN-2026-011, opcional)

Las activaciones por mes son un **promedio** y pueden ser fraccionarias (2.500 m³ / 120 m³ por día / 2 días por intervención = 10,42). Por defecto (`activity.fullActivations` ausente o `false`) cada costo por salida se reparte por día y el mes paga 10,42 salidas, como siempre. Con la opción activa:

```
intervenciones estimadas  A = D / días por intervención          (no cambia: producción y facturación siguen con A)
intervenciones costeadas  C = ⌈A⌉                                (con A entero, C = A y nada cambia)
ajuste del mes            = (C − A) × costo discreto por salida
costo discreto por salida = movilización por sus medios (combustible en ruta + desgaste)
                          + logística auxiliar (combustible y desgaste de vehículos, peajes, viáticos)
                          + externos por llamado / viaje / km, o por hora / día cuando rige el mínimo por llamado
                          + movilización cobrada aparte por el proveedor
                          + materiales y otros costos "por llamado"
                          + su estructura (sólo si es % sobre directo o mano de obra)
                          + su financiación (su salida de caja, con los días de su grupo o de su proveedor)
                          + su contingencia
```

**No se redondean** sueldos, standby, tenencia de equipos, mantenimiento por hora, materiales por mes o por día, externos por mes o global, estructura mensual fija, producción ni facturación (los ingresos por llamado —call-out, movilización cobrada al cliente, km extra— siguen con las intervenciones estimadas: la opción sólo agrega costo). Cada driver existe en una sola línea del modelo (un equipo transportado o una movilización incluida por el proveedor no suma movilización propia), así que el ajuste no cuenta nada dos veces.

El costo pasa a ser **escalonado** en D: el equilibrio, los días para el margen objetivo y el comparador evalúan cada salto (múltiplos de los días por intervención) para no saltear un tramo con pérdida (§15), y la descomposición lineal se marca como no lineal.

**Semántica explícita (PLAN-2026-014, decisión del dueño LAB-D1; la fórmula no cambia).** Apagada, la frecuencia es un **promedio**: con 2 días de trabajo y salidas de 4 días hay 0,5 salidas por mes y los costos por salida se cuentan en proporción (0,5 de la salida). Encendida, los costos físicamente indivisibles por salida se cuentan completos (⌈A⌉). La interfaz muestra siempre tres números: **salidas promedio** (A), **salidas costeadas** (A apagada; ⌈A⌉ encendida) y el **efecto del redondeo** `(⌈A⌉ − A) × costo discreto por salida` (incluido o "no incluido"), en "Cómo se cobra" (`activationRoundingText`), en "Ver cálculo" del costo total y de Movilización y viajes (como nota, apagada) y en el Resultado. Con **menos de una salida por mes**, la opción apagada y costos por salida, un aviso informativo (no resta puntaje; `activations_below_one`, `focus` a la casilla) lo dice con los tres números. Golden: `salidas-menos-de-una-promedio` (costo 3.450.000, efecto +50.000 sin sumar) y `salidas-menos-de-una-completa` (⌈0,5⌉ = 1, costo 3.500.000). Invariante de Test Lab INV-29.

**Ejemplo (COT-0009 con 2.500 m³):** costo por salida = movilización del vactor 77.500 (52.500 combustible + 25.000 desgaste) + estructura 10 % 7.750 + financiación 5.488,75 (52.500 × 3 % × 75/30 + 25.000 × 3 % × 45/30 + 7.750 × 3 % × 55/30) = **90.738,75**. A = 10,4167, C = 11 → ajuste = 0,5833 × 90.738,75 = **52.930,94** por mes. Personal, tenencia del vactor, la pickup mensual, los m³ y la facturación no cambian. Con 2.400 m³ (A = 10 exacto) el mes no cambia; el equilibrio (≈ 8,04 salidas) sí cuenta la novena salida completa.

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

Persona compartida con otros servicios: esta cotización carga sólo el % explícito de su costo fijo (§4.2).

### 3.1 Horas extra por tramos (PLAN-2026-010)

Opcional: `line.overtime` es una lista de tramos `{ label, premiumPct, hours, basis, billRatePerHour }` (HE 50 %, HE 100 %, otro recargo). Los 50 % y 100 % son **valores de partida editables**, no normativa: cada convenio define los suyos.

```
costo hora del tramo  = valor hora × (1 + recargo del tramo) × factorCargas
basis 'per_active_day' (horas por día activo)          → variable por día × posiciones
basis 'per_month'      (horas promedio por mes/persona) → fijo del mes × dotación
```

Sin lista `overtime`, se usa el campo único de siempre (horas extra por día activo + un recargo) **con el mismo orden de cálculo**: mismo resultado al centavo (test `audit-cot0009.test.js`). Antes → después: ninguna cotización existente cambia (foto de 99 casos idéntica).

**Horas de cobertura de la operación vs horas cargadas del puesto (PLAN-2026-014, decisión del dueño LAB-D2; no es una fórmula de costo).** Es un control **mensual de cobertura**: con días de trabajo D y horas por día H (de la actividad), cada posición tiene que cubrir `D × H` horas en el mes. Con lo cargado se cubren `personas por posición × horas normales por mes del puesto + horas extra por día activo × D + horas extra por mes × personas por posición`. Si falta cubrir horas, la completitud avisa (`labor_hours`, naranja, sólo aparece en ese caso): "La operación requiere más horas de cobertura que las horas cargadas para este puesto. Revisá dotación, turnos y/o horas extra.", con el cálculo del mes, las horas que faltan y `focus` a "Personas por posición". RATEOS **no tiene un dato de jornada diaria**: el control no dice cuántas horas por día trabaja cada persona y por eso ningún texto habla de "jornada" (Test Lab lo audita: `UX-TERM-JORNADA`). RATEOS **nunca** infiere horas extra, turnos, relevos ni convenio, ni cambia el costo: lo decide la empresa. Ejemplos: 8 h × 20 días = 160 h ≤ 176 h → sin aviso; 12 h × 20 = 240 h con 1 persona de 176 h → faltan 64 h; con 2 personas por posición (352 h) o 4 h extra por día (256 h) → sin aviso; 24 h × 20 = 480 h necesita 3 personas (2 cubren 352 h). Invariante INV-31.

**Horas extra facturadas aparte** (`line.overtimeBilled = true`): siguen siendo costo y además generan ingreso `horas × precio por hora del tramo` (por día activo × posiciones, o por mes × dotación), que entra en "otros ingresos" igual que los materiales facturados aparte (§12) y por eso baja la tarifa piso. Ejemplo COT-0009: 2 h/día al 50 % facturadas a $ 30.000/h × 20 días = $ 1.200.000 de ingreso por mes; el costo no cambia.

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
otros                = otros costos anuales de tenerlo / 12             (v3: habilitaciones, GPS…)
mantenimiento fijo   = presupuesto mensual (o anual / 12)               (v4: sólo si el mantenimiento se carga como presupuesto)
posesión en efectivo   = seguro + patente + certificaciones + otros + mantenimiento fijo
posesión no efectivo   = amortización + costo de capital       (no son salidas de caja mensuales)
posesión total         = efectivo + no efectivo
```

Operación por hora de uso:

```
combustible/h  = litros/h × precio del combustible      (precio = 0 si el combustible lo provee el cliente)
operación/h    = mantenimiento/h + neumáticos/h + combustible/h
```

- **"No usa combustible"** (`equipment[].fuelNotApplicable = true`, PLAN-2026-014, decisión LAB-D5): equipo propio eléctrico, manual o estacionario. Es un dato **explícito**: litros/h = 0 trabajando y en ruta (§5.1), no se pide consumo ni precio de combustible por ese equipo y no impide el 100 % de completitud. Un consumo 0 **sin** la marca sigue siendo un dato faltante (nunca se infiere "no consume" de un 0). Viene del legajo de Recursos (y cambia la huella del snapshot sólo si está marcado: ninguna cotización existente se marca sola). Invariante INV-30.
- **Horas de uso por día de una línea** (decisión del dueño, PLAN-2026-014; reemplaza la regla anterior "sin tope"): son las horas **por unidad** de equipo, propio o externo (alquilado o tercerizado): las de la línea o, vacías, las de la actividad. **Máximo físico: 24 h por día** (`equipmentHoursPerDay`, el mismo tope de la validación y de la actividad, §2). La cantidad de equipos va en `quantity`, que multiplica las horas como siempre: **2 equipos × 20 h = 40 equipo-horas por día**, nunca 1 equipo × 40 h. Un dato mayor a 24 sigue siendo un **error** de `validateQuote` (0 a 24) para que se corrija, y el motor nunca calcula por encima del tope: 24,1 h o 30 h cuestan lo mismo que 24 h (operación, combustible por hora y tarifa por hora de un externo). "Ver cálculo" lo explica en la línea. Antes → después: una línea cargada con 30 h y $ 1.000/h de operación pasaba de $ 30.000 a **$ 24.000 por día**; con 24 h o menos nada cambia (ningún golden ni escenario anterior usaba más de 24).

**Mantenimiento y neumáticos: forma de carga (esquema 4, PLAN-2026-007)** — `maintenanceOf`, `tiresOf`. Sin forma de carga se usa "por hora" (los datos anteriores calculan igual):

| Forma de carga | Fórmula | Dónde entra |
|---|---|---|
| Mantenimiento por hora | `mantenimiento/h` cargado | Operación (por hora de uso) |
| Service cada N horas | `costo del service / horas de uso entre services` | Operación (por hora de uso) |
| Presupuesto mensual o anual | `presupuesto mensual` (o `anual / 12`) | **Posesión** (costo FIJO de tenerlo): nunca se divide por horas |
| Neumáticos por hora | `neumáticos/h` cargado | Operación (por hora de uso) |
| Juego + vida útil en horas | `costo del juego / vida útil en horas` | Operación (por hora de uso) |
| Juego + vida útil en km (equipos de ruta) | `costo del juego / vida útil en km` = $/km | Desgaste en ruta de la movilización (§5.1), no por hora |

Ejemplos: service $ 600.000 cada 250 h = **$ 2.400/h**; presupuesto $ 3.000.000/mes o $ 36.000.000/año = **$ 3.000.000/mes de posesión** y $ 0/h; juego $ 2.400.000 / 3.000 h = **$ 800/h**; juego $ 2.400.000 / 80.000 km = **$ 30/km**. Si en una forma de carga no hay horas o km (0 o vacío), el valor es 0 y se avisa.

**Avisos de sentido común** (`equipmentChecks`, no bloquean ni corrigen: la persona decide). Se comparan con el valor de reposición en la moneda de los costos (si está en otra moneda sin tipo de cambio, no se comparan montos):

| Aviso | Condición |
|---|---|
| Mantenimiento por hora absurdo | `mantenimiento/h × 100 > reposición` ("¿Seguro que el importe está expresado por hora?") |
| Mantenimiento por hora alto | `mantenimiento/h × 1.000 > reposición` |
| Presupuesto alto | `mantenimiento fijo mensual × 12 > reposición` |
| Neumáticos por hora absurdo / alto | `neumáticos/h × 100 > reposición` / `× 1.000 > reposición` |
| Neumáticos por km absurdo | `neumáticos/km × 1.000 > reposición` ("¿La vida útil está en km?") |
| Residual mayor que reposición | `residual > reposición` (la amortización queda en 0) |
| Sin vida útil | `reposición > 0` y `vida útil = 0` (la amortización queda en 0) |
| Falta el intervalo del service / la vida útil del juego | costo cargado con horas o km en 0 |

Caso real que motivó el cambio: un autoelevador con reposición $ 100.000.000 y "mantenimiento" $ 3.000.000 cargado como $/h → operación $ 3.000.000/h, $ 24.000.000 por día activo de 8 h, ~$ 360.000.000 en 15 días. RATEOS no cambia ese dato (sigue siendo $/h hasta que la persona lo edite), pero ahora lo muestra como "POR HORA de uso" y avisa que 100 horas cuestan más que el equipo.

**En una cotización** (`computeEquipmentLine`), con `horas por día activo` de la línea por unidad (si está vacío se usan las horas por día activo de la actividad), como mucho 24:

| Parte | Fórmula | Categoría EECC |
|---|---|---|
| Fijo mensual | posesión total (incluye el mantenimiento fijo si se cargó como presupuesto) × cantidad | Equipos |
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

Un valor de reposición en otra moneda se convierte con el tipo de cambio de la cotización antes de calcular (§6.1). La regla vale para los equipos **propios** (`acquisition = 'owned'`, el valor por defecto): un alquilado o tercerizado no tiene amortización, seguro ni costo de capital (§4.1).

### 4.1 Equipos y servicios externos (alquilados y tercerizados)

Archivo: `js/engines/external-engine.js` (`computeExternalLine`, `externalFiscal`). PLAN-2026-005. Un recurso externo es una **tarifa del proveedor**: precio NETO (sin IVA) por una unidad, con un mínimo opcional.

| Unidad | Unidades por llamado |
|---|---|
| hora | horas de uso por día × días por llamado |
| día | días por llamado |
| viaje — **por tramo** (`unit: 'trip'`, "Por tramo (cada ida o cada vuelta)") | tramos por llamado (de Viajes: viajes × (ida y vuelta ? 2 : 1)) |
| viaje — **por viaje completo** (`unit: 'trip'` + `tripBasis: 'round_trip'`, ECO-01) | viajes por llamado (un viaje ida y vuelta = 1 unidad) |
| km | km de ruta por llamado ("Por km recorrido") |
| llamado (salida / intervención) | 1 |
| mes | — (fijo mensual = precio × cantidad) |
| global | — (fijo mensual = precio × cantidad / meses de contrato; sin contrato = 1 mes) |

```
facturado/llamado (neto) = máx(unidades por llamado, mínimo) × precio neto × cantidad × tipo de cambio
por día activo (neto)    = facturado/llamado / días por llamado
```

**Tratamiento fiscal** (lo define la empresa: RATEOS no trae alícuotas; `vatPct` arranca sin definir):

```
parte recuperable = 1 (Sí) | 0 (No) | % parcial / 100 (Parcial) | 0 si es Parcial sin % (+ pendiente rojo) | 1 si está sin definir (+ aviso)
costo económico   = neto × (1 + cargos no recuperables% + IVA% × (1 − parte recuperable))
salida de caja    = neto × (1 + IVA% + percepciones% + cargos no recuperables%)     (se financia, §8)
crédito fiscal    = neto × (IVA% × parte recuperable + percepciones%)               (NO es costo)
```

- Al costo de la cotización entra **sólo el costo económico**. El IVA recuperable y las percepciones son caja que se adelanta: **no son costo, pero sí se financian** hasta cobrar (§8, corrección de PLAN-2026-010).
- El plazo de pago de cada externo es el de su línea (`equipment[].supplierPayDays`, PLAN-2026-011, §8); vacío = el de "Proveedores". El viejo `external.fiscal.paymentTermDays` sigue informativo (la línea ofrece [Usar X días]).
- Ganancias no se aplica como % sobre un alquiler; el IIBB del proveedor ya está en su precio (el propio se calcula sobre la facturación, §13.1).
- "No" o "Parcial" sin alícuota de IVA → la completitud lo marca en rojo (no se puede calcular el IVA que no se recupera).
- **"Parcial" sin % recuperable** (regla real documentada en PLAN-2026-014, LAB-D6): se toma **0 % recuperable** —todo el IVA es costo, como "No", criterio conservador— y la completitud lo marca en rojo ("Falta … la parte recuperable") hasta que se cargue el %.

Opcionales del proveedor:

| Incluido | Si es "No" |
|---|---|
| Combustible | según cómo se cargó el consumo (`external.fuelMode`, PLAN-2026-012): **por hora** (el de siempre) litros/h × horas por día × cantidad × precio; **por km de ruta** km físicos de la ruta por llamado × cantidad × L/100 km / 100 (o ÷ km/L) × precio. Categoría **Combustible**, aparte de la tarifa; nunca las dos formas a la vez |
| Movilización | monto por llamado × cantidad, con el mismo tratamiento fiscal (categoría **Equipos y servicios externos**) |
| Operador | informativo: el operador se carga en Personal (y se asigna al equipo para no contarlo dos veces) |

Categoría EECC: **Equipos y servicios externos** (`external`). Grupo de pago: proveedores.

**Ejemplo (caso D):** camión alquilado $ 1.000.000 neto por día, IVA 21 % recuperable, 2 días por llamado → facturado por llamado 2.000.000 neto; costo económico **1.000.000/día**; salida de caja **1.210.000/día**; crédito fiscal **210.000/día** (no es costo). Con IVA no recuperable el costo económico es 1.210.000/día.

**Combustible por km (PLAN-2026-012, opcional).** COT-0010 con el combustible del camión a nuestro cargo: 12 viajes × 200 km = **2.400 km × 35 L/100 km = 840 L × $ 1.500 = $ 1.260.000** por mes en Combustible; la tarifa ($ 7.800.000) no cambia. Es un costo por salida (con "cada salida completa" se costea con salidas enteras). Si el externo además "va por sus propios medios", la movilización no vuelve a sumar combustible en ruta (ya está en su consumo por km). Sin elegir la forma, sigue por hora: ninguna cotización existente cambia.

**Tarifa ligada a la ruta (sólo presentación).** Por km: "Neuquén → Añelo · 200 km por viaje · $ 650.000 por viaje (ida y vuelta) · equivalente $ 3.250/km". Por tramo: la unidad es **cada ida o vuelta** y se muestra cuántos tramos tiene un viaje y su equivalente por viaje y por km. Por viaje completo: viajes completos del mes, la tarifa por viaje y su equivalente por km. Nunca se fuerza el $/km.

**Tramo, viaje completo, salida y km (ECO-01, AUD-T1 H-01).** Cuatro magnitudes distintas, cada una con su nombre en la unidad del proveedor:

| Unidad del proveedor | Qué cuenta | Ejemplo E3 de la regresión ECO-01 (18 salidas × 2 viajes de 320 km ida y vuelta) |
|---|---|---|
| Por tramo (cada ida o cada vuelta) | cada ida **o** cada vuelta: un viaje ida y vuelta son 2 tramos | 72 tramos × precio |
| Por viaje completo (ida y vuelta) | cada viaje ida y vuelta | 36 viajes × precio |
| Por salida (llamado / intervención) | cada salida, tenga los viajes que tenga | 18 salidas × precio |
| Por km recorrido | km físicos de la ruta | 11.520 km × precio |

- **"Por tramo" conserva su significado**: es la unidad `trip` de siempre (antes se llamaba "Por viaje (cada ida o vuelta)"; sólo cambió el rótulo). Nada guardado se reinterpreta: una línea `trip` sin `tripBasis` sigue contando tramos y da los mismos números.
- **"Por viaje completo"** es la misma unidad `trip` con `external.tripBasis = 'round_trip'` (dato opcional; sin él es por tramo). El motor cuenta los viajes de la ruta (`fullTripsPerActivation` = viajes por llamado), no los tramos; el mínimo, la cantidad, el IVA y la financiación se aplican igual. Con la ruta "sólo ida" un viaje completo es un viaje de ida.
- Con los datos de E3: 928.000 por viaje completo = 2.900 $/km = 464.000 por tramo → costo del mes **$ 41.281.757,11** y sugerida **$ 1.377.000** (los tres dan lo mismo, test `tests/engines/eco-01.test.js`). Cargado "Por salida" da 18 × 928.000 (costo $ 21.875.213,61, sugerida $ 730.000); cargado "Por tramo" da 72 × 928.000 (costo $ 80.094.844,11, sugerida $ 2.671.000). **Las fórmulas de "Por salida" y "Por tramo" no cambian**: lo que cambia es que ahora existe la unidad correcta y que la combinación ambigua se avisa.
- **"Por salida" con varios viajes por salida** (ruta con más de 1 viaje por llamado): pendiente **crítico** y resultado **no confiable** hasta elegir la unidad o confirmarla (`external_unit_trips`, §19), nombrando salidas por mes, viajes por salida, viajes del mes y el equivalente por viaje. "Sí, cobra por salida" guarda en la línea **el supuesto confirmado** (`line.externalUnitConfirmed = { unit: 'activation', price, tripsPerActivation, distanceKm, roundTrip }`, `externalUnitAssumption`) y el crítico se va sin cambiar el costo. La confirmación **sólo vale mientras ese supuesto siga igual**: si cambian la tarifa, los viajes por salida (también los que se derivan de la unidad "viaje"), la distancia o ida y vuelta, vuelve el crítico diciendo qué cambió; cambiar la unidad la borra. Con 1 viaje por salida (el on-call de siempre) no hay ambigüedad y no se avisa.

### 4.2 Recursos compartidos: % de los costos fijos (PLAN-2026-012, opcional)

Archivos: `js/domain/assignment.js` (`fixedCostShareOf`), `labor-engine.computeLaborLine`, `equipment-engine.computeEquipmentLine`. Concepto aprobado en PLAN-2026-006 §3.1. La asignación es un dato de **la línea de la cotización** (nunca del recurso maestro):

| Recurso | Opciones | % de costos fijos que carga la cotización |
|---|---|---|
| Personal | Dedicada a este servicio · Contratada para este servicio | 100 % |
| Personal | Compartida | el % que carga la persona (0 < % ≤ 100) |
| Equipo propio | Reservado para este servicio | 100 % |
| Equipo propio | Compartido | el % que carga la persona |
| Alquilado / tercerizado | — | no aplica (se paga por uso) |

```
personal:      fijo = (costo fijo por persona × % asignado + horas extra por mes) × dotación
               (costo fijo por persona = sueldo y cargas + seguros, EPP, capacitación y traslado)
equipo propio: fijo = posesión mensual × cantidad × % asignado
               (amortización, seguro, patente, certificaciones, otros, mantenimiento fijo y costo de capital)
variables:     sin cambios (horas extra por día, viandas, combustible, mantenimiento y neumáticos por uso, km)
estructura por empleado: dotación equivalente = Σ personas × % asignado
```

- Nunca se infiere del uso ("trabaja 15 días" no es "50 % del fijo"). Sin dato, dedicada, reservada o contratada = **100 %**: ninguna cotización existente cambia.
- Compartida sin % (o ≤ 0, no numérico) → 100 % (nunca se esconde costo) y la validación lo pide en rojo; más de 100 → 100.
- Se avisa el resto no cubierto: "El 75 % restante ($ 2.460.027 por mes) lo tiene que cubrir otro servicio o contrato".
- "Actualizar desde Recursos" conserva la asignación (`KEEP_ON_UPDATE`).
- "Usado en" (Recursos, `js/domain/resource-usage.js`): por recurso, cada cotización con su estado y su % (personas o unidades × %); **adjudicadas = compromiso**, borrador / enviada = potencial, perdidas y archivadas no cuentan; aviso si lo adjudicado supera el 100 % (no bloquea).

**Ejemplos:** coordinador $ 3.280.036 compartido al **25 % → $ 820.009**; equipo con posesión $ 5.000.000 compartido al **30 % → $ 1.500.000**; en ambos las variables son las mismas que al 100 %.

## 5. Logística

Archivo: `js/engines/logistics-engine.js` (`computeLogistics`). Desde PLAN-2026-005 esta sección es la **logística auxiliar** (vehículos de apoyo y de personal, peajes y viáticos). Cómo llega cada equipo al lugar del servicio es la movilización del recurso principal (§5.1). El indicador "Movilización y viajes" (y su incidencia) suma ambas.

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

- Viajes por activación vacío → 1. Ida y vuelta es el valor por defecto. Con la unidad comercial "viaje" los viajes por activación **se derivan** (§5.2).
- "Sin traslados" (`notApplicable`) → todo en 0.
- La logística es 100 % **variable por día activo** (no tiene parte fija).
- En la EECC, el **combustible de traslados** se informa en **Combustible**; desgaste, peajes y viáticos en **Logística**. El indicador "Costo logístico mensual" y su incidencia incluyen ambos.

**Ejemplo demo (ILUSTRATIVO):** Neuquén Capital → Añelo 110 km, ida y vuelta, 1 viaje por activación, combustible 1.500/L. Desde v3 la demo carga la hidrogrúa y la pickup como **movilización por sus propios medios** de cada equipo (§5.1) en lugar de vehículos sueltos; los números son los mismos.

| Equipo / vehículo | km | Litros | Combustible | Desgaste |
|---|---:|---:|---:|---:|
| Hidrogrúa (35 L/100 km, 150 $/km) | 220 | 77,0 | 115.500 | 33.000 |
| Vehículo de apoyo (12 L/100 km, 80 $/km) | 220 | 26,4 | 39.600 | 17.600 |
| **Por activación** | 440 | 103,4 | 155.100 | 50.600 |

Costo por activación 205.700; con 2 días por activación → 102.850 por día activo; con 4 activaciones → **822.800 por mes**.

### 5.1 Movilización del recurso principal

Archivo: `js/engines/mobilization-engine.js` (`computeMobilization`). Por cada línea de equipo, "¿cómo llega al lugar del servicio?":

```
por sus propios medios (self):
  km por llamado     = km de ruta por llamado × cantidad
  litros             = km × consumo en ruta (L/100 km) / 100
  combustible        = litros × precio       (0 si lo provee el cliente; un externo sólo si su tarifa NO incluye combustible:
                                              sin definir no se suma y se avisa, igual que el combustible trabajando)
  desgaste           = km × (mantenimiento y neumáticos por km + neumáticos por km si se cargaron como juego / vida útil en km)
                                                                     (SIN combustible ni amortización)
  conductor          = su operador (ya en Personal) → no se suma mano de obra; otra persona → debe estar en Personal
lo transporta otro equipo (transported) → 0 (el costo está en la línea del carretón / batea / camión)
con un vehículo de apoyo (support)      → 0 (el costo está en ese vehículo de la logística auxiliar)
no requiere (none) / sin definir        → 0
externo con movilización incluida       → 0
por día activo = por llamado / días por llamado
```

- Combustible en ruta → categoría **Combustible**; desgaste por km → **Logística**.
- Un equipo propio marcado **"No usa combustible"** (§4) tampoco consume al trasladarse: litros = 0, sigue el desgaste por km y no se pide el consumo en ruta (PLAN-2026-014).
- La amortización ya está en el costo de tenerlo (§4): nunca se suma por km.
- Avisos: falta el consumo en ruta, falta quién maneja, falta el equipo que lo transporta, dos equipos que se transportan entre sí, falta el vehículo de apoyo.

**Ejemplo (caso B):** Vactor por sus propios medios, base → locación 80 km ida y 80 vuelta, 40 L/100 km, desgaste 300 $/km, combustible 1.500/L, sin pickup → 160 km, 64 L, combustible 96.000 + desgaste 48.000 = **144.000 por llamado**; maneja su operador: **no** se agrega mano de obra.

**Ejemplo (caso C):** retroexcavadora "lo transporta otro equipo" = carretón tercerizado por viaje (1.200.000 neto, ida y vuelta = 2 viajes) → la retro suma 0 de movilización; el carretón suma 2.400.000 neto por llamado. Nada se duplica.

### 5.2 Viajes físicos y km de la ruta (PLAN-2026-012)

Archivo: `js/engines/transport-engine.js` (`routeTrips`, `transportSummary`, `traceTransport`). **Unidad de venta ≠ días de trabajo ≠ viajes físicos ≠ km**; cada dato alimenta sólo lo suyo:

```
viajes facturables            = cantidad a facturar por mes (unidad "viaje")
días de trabajo               = viajes facturables ÷ viajes por día        (§12.1, con el mínimo por llamado si rige)
intervenciones (salidas)      = días de trabajo ÷ días por intervención
viajes físicos por intervención:
  unidad "viaje"              = viajes por día × días por intervención     (se DERIVA)
  otras unidades              = "Viajes por llamado" de Movilización y viajes (como siempre)
viajes físicos por mes        = intervenciones × viajes físicos por intervención
km por viaje                  = distancia de ida × (ida y vuelta ? 2 : 1)
km de ruta por mes            = viajes físicos por mes × km por viaje
```

- Proveedor por km → km de ruta; por tramo → tramos (cada ida o vuelta); por viaje completo (ECO-01) → viajes; por día → días; por hora → horas; por mes → fijo; por llamado → intervenciones. Nunca se asume intervención = viaje, viaje = tramo ni día = viaje.
- Sin mínimo por llamado, los viajes físicos de la unidad "viaje" son los facturables: **1, 2 o 3 viajes por día recorren los mismos km** y el proveedor por km cuesta lo mismo (golden). Con mínimo por llamado se costean los viajes que se hacen (el mínimo factura de más).
- **Corrección (bug demostrado, antes → después):** antes la ruta usaba "Viajes por llamado" (1 por defecto) aunque se vendieran 2 viajes por día. COT-0011 con ese dato en 1: 12 viajes facturados pero 6 físicos costeados → proveedor $ 3.900.000, costo $ 8.320.447, sugerida $ 816.000 (−35 %). Ahora: 12 viajes, 2.400 km, $ 7.800.000, costo $ 12.864.478, sugerida $ 1.262.000. Sólo cambian las cotizaciones $/viaje cuyo "Viajes por llamado" no coincidía con viajes por día × días por intervención; el dato guardado no se toca y se muestra un aviso informativo ([Entendido] lo iguala).
- Limitación: con la unidad "viaje" la cantidad de viajes es una sola para todo lo que circula por la ruta (proveedor por km, equipos por sus medios y vehículos de apoyo). Con "cada salida completa" activado, una salida incompleta se costea con todos sus viajes (criterio conservador de §2.1).
- Resumen visible en "Cómo se cobra", "Movilización y viajes" y el Resultado: viajes facturables, viajes físicos costeados, días de trabajo, km por viaje y **km de ruta por mes**, con "Ver cálculo" (`traceTransport`). La distancia / actividad del proveedor se muestra aparte de la movilización propia.
- **Cobro por km: km FACTURABLES ≠ km DE RUTA** (PLAN-2026-014, decisión del dueño LAB-D4). Los km facturables son lo que se cobra (cantidad del mes); los km de ruta, lo que se recorre y se costea (combustible, desgaste, proveedor por km): `transportSummary` expone `billableKmPerMonth` y `billableToRouteKm` (km facturables por km de ruta). **Nunca** se deriva uno del otro ni se pisa lo cargado. "Ver cálculo" muestra los dos, la relación y la diferencia; si se facturan **más** km que los de la ruta, la completitud avisa (`route_consistency`, §19: los costos por km quedarían cortos) y "Ver cálculo" lo explica; si la ruta recorre más (vueltas vacías), se costean todos los km de la ruta.

**Ejemplo (COT-0010 / COT-0011):** 12 viajes facturables, Neuquén → Añelo 100 km (200 km por viaje). COT-0010 a 1 viaje por día: 12 días, 12 intervenciones de 1 viaje. COT-0011 a 2 por día: 6 días, 6 intervenciones de 2 viajes. En ambos 12 viajes físicos × 200 km = **2.400 km × $ 3.250 = $ 7.800.000**.

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

La categoría debe ser una de `labor`, `equipment`, `external`, `fuel`, `materials`, `logistics`, `structure` (`DIRECT_CATEGORY_IDS`; si no, se usa `materials`). El grupo de pago sale de `CATEGORY_PAY_GROUP` (`js/domain/catalogs.js`). `external` ("Equipos y servicios externos", por ejemplo un subcontrato) es un costo **directo** del grupo de pago **Proveedores** (regla real documentada en PLAN-2026-014, LAB-D6).

### 6.1 Moneda y tipo de cambio

Archivo: `js/engines/currency-engine.js` (`conversionFactor`). La cotización calcula en **su** moneda (`quote.currency`, la de la empresa al crearla).

```
valor en moneda de la cotización = valor × tipo de cambio de la cotización      (1 si es la misma moneda o no tiene)
sin tipo de cambio → factor = 0: el valor NO se suma y la validación lo marca en rojo
```

- Se convierten: valor de reposición y residual de un equipo propio (su `base.currency`), la tarifa y la movilización de un externo, el costo unitario de un material.
- Sólo falta el tipo de cambio si el valor nos cuesta algo: un material que provee el cliente, una cantidad 0 o un precio 0 no lo piden.
- Sueldos y costos de tener/usar un equipo propio están siempre en la moneda de la empresa.
- El tipo de cambio lo carga la empresa en cada cotización (con su mes): RATEOS nunca lo consulta ni lo inventa.

### 6.2 Base económica de la oferta

Archivo: `js/engines/economic-base-engine.js` (`summarizeEconomicBase`). Para cada valor que pesa en el costo (personal con sueldo, equipos propios —valor y costos—, externos, combustible que pagamos, materiales que pagamos y tipos de cambio usados) se toma su período base.

```
base general     = mes de quote.offerDate
por rubro        = base más vieja y más nueva
bases distintas  = (más nueva − más vieja) > BASE_SPREAD_MONTHS (3)  → "Esta cotización usa valores con diferentes fechas base."
base vieja       = (mes de la oferta − base) > BASE_STALE_MONTHS (6)
sin base         = "Base no definida" (nunca se inventa una fecha)
```

Son advertencias: no cambian el cálculo. Se compara contra la fecha de la OFERTA, nunca contra "hoy" (el motor es determinístico).

**Usar el mes de la oferta (PLAN-2026-010).** En "Tipo de servicio → Base económica de la oferta" se listan uno por uno los valores sin base y los de base vieja. Para los que no tienen base, la persona puede asignarles el mes de la oferta (`assignOfferBase`, `js/domain/economic-base.js`) **después de confirmar la lista**: nunca se hace solo, nunca pisa una base ya definida (cada recurso puede tener la suya) y queda marcado con la fuente "Mes de la oferta (asignado en la cotización)". No cambia ningún monto.

**Ejemplo (caso F):** oferta de oct-26 con un material de base ene-26 → 9 meses antes → "Un valor tiene una base de más de 6 meses antes de la oferta: Filtros (ene-26)" y, si el resto es de sep/oct-26, "Esta cotización usa valores con diferentes fechas base (de ene-26 a oct-26)."

## 7. Estructura (costos indirectos)

Archivo: `js/engines/cost-engine.js` (dentro de `buildCostModel`).

**Base directa** = todas las líneas de costo directo **excepto** las cargadas con categoría Estructura (personal, standby, equipos, combustible, logística, materiales y otros costos). **Base de mano de obra** = líneas de categoría Mano de obra (incluye standby y otros costos de categoría personal).

| Método (`indirect.method`) | Fijo mensual | Variable por día activo |
|---|---|---|
| `percent_direct` — % sobre costo directo | directos fijos × % | directos variables × % |
| `percent_labor` — % sobre mano de obra | mano de obra fija × % | mano de obra variable × % |
| `per_employee` — monto por empleado | monto × dotación equivalente (personas × % asignado si se comparte, §4.2; sin compartir = la dotación de siempre) | 0 |
| `per_contract` — monto por contrato | monto | 0 |
| `per_hour` — monto por hora operativa | 0 | monto × horas por día activo |
| `manual` — monto mensual manual | monto | 0 |

La estructura es salida de caja (grupo de pago "Estructura y alquileres") y por lo tanto se financia.

**Impuestos ≠ estructura (PLAN-2026-012, sólo presentación).** Ingresos Brutos, el impuesto al cheque y sellos son **impuestos sobre lo que facturás** (§13.1), no gastos de estructura. No hay una capa nueva: el paso Estructura lo aclara y avisa si un rubro desglosado parece uno de esos impuestos (por su nombre), sobre todo si además hay impuestos sobre la facturación cargados (se contarían dos veces). RATEOS no inventa alícuotas.

Ejemplo demo: `percent_direct` 12 % sobre directos fijos 7.259.304,67 y directos variables 658.458,70/día → estructura **871.116,56 fijo + 79.015,04 por día activo**.

**Estructura desglosada por rubro (PLAN-2026-010, opcional).** Con `indirect.mode = 'detailed'`, `indirect.items` es una lista de rubros `{ label, method, pct, amount }` (administración % sobre directo, HSE por empleado, seguros generales por contrato…), cada uno con uno de los métodos de la tabla:

```
estructura fija     = Σ fijo de cada rubro
estructura variable = Σ variable por día de cada rubro
```

Un solo rubro igual al modo simple da exactamente el mismo costo (test). Sin `mode` o con `mode = 'simple'` se usa el método único de siempre: ninguna cotización existente cambia. La empresa puede guardar su desglose como política (`settings.indirectPolicy`) y reutilizarlo en otras cotizaciones; las cotizaciones hechas no cambian.

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
- **Externos: se financia la salida de caja** (neto + IVA + percepciones + cargos no recuperables, §4.1), no el costo económico. Corrección de PLAN-2026-010 (bug P0 de la auditoría COT-0009): antes se financiaba el costo económico, así que el IVA recuperable y las percepciones que se le pagan al proveedor no tenían costo financiero. **Sin tratamiento fiscal definido, caja = costo y nada cambia** (COT-0009 y la foto de 99 casos, idénticas). Antes → después, pickup tercerizada $ 2.800.000/mes en COT-0009 (proveedores a 15 + 60 − 30 = 45 días al 3 % → $ 0,045 por peso):

| Tratamiento fiscal de la pickup | Costo financiero adicional antes | Después |
|---|---:|---:|
| Sin definir (como en el PDF) | 0 | 0 |
| IVA 21 % recuperable | 0 | 26.460 (588.000 × 0,045) |
| IVA 21 % no recuperable | 29.694 | 29.694 (sin cambio: ya era costo) |
| IVA 21 % parcial 50 % | 14.847 | 28.077 |
| IVA 21 % recuperable + percepciones 3 % | 0 | 30.240 (672.000 × 0,045) |

  (El no recuperable y el parcial incluyen la estructura del 10 % sobre el IVA no recuperable, que se paga a 20 días: 55 días.) Tests: `tests/engines/external-finance.test.js`.
- **Plazo de pago por proveedor (PLAN-2026-011):** un equipo o servicio externo con `supplierPayDays` cargado ("¿A cuántos días pagás a este proveedor?") se financia aparte: `días financiados = días hasta facturar + plazo de cobro − plazo de ese proveedor` (nunca negativo), para su tarifa y la movilización que cobra aparte. Vacío → los días de "Proveedores" (como siempre: las cotizaciones existentes dan igual). El costo económico del externo **no cambia**; sólo el capital de trabajo y el costo financiero. Ejemplo COT-0009 (cobro a 15 + 60 días): pickup 2.800.000/mes con plazo propio 15 días → 60 días financiados en lugar de 45 → **+42.000** de costo financiero (2.800.000 × 3 % × 15/30) y +1.400.000 de capital de trabajo. "Ver cálculo" muestra por proveedor: salida de caja, plazo, días financiados, capital de trabajo y costo financiero asociado. La "Condición de pago" de Recursos o un plazo cargado antes como dato informativo no se usan solos: la cotización ofrece [Usar X días].
- **Plazo de cobro sin cargar**: el costo financiero es parcial (sólo los días hasta facturar) y así se dice en la interfaz y en "Ver cálculo"; nunca "no se calcula".
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
| Equipos propios | posesión, mantenimiento y neumáticos, otros costos "equipos" |
| Equipos y servicios externos (v3) | costo económico de alquilados y tercerizados (§4.1) y su movilización si no está incluida |
| Combustible | combustible operativo de equipos + **combustible de traslados** + combustible en ruta de la movilización (§5.1) + combustible no incluido de un alquilado, otros costos "combustible" |
| Materiales | materiales, otros costos "materiales" |
| Logística | desgaste por km (logística auxiliar y movilización), peajes, alojamiento/viáticos, otros costos "logística" |
| Estructura | absorción de estructura + otros costos "estructura" |
| Financiero | costo financiero (§8) |
| Contingencia | contingencia (§9) |

**Fijo del mes y variable por día (PLAN-2026-010).** Cada fila de la EECC trae además `fixedMonthly` (fijo_c × factorMeses(D)) y `variablePerActiveDay` (variable_c). La interfaz muestra "Fijo del mes" y "Variable por día de trabajo" en columnas separadas: el viejo "$/día activo" (monto ÷ D) mezclaba los fijos y no era un costo por día; queda sólo como "equivalente por día al nivel estimado". Ningún número cambia: es otra forma de mostrar el mismo monto.

**Incidencia mostrada = 100 %.** `displayPct` se redondea a 2 decimales con el **método del mayor resto** (`roundPercentagesToTotal` en `js/core/money.js`): se reparten centésimas enteras proporcionalmente, se asignan los pisos y las centésimas faltantes van a las categorías con mayor resto (desempate por orden). Así la suma mostrada es exactamente 100,00 %. Ejemplo: tres categorías iguales → 33,34 % + 33,33 % + 33,33 %. Si el costo total es 0, todas las incidencias son 0 % y el total es 0 %.

EECC del caso demo con 8 días (ILUSTRATIVO):

| Categoría | Monto | Incidencia |
|---|---:|---:|
| Mano de obra | 4.284.508 | 27,16 % |
| Equipos propios | 5.335.667 | 33,82 % |
| Equipos y servicios externos | 0 | 0,00 % |
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

**Con impuestos sobre la facturación** (`t`, §13.1) el margen sigue siendo sobre el precio, pero el precio tiene que cubrir también los impuestos:

```
precio                   = costo / (1 − margen − t)                    priceFromMarginAndTaxes   (válido si margen + t < 100)
markup                   = precio / costo − 1 = (margen + t) / (1 − margen − t)    markupWithTaxesPct
ganancia sobre el costo  = resultado / costo = margen / (1 − margen − t)           profitOnCostPct
```

El **markup** sigue siendo lo de AGENTS.md §9 (`precio = costo × (1 + markup)`): con impuestos, el recargo sobre el costo cubre impuestos **y** ganancia. La **ganancia sobre el costo** es sólo la parte que queda (lo que en una planilla en cascada suele llamarse "beneficio sobre costo"); no es un markup y se rotula aparte.

Costo 100, margen 10 %, t 10 % → precio **125**, impuestos 12,5, resultado 12,5 (10 % del precio), markup **25 %** (125 = 100 × 1,25), ganancia sobre el costo **12,5 %**. Sin impuestos ambos dan 11,11 %. Con `t = 0` las dos funciones dan exactamente `marginToMarkup` y `priceFromMarginAndTaxes` da `priceFromMargin`. En la tarifa piso (margen 0) el markup es `t / (1 − t)` (11,11 % con t 10 %: el recargo cubre sólo impuestos) y la ganancia sobre el costo, 0.

Escalera de precios (`priceLadder(costo, márgenes, personalizado, t)`): tarifa piso (margen 0), margen 5 %, 10 %, 15 % (`DEFAULT_MARGIN_LADDER` o `settings.marginLadder`) y margen personalizado (si es válido, mayor a 0 y no está en la escalera). Para costo 100 sin impuestos: 100,00 / 105,26 / 111,11 / 117,65 / personalizado 20 % → 125,00 (markups equivalentes 0 / 5,26 / 11,11 / 17,65 / 25 %). Cada fila trae además `billingTaxes` (= t × precio), `gain` (= margen × precio), `markupPct` (`markupWithTaxesPct`) y `profitOnCostPct`, de modo que **precio = costo + impuestos + ganancia**; con t 10 %: 111,11 / 117,65 / 125,00 / 133,33 (markups 11,11 / 17,65 / 25 / 33,33 %). Se omiten los márgenes con margen + t ≥ 100.

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
| Fee de disponibilidad | `availabilityFeeMonthly` | monto mensual fijo (× meses). Con la tarifa en **$/mes (abono)** se sumarían dos abonos por mes: pendiente **crítico** `monthly_fee_overlap` (ECO-01, §19 y §12.2); la fórmula no cambia |
| Descuento comercial | `pricing.commercialDiscountPct` | multiplica el factor de descuentos |

### 12.0 Cómo se compone la facturación del mes (ECO-01, AUD-T1 H-02)

Archivo: `js/engines/commercial-rules-engine.js` (`revenueComposition`). Presenta, **sin calcular nada nuevo**, los componentes de `computeRevenue` que suman en el mes con la actividad estimada, en este orden: tarifa × unidades (`base`), abono de disponibilidad, cargos por llamado, movilización, km adicionales, equipo en espera, materiales facturados aparte (fijos + variables), horas extra facturadas aparte (fijas + variables) y el ajuste al mínimo mensual garantizado. Sólo las filas mayores que 0; **las filas suman el total** (`revenue.total`). El Resultado lo muestra en "Cómo se factura el servicio" ("Cómo se compone la facturación del mes").

**Abono mensual + abono de disponibilidad.** Con la tarifa en $/mes, la tarifa ya es el abono: un "Abono de disponibilidad" > 0 es un segundo cargo fijo del mismo mes y **se suma** (fórmula histórica, no se elimina en silencio). Ejemplo (regresión ECO-01, escenario E1): tarifa conocida 25.000.000 + abono de disponibilidad 25.000.000 → facturación 50.000.000, cuando con un solo abono es 25.000.000. Desde ECO-01 esa combinación es un pendiente **crítico** (`monthly_fee_overlap`): el resultado queda como BORRADOR (no confiable) hasta dejar un solo abono. En modo "calculá", la tarifa sugerida ya descuenta el abono de disponibilidad (es un "otro ingreso", §13): el aviso lo dice. Dos cargos fijos distintos se expresan igual con un número: la tarifa mensual. **Siguen igual** los modelos legítimos: abono mensual fijo solo; abono de disponibilidad + tarifa por uso (día, hora, llamado, cantidad); mínimo mensual garantizado (con abono o con tarifa por uso).

### 12.1 Unidad de facturación según el tipo de servicio (PLAN-2026-009)

Archivos: `js/domain/billing-units.js` (catálogo y textos), `js/engines/cost-engine.js` (`activeDaysForQuantity`, `normalizeActivity`), `js/engines/commercial-rules-engine.js` (`billableUnits`, `unitHasDayTiers`), `js/engines/quote-engine.js` (cantidad de equilibrio).

**UNIDAD DE COSTO ≠ UNIDAD DE VENTA.** Los costos se siguen calculando con sus drivers reales (días de trabajo: personal, equipos, combustible, viajes, materiales por día o por llamado). La facturación se expresa en la unidad comercial que elige la empresa:

```
facturación base = cantidad facturable × tarifa neta por unidad
```

| Tipo (`billingUnitOf(quote).kind`) | Unidades (`quote.unit`) | Actividad que se carga | Días de trabajo D (derivados) | Cantidad facturable |
|---|---|---|---|---|
| `day`, `hour`, `month` | `day`, `hour`, `month` | días de trabajo (como siempre) | `activity.activeDaysPerMonth` | igual que antes (tabla de arriba) |
| `quantity` | `m3`, `trip`, `km`, `ton`, `tonkm`, `unit`, `kg`, `meter`, `m2`, `lot`, `shift` y `custom` (unidad propia: pozo, muestra…) | cantidad por mes `Q` + cantidad por día de trabajo `r` (rendimiento) | `D = Q / max(días por llamado × r, minimum call) × días por llamado` (sin minimum call: `Q / r`) | `llamados × max(días por llamado × r, minimum call)` |
| `event` | `call` ($/llamado), `job` ($ global por trabajo), `milestone` ($/hito) | llamados o trabajos (o hitos) por mes + días de trabajo de cada uno (+ hitos por trabajo) | `D = Q / hitos por trabajo × días por llamado` | `llamados × hitos por trabajo` (1 si no es por hito); el minimum call no aplica |

- La cantidad de equilibrio se busca sobre D con el mismo algoritmo robusto de §15 y se expresa en la unidad comercial: `cantidad de equilibrio = cantidad facturable(D de equilibrio)`. Lineal: `Q* = (costos fijos − ingresos fijos × (1 − t)) / (tarifa × (1 − t) + otros ingresos por unidad − costo variable por unidad)`, con `costo variable por unidad = costo variable por día de trabajo / unidades por día`.
- Tarifa piso, objetivo y sugerida: las mismas fórmulas de §13 con las unidades facturables de esta tabla ("$ 8.450 / m³"). Nunca "/ día" si no se cobra por día.
- **Descuentos por cantidad de días (§14) sólo con `day` u `hour`.** Con `month`, `quantity` o `event` no se aplican (los tramos quedan guardados, no se borran).
- Sin rendimiento (`r` vacío o 0, sin minimum call) no hay días de trabajo: los costos variables quedan en 0 y la cotización muestra un error ("Cargá cuántos m³ hacés por día de trabajo"). Una cantidad negativa es un error y se toma como 0. Si los días derivados superan los disponibles del mes, se avisa (como en §16: se interpreta como trabajo de más de un mes).
- Una unidad que no es habitual para el tipo de servicio (por ejemplo, $/día en "Servicio por unidad producida") **calcula igual** y muestra un aviso.
- Sensibilidad y escenarios (§17): la variación de actividad cambia la cantidad del mes; los días se derivan (tope: los días disponibles).

**Horas y materiales** (`pricing.materialsBilledSeparately = true`): los materiales se facturan aparte. Siguen siendo costo (no cambia el costo del mes) y lo que se cobra por ellos suma a los otros ingresos:

```
materiales facturados = costo del material (con merma y logística) × (1 + markup de reventa %)
                        (fijos del mes × meses; por día o por llamado × D)
```

Sin la opción (o en cotizaciones anteriores) nada cambia: la tarifa cubre los materiales, como siempre.

**Compatibilidad:** `$/día`, `$/hora` y `$/mes` calculan exactamente igual que antes (foto completa de 99 casos idéntica; tests `tests/engines/billing-units.test.js` y golden `unidad-on-call-dia.json`). Única diferencia de texto: el rótulo "Unidades facturables (mess)" de "Ver cálculo" pasa a "(meses)".

Casos de referencia (golden):

| Caso | Datos | Resultado |
|---|---|---|
| A — bombeo $/m³ | 10.000 m³/mes, 500 m³/día, fijos 30.000.000, variable 1.000.000 por día de trabajo, tarifa 7.000/m³, margen 20 % | 20 días de trabajo; costo 50.000.000; piso **5.000/m³**; objetivo **6.250/m³**; equilibrio **6.000 m³** (12 días) |
| B — transporte $/viaje | 40 viajes/mes, 2 por día, fijos 12.000.000, variable 600.000/día, tarifa 900.000, margen 25 % | costo 24.000.000; piso **600.000/viaje**; objetivo **800.000**; equilibrio **20 viajes** (10 días) |
| C — movimiento de suelo $/m³ | 5.000 m³/mes, 250 m³/día, fijos 20.000.000, variable 1.500.000/día, margen 15 % | costo 50.000.000; piso **10.000/m³**; objetivo **11.764,71/m³**; equilibrio **2.500 m³** |
| D — inspección $/unidad | 300 u/mes, 15 por día, fijos 3.000.000, variable 150.000/día, margen 10 % | costo 6.000.000; piso **20.000/u**; objetivo **22.222,22/u**; equilibrio **200 u** |
| E — on-call $/día | 15 días/mes, fijos 30.000.000, variable 1.000.000/día, tarifa 4.000.000 | piso **3.000.000/día**; equilibrio **10 días** (igual que siempre) |

## 13. Tarifa piso, precio objetivo y precio comercial

Archivos: `js/engines/commercial-rules-engine.js` (`requiredNetRate`, `listRateFromNet`), `js/engines/economics-engine.js` (`requiredRatesAt`, `evaluateAt`), `js/engines/quote-engine.js` (`computeQuote`).

| Concepto | Definición |
|---|---|
| **COSTO** | Costo(D) del mes (§10). |
| **TARIFA PISO** | Tarifa **neta** por unidad que iguala la facturación con el costo (margen 0). |
| **PRECIO OBJETIVO** | Tarifa por unidad que logra el margen objetivo (`pricing.targetMarginPct`). |
| **PRECIO COMERCIAL** | Tarifa **de lista** finalmente ofrecida al cliente. |

Tarifa neta necesaria para un margen `m` sobre la facturación total, con impuestos sobre la facturación `t` (§13.1; `t = 0` si no aplican o están sin definir):

```
facturación necesaria = Costo(D) / (1 − m − t)
tarifa neta(m)        = (facturación necesaria − otros ingresos(D)) / unidades facturables(D)
tarifa de lista(m)    = tarifa neta(m) / factor de descuentos
tarifa piso           = tarifa neta(0)          (cubre el costo y los impuestos: Costo / (1 − t))
```

Los otros ingresos también tributan: se restan de la facturación necesaria ya calculada con el gross-up.

- Si las unidades facturables son 0 (por ejemplo, 0 días), la tarifa es `null` ("—").
- Si los otros ingresos ya cubren la facturación necesaria, la tarifa es 0 y se marca `coveredByOtherRevenue`.
- Si el factor de descuentos es 0 (descuento 100 %), la tarifa de lista es `null`.
- El **mínimo garantizado NO se usa** para calcular tarifas necesarias (criterio conservador: no se cuenta con un ingreso que sólo aparece si la actividad es baja). Sí se usa al evaluar el resultado y el break-even con una tarifa dada; por eso la alerta `belowFloor` exige además que el mes dé pérdida (§20).
- Margen objetivo **vacío** → se calcula con 0 y el Cost Completeness Score lo marca en rojo. Margen objetivo **inválido** (≥ 100, < 0 o no numérico) **o margen + t ≥ 100** → no hay precio objetivo ni tarifa sugerida (`null`), `kpis.targetMarginInvalid = true`, la cotización queda `atRisk` y las trazas lo explican. Antes se usaba 0 % en silencio y la "sugerida" quedaba igual a la piso (PLAN-2026-002, PN3). Margen personalizado inválido, 0 o con margen + t ≥ 100 → no se muestra.

**Tarifa comercial sugerida** = tarifa objetivo de lista redondeada **hacia arriba** al múltiplo de `pricing.roundingStep` (`commercialRound`; paso 0 = sin redondeo). Nunca baja el margen. Ejemplo demo: 2.258.948,79 → **2.259.000** con paso 1.000.

**Tarifa comercial (de lista) usada para evaluar**, en orden de prioridad (`kpis.commercialSource`):

1. `override`: tarifa forzada por el motor de sensibilidad (tarifa fija, §17).
2. `known_rate`: modalidad "Conozco la tarifa" → `pricing.knownRate` (si es > 0).
3. `offered`: `pricing.offeredRateOverride` (si es > 0).
4. `suggested`: tarifa comercial sugerida.
5. `none`: no hay tarifa (también cuando la fuente elegida no da una tarifa mayor a 0, por ejemplo "Conozco la tarifa" sin tarifa cargada).

Con esa tarifa: tarifa neta comercial = lista × factor de descuentos (con el tramo que corresponda a la actividad estimada), facturación, `impuestos = t × facturación`, `resultado = facturación − impuestos − costo`, margen = resultado / facturación (antes de Ganancias) y markup = resultado / costo (recargo efectivo sobre el costo).

Equivalencias informativas (`result.equivalents`):

| Unidad | $/hora | $/día | $/mes |
|---|---|---|---|
| `day` | tarifa / horas por día activo | tarifa | facturación total |
| `hour` | tarifa | tarifa × horas por día activo | facturación total |
| `month` | — | tarifa / D | facturación total |

**Modo A — "Conozco la tarifa"** (`known_rate`): se ingresa la tarifa y RATEOS calcula días mínimos (break-even), días para el margen objetivo, resultado y margen esperados. **Modo B — "Conozco la actividad"** (`known_activity`): se ingresa la actividad estimada y RATEOS calcula tarifa piso y tarifas con margen 5 %, 10 %, 15 % y personalizado.

Ejemplo demo (modo B, 8 días, ILUSTRATIVO): tarifa piso neta ≈ 1.972.062/día; con el tramo 8–15 días (3 % de descuento) la piso de lista ≈ 2.033.054; objetivo 10 % neta ≈ 2.191.180, de lista ≈ 2.258.949; sugerida 2.259.000; facturación ≈ 17.529.840; resultado ≈ 1.753.342; margen ≈ 10,00 %; markup ≈ 11,11 %.

**Neta y de lista.** La tarifa que se escribe en la cotización es la **de lista**; la neta es lo que efectivamente se cobra después de descuentos (`neta = lista × factor de descuentos`). Para comparar con la tarifa conocida o la ofrecida hay que usar la tarifa de lista: cobrar como lista la tarifa piso **neta** (1.972.062 en la demo) deja un resultado negativo porque después se le aplica el descuento del tramo (resultado ≈ −473.297, margen ≈ −3,09 %).

**Traza "Tarifa piso"** (`traces.floorRate`): entradas costo total, impuestos sobre la facturación (si t > 0), otros ingresos, unidades facturables y factor de descuentos (tramo × continuidad × comercial); pasos intermedios "Facturación necesaria" (si t > 0) y "Tarifa piso neta"; resultado "Tarifa piso de lista". Fórmula: `Tarifa piso neta = (Costo total − Otros ingresos) / Unidades facturables · Tarifa piso de lista = neta / factor de descuentos` (con t > 0, antes `Facturación necesaria = Costo total / (1 − impuestos sobre la facturación)`). Así el "Ver cálculo" termina en el mismo número que se muestra como tarifa piso de lista (2.033.054 en la demo). Con impuestos sin definir, una nota avisa que la tarifa piso **no** los incluye.

### 13.1 Impuestos sobre la facturación (gross-up)

Archivos: `js/engines/billing-taxes-engine.js` (`billingTaxInfo`, `billingTaxConfigInfo`, `traceBillingTaxes`), `js/domain/billing-taxes.js` (forma de los datos), `js/engines/pricing-engine.js` (`priceFromMarginAndTaxes`, `markupWithTaxesPct`, `profitOnCostPct`). Plan: PLAN-2026-002 en [.agent/PLANS.md](../.agent/PLANS.md).

Son los impuestos que se pagan **sobre lo que se factura** (sin IVA): Ingresos Brutos, impuesto a los débitos y créditos (como % equivalente sobre la facturación sin IVA), sellos del contrato y otros cargos proporcionales a lo facturado. **No son costo**: dependen del precio. Por eso no entran en la estructura de costos (EECC), ni en la base de la contingencia o del financiero, y se cubren con un **gross-up exacto** junto con el margen:

```
t                     = Σ alícuotas sobre lo facturado (puntos)
facturación necesaria = Costo / (1 − m − t)                (sólo si m + t < 100)
impuestos             = t × facturación
resultado             = facturación − impuestos − costo = facturación × (1 − t) − costo
margen                = resultado / facturación         (sobre el precio, antes del impuesto a las Ganancias)
markup                = facturación / costo − 1         (en el objetivo: (m + t) / (1 − m − t))
ganancia sobre costo  = resultado / costo               (en el objetivo: m / (1 − m − t))
```

| Ejemplo sintético (costo 100) | Sin impuestos | t = 10 % |
|---|---:|---:|
| Tarifa piso (m = 0) | 100,00 | **111,11** |
| Precio con margen 10 % | 111,11 | **125,00** |
| Impuestos con margen 10 % | 0 | 12,50 |
| Resultado con margen 10 % | 11,11 | 12,50 |
| Markup con margen 10 % (recargo sobre el costo) | 11,11 % | **25,00 %** |
| Ganancia sobre el costo con margen 10 % | 11,11 % | 12,50 % |

Prohibido: `(1 − m)(1 − t)` (daría 123,46), aplicar t sobre el costo (121) o sobre la tarifa de lista. La base es la **facturación neta total** del mes: tarifa neta × unidades + otros ingresos + ajuste por mínimo garantizado (el ajuste también tributa).

**Datos** (`quote.billingTaxes`, esquema v2), con dos modos **excluyentes** para no contar dos veces lo mismo:

| Campo | Significado |
|---|---|
| `mode` | `combined` ("Un % total") o `detailed` ("Detalle por impuesto"). Sólo se usa el del modo elegido |
| `combinedPct` | % total (modo `combined`) |
| `items[]` | `{ id, kind, label, pct }` con `kind` en `BILLING_TAX_KINDS` (Ingresos Brutos, débitos y créditos, sellos, otro) — sólo nombres: **RATEOS no trae alícuotas** (AGENTS.md §7) |
| `notApplicable` | "No incluir impuestos sobre la facturación en esta cotización" → t = 0 y definido (elección de cálculo, no una afirmación fiscal) |

Estados (`billingTaxInfo`): **sin definir** (ni %, ni detalle, ni "no aplica") → `t = 0`, `defined = false` y la tarifa piso NO incluye estos impuestos (la traza y la interfaz lo avisan); **definido** (incluso 0 % explícito); **inválido** (algún % negativo o no numérico, o un total ≥ 100) → se calcula con `t = 0`, `invalid = true`, `validateQuote` informa el error y la completitud lo marca en rojo. Los porcentajes en texto se leen como en la validación (`"4,5"` → 4,5).

**Sellos** se modela proporcional a la facturación: es exacto con la actividad estimada y una aproximación con otra actividad (la traza lo aclara). **No incluye** IVA, Ganancias, retenciones/percepciones (pagos a cuenta) ni costo financiero (RATEOS lo calcula por plazos, §8).

**Limitación conocida:** no se modela el costo financiero de pagar estos impuestos antes de cobrar (se devengan al facturar y el cobro llega a N días). Con plazos largos, si es relevante, se carga como otro costo o se contempla en el margen.

**Convención de montos: sin IVA** (`quote.vatTreatment`, esquema v2). Costos, tarifas, facturación e impuestos sobre la facturación se cargan y calculan **sin IVA**: el IVA no es costo ni ingreso de la empresa. Es la única convención que soporta esta versión (`VAT_TREATMENTS` en `js/domain/catalogs.js`, valor `excluded`) y queda **explícita en cada cotización** (la migración v1 → v2 la agrega; las cotizaciones nuevas nacen con ella). La interfaz la muestra al cargar ("Montos sin IVA" en el editor, en los formularios de equipos, materiales y combustible, y en el resultado e impresión). Una cotización con otra convención **no se calcula en silencio como si fuera sin IVA**: `validateQuote` informa un error y el resultado lo muestra. Si en el futuro se soportan montos con IVA, se agrega el valor al catálogo y la conversión en el motor, sin cambiar la forma de los datos.

**Valor de la empresa** (`settings.defaultBillingTaxes`, `null` = sin definir): una cotización nueva arranca con ese valor si la empresa ya decidió (`billingTaxesForNewQuote`), **aunque la configuración sea la de demostración** (es un dato propio que cargó el usuario); si no, sin definir. Una plantilla sólo lo pisa si trae una decisión propia. La demo queda **sin definir** a propósito.

**Traza** (`traces.billingTaxes`): alícuotas cargadas, facturación del mes, t total e impuestos del mes, con las notas de sin definir / inválido / Sellos / exclusiones.

### 13.2 Composición del precio, apropiación y total del contrato

Archivo: `js/engines/price-composition-engine.js` (`priceComposition(result)`), función pura sobre el resultado de `computeQuote` (no recalcula el motor). Plan: PLAN-2026-002 (PN4/PN5).

"¿Cómo se forma tu precio?" descompone la **facturación del mes** (sin IVA) con la tarifa que se cotiza:

```
Facturación = Σ costo por rubro (8 categorías de la EECC) + impuestos sobre la facturación + resultado
% del precio de cada fila = fila / Facturación
```

- Suma **100 % del precio**; la EECC (§10) suma 100 % del **costo**: nunca van en la misma tabla.
- Con ganancia, los % mostrados suman exactamente 100 (método del mayor resto: 2 decimales en la tabla, 1 decimal en "De cada $ 100…"). Con **pérdida** no se fuerza el 100 %: el costo (y los impuestos) superan lo facturado y el resultado es negativo; se redondea en forma simétrica (118,75 → 118,8; −18,75 → −18,8).
- Sin tarifa o sin facturación (0 días) → no disponible, con motivo.

**Apropiación por unidad facturable** (proporcional al precio):

```
parte de la fila en la tarifa = tarifa neta × fila / Facturación
Σ partes = tarifa neta · tarifa de lista = tarifa neta / factor de descuentos
```

Si hay otros ingresos (cargos por llamado, abono, mínimo garantizado), la tarifa neta se reparte en la misma proporción que la facturación del mes.

**Total del contrato** = valores del mes × `contractMonths` (misma actividad todos los meses, sin ajustes por índices).

**Ejemplo sintético** (fijos 30.000.000, variable 1.000.000/día, 10 días, margen 10 %, impuestos 10 %): facturación 50.000.000 = costo 40.000.000 (80 %) + impuestos 5.000.000 (10 %) + ganancia 5.000.000 (10 %); por día: 4.000.000 + 500.000 + 500.000 = 5.000.000 (tarifa neta); contrato de 12 meses: 600.000.000 facturados, 60.000.000 de ganancia.

**Los números cierran** (`checks`, en "Ver cálculo completo"): facturación = costo + impuestos + resultado; los rubros suman el costo del mes; impuestos = t × facturación; los % del precio suman 100 (no aplica con pérdida); la apropiación por unidad suma la tarifa neta; lista × factor = neta; margen = resultado / facturación. Si alguno falla es un error de cálculo, no un dato del usuario (la interfaz lo avisa). Tests: `tests/engines/price-composition-engine.test.js` (caso exacto, pérdida, sin tarifa y todas las plantillas).

**Presentación hacia arriba.** Las tarifas mínimas (piso, objetivo y sugerida) que se muestran sin decimales se redondean **hacia arriba** con `formatMoneyCeil` (`js/core/format.js`): cobrar la cifra que se ve nunca deja debajo del piso o del objetivo. Ejemplo con redondeo comercial 0 (caso de referencia con 10 días): tarifa objetivo 4.444.444,44 → se muestra **$ 4.444.445** (con `formatMoney` se vería $ 4.444.444, que cobrado da un margen de 9,99999 %, "debajo del objetivo", y 11 días enteros para el margen objetivo en lugar de 10). El valor interno del motor no cambia.

## 14. Descuentos por volumen y continuidad

Archivos: `js/engines/commercial-rules-engine.js` (`DEFAULT_VOLUME_TIERS` —definidos en `js/domain/catalogs.js` y re-exportados—, `normalizeTiers`, `findVolumeTier`, `tierLabel`, `classifyDiscount`, `continuityApplies`), `js/engines/quote-engine.js` (`evaluateDiscountTiers`, `minActiveDaysForBillableDays`).

**Tramos por defecto** (0 % de descuento): 1 día · 2–7 días · 8–15 días · 16–30 días · +30 días (`fromDays` 31, `toDays` vacío).

**Búsqueda del tramo** (`findVolumeTier`): los tramos se ordenan por "desde"; aplica **el último tramo cuyo "desde" sea ≤ días facturables** (tolerancia 1e-9). Con 0 días no hay tramo. El "hasta" sólo se usa para la etiqueta: 7,5 días cae en el tramo 2–7. Con unidad `month`, por cantidad (m³, viaje…) o por evento (llamado, trabajo, hito) no se aplican tramos (§12.1). Los tramos que no son objetos se ignoran; si no queda ninguno se usan los tramos por defecto.

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
contribución por día = tarifa por día × (1 − t) − costo variable por día
break-even (días)    = costos fijos / contribución por día
días enteros         = ceilTolerant(break-even)       (10,0000000001 → 10, no 11)
```

- Fijos = 0 → break-even 0 días.
- Contribución ≤ 0 → **inalcanzable**: "La tarifa no cubre el costo variable por día: nunca se alcanza el equilibrio." (con t > 0: "Lo que te queda de la tarifa después de los impuestos sobre la facturación no cubre el costo variable por día…"). t ≥ 100 → inalcanzable.
- Caso básico con t = 10 %: contribución 4.000.000 × 0,9 − 1.000.000 = 2.600.000 → **11,54 días** (12 enteros). Con t = 0 sigue siendo **10 días**.

**Problema inverso** (`minimumRateForDays`): `tarifa mínima = (costos fijos / días + costo variable por día) / (1 − t)`. Ejemplo: fijos 30.000.000, variable 1.000.000, 6 días → **6.000.000/día** (con t = 10 %: 6.666.666,67; D ≤ 0 o t ≥ 100 → `null`).

### Algoritmo numérico robusto (el que usa `computeQuote`)

Con reglas comerciales (mínimo garantizado, tramos, minimum call, fees) el resultado deja de ser lineal en D. `findBreakEvenDays(resultado(D), { maxDays })`:

1. Evalúa una grilla de paso **0,1 día** entre 0 y `maxDays` (= días disponibles del mes).
2. Toma el **último** punto con resultado negativo (tolerancia `PROFIT_TOLERANCE` = 1e-6).
3. Refina por **bisección** entre ese punto y el siguiente (hasta 80 iteraciones o 1e-10).
4. Si el resultado está a menos de 1e-7 de un entero que cumple, devuelve el entero exacto.

**Definición:** break-even = menor D **a partir del cual ya no se pierde**: resultado(D) ≥ 0 y se mantiene ≥ 0 hasta los días disponibles. Casos:

- Ningún punto negativo → 0 días, con su motivo (`breakEven.zeroReason`, PLAN-2026-012): `no_fixed_costs` (sin costos fijos: "Sin costos fijos: cada viaje vendido cubre su costo variable. Desde el primer viaje hay contribución positiva." — nunca "0 viajes") o `fixed_revenue` (los ingresos fijos —abono, standby— ya cubren los costos fijos).
- El último punto (días disponibles) es negativo → **inalcanzable**: "No se alcanza el equilibrio dentro de los N días disponibles del mes."
- Unidad `month` → no aplica ("Con abono mensual la facturación no depende de los días activos").
- Sin tarifa → no se puede calcular.

**Ejemplos de la definición robusta** (golden cases):

- Fee de disponibilidad 6.000.000/mes sobre el caso básico: break-even = (30.000.000 − 6.000.000) / (4.000.000 − 1.000.000) = **8 días**.
- Mínimo garantizado 35.000.000/mes sobre el caso básico: facturación = max(35.000.000, 4.000.000 × D). Con menos de 5 días se gana (el mínimo cubre los costos), entre 5 y 10 días se pierde y desde 10 días ya no se pierde → break-even robusto **10 días** (no 0). Con 8 días se facturan 35.000.000 y se pierden 3.000.000.

**Días para margen objetivo** (`kpis.targetMarginDays`): misma búsqueda sobre `resultado(D) − margen objetivo × facturación(D) ≥ 0` (el resultado ya descuenta los impuestos sobre la facturación). Caso básico con margen 10 %: 2,6 × D − 30 ≥ 0 (en millones) → ≈ 11,54 días (12 enteros). Con margen objetivo inválido o margen + t ≥ 100 no se calcula (motivo explícito).

**Traza "Ver cálculo"** (`traceBreakEven` + `linearDecomposition`): muestra costos fijos, ingresos fijos (fee de disponibilidad + standby), ingreso por tarifa por día activo (tarifa neta por unidad × unidades del día; con unidad hora es un valor **por día**, no por hora), otros ingresos por día activo, costo variable por día y contribución:

```
break-even = (costos fijos − ingresos fijos × (1 − t)) / (ingreso por día × (1 − t) − costo variable por día)
```

(con t = 0 es la fórmula de siempre; la traza muestra el factor `(1 − impuestos sobre la facturación)` sólo si t > 0).

La descomposición (`result.linear`) se evalúa **en el punto de equilibrio** (`max(break-even, 1)` días) cuando el break-even se alcanza y es mayor a 0, porque ahí rige el tramo de descuento que realmente aplica; si no, se evalúa con la actividad estimada. Así las entradas de la traza dan el resultado informado. Si hay reglas no lineales (mínimo garantizado, minimum call aplicado o algún tramo con descuento), la traza lo aclara: el resultado se calculó día a día, no sólo con la fórmula.

**Ejemplo demo (ILUSTRATIVO):** el equilibrio cae en ≈ 6,38 días, dentro del tramo **2–7 días (0 % de descuento)**: tarifa neta = lista = 2.259.000/día. Fijos ≈ 9.031.407, variable ≈ 843.136/día → contribución ≈ 1.415.864/día → break-even = 9.031.407 / 1.415.864 ≈ **6,38 días** (7 días enteros). Con los 8 días estimados (tramo 8–15, neta 2.191.230) la contribución sería 1.348.094 y la fórmula daría 6,70: por eso la traza no usa la actividad estimada. Días para margen 10 % ≈ 7,59 (8 enteros).

## 16. Utilización y matriz tarifa × utilización

Archivo: `js/engines/utilization-engine.js` (`utilizationPct`, `activeDaysFromUtilization`, `matrixDays`, `buildRateUtilizationMatrix`).

```
utilización %                = días activos / días disponibles × 100      (null si no hay disponibilidad)
días activos (utilización u) = min(max(u, 0), 100) / 100 × días disponibles
tarifa necesaria(D, m)       = (Costo(D) / (1 − m − t) − otros ingresos(D)) / unidades(D)
```

Con tarifa por día o por hora, a mayor utilización, menor tarifa unitaria necesaria (los fijos se reparten entre más días); a menor utilización, mayor tarifa. **Con abono mensual (`month`) es al revés:** se factura 1 abono por mes sea cual sea D (hasta los días disponibles), así que el abono necesario `Costo(D) / (1 − m − t)` **crece** con los días porque crece el costo variable. Ejemplo (caso de referencia en $/mes): piso 35.000.000 / 38.000.000 / 40.000.000 / 45.000.000 / 50.000.000 para 5 / 8 / 10 / 15 / 20 días.

**Días de la matriz** (`matrixDays`): los configurados (`settings.matrixDays`, por defecto `DEFAULT_MATRIX_DAYS` = 5, 8, 10, 15, 20) + la actividad estimada si es > 0; sin duplicados, ordenados. Márgenes: `settings.marginLadder` (por defecto 5, 10, 15) + el personalizado.

Cada fila tiene: días, utilización %, tarifa piso neta, tarifas neta y de lista y facturación necesaria por margen (con el tramo de esos días; se omiten los márgenes con margen + t ≥ 100), costo y, si hay tarifa comercial, facturación, resultado (después de impuestos sobre la facturación), margen y descuento del tramo. Marca la fila de la actividad estimada (`isEstimate`) y las que superan los días disponibles (`exceedsAvailability`).

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

Compara cuatro formas de cobrar el mismo servicio (tarifa por día). Requiere actividad estimada `De > 0`, margen objetivo válido y margen + t < 100 (si no, devuelve `models: []` con el motivo). Con `k = 1 − margen − t`, `C(D)` = costo total con D días, `Fijos = C(0)`, `v` = costo variable por día y `Dp = max(0, De × (1 + actividad pesimista%))` (por defecto −25 %), cada modelo se **calibra** para lograr el margen objetivo con la actividad estimada **después de impuestos sobre la facturación** (`resultado(D) = R(D) × (1 − t) − C(D)`):

| Modelo | Facturación R(D) | Calibración |
|---|---|---|
| Sólo tarifa por día | `p × D` | `p = C(De) / (k × De)` |
| Fee de disponibilidad + tarifa por día | `Fee × factorMeses(D) + q × D` | `Fee = Fijos / k`, `q = v / k` |
| Mínimo garantizado + tarifa por día | `max(G × factorMeses(D), p × D)` | `G = Fijos / (1 − t)` (cubre los fijos después de impuestos) |
| Paquete mensual + excedentes | `Paquete + p × max(0, D − De)` | `Paquete = C(De) / k` |

El fee y el mínimo garantizado son montos mensuales: igual que los costos fijos (§1) y que `computeRevenue` (§12), se multiplican por `factorMeses(D)` cuando los días superan los disponibles. Así `R(D) = C(D) / k` también con `De` mayor a los días disponibles y los cuatro modelos logran el margen objetivo con la actividad estimada (ejemplo: caso de referencia con De = 35 y 30 disponibles → los 4 modelos dan margen 10 % y facturan ≈ 77.777.778; antes "Fee + tarifa" daba 3,08 %).

Para cada modelo: ingreso, resultado y margen esperados (con `De`), ingreso, resultado y margen pesimistas (con `Dp`), **ingreso mínimo asegurado** = R(0), break-even con el algoritmo numérico (§15, con el resultado después de impuestos) y **riesgo**: alto si el resultado pesimista es negativo; medio si el margen pesimista es menor a la mitad del objetivo; bajo en otro caso. El comparador usa una facturación simplificada (sin tramos, fees ni descuentos de la cotización) para comparar los modelos entre sí.

Ejemplo (caso de referencia, margen 10 %, sin impuestos, De = 8, Dp = 6): `p ≈ 5.277.778`, `Fee ≈ 33.333.333` + `q ≈ 1.111.111`, `G = 30.000.000`, `Paquete ≈ 42.222.222`. Todos facturan ≈ 42.222.222 con 8 días; break-even ≈ 7,01 días para "sólo tarifa" y "mínimo garantizado" (riesgo alto) y 0 días para "fee + tarifa" y "paquete" (riesgo bajo). Con t = 10 % y De = 10: `p = 5.000.000`, `G ≈ 33.333.333`; los cuatro modelos facturan 50.000.000 y dejan 5.000.000 (10 %).

**Por cantidad o por evento ($/m³, $/viaje, $/unidad — PLAN-2026-010).** Con unidad de facturación por cantidad o evento (§12.1) los cuatro modelos son los mismos, con la misma facturación R(D) y la misma calibración, pero sus parámetros se expresan en la unidad comercial con `u` = unidades facturables por día de trabajo: "Sólo tarifa por m³" (`p / u`), "Abono de disponibilidad + tarifa por m³" (`q / u`), "Facturación mínima mensual (take-or-pay) + tarifa por m³" y "Paquete mensual con m³ incluidos + excedente" (`De × u` incluidos). El break-even se informa también en la unidad (`días × u`). Mismos ingresos y resultados que por día (test COT-0009: 2.400 m³ = 20 días × 120 m³). Sin rendimiento por día no se arman modelos (se pide cargarlo).

La sensibilidad y los escenarios conservan los impuestos de la cotización: con la tarifa fija, los impuestos se recalculan sobre la facturación de cada escenario (`billingTaxes` en cada fila).

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
| 3 | `utilization` | on-call o "Conozco la actividad"; por cantidad o evento; cobro por hora | 2 | ok si días activos > 0 (por cantidad: cantidad del mes > 0 y, si es cantidad, cantidad por día > 0); **cobro por hora** (Test Lab, PLAN-2026-013): también horas por día > 0 (sin horas no hay unidades facturables), aun con "Ya tengo la tarifa"; si no, rojo. `focus` al dato que falta (días, cantidad del mes, cantidad por día u horas) |
| 4 | `labor` | tipo distinto de "Equipo sin operador"; **o** cualquier tipo con un puesto usado sin básico | 2 | ok si alguna línea tiene básico > 0 y posiciones > 0; si no, rojo. **Puesto usado sin sueldo (ECO-01, AUD-T1 H-03):** si alguna línea con posiciones > 0 tiene el básico vacío o ≤ 0, rojo y **crítico** (`critical: true`), con el nombre de cada puesto, `focus` a su básico y `targets` a cada línea. Vale también para "Equipo sin operador" si se cargó un puesto con posiciones. No se inventa ningún sueldo; un puesto con 0 posiciones no se usa y no se marca. No hay excepciones: un puesto que no se paga no se carga con posiciones |
| 5 | `relief` | servicio permanente, u on-call 24/7, con personal cargado | 1 | ok si todas las líneas tienen más de 1 persona por posición; si no, naranja |
| 5b | `labor_hours` (PLAN-2026-014) | días de trabajo y horas por día > 0, y alguna línea con posiciones y horas normales que no cubre `D × H` | 1 | **sólo aparece en ese caso** (las demás cotizaciones no cambian de puntaje): naranja "La operación requiere más horas de cobertura que las horas cargadas para este puesto. Revisá dotación, turnos y/o horas extra." con el cálculo del mes y las horas que faltan, `focus` a "Personas por posición" y `targets` a cada línea. Nunca agrega horas extra ni personas (§3) |
| 6 | `equipment_cost` | tipo con equipos (on-call, equipo con/sin operador, transporte) o hay equipos | 2 | ok si hay equipos y todos tienen costo: los propios reposición > 0 y vida útil > 0, los externos tarifa > 0; si no, rojo. `focus` al dato que falta de la primera línea que nombra el mensaje (reposición, vida útil o tarifa del proveedor); sin equipos cargados no hay campo y el botón lleva al paso |
| 7 | `fuel` | hay equipos o vehículos de traslado | 2 | **sólo cuenta lo que consume combustible a nuestro cargo** (PLAN-2026-012): equipos propios, externos con combustible NO incluido (por hora o por km), movilización por sus medios que paga combustible y vehículos de apoyo. Si no hay ninguno → ok "No aplica" (un externo con combustible incluido no pide consumo); provisto por el cliente → ok sin costo; rojo sin responsable, sin precio, sin consumo (o, por km, sin km: con "Sin traslados" el pendiente lo dice y lleva a esa opción; sin distancia, a la distancia; sin viajes, a los viajes); naranja si el precio es el ILUSTRATIVO por defecto; **rojo** si es ILUSTRATIVO en una cotización real **nueva** (`fuel.requiresConfirmation`, PLAN-2026-014 / LAB-D7: "confirmalo («Es mi precio vigente») o cargá tu precio actual", con el valor y su base). Un equipo propio marcado **"No usa combustible"** no consume (LAB-D5). El pendiente trae `focus` (el campo exacto) y se muestra en el paso de ese campo |
| 8 | `materials` | siempre | 1 / 2 | "no usa materiales" → ok (1); sin líneas → naranja (1); con líneas → ok si todas tienen responsable, si no rojo (2); con responsable, una línea que pagamos con precio y cantidad 0 (o al revés) → **naranja** "no suma costo", con `focus` a su cantidad o precio (Test Lab) |
| 9 | `logistics` | siempre | 1 / 2 | "sin traslados" → ok (1); si no, ok si distancia > 0 y algo se mueve (un vehículo con cantidad > 0, un equipo con movilización por sus medios / transportado / con apoyo, o un externo con movilización incluida); si no, rojo (2) |
| 9b | `mobility` (v3) | hay equipos y traslados | 1 | ok si cada equipo tiene definido cómo llega (o el externo la incluye) y no hay avisos de transporte o conductor; si no, naranja. Con **"Sin traslados"** y un equipo que viaja por sus medios o con vehículo de apoyo (Test Lab): naranja "esa movilización no se suma", con `focus` a "Sin traslados" |
| 9c | `external_terms` (v3) | hay equipos externos | 1 | rojo si falta la alícuota de IVA cuando no es recuperable (o la parte recuperable si es parcial); naranja si no se definió si el IVA es recuperable, si no se definió si la tarifa incluye combustible u operador, si una tarifa global no tiene meses de contrato (se toma 1 mes), si la oferta del proveedor venció antes de la fecha de la oferta o no tiene vigencia; si no, ok |
| 9c' | `external_route` (PLAN-2026-012) | un externo por km o por viaje, con tarifa y sin mínimo, en una cotización sin km / viajes ("Sin traslados", sin distancia o sin viajes) | 2 | **rojo y crítico**: "Falta definir la ruta/distancia para calcular este proveedor." (antes era parte de 9c, peso 1, sólo "revisar"); `focus` al campo de la ruta; la línea dice "Falta la ruta" en lugar de $ 0 |
| 9c'' | `external_hours` (Test Lab, PLAN-2026-013) | un externo por hora, con tarifa, cantidad > 0 y sin mínimo, con 0 horas por día (las de su línea, o las de la actividad si la línea las hereda) | 2 | **rojo y crítico**: su tarifa no se puede calcular (nunca es un $ 0 válido); `focus` a las horas de la línea o de la actividad |
| 9c'''' | `external_unit_trips` (ECO-01, AUD-T1 H-01) | un externo "Por salida" (unidad `activation`) con tarifa y cantidad > 0, en una ruta con **más de 1 viaje por llamado**, sin una confirmación vigente (`externalUnitConfirmed` igual al supuesto actual, §4.1) | 2 | **sólo aparece en ese caso** (las demás cotizaciones no cambian de puntaje): rojo, **crítico** y **no confiable** "Unidad del proveedor": la tarifa se paga una vez por salida; el mensaje nombra salidas por mes, viajes por salida, viajes del mes y el equivalente por viaje, y ofrece "Por viaje completo (ida y vuelta)" / "Por tramo" o confirmar "Sí, cobra por salida". Con una confirmación vencida empieza con "La confirmación anterior … ya no vale: cambió …". `focus` a la unidad de la línea, `targets` a cada línea. No cambia la fórmula |
| 9c''' | `route_consistency` (Test Lab) | unidad "viaje" o "km" | 1 | naranja si se cobran viajes o km con "Sin traslados" (`focus` a esa opción), o si con la unidad "km" se facturan **más** km que los que recorre la ruta (llamados × viajes por llamado × km por viaje): los costos por km quedarían cortos (`focus` a "Viajes por …", el rótulo con el nombre de la activación de la cotización: "Viajes por salida" en transporte). Una ruta con más km que los facturados (vuelta vacía) no se avisa. No se deriva (decisión del dueño) |
| 9d | `duplicates` (v3) | hay equipos | 1 | naranja si un externo incluye operador y además tiene uno de Personal asignado, si un equipo que va por sus propios medios también figura como vehículo de la logística auxiliar, o si un externo cuya movilización cobra el proveedor aparte además va "por sus propios medios"; si no, ok |
| 9e | `economic_base` (v3) | hay valores con costo | 1 | naranja si algún valor no tiene fecha base; si no, ok |
| 9f | `base_age` (v3) | algún valor con base | 1 | naranja si hay bases de más de 6 meses antes de la oferta o bases distintas (§6.2); si no, ok |
| 9g | `currency` (v3) | hay valores en otra moneda o sin moneda | 2 | rojo si falta el tipo de cambio (el valor no se suma); naranja si hay valores sin moneda; si no, ok |
| 10 | `structure` | siempre | 1 | ok si el % (métodos porcentuales) o el monto es > 0; si no, naranja |
| 11 | `payment_term` | siempre | 2 | ok si el plazo de cobro está definido (número, incluido 0); si está vacío o `null`, rojo (`focus` al plazo) |
| 12 | `contingency` | siempre | 1 | ok si la contingencia total > 0; si no, naranja |
| 13 | `margin` | siempre | 2 | rojo si está vacío, es inválido (≥ 100 %, negativo o no numérico) o margen + impuestos sobre la facturación ≥ 100 %; naranja si es 0; ok si es > 0 (`focus` al margen cuando no está ok) |
| 13b | `billing_taxes` | siempre | 1 | ok si están definidos (un % total, algún renglón del detalle —incluso 0 %— o "No incluir impuestos sobre la facturación en esta cotización"); naranja si están sin definir ("la tarifa piso no los incluye"); rojo si hay un % inválido |
| 13c | `monthly_fee_overlap` (ECO-01, AUD-T1 H-02) | tarifa en $/mes y abono de disponibilidad > 0 | 2 | **sólo aparece en ese caso**: rojo y **crítico** "Dos abonos por mes": con tarifa conocida nombra la tarifa, el abono y la suma (`$ 25.000.000 + $ 25.000.000 = $ 50.000.000 por mes, de lista`); en modo "calculá", que la sugerida ya descuenta el abono. `focus` al abono de disponibilidad. No cambia la fórmula (§12.0) |
| 14 | `standby` | on-call | 1 | ok si hay tarifa de standby o se marcó "no aplica"; si no, naranja |

**Severidad (PLAN-2026-010, no cambia el puntaje).** Cada pendiente trae `severity`: `critical` si falta algo que cambia el costo o el precio (`equipment_cost`, `external_route`, `external_hours`, `currency`, `utilization`, `rate`, `margin` o —desde ECO-01— `monthly_fee_overlap` y `external_unit_trips` en rojo: por ejemplo un externo sin tarifa, que se nombra en el mensaje y en `targets`), también cuando la regla lo marca en su ítem (`critical: true`: `labor` con un puesto usado sin sueldo básico, ECO-01), `review` para el resto. `critical` y `review` cuentan cuántos hay; si suman más de 0 el resultado muestra arriba **"BORRADOR — revisar N puntos antes de usar esta tarifa"**. **Resultado no confiable (ECO-01):** los pendientes con `unreliable: true` (`monthly_fee_overlap`, `external_unit_trips` y `labor` con un puesto usado sin sueldo) son los que dejan números a la vista que **no son reales** (facturación duplicada, costo de un proveedor o de un puesto de menos); `unreliable` cuenta cuántos hay. Con alguno, el aviso de arriba del Resultado —que va antes del costo, la tarifa y el margen, a la vista y en el PDF— dice **"RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA"** con la causa primero, y el margen, el cálculo de días / equilibrio y el resumen en vivo del editor dicen "NO CONFIABLE (…)" en lugar de "Ganás…". Las cifras no cambian. Aparte, `notices` lleva avisos **informativos** que no restan puntaje ni son pendientes (por ejemplo, un equipo propio sin costo de capital: "RATEOS no está imputando rendimiento ni costo del dinero invertido en este equipo"). Con estructura desglosada (§7), `structure` está ok si algún rubro tiene valor.

**Botones al campo exacto (PLAN-2026-012).** Un pendiente con `focus` lleva a `#/cotizaciones/<id>/<paso>?campo=<ruta>` y el editor enfoca ese campo (ruta validada por lista blanca); el combustible sin campo exacto no muestra botón. Avisos informativos nuevos: viajes físicos derivados con un dato anterior de viajes por salida distinto, y recurso compartido con el resto de su costo fijo sin cubrir. PLAN-2026-014 agrega el aviso informativo **menos de una salida por mes** (`activations_below_one`, §2.1: salidas promedio, costeadas y efecto del redondeo, con botón a la casilla) y el pendiente `labor_hours` (5b). COT-0010 / COT-0011 pasan de **92 % a 100 %** sin inventar consumo.

**Test Lab (PLAN-2026-013).** La tarifa conocida, la actividad, el plazo de cobro, el margen y el costo de equipos también traen `focus`, y dentro de cada paso "Ir al campo" usa el campo que indica el motor. Los avisos citan el rótulo del campo tal como se ve ("Horas trabajadas por día activo", "Viajes por salida", "Sin traslados"); desde PLAN-2026-014 los rótulos que nombran la activación salen de la misma función que arma el campo (`activationFieldLabels`). Dos avisos informativos nuevos (no restan puntaje): **puesto con sueldo y 0 posiciones** (`labor_no_positions`, "no suma costo", `focus` a sus posiciones) y **"el servicio no usa materiales" con materiales cargados** (`materials_ignored`, "no se suman al costo"). `validateQuote` valida además los materiales (cantidad ≥ 0, costo ≥ 0, merma y logística 0–100 %, markup de reventa 0–1000 %; salvo con "El servicio no usa materiales", donde las líneas no se ven ni se suman) y el monto de otros costos (≥ 0), con las mismas reglas que sus campos. Nada de esto cambia un costo ni un precio: cambia qué se marca como pendiente (y por lo tanto el puntaje de las cotizaciones afectadas).

Los pendientes (`pending`) se ordenan críticos primero y después rojos. Ejemplos: demo Hidrogrúa **94,44 %** (pendientes en naranja: relevos, impuestos sobre la facturación y standby; con v3 suma las reglas de movilización, duplicados, base y antigüedad en verde: antes 93,48 %); caso de referencia **76,67 %** (personal en rojo; estructura, contingencia e impuestos sobre la facturación en naranja).

**Efecto de borde de la regla `billing_taxes` (PLAN-2026-002).** Agrega peso 1 a todas las cotizaciones. Una cotización con impuestos sin definir suma 0,5 de 1: si su puntaje era mayor a 50 % **baja un poco** (demo 95,45 % → 93,48 %; caso de referencia 78,57 % → 76,67 %) y si era menor **sube un poco** (cotización en blanco 33,33 % → 34,21 %). Una cotización que estaba apenas arriba de 85 % puede pasar de verde a naranja, o apenas arriba de 60 % pasar a "con riesgo" (`incomplete`/`atRisk`), hasta que se definan los impuestos o se elija "No incluir impuestos sobre la facturación en esta cotización". Los números económicos no cambian.

**Colores del puntaje** (`completenessTone`, `js/engines/completeness-engine.js`), iguales en el editor, el resultado y el listado: **verde ≥ 85 %** (`COMPLETENESS_GREEN_THRESHOLD`), **naranja ≥ 60 %**, **rojo < 60 %** (`COMPLETENESS_RISK_THRESHOLD`, el mismo límite que marca `incomplete` y `atRisk`, §20).

**Defaults ILUSTRATIVOS no cuentan como definidos.** Un valor que nadie cargó no puede dar un ítem en verde. Al crear una cotización en blanco con la configuración ILUSTRATIVA de la demo (`settings.illustrative = true`, ver `createEmptyQuote` en `js/domain/quote-factory.js`):

| Dato | Cotización nueva | Regla |
|---|---|---|
| Días activos (`activity.activeDaysPerMonth`) | `null` (siempre, también con configuración propia) | `utilization` en rojo |
| Plazo de cobro (`finance.paymentTermDays`) | `null` | `payment_term` en rojo |
| Contingencia general (`risk.generalPct`) | 0 | `contingency` en naranja |
| Precio del combustible (`fuel.pricePerLiter`) | el de la configuración, con `fuel.illustrative = true` y `fuel.requiresConfirmation = true` (PLAN-2026-014) | `fuel` en **rojo** hasta confirmarlo o reemplazarlo (si hay equipos o vehículos que lo consumen). Las cotizaciones anteriores —sin `requiresConfirmation`— y la demo siguen en naranja: no se modifican |
| Margen objetivo (`pricing.targetMarginPct`) | el de la configuración (10 % en la demo) | `margin` en verde |
| Impuestos sobre la facturación (`billingTaxes`) | los de la empresa (`settings.defaultBillingTaxes`) si ya los decidió, aun con configuración de demostración; si no, sin definir | `billing_taxes` en naranja si quedan sin definir |

Con una configuración propia (`settings.illustrative !== true`), el plazo y la contingencia toman los valores de la configuración y el combustible no queda marcado. Las plantillas pueden traer sus propios valores (por ejemplo, la plantilla Hidrogrúa on-call carga 8 días activos y 90 días de plazo). Ejemplo: una cotización en blanco con la configuración demo da **34,21 %** (rojos: actividad, personal, equipos, logística y plazo de pago; naranjas: materiales, estructura, contingencia, impuestos sobre la facturación y standby).

## 20. Indicadores y alertas

`computeQuote(quote, { settings })` devuelve `kpis` con, entre otros: días activos, utilización, costo total, fijos, variables, costo por día activo, tarifas piso/objetivo/sugerida/comercial (neta y de lista), facturación, resultado, margen, markup, break-even y días para margen objetivo (exactos y enteros), completitud, costo financiero, impacto financiero en margen, capital de trabajo, costo logístico mensual e incidencia.

Desde PLAN-2026-002 también: `billingTaxPct` (t usado), `billingTaxesDefined`, `billingTaxesInvalid`, `billingTaxes` (impuestos sobre la facturación del mes, en $), `targetMarginInvalid`, `targetMarkupPct` (markup del objetivo, (m + t) / (1 − m − t)), `targetProfitOnCostPct` (ganancia sobre el costo del objetivo, m / (1 − m − t)), `profitOnCostPct` (resultado / costo con la tarifa cotizada) y `priceToCostMultiplier` (facturación / costo del mes). `result.billingTaxInfo` trae la configuración normalizada y su estado; `traces.billingTaxes`, la traza. Invariante (tests): **facturación = costo + impuestos sobre la facturación + resultado** en la estimación y en cada fila de la matriz.

**Externos del mes: costo, caja y crédito fiscal** (`externalMonthly`, `externalCashMonthly`, `externalTaxCreditMonthly`, recuadro de externos del Resultado). Suman la tarifa y la movilización de los proveedores; el combustible no incluido en la tarifa va a "Combustible" (§4.1). Con "Cada salida se cuenta completa" (§2.1), el ajuste por las salidas que se pagan enteras usa las mismas líneas (Test Lab LAB-F1, PLAN-2026-013: antes sumaba también el combustible por km del proveedor y el indicador quedaba más alto que la fila "Equipos y servicios externos" de la EECC). Ejemplo: COT-0011 con 13 viajes, salidas completas y combustible del proveedor a nuestro cargo (35 L/100 km): externos **$ 9.100.000** = fila de la EECC (antes $ 9.205.000) y caja **$ 11.011.000** = 9.100.000 × 1,21 (antes $ 11.116.000). El costo total ($ 16.101.897,55) y la sugerida ($ 1.458.000) no cambian.

**Margen y markup de la cotización sólo con tarifa comercial.** `kpis.marginPct` y `kpis.markupPct` son `null` si no hay tarifa comercial (`commercialSource = 'none'`), aunque haya otros ingresos (fee, standby, call-out). Ejemplo: caso de referencia en "Conozco la tarifa" sin tarifa y con fee de disponibilidad 6.000.000/mes → facturación 6.000.000, margen y markup `null` (antes figuraba un margen de −533,33 % que entraba al promedio del dashboard). La facturación y el resultado se siguen informando.

| Alerta | Regla |
|---|---|
| `belowFloorRate` | hay tarifa y la tarifa neta comercial < tarifa piso neta (tolerancia 1e-6). Informativo: la tarifa sola no cubre el costo |
| `belowFloor` ("bajo piso: perdés dinero") | `belowFloorRate` **y** resultado del mes < 0 |
| `belowTarget` | hay tarifa, el margen objetivo es válido y el margen < margen objetivo |
| `incomplete` | completitud < `COMPLETENESS_RISK_THRESHOLD` (60 %) |
| `atRisk` | sin tarifa, **o** margen objetivo inválido (incluido margen + t ≥ 100), **o** resultado < 0, **o** margen < objetivo, **o** completitud < 60 % |

Con impuestos sobre la facturación, una tarifa que cubre el costo pero no los impuestos **pierde plata**: es `belowFloor`. Ejemplo sintético: fijos 30.000.000, variable 1.000.000/día, 10 días, tarifa 4.200.000/día → sin impuestos gana 2.000.000; con t = 10 % paga 4.200.000 de impuestos y pierde 2.200.000 (la piso es 4.444.444,44).

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
| Margen ≥ 100, < 0 o no numérico | `priceFromMargin` → `null`; margen objetivo inválido → sin precio objetivo ni tarifa sugerida (`targetMarginInvalid`, `atRisk`), nunca otro margen en silencio; personalizado inválido → se omite; `validateQuote` informa y el Cost Completeness Score lo marca en rojo. |
| Margen + impuestos sobre la facturación ≥ 100 | No existe un precio que deje ese margen: igual que un margen inválido; `validateQuote` informa "Con X % de impuestos sobre la facturación, el margen tiene que ser menor a (100 − X) %"; el comparador de modelos devuelve `models: []` con el motivo. |
| Impuestos sobre la facturación sin definir | t = 0 (los números no cambian), `billingTaxesDefined = false`, la traza de la tarifa piso avisa que no los incluye y la completitud lo marca en naranja. |
| Impuestos sobre la facturación inválidos (negativos, texto, total ≥ 100) | Se calcula con t = 0, `billingTaxesInvalid = true`; `validateQuote` y la completitud (rojo) lo informan. |
| Impuestos 0 % explícito o "no incluir impuestos sobre la facturación en esta cotización" (la columna sigue)go impuestos sobre lo que facturo" | t = 0 y definido: sin aviso. |
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
| `gross-up-impuestos-facturacion.json` | costo 100; margen 10 %; impuestos sobre la facturación 10 % | precio **125** (NO 121 ni 123,46) |
| `tarifa-piso-con-impuestos.json` | costo 100; margen 0; impuestos 10 % | tarifa piso **111,11…** |
| `markup-con-impuestos.json` | margen 10 %; impuestos 10 % | markup **25 %** (precio 125 = costo 100 × 1,25) |
| `ganancia-sobre-costo-con-impuestos.json` | margen 10 %; impuestos 10 % | ganancia sobre el costo **12,5 %** (no es el markup) |
| `on-call-break-even-con-impuestos.json` | caso básico con impuestos 10 % | contribución 2.600.000/día; break-even **11,54 días** (12 enteros) |
| `on-call-tarifa-minima-6-dias-con-impuestos.json` | fijos 30.000.000; variable 1.000.000/día; 6 días; impuestos 10 % | tarifa mínima 6.666.666,67/día |
| `externo-alquiler-iva-recuperable.json` | alquiler 1.000.000 neto/día, IVA 21 % recuperable | costo económico 1.000.000/día; caja 1.210.000; crédito fiscal 210.000 |
| `externo-alquiler-iva-no-recuperable.json` | mismo alquiler, IVA no recuperable | costo económico 1.210.000/día |
| `externo-minimo-por-llamado.json` | grúa tercerizada 450.000/h, mínimo 8 h, llamado de 1 día de 5 h | factura **8 h** = 3.600.000 neto por llamado |
| `movilizacion-autopropulsada-160km.json` | Vactor por sus medios 80 + 80 km, 40 L/100 km, 1.500/L, 200 $/km | **160 km**, 64 L, combustible 96.000 + desgaste 32.000 = 128.000 por llamado; sin mano de obra extra |
| `on-call-cotizacion-con-impuestos.json` | fijos 30.000.000; variable 1.000.000/día; 10 días; margen 10 %; impuestos 10 % | costo 40.000.000; piso 4.444.444,44; objetivo 5.000.000; facturación 50.000.000; impuestos 5.000.000; resultado 5.000.000 (10 %); markup 25 %; ganancia sobre el costo 12,5 % |
| `unidad-bombeo-m3.json` | §12.1 caso A: 10.000 m³/mes, 500 m³/día, fijos 30.000.000, variable 1.000.000/día, tarifa 7.000/m³ | piso **5.000/m³**; objetivo 6.250 (20 %); equilibrio **6.000 m³** (12 días) |
| `unidad-transporte-viaje.json` | §12.1 caso B: 40 viajes/mes, 2 por día, fijos 12.000.000, variable 600.000/día, tarifa 900.000 | piso **600.000/viaje**; objetivo 800.000 (25 %); equilibrio **20 viajes** |
| `unidad-movimiento-suelo-m3.json` | §12.1 caso C: 5.000 m³/mes, 250 m³/día | piso **10.000/m³**; objetivo 11.764,71 (15 %); equilibrio **2.500 m³** |
| `unidad-inspeccion-unidad.json` | §12.1 caso D: 300 u/mes, 15 por día | piso **20.000/u**; objetivo 22.222,22 (10 %); equilibrio **200 u** |
| `unidad-on-call-dia.json` | §12.1 caso E: on-call $/día, 15 días | piso 3.000.000/día; equilibrio **10 días** (igual que siempre) |
| `cot-0009-prueba-real.json` | cotización real de prueba COT-0009 reconstruida del PDF auditado (`tests/fixtures/cot-0009.js`, sin datos de cliente): 2.400 m³/mes, 120 m³/día, 2 días por intervención, vactor propio, pickup tercerizada 2.800.000/mes con IVA sin definir, estructura 10 %, financiero 3 % a 60 días, impuestos 5 %, margen 10 %, redondeo 1.000 | costo **28.367.260**; piso **12.441,78/m³**; objetivo **13.905,52/m³**; sugerida **14.000/m³**; facturación 33.600.000; impuestos 1.680.000; resultado **3.552.740**; margen **10,5736 %**; equilibrio **≈ 1.929,05 m³**; m³ para el margen objetivo ≈ 2.368,63; financiero 1.422.700,77 |
| `cot-0010-transporte-1-viaje-por-dia.json` | COT-0010 (`tests/fixtures/cot-0010.js`, sin cliente): 12 viajes/mes a 1 por día, Neuquén → Añelo 100 km ida y vuelta, transportista $ 3.250/km con todo incluido e IVA 21 % recuperable a 15 días, coordinador $ 3.280.036, estructura 8 %, contingencia 3 %, financiero 3 % (15 + 40 días), impuestos 5 %, margen 10 %, redondeo 1.000 | 12 días; 12 viajes físicos; **2.400 km**; proveedor **7.800.000**; costo **12.864.478**; piso **1.128.463**; objetivo **1.261.224**; sugerida **1.262.000**/viaje; facturación 15.144.000; impuestos 757.200; resultado **1.522.322**; margen 10,05 %; equilibrio ≈ **8,55 viajes**; completitud 100 % |
| `cot-0011-transporte-2-viajes-por-dia.json` | COT-0011: igual a 2 viajes por día | 6 días; mismos 12 viajes físicos, 2.400 km y los mismos números |
| `cot-0010-transporte-3-viajes-por-dia.json` | igual a 3 viajes por día | 4 días; mismos km, proveedor y tarifa |
| `cot-0011-viajes-por-llamado-inconsistente.json` | COT-0011 con "Viajes por llamado" = 1 (dato viejo) | se derivan 2 viajes por intervención: los mismos números (antes 6 viajes, $ 3.900.000 y sugerida 816.000) |
| `producto-chipa-costo-y-precio.json` | producto (§23): tanda de 60, receta 6.000, empaque 20/u, personal 90 min a 6.000/h, horno 40 min a 1.500/h, fijos 175.000/mes, 3.000 u/mes, margen 30 % | variable **286,67**/u; fijo **58,33**/u; costo **345**/u; precio **492,86** (markup 42,86 %); equilibrio **848,73** u/mes |

**Red de seguridad** (`tests/engines/regression-baseline.test.js`, PLAN-2026-002 PN0): con impuestos sin definir, los KPIs, la EECC, la matriz y los tramos de la demo, el caso de referencia, cada plantilla y variantes sintéticas son **idénticos** a los del motor anterior (`tests/fixtures/baseline-v1.json`).

El caso on-call básico también existe como cotización demo "Ejemplo: tarifa que no cubre los costos (caso de referencia)" (antes "Caso de referencia on-call (prueba del motor)") (`demoReferenceQuote` en `js/domain/demo-data.js`): fijos cargados como otro costo fijo mensual, variable como otro costo por día activo, modalidad "Conozco la tarifa" con 4.000.000/día, sin financiero, contingencia ni reglas → break-even exactamente 10 días. Además, toda EECC con costo > 0 debe mostrar incidencias que suman exactamente 100,00 % (tests de `costStructure`).

## 23. Productos: costo por unidad y precio (PLAN-2026-008)

Motor: `js/engines/product-engine.js` (`computeProduct`). Puro, con trazas ("Ver cálculo") para cada resultado. **No cambia ninguna fórmula de las cotizaciones**: es un motor nuevo que reutiliza LaborEngine (costo hora con cargas), EquipmentEngine (tenencia y uso) y las reglas de precio de §11 y §13.1.

Un producto se fabrica por **tandas** (una receta rinde N unidades) y se vende por unidad (`saleUnit`: unidad, docena, kg, porción…). Se separa siempre lo **variable** (depende de cuánto producís) de lo **fijo** (se paga igual cada mes).

| Concepto | Fórmula |
|---|---|
| Vendibles por tanda `S` | `unidades por tanda × (1 − pérdida %)` |
| Ingrediente o material | `cantidad usada (convertida a la unidad del precio) × precio por unidad × (1 + merma %)`; precio por unidad = cargado, o `precio del paquete ÷ contenido`. Va **por tanda** (receta) o **por unidad** (empaque, etiqueta). Conversión: g ↔ kg, ml ↔ l, unidad ↔ docena; unidades de distinto tipo no se convierten (error, no suma) |
| Personal por tanda | `personas × minutos por tanda ÷ 60 × costo hora con cargas`; `costo hora = costo mensual por persona ÷ horas normales del mes` (mismo LaborEngine que las cotizaciones; las cargas son las del convenio que cargó la empresa) |
| Uso de máquinas por tanda | `minutos de uso ÷ 60 × (mantenimiento/h + neumáticos/h + combustible/h + energía/h)` |
| Tenencia de máquinas (FIJO) | `posesión mensual (amortización, seguro, patente, certificaciones, mantenimiento por presupuesto, costo de capital) × % asignado al producto` |
| Gastos fijos del negocio | `monto mensual × % asignado al producto` |
| Variable por unidad | `(receta + personal + uso de máquinas) ÷ S + materiales por unidad` |
| Fijo por unidad | `fijos asignados del mes ÷ unidades vendidas por mes` |
| Costo por unidad | `variable por unidad + fijo por unidad + financiación por unidad` (la financiación es 0 sin plazos ni tasa, §23.1) |
| Precio piso | `costo ÷ (1 − t)` (t = impuestos sobre lo que vendés, §13.1) |
| Precio con margen | `costo ÷ (1 − margen − t)` — **margen sobre el precio, no markup** (§9 de AGENTS.md) |
| Precio sugerido | redondeo comercial **hacia arriba** al múltiplo elegido (nunca baja el margen) |
| Precio al público | `precio sugerido × (1 + IVA %)`, **sólo si la empresa carga el IVA** (RATEOS no trae alícuotas; el IVA no es costo ni ganancia) |
| Equilibrio (u/mes) | `(fijos asignados + financiación fija) ÷ (precio × (1 − t) − (variable por unidad + financiación variable por unidad))`; sin fijos → 0; contribución ≤ 0 → inalcanzable (`null`, nunca `Infinity`) |
| Resultado del mes | `precio × N − impuestos sobre la venta − variable × N − fijos asignados − costo financiero del mes` (N = unidades por mes) |
| Precio actual (opcional) | margen real `1 − t − costo ÷ precio`, ganancia por unidad, equilibrio y aviso si queda bajo el piso o bajo el costo variable |

Reglas:

- **El % de los fijos que le toca al producto es SIEMPRE un dato explícito** (de cada máquina y de cada gasto fijo): nunca se infiere del uso (PLAN-2026-006). Sin %, ese fijo no se suma y el producto avisa.
- Sin unidades vendidas por mes, los fijos no se pueden repartir: error (el costo por unidad queda sin calcular, nunca `Infinity`).
- **Puesto sin sueldo básico (ECO-01, AUD-T1 H-03):** una línea de personal con personas > 0 y minutos por tanda > 0 sin básico (> 0) es un **error** (`labor.N.basicMonthly`, con el nombre del puesto): su costo hora quedaría sin sueldo. No cambia el cálculo; un puesto con 0 minutos no se usa y no se marca.
- Impuestos sobre la venta sin decidir: aviso (el precio no los incluye). "No corresponden" o un % cargado lo resuelven.
- Horas del mes del personal (informativo, **no cambia el costo**): `tandas por mes × minutos por tanda ÷ 60` por persona, contra sus horas normales. El costo del personal es por minuto de tanda: las horas pagadas que no se usan en este producto no entran en su costo (la pantalla lo dice y sugiere sumarlas en "Gastos fijos" si no se usan en otros productos). Más horas que las del mes → aviso.
- Valores en otra moneda: sólo con el tipo de cambio que carga la empresa en el producto; sin él no suman y el producto queda con error.
- Las líneas que vienen de Recursos guardan una copia (snapshot): cambiar el recurso nunca cambia el producto; se avisa y la persona elige [Actualizar en este producto] o [Conservar valor original]. Al actualizar se conservan personas, minutos por tanda, energía, % asignado, dónde va y la unidad en que se usa.

Caso de referencia (golden `producto-chipa-costo-y-precio.json`, ILUSTRATIVO): tanda de 60, receta $ 6.000, bolsita $ 20/u, personal 90 min a $ 6.000/h = $ 9.000, horno 40 min a $ 1.500/h = $ 1.000 → variable $ 16.000 ÷ 60 + $ 20 = **$ 286,67**; fijos horno $ 50.000 × 50 % + alquiler $ 600.000 × 25 % = $ 175.000 ÷ 3.000 u = **$ 58,33**; costo **$ 345**; margen 30 % sin impuestos → **$ 492,86** (markup 42,86 %); equilibrio $ 175.000 ÷ ($ 492,86 − $ 286,67) = **848,7 u/mes**. Con 5 % de impuestos sobre la venta: $ 345 ÷ 0,65 = $ 530,77.

### 23.1 Financiación de productos (PLAN-2026-014, decisión del dueño LAB-D3)

Opcional (`product.finance`). Usa el **mismo motor que las cotizaciones** (`computeFinance`, §8; no se duplica): cada costo en efectivo se paga X_g días después de producir; lo producido se vende Z días después (stock) y se cobra Y días después de vender.

```
días financiados_g   = max(0, Z días entre producir y vender + Y plazo de cobro − X_g días hasta pagar ese costo)
capital de trabajo   = Σ caja_g × días_g ÷ 30
costo financiero     = capital de trabajo × tasa mensual            (interés simple)
financiación/unidad  = Σ caja variable por unidad_g × tasa × días_g ÷ 30
                     + (Σ caja fija del mes_g × tasa × días_g ÷ 30) ÷ unidades por mes
efecto en el precio  = precio con tu margen − precio con tu margen sin la financiación
```

| Grupo de pago (`payDays`) | Caja del producto |
|---|---|
| `materials` | ingredientes y materiales (por unidad) |
| `salaries` | personal (por unidad) |
| `fuel` | combustible y energía de las máquinas (por unidad) |
| `suppliers` | mantenimiento y neumáticos (por unidad) + tenencia **en efectivo** de las máquinas × % asignado (seguro, patente, certificaciones, otros, mantenimiento fijo; por mes) |
| `structure` | gastos fijos del negocio × % asignado (por mes) |

- La amortización y el costo de capital **no** son salidas de caja: no se financian (igual que §8).
- **Alcance: estimación financiera sobre costos netos.** Se financian los montos sin IVA (como los materiales de una cotización): el IVA de las compras **no** se modela, así que esto **no** es una simulación completa de caja. La interfaz lo dice siempre junto a la financiación (tarjeta "Financiación", resultado del mes y "Ver cálculo"): "Estimación financiera sobre costos netos. El IVA de compras no está incluido en este capital de trabajo." (Test Lab lo exige: `UX-PRODUCT-FINANCE-SCOPE`). Un modelo de IVA de compras sería un cambio aparte (decisión del dueño).
- El impulsor variable es la **unidad vendida** (en una cotización, el día activo): `variablePerActiveDay` de FinanceEngine es, en productos, por unidad.
- **Nunca se inventan plazos ni tasas:** un producto nuevo arranca con todo vacío (`invoiceLagDays`, `paymentTermDays`, `monthlyRatePct` y cada `payDays` en `null`) y la financiación es 0; un producto anterior (sin `finance`) calcula exactamente igual. Días hasta pagar vacíos = se paga al producir.
- Avisos (sólo si se empezó a cargar): tasa sin plazo de cobro ("la financiación sólo cuenta los días hasta vender") y plazos sin tasa ("sin tasa el costo financiero es 0").
- El costo por unidad, los precios (piso, con margen, sugerido), el equilibrio y el resultado del mes incluyen la financiación; el desglose agrega la fila "Financiación (capital de trabajo)" sólo si es > 0, y "Ver cálculo" (`traces.finance`) muestra los días y la caja de cada grupo.

**Ejemplo (chipá del golden + 10 días de stock, cobro a 20 días, todo pagado al producir, 3 % mensual → 30 días financiados):** caja variable 286,67 por unidad × 3 % = **8,60**; caja fija 175.000 (seguro del horno 25.000 + alquiler 150.000) × 3 % = 5.250 por mes ÷ 3.000 u = **1,75**; financiación **10,35** por unidad → costo **355,35** (antes 345), precio con margen 30 % **507,64** (+14,79). Capital de trabajo 1.035.000; costo financiero 31.050 por mes. Invariantes de Test Lab PINV-08/09/10.
