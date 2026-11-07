# Informe: prueba de RATEOS como prestador de cuadrillas de 3 personas en diagrama 2x1 (Vaca Muerta)

Autor: agente "prestador de cuadrillas 3p / 2x1". Fecha: 07-nov-2026. App: v0.8.1 (build 401ae8b), `dist/` con Supabase simulado.
Scripts: `(carpeta de trabajo de la sesión)/work-2x1/` (estado: `state.json`).
Capturas: `(carpeta de trabajo de la sesión)/shots/2x1/`.
No se modificó nada del repo.

---

## 0. Supuestos de mercado (con fuente y fecha)

| Dato | Valor usado | Fuente / criterio |
|---|---|---|
| Diagrama 2x1 | **14x7** (14 días en sitio, 7 de franco, jornada de 12 h) | El art. 14 del CCT 644/12 permite una jornada de hasta 12 h en diagrama 2x1 (Ámbito, 02-feb-2017, [link](https://www.ambito.com/cuales-son-puntos-claves-del-convenio-petrolero-vaca-muerta-n3971546)). En la cuenca, el 14x7 es la forma de 2x1 más común en operadoras y servicios (Econojournal 2019, [link](https://econojournal.com.ar/?p=95935); guías de empleo del sector). En 2019 se discutieron el 1x1 y el 8x4. |
| Sueldo básico | $ 4.130.864/mes (mínimo bruto garantizado para 8 h) | Paritaria 2026-27, actas del 14 y 22-jul-2026 ([Diario Neuquino](https://diarioneuquino.com.ar/paritaria-petrolera-2026-2027-acordaron-un-aumento-del-16-y-el-salario-minimo-supera-los-41-millones-en-la-cuenca-neuquina/), [LM Neuquén](https://mase.lmneuquen.com/vaca-muerta/paritaria-petrolera-2026-2027-cuanto-es-el-aumento-sueldo-y-como-se-paga-tramos-n1248412)). La negociación se reabre en nov-2026. |
| Adicionales | $ 1.300.000/mes (zona, diagrama, asignación Vaca Muerta ≈ $ 402.800) | Estimación propia. La asignación VM figura en $ 380.000–402.800 según la fuente. |
| Cargas | SAC 8,33 %, vacaciones 5,8 %, contribuciones 26,4 %, ART 9 % → factor 1,5453 | Estimación de cuenca, sin fuente oficial única. |
| Horas extra | 4 h/día al 50 % (12 h de jornada contra 8 h normales) | Criterio propio. El CCT distingue 50 % y 100 % (franco o feriado); usé el 50 % como promedio conservador. |
| Campamento | $ 70.000 por persona y día (cama y 4 comidas) | Estimación, sin fuente pública. |
| Gasoil | $ 1.530/L sin IVA | Estimación a partir de un surtidor de ≈ $ 1.850 con IVA. |
| Camioneta 4x4 doble cabina | Reposición $ 62 M, residual $ 25 M a 5 años, seguro $ 3,6 M/año, patente $ 1,9 M/año | Estimación. |
| Ruta | Base en Neuquén → Loma Campana (Añelo), 110 km por tramo | — |
| Comerciales | Estructura 12 %, cobro a 60 días, tasa 3,5 % mensual, contingencia 3 % (5 % en el precio cerrado), margen 15 %, impuestos sobre la facturación 4,5 % (IIBB, cheque y sellos) | Criterio propio. |

### Dotación: nómina contra personas en sitio (cálculo a mano)

En 14x7 cada persona está en sitio 14 de cada 21 días, es decir **2/3 del tiempo**.

- **"3 en nómina → 2 en sitio"**. Con los ingresos escalonados cada 7 días siempre hay exactamente 2 personas en sitio. Cada 7 días entra una y sale otra (un viaje de relevo). Es la forma natural de "3 personas en 2x1".
- **"3 siempre en sitio"**. Hacen falta 3 / (2/3) = **4,5 personas**. Con enteros no se puede: con grupos de 2, 2 y 1 hay 3 o 4 en sitio según la semana. Un proveedor real tiene **5 en nómina** (en sitio hay 3,33 personas en promedio, y la holgura cubre vacaciones y licencias) o 4 más un relevista compartido.
- **Relevos al mes**: 30 / 7 = **4,29 viajes** Neuquén ↔ locación (220 km ida y vuelta) en los dos casos.

**La app no hace esta conversión.** Sólo existen "Posiciones a cubrir" × "Personas por posición (relevos)". Hay que cargar 1,5 (o 1,6667) a mano. La app acepta personas fraccionarias sin avisar y no sabe qué es un diagrama, un franco ni un relevo. El texto de ayuda dice sólo: "Para cubrir 24/7 normalmente se necesita más de una persona por posición".

---

## 1. Recursos cargados (Recursos y Configuración)

- **Configuración → Convenios**: "CCT 644/12 Petroleros Privados (dic-26 est.)": 176 h, horas extra al 50 %, SAC 8,33 %, vacaciones 5,8 %, contribuciones 26,4 %, ART 9 %. La app calcula el factor 1,5453, igual que a mano. Captura `06-convenio.png`.
- **Recursos → Personal**: "Operario de cuadrilla 2x1 (CCT 644/12)" con básico 4.130.864, adicionales 1,3 M, 4 h extra por día activo y seguros, EPP y capacitación por $ 190.000. La app da **$ 8.582.424 por persona y mes**. A mano: 5.430.864 × 1,5453 + 190.000 = 8.582.424 ✓. Captura `07-perfil.png`.
- **Recursos → Equipos**: "Camioneta 4x4 doble cabina cuadrilla", propia. Posesión $ 1.593.333/mes y operación $ 16.000/h (8 L/h + $ 4.000/h de mantenimiento). Captura `08-camioneta.png`.

---

## 2. Cotizaciones

Todas se hicieron por la UI: Nuevo cálculo → Empezar en blanco → 5 etapas → Resultado. Los números se verificaron con `computeQuote` sobre el estado guardado (`var.mjs`, `c3e.mjs`).

### C1 — 3 en sitio, 2x1, fijo mensual, con camioneta y relevos (COT-0001)

**Datos**
- Contrato: Fijo mensual. Componentes: Personal, Vehículo, Herramientas, Viáticos.
- Actividad: 30 días × 12 h.
- Personal: 3 posiciones × **1,5** personas por posición, que la app muestra como "4,5 personas".
- Camioneta: 3 h de uso por día en el yacimiento; se moviliza por sus propios medios.
- Logística: 110 km. **Viajes por intervención = 0,143**: es un truco para tener 4,29 relevos por mes (ver hallazgo P1-3). Alojamiento y viáticos $ 210.000 por intervención (= por día: 3 personas × $ 70.000).
- Herramientas $ 650.000/mes. Exámenes médicos e inducciones $ 450.000/mes.
- Pantallas: `09-labor-c1.png`, `10-equipos-c1.png`, `12-logistica-c1.png`, `13-resultado-c1.png`, `result-full-0.png`.

**Resultado de la app**

| Indicador | Valor |
|---|---:|
| Costo del mes | $ 84.542.140 |
| Tarifa piso | $ 88.525.801 / mes |
| Tarifa sugerida (15 %) | **$ 105.022.000 / mes** |
| Costo por día | $ 2.818.071 |
| Composición del costo | Mano de obra 69 %, estructura 10 %, logística 8 %, financiero 6 % |

**Verificación a mano**
- Personal fijo: 8.582.424 × 4,5 = 38.620.907 ✓.
- Horas extra: 4 h × (4.130.864 / 176 × 1,5) × 1,5453 × 3 posiciones × 30 días = 19.585.762 ✓.
- Tarifa piso: 84.542.140 / 0,955 = 88.525.801 ✓.
- Tarifa sugerida: 84.542.140 / 0,805 = 105.021.292, redondeada hacia arriba a 105.022.000 ✓.
- Costo directo 68,98 M → estructura 12 % = 8,28 M → contingencia 3 % sobre 82,08 M = 2,46 M ✓.

**Razonabilidad**
- El costo de la app corresponde a **4,5 personas**. El proveedor real cotiza **5**, y con 5 (personas por posición 5/3) el costo pasa a $ 89,81 M y la sugerida a **$ 111,57 M (+6,2 %)**.
- La app carga la hora extra sólo sobre el básico. Si se calcula sobre básico más adicionales remunerativos, como es habitual, el costo sube a $ 92,1 M (+9 %).
- Precio por hora-hombre en sitio: 105 M / (3 × 12 h × 30 días) ≈ **$ 97.000/h ≈ USD 65–70/h**. Está en la franja alta de lo que se paga por un operario en servicios petroleros; el sobrecosto viene de 360 h extra al mes, las cargas de cuenca y el campamento. Es razonable para una cuadrilla dedicada con camioneta y campamento. No encontré tarifas públicas para comparar.

### C4 — variante "3 en nómina → 2 en sitio" (COT-0004, hecha entera en modo **mobile**)

**Datos**: 2 posiciones × 1,5 = 3 personas. Campamento $ 140.000/día. Lo demás, igual que C1. Capturas `m01`…`m08-*-mobile.png`.

**Resultado de la app**

| Indicador | Valor |
|---|---:|
| Costo del mes | $ 57.375.207 |
| Tarifa piso | $ 60.078.751 / mes |
| Tarifa sugerida | **$ 71.274.000 / mes** |
| Costo por día | $ 1.912.507 |

**Verificación**: 3 personas × 8.582.424 = 25,75 M fijos ✓. A $ 99.000 por hora-hombre en sitio, el precio es coherente con C1. En este caso la app no se equivoca, porque 1,5 × 2 da un número entero.

**Mobile**: sin scroll horizontal (scrollWidth = 390 en todas las etapas). La carga es usable, pero larga: la etapa de personal tiene más de 2.700 px de alto. El aviso flotante ("Se agregó…") tapa campos al pie.

### C2 — la misma cuadrilla, por día trabajado (on call) con mínimo garantizado (COT-0002)

**Datos**
- Contrato: Por servicio, $/día. 18 días trabajados por mes, llamados de 3 días, 12 h.
- Personal: 3 × **1,6667** = 5 en nómina.
- Horas extra: la cuadrilla está en diagrama y en campamento todos los días, así que las 4 h extra se pagan todos los días en sitio, se trabaje o no. Se cargaron como tramo "por mes": 72 h por persona, más un tramo de 7 h/mes de "horas de viaje de relevo".
- Campamento ($ 6,3 M) y relevos ($ 315.000) cargados como **Otros costos fijos**, categoría Logística: la app no tiene un concepto que los exprese (ver P1-4).
- Mínimo mensual garantizado = 15 días × tarifa sugerida = **$ 94.860.000**, calculado a mano.
- Capturas `20-labor-c2-tramos.png`, `21-materiales-c2-otros.png`, `22-resultado-c2.png`.

**Resultado de la app**

| Indicador | Valor |
|---|---:|
| Costo del mes | $ 91.626.424 |
| Tarifa piso | $ 5.330.217 / día |
| Tarifa sugerida | **$ 6.324.000 / día** |
| Equilibrio | 15,1 días |
| Costo por día activo | $ 5.090.357 |

**Verificación**
- Tarifa piso: 91.626.424 / 0,955 / 18 = 5.330.217 ✓.
- Horas extra: 72 × 35.206 × 1,5453 × 5 = 19.586.154 ✓.

**Razonabilidad**
- La economía es correcta: con nómina y campamento fijos, cobrar sólo los días trabajados sale caro. Da $ 175.000 por hora-hombre trabajada.
- Si se trabajan menos días, la tarifa piso se dispara: con 10 días, $ 9,54 M/día.
- Un proveedor real cobraría abono de disponibilidad más tarifa por día, o un día de espera. El comparador de modelos de la app lo sugiere (abono + $ 1,40 M/día), pero el mínimo "en días", que es como se negocia, no existe (ver P1-8).

### C3 — precio cerrado, trabajo de 45 días (COT-0003)

**Datos**
- Contrato: Precio cerrado, $ global. 1 trabajo por mes de **45 días** (la app no tiene otra forma de cargarlo), 12 h.
- Personal: 3 × 1,6667 = 5, "Contratada para este servicio".
- Relevos: en 45 días entran **6 relevos** (días 7, 14, 21, 28, 35 y 42) más la movilización y la desmovilización = **8 viajes por trabajo**. Los francos los cubren las 2 personas de más: con grupos de 2, 2 y 1 rotando 14x7, siempre hay 3 o más en sitio.
- Campamento por trabajo: 3 × 45 × $ 70.000 = $ 9,45 M.
- Otros costos por trabajo: exámenes $ 2,5 M y preaviso de 15 días al terminar (período de prueba, 5 personas) $ 18,4 M.
- Contingencia 5 %.
- Capturas `30-modality-c3.png`, `31-labor-c3.png`, `32-logistica-c3.png`, `33-resultado-c3.png` y `crop-33.png`.

**Resultado de la app**

| Indicador | Valor |
|---|---:|
| Costo | $ 162.788.069 (rotulado "Costo del mes") |
| Tarifa piso | $ 170.458.711 / trabajo |
| Tarifa sugerida | **$ 202.222.000 / trabajo** |
| Costo por día | $ 3.617.513 |

**Verificación**
- Personal: 42,91 M × 1,5 meses + 652.859 × 45 + 2,5 M + 18,4 M = 114.648.109 ✓.
- Logística: 8 viajes × 220 km = 1.760 km. Combustible 323.136 + desgaste 264.000 = 587.136 ✓.
- Cargarlo como 0,667 trabajos por mes da **el mismo precio por trabajo** ✓.

**Razonabilidad**: $ 4,49 M por día, unos $ 125.000 por hora-hombre. Es más caro que C1 por el preaviso y las habilitaciones de un trabajo corto y por la contingencia más alta. Es razonable, pero el Resultado está mal rotulado y hay un total erróneo (ver P0-1 y P1-6).

---

## 3. Lo que no pude expresar (y cómo lo cobra un proveedor real)

1. **Diagrama (14x7, 7x7, 2x1, 1x1) → nómina contra personas en sitio.** La app no lo calcula. Hay que pasar 1,5 o 1,6667 personas por posición, que es fraccionario y no se puede hacer exacto (5/3 queda como "5,0001 personas"). Un proveedor real cotiza nómina entera (5) y factura posiciones cubiertas.
2. **Relevos como un hecho propio (cada 7 días, X personas, un medio, horas de viaje).** Con el contrato fijo mensual, la "intervención" queda clavada en 1 por día (30 por mes) y no hay ningún campo para cambiarla. Para no costear 30 viajes a Añelo tuve que poner **0,143 viajes por intervención**. Con el contrato por servicio, la intervención es el llamado y tampoco es el relevo. En el precio cerrado coincide por casualidad con el trabajo.
3. **Campamento por persona-día en sitio** (lo pagan los días de diagrama, no los días facturados). "Alojamiento y viáticos por intervención" sólo sigue a los días activos. En C2 tuve que cargarlo como otro costo fijo, calculado a mano.
4. **Horas de viaje** del CCT (traslado de relevo pagado como horas). No existen; las cargué como un tramo de horas extra "por mes".
5. **Jornada de 12 h pagada en diagrama aunque no haya trabajo** (guardia en campamento). Las horas extra sólo existen "por día activo" o como promedio mensual cargado a mano.
6. **Hora extra sobre básico más adicionales.** El motor usa sólo el básico (docs §3). En C1 la diferencia es de unos $ 7,6 M/mes (+9 % de costo).
7. **Mínimo garantizado en días** ("se garantizan 15 días al mes"). Sólo se puede cargar en $; en el modo "calculá la tarifa" es circular, porque hay que cargar el mínimo que sale de la tarifa que la app calcula después.
8. **Un único trabajo de 45 días.** Sólo se puede cargar como "trabajos por mes". La pantalla habla de "45 días de trabajo por mes" y de "150 % de utilización".
9. **Francos y descanso legal.** El único control es de horas. Con 1 persona por posición y 7 h extra por día, el aviso desaparece aunque esa persona trabaje 30 días seguidos de 12 h.

---

## 4. UX confusa o engañosa (pantalla, campo y captura)

- **Etapa 2 › Personal › "Personas por posición (relevos)"**: acepta 1,5 y muestra "3 posiciones × 1,5 personas = 4,5 personas" sin ningún aviso (`09-labor-c1.png`).
- **Etapa 2 › Personal › Opciones avanzadas**: "Cargas aplicadas… factor × 1,5453. **ILUSTRATIVO**" aparece aunque el convenio y el perfil no son ilustrativos. La causa es que 176 h y 50 % coinciden con los valores ilustrativos (`illustrativeParam` compara por valor, `labor.js:118`), así que un usuario real con la jornada legal estándar queda marcado para siempre (`09-labor-c1.png`).
- **Etapa 1 › Contrato › "Empezar en blanco"**: arranca con "Personal" y "Equipo o maquinaria" ya marcados. Una cuadrilla con camioneta termina como `serviceType = equipment_with_operator` (`03-etapa1-c1.png`, `m02-contrato-mobile.png`).
- **Etapa 1 › Cómo se cobra (fijo mensual)**: muestra "INTERVENCIONES POR MES 30" sin explicar qué es una intervención en un abono ni dejar cambiarla. Además dice "Cargá los días por mes para ver cuántos intervenciones…" (debe decir "cuántas") (`04-comose-cobra.png`, `05-comose-cobra-lleno.png`).
- **Etapa 2 › Equipos**: las horas de uso por día de la camioneta toman por defecto las de la actividad (12 h × 8 L/h = 96 L/día, unos 800 km). Un vehículo de cuadrilla se cuesta por km/día, no por horas de motor (`10-equipos-c1.png`).
- **Movilización y viajes**: el resumen muestra "0,14 viajes por intervención" (el valor cargado es 0,143). Un viaje fraccionario es la señal de que el modelo no calza (`12-logistica-c1.png`).
- **Resultado C3 (precio cerrado)**: "COSTO DEL MES $ 162.788.069 / mes" (es el costo del trabajo de 45 días), "Ganás $ 30.333.941 **por mes**" (es por trabajo), "necesitás facturar al menos **0,5 trabajos por mes** (22,1 días)" y el aviso "Revisá cómo cobrás… 45 días: más que los 30 disponibles", que empuja a "corregir" algo que está bien (`crop-33.png`).
- **Indicador "Costo logístico / incidencia"**: no incluye el campamento cargado como otro costo de Logística. En C2 dice 0,13 %, cuando lo real es ≈ 7 %.
- **Base económica**: un equipo cargado en Recursos con "Base del valor" queda "Costos no definida", porque hay un segundo campo de base para los costos anuales. El aviso "2 valores no tienen fecha base" deja la cotización en BORRADOR (96 %) aunque esté completa.

---

## 5. Errores de cálculo y bugs (con reproducción)

**B1 — Total del contrato de un precio cerrado = 12 veces el precio (P0)**
1. Contrato "Precio cerrado", 1 trabajo por mes de 45 días, contrato de 12 meses (es el valor por defecto en "Más datos de la cotización").
2. Resultado › Ver reparto de la tarifa y total del contrato: "Total del contrato (12 meses) — Facturación **$ 2.426.664.000**". El trabajo vale $ 202.222.000, así que el total está 12 veces arriba.
3. Origen: `quote-result.js:1940` multiplica el mes por `contractMonths` sin mirar el modo `closed`. Encima, el resultado depende de cómo se cargó el trabajo: 1 trabajo/mes × 1,5 meses = 303 M; 0,667 trabajos/mes × 1,5 meses = 202 M.

**B2 — Aviso de horas de personal falso cuando el trabajo dura más de un mes (P1)**
- En C3: "45 días × 12 h = 540 h de cobertura por posición en el mes; lo cargado cubre 473,3 h… Faltan 66,7 h". El control compara 45 días de demanda contra **un mes** de horas normales.
- Prorrateado (×1,5 meses) se cubren 440 + 180 = 620 h, más de 540, así que no falta nada. Cargado como 0,667 trabajos por mes (D = 30) el aviso no aparece.
- Origen: `completeness-engine.js` (bloque `labor_hours`) usa D sin `factorMeses`.

**B3 — Precio del trabajo cerrado sensible a "Días disponibles en el mes" (P2)**
- El mismo trabajo de 45 días cuesta $ 202,22 M con 30 días disponibles y $ 198,83 M con 31. El sueldo de 45 días calendario se prorratea por un mes abstracto.

**B4 — 4,5 personas costeadas (P1, induce a error)**
- 3 posiciones × 1,5 suma 4,5 sueldos. El proveedor real paga 5. La diferencia es de **−$ 5,27 M/mes (−6,2 %)** en la tarifa sugerida (105,0 M contra 111,6 M).
- No hay aviso de dotación fraccionaria.

**B5 — Relevos costeados todos los días si no se usa el truco (P2)**
- Con "Viajes por intervención" en 1 (el valor por defecto), C1 costea 30 viajes por mes a Añelo (6.600 km): +$ 2,33 M/mes de costo y +$ 2,9 M de tarifa sugerida. El usuario no tiene un campo de frecuencia de relevo para evitarlo.

**Sin bugs de cálculo** en la aritmética que verifiqué: factor de cargas, fijo por persona, horas extra, tarifa piso y sugerida con gross-up, estructura, contingencia, logística por km, consistencia del precio por trabajo entre las dos formas de carga y redondeo comercial.

---

## 6. Hallazgos y correcciones propuestas

Principio aplicado: nada de listas cerradas. Cada concepto nuevo es opcional y de texto o número libre.

| # | Sev. | Hallazgo | Corrección propuesta |
|---|---|---|---|
| 1 | **P0** | Total del contrato con precio cerrado = precio × 12 meses (B1). | Con `contract.mode = closed`, el total es el precio × la cantidad de trabajos del contrato (campo "Trabajos del contrato", 1 por defecto). `contractMonths` sólo para fijo mensual o por servicio; si no, mostrarlo como "Duración: 45 días ≈ 1,5 meses". |
| 2 | P1 | No existe el diagrama: hay que convertir 14x7 a mano y la app acepta 4,5 personas (B4). | Campo opcional **"Diagrama"** en cada puesto, libre: días de trabajo / días de franco (14/7, 7/7, 20/10, 5/2…). Calcular la fracción en sitio = T/(T+F), la **nómina necesaria** = posiciones / fracción, **sugerir el entero** ("4,5 → 5: en sitio 3,33 promedio") y dejar que el usuario elija nómina real. Mostrar siempre "nómina N / en sitio M". Si "personas por posición" no da un total entero, aviso informativo. |
| 3 | P1 | Fijo mensual: intervención = 1 día y no se puede cambiar. El tipo "permanente", con "¿Cada cuántos días hay una intervención?", no se alcanza desde el contrato (`serviceTypeForContract` nunca devuelve `permanent`). Los relevos se cargan con viajes fraccionarios. | Crear un driver **"Relevos"** separado de intervenciones y llamados: cada N días (o derivado del diagrama), personas por relevo, vehículo o medio (propio, combi, remis, avión), km, peajes y **horas de viaje** pagas. Costo = relevos/mes × costo por relevo. Mostrar el campo de intervalo en fijo mensual. |
| 4 | P1 | Campamento y viáticos sólo por día activo. En on call con cuadrilla en diagrama se paga todo el calendario. | Elegir la base del viático: por día activo, **por persona-día en sitio** (dotación en sitio × días calendario) o por relevo. |
| 5 | P1 | Hora extra sólo sobre básico (−9 % de costo en C1) y sin "jornada pagada en diagrama aunque no se trabaje". | En el puesto: "Base de la hora extra: básico / básico + adicionales remunerativos" y horas extra "por día en sitio" (sigue al diagrama), además de las que existen. |
| 6 | P1 | Resultado de un precio cerrado rotulado por mes: "Costo del mes", "Ganás… por mes", "0,5 trabajos por mes", y el aviso "Revisá cómo cobrás" cuando el trabajo dura más de 30 días. | Con precio cerrado: "Costo del trabajo", "Ganás $ X por trabajo", duración en días, "Costo por día" visible. Sacar el aviso de "más días que el mes" cuando la unidad es el trabajo. Dejar cargar "1 trabajo de 45 días" sin la fracción por mes. |
| 7 | P1 | Aviso de horas de personal falso con D > días disponibles (B2). | Prorratear las horas normales por `factorMeses` (o comparar por día). Agregar un test golden con un trabajo de 45 días. |
| 8 | P1 | Mínimo garantizado sólo en $; en "calculá" es circular. | "Mínimo garantizado" en $ **o en unidades** (días u horas garantizados), que siga la tarifa ofrecida o sugerida. |
| 9 | P1 | El único control de cobertura es de horas: no detecta 30 días seguidos sin franco. | Con diagrama cargado, controlar días en sitio por persona contra el ciclo. Sin diagrama, aviso informativo cuando D = días disponibles y personas por posición = 1 ("¿quién cubre los francos?"). |
| 10 | P2 | Marca ILUSTRATIVO cuando los valores reales coinciden con los de ejemplo (176 h, 50 %). | Marcar por origen (flag `illustrative` del convenio, del perfil o de la cotización), no por comparar valores. |
| 11 | P2 | "Empezar en blanco" trae "Equipo o maquinaria" marcado; una cuadrilla con camioneta queda como "equipo con operador". | Un comienzo en blanco no marca nada. Con sólo "Vehículo" no marcar "maquinaria". Tipo derivado "cuadrilla con vehículo". |
| 12 | P2 | Una camioneta de cuadrilla se cuesta por horas de motor, con 12 h/día por defecto. | Para la familia "Camioneta" o vehículos: uso en **km por día** (consumo L/100 km y $/km de la ficha), con horas opcionales. |
| 13 | P2 | El indicador de logística no suma otros costos de categoría Logística (campamento). | Incluirlos, o rotular "movilización y viajes (sin otros costos)". |
| 14 | P2 | Personas por posición fraccionaria no exacta (5/3 → "5,0001"). | Dejar cargar la **nómina total** y derivar personas por posición, o redondear la vista. |
| 15 | P2 | El precio de un trabajo cerrado depende de los días disponibles (30 o 31) (B3). | Para precio cerrado, prorratear fijos por días calendario del trabajo / 30, explícito y editable. |
| 16 | P2 | Dos bases en el equipo (valor y costos): un equipo de Recursos queda "Costos no definida" y la cotización queda en BORRADOR. | Heredar la base del valor para los costos anuales si están vacíos, o pedir una sola base. |
| 17 | P2 | "cuántos intervenciones" (Cómo se cobra). | "cuántas intervenciones". |
| 18 | P2 | Mobile: la etapa de personal es muy larga y el aviso flotante tapa campos. | Colapsar "Opciones avanzadas" de cada puesto en tarjetas. Avisos flotantes arriba o que se cierren solos antes. |

### Cómo lo cobraría un proveedor real (para que la app lo soporte sin opciones fijas)
- **Fijo mensual por posición cubierta** (3 posiciones 12 h, 30 días), con nómina 5 detrás. Relevos y campamento incluidos o como ítems aparte.
- **On call**: abono de disponibilidad (cubre nómina y campamento) más tarifa por día trabajado, o día de espera al 50–70 % de la tarifa; mínimo garantizado expresado en **días**.
- **Precio cerrado**: precio global por el trabajo, más adicionales por día extra (que hoy sí existen como "Adicionales") y cláusula de ajuste. Total del contrato = precio del trabajo.
