# Informe de prueba de RATEOS: especialista en logística (Neuquén / Vaca Muerta)

Fecha: 07/11/2026. App: `dist` v0.8.1 (build 401ae8b), con el arnés Playwright y Supabase simulado.
Recorrí la interfaz como un usuario real: Nuevo cálculo → Empezar en blanco → las 5 etapas → Resultado. Hice 4 cotizaciones completas en escritorio y repasé una en modo mobile (390 px). Después recalculé cada número con `computeQuote`, usando el estado que quedó guardado.

- Scripts: `(carpeta de trabajo de la sesión)/work-logistica/` (q1.mjs a q4.mjs, check1/2.mjs, mobile.mjs, variants1/3.mjs, verify2.mjs)
- Capturas: `(carpeta de trabajo de la sesión)/shots/logistica/`
- Estados guardados: `state.json` (Q1, Q2), `state3.json` (Q3), `state4.json` (Q4), en la carpeta work-logistica.

Todos los montos son **sin IVA**, como pide la app.

---

## 0. Referencias de mercado usadas

| Dato | Valor usado | Fuente / criterio |
|---|---|---|
| Gasoil | $ 2.150/L sin IVA (nov-26) | YPF Neuquén: Infinia Diesel a $ 2.577/L con IVA (ago-2026, [noticiasnqn](https://www.noticiasnqn.com.ar/noticias/2026/06/04/338051-volvio-a-aumentar-el-combustible-en-neuquen)). Sin IVA son ≈ $ 2.130; le sumé ~1 % por los aumentos posteriores. **Estimación.** |
| Chofer CCT 40/89 | Básico 1ª categoría ≈ $ 1.126.149 (planilla 247, oct-2026) | [calcularsueldo.com.ar](https://calcularsueldo.com.ar/?p=16246), [perfil.com (ago-2026)](https://www.perfil.com/noticias/economia/escala-salarial-de-camioneros-todos-los-sueldos-basicos-y-horas-extras-de-agosto-de-2026-a35.phtml). Las fuentes no coinciden entre sí. Usé básicos de $ 1,10 a 1,35 M más adicionales de $ 0,65 a 1,0 M (zona, permanencia y adicional yacimiento). Ojo: muchos choferes de Vaca Muerta cobran por el CCT petrolero 644/12, que es bastante más alto. |
| Costo del transporte de cargas | +30,3 % acumulado ene–sep 2026 (FADEEAC). Corredor Mendoza–Bs As ≈ $ 2.319/km (jun-2026) | [agrofy (oct-2026)](https://news.agrofy.com.ar/noticia/216735/costo-transporte-cargas-acumulo-suba-303-nueve-meses-impacto-gasoil), [sitioandino](https://www.sitioandino.com.ar/economia/costos-del-transporte-cargas-subieron-20-2026-y-agravan-la-presion-el-sector-n5724159) |
| Pickup 4x4 0 km | $ 43 a 76 M en Neuquén (avisos) | [MercadoLibre Neuquén 4x4](https://autos.mercadolibre.com.ar/4x4/precio-negociable/neuquen/2026/). Usé $ 62 M con el equipamiento petrolero. |
| Tarifas de hidrogrúa, alquiler de 4x4 con chofer y carretón | No encontré tarifas publicadas | Uso los rangos de mi experiencia, marcados como **estimación**: hidrogrúa de 25–30 t·m con chofer y rigger, $ 180–300 mil/h con mínimo de 4 h más km de traslado; 4x4 con chofer a disposición, $ 9–13 M/mes; carretón cama baja con escolta Bahía Blanca → Añelo, $ 9–14 M por movilización. |

Parámetros comunes de las 4 cotizaciones:
- Cargas: SAC 8,33 %, vacaciones 5 %, contribuciones 26 %, ART 9 %, 200 h normales.
- Estructura: 12 % (8 % en Q4).
- Cobro a 60 días (45 días en Q3), tasa del 3 % mensual (valor por defecto).
- Contingencia: 3 %.
- Impuestos sobre la facturación: 4,5 % (IIBB Neuquén más débitos y créditos, **estimación**).

---

## 1. Cotizaciones realizadas

### Q1. Camión con hidrogrúa on call, Neuquén → Añelo (100 km), chofer y ayudante

**Cómo la cargué:**
- **Contrato:** "Por servicio prestado (on call)", cobro en $/hora. Cálculo "calculá cuánto cobrar", 10 llamados por mes de 1 día y 6 h facturables por día. Mínimo por llamado de 4 h y standby "no aplica".
- **Personal:**
  - Chofer hidrogruista: básico 1,30 M + adicionales 0,90 M, 2 h extra por día y vianda de $ 22.000.
  - Ayudante/rigger: 1,10 M + 0,65 M, con las mismas extras.
- **Equipo propio:** camión 6x4 con hidrogrúa 30 t·m.
  - Valor de reposición $ 270 M, 10 años de vida útil y residual de $ 67,5 M.
  - Costos anuales: seguro 6 M, patente 2,5 M, certificaciones de izaje 1,8 M y otros 0,9 M.
  - Uso: 4 h de grúa por día, 8 L/h, mantenimiento $ 18.000/h.
  - Neumáticos: juego de $ 9,5 M con vida de 90.000 km.
- **Movilización:** por sus propios medios, 38 L/100 km, desgaste de $ 180/km, maneja su operador.

**Qué dio la app** (captura q1-07-resultado.png):

| | App |
|---|---|
| Costo del mes | **$ 16.296.248** |
| Tarifa piso | **$ 284.403 / h** |
| Tarifa sugerida (18 %) | **$ 351.000 / h** (≈ $ 2,1 M por día de 6 h) |
| Días para no perder | 7,4 |

**Verificación manual: coincide.**
- Factor de cargas: 1,1333 × 1,35 = 1,53.
- Chofer: 2,2 M × 1,53 + 90 mil = 3.455.901.
- Tenencia del camión: (270 − 67,5)/120 + 11,2 M/12 = 2.620.833.
- Combustible en ruta: 200 km × 0,38 × 2.150 = 163.400 por llamado.
- Desgaste: 200 × (180 + 105,56 de neumáticos) = 57.111.
- Tarifa: 16,296 M / (1 − 0,18 − 0,045) / 60 h = 350.457.

**¿Es razonable?** Queda en la parte alta del rango estimado ($ 180–300 mil/h). Hay dos causas, y las dos son de cómo la app pide los datos:
1. **La grúa y la cuadrilla se cargan 100 % reservadas** para 10 días al mes. Si las comparto al 40 %, el costo baja a $ 9,9 M y el piso a $ 172.794/h. El usuario tiene que saber el % de antemano: la app no ayuda a estimarlo.
2. **Sólo se facturan las 6 h en locación.** El mercado cobra la grúa *portal a portal* (desde que sale de base), así que con 100 km son unas 3 h más de viaje. Facturando 9 h, el piso baja a $ 189.601/h, un 33 % menos. La app no separa las horas de viaje de las horas de trabajo (ver P1-5).

Si además cobro los km aparte (regla "km adicional" a $ 3.500/km), el piso por hora baja a $ 167.736 y aparecen $ 7 M de otros ingresos. La regla funciona bien.

### Q2. Camioneta 4x4 con chofer a disposición de una operadora (fijo mensual)

**Cómo la cargué:**
- **Contrato:** "Fijo mensual" con Personal y Vehículo. Unidad $/mes, 26 días por mes de 10 h (lunes a sábado).
- **Chofer:** 1,18 M + 0,75 M, 2,3 h extra por día y vianda de 22.000.
- **Pickup 4x4 DC equipada petrolera:**
  - Valor $ 62 M, 5 años de vida útil y residual de $ 20 M.
  - Costos anuales: seguro 3,6 M, patente 1,9 M, equipamiento/habilitación 1,5 M y rastreo satelital 0,72 M.
  - Neumáticos: juego de $ 1,52 M con vida de 60.000 km.
- **Km:** para que el vehículo recorra ~6.000 km por mes tuve que cargarlos como **"movilización por sus propios medios"**: distancia de 115 km, ida y vuelta, 1 intervención por día. Resultado: 26 × 230 = 5.980 km, 11 L/100 km y desgaste de $ 120/km más neumáticos.
- **Km excedente:** lo cargué como "Adicional" con 800 km por mes y un costo de $ 380/km que tipeé a mano.

**Qué dio la app** (captura q2-06-resultado.png):

| | App |
|---|---|
| Costo del mes | **$ 10.139.459** |
| Tarifa piso | **$ 10.161.519 / mes** |
| Tarifa sugerida (15 %) | **$ 12.140.000 / mes** más km excedente (precio sugerido ≈ $ 570/km) |

**Verificación manual: coincide.**
- Tenencia de la pickup: 700.000 + 643.333 = 1.343.333.
- Combustible: 5.980 × 0,11 × 2.150 = 1.414.270.
- Desgaste: 5.980 × 145,33 = 869.093.

**¿Es razonable?** Sí: entra en el rango estimado de $ 9–13 M/mes. El problema está en *cómo* hubo que expresar los km (ver P1-3).

**Detalle a tener en cuenta:** la tarifa piso ($ 10,16 M) apenas supera el costo ($ 10,14 M), aunque los impuestos son del 4,5 %. La razón es que la tarifa piso ya descuenta lo que se espera facturar de km excedente, con su propio margen del 15 % ($ 455.716). En el resultado no se ve que el piso "para no perder plata" depende de vender esos 800 km extra.

### Q3. Movilización de una excavadora de 30 t, Puerto de Bahía Blanca → Añelo (semi y carretón, precio cerrado)

**Cómo la cargué:**
- **Contrato:** "Precio cerrado" con Personal, Vehículo, Viáticos y Otros. Unidad $ global por trabajo: 1 trabajo por mes de 4 días, a 12 h por día.
- **Personal:**
  - Chofer de carretón: 1,35 M + 1,0 M y 4 h extra por día.
  - Chofer de escolta: 1,18 M + 0,70 M y 4 h extra por día.
- **Tractor 6x4 450 CV:**
  - Valor $ 280 M, 8 años de vida útil y residual de 90 M.
  - Costos anuales: seguro 7,2 M, patente 4 M, RTO y habilitaciones 1,2 M, satelital 0,72 M.
  - Neumáticos: juego de 9,5 M con vida de 100.000 km.
  - Movilización por sus medios, a 45 L/100 km y 220 $/km.
- **Carretón cama baja 3 ejes 60 t:**
  - Valor $ 95 M, 15 años de vida útil y residual de 20 M.
  - Costos anuales: seguro 2,4 M, patente 1,5 M, certificaciones 0,8 M.
  - Neumáticos: juego de 8,4 M con vida de 120.000 km. Marcado "No usa combustible".
  - Movilización: **"Lo transporta otro equipo" = tractor**.
- **Ruta:** distancia "una vía" de 640 km, ida y vuelta. Es una aproximación: la ruta real es Neuquén → Bahía Blanca vacío (540 km), Bahía Blanca → Añelo cargado (640 km) y Añelo → Neuquén (100 km).
- **Pickup de escolta** como vehículo auxiliar: 11 L/100 km y 145 $/km.
- **Peajes:** $ 45.000 por trabajo (estimación).
- **Viáticos:** $ 690.000 por trabajo, calculados fuera de la app (2 personas × 3 noches × $ 115.000).
- **Otro costo por trabajo:** permiso de tránsito para carga excepcional (DNV y DPV) más seguro de la carga en tránsito, $ 1.040.000.

**Qué dio la app** (captura q3-07-resultado.png):

| | App |
|---|---|
| Costo "del mes" | **$ 17.983.085** |
| Tarifa piso | **$ 18.830.456 / trabajo** |
| Tarifa sugerida (18 %) | **$ 23.204.000 / trabajo** |
| "Necesitás facturar al menos" | 0,75 trabajos por mes |

**Verificación manual:**
- Combustible del tractor: 1.280 × 0,45 × 2.150 = 1.238.400 (coincide).
- Desgaste del tractor: 1.280 × (220 + 95) = 403.200 (coincide).
- Escolta: 302.720 de combustible + 185.600 de desgaste + 45.000 de peajes + 690.000 de viáticos (coincide).
- **Falta el desgaste de neumáticos del carretón:** 1.280 × 70 = **$ 89.600 por trabajo** que no aparecen en ningún lado (bug P0-1).

**¿Es razonable?** **No.** $ 23,2 M es aproximadamente el doble del mercado estimado ($ 9–14 M). El motivo es que con "1 trabajo por mes" la app carga en ese único trabajo **el mes completo** de:
- sueldos: $ 7,29 M, el 40 % del costo;
- tenencia del tractor y el carretón: $ 3,88 M;
- estructura: $ 1,81 M.

Con el mismo equipo haciendo más trabajos por mes (variants3.mjs):

| Trabajos por mes | Tarifa piso por trabajo |
|---|---|
| 1 | $ 18,83 M |
| 3 | $ 10,09 M |
| 5 | $ 8,34 M (sugerida ≈ $ 10,3 M, ya dentro del mercado) |
| 7 | $ 7,59 M |

Para la app, el usuario que cotiza "una movilización" está cotizando 1 trabajo por mes. Nada le advierte que sus fijos se cargan enteros en ese trabajo (ver P1-1).

### Q4 (extra). Flete de cañería Neuquén → Añelo en $/viaje, con un fletero tercerizado que cobra por km

**Cómo la cargué:**
- **Contrato:** "Por servicio" con Servicio de terceros y Vehículo. Unidad $/viaje: 40 viajes por mes, 2 viajes por día.
- **Semi playo tercerizado:** $ 3.250/km, con operador, combustible, movilización y seguro incluidos. IVA 21 % recuperable.
- **Ruta:** 100 km de ida.

**Qué dio la app** (captura q4-04-resultado.png):

| | App |
|---|---|
| Costo del mes | **$ 30.498.403** |
| Tarifa piso | **$ 798.388 / viaje** |
| Tarifa sugerida (12 %) | **$ 914.000 / viaje** (equivale a $ 4.570/km) |
| Km de ruta | 8.000 por mes |

**Verificación manual:** 40 viajes × 200 km × 3.250 = $ 26 M (coincide). Los viajes físicos se derivan bien de los viajes por día (40 viajes, 20 intervenciones × 2). El resultado dice correctamente "Sin costos fijos".

**¿Es razonable?** Sí. Un recargo del 40 % sobre el fletero cubre estructura, financiación a 60 días, contingencia, IIBB y el 12 %. Es la cotización mejor resuelta de las cuatro.

### Prueba en mobile (390 px)

Recorrí Q3 en Movilización, Equipos, Cómo se cobra y Resultado. No hay scroll horizontal de página: scrollWidth = clientWidth = 390. Las tablas de vehículos se ven como tarjetas y el resultado se lee bien (crop-mobile-result.png, crop-mobile-log-0.png). No encontré problemas.

---

## 2. Lo que NO pude expresar en la app (y cómo lo cobra un proveedor real)

1. **Rutas con tramos.** La app tiene una sola "Base → Destino" con ida y vuelta.
   - Un carretón real hace base → origen de la carga (vacío) → destino (cargado) → base (vacío).
   - Cada tramo consume distinto: un semi cargado gasta unos 45–55 L/100 km y vacío unos 32–38.
   - Tuve que inventar una distancia "una vía" de 640 km y un consumo promedio.
   - El proveedor real cotiza por km, separando los km cargados de los km en vacío, o con un precio cerrado que sale de esa planilla.
2. **Viáticos por persona y por noche.** El único campo es "Alojamiento y viáticos por llamado/trabajo", un monto global.
   - El proveedor calcula personas × noches × (hotel + comidas), más el viático de convenio no remunerativo por día o pernocte (CCT 40/89).
   - Cuando cambian los días del trabajo o la dotación, el monto no se recalcula.
3. **Km recorridos por mes de un vehículo afectado.** La camioneta a disposición recorre km en el yacimiento, no "una movilización a una locación". No hay un campo "km por día" ni "km por mes" en el vehículo, así que hubo que simularlo con la movilización.
4. **Tope de km mensual con excedente.** La regla "Km incluidos y km adicional" es **por llamado**, no por mes. El adicional "Km excedente" pide **mi costo por km a mano** y no lo toma del vehículo, aunque la app ya lo conoce: 11 L/100 km × 2.150 + 145 $/km ≈ $ 382/km.
5. **Horas portal a portal.** No se pueden separar las horas facturables de traslado de las horas en locación, ni calcular el tiempo de viaje a partir de los km. En hidrogrúas y camiones grúa la hora se cobra desde que el equipo sale de la base.
6. **Desgaste de un remolque arrastrado.** Carretón, batea, cisterna o semirremolque en modo "lo transporta otro equipo": su desgaste por km (neumáticos y mantenimiento) no se suma en ningún lado. Ver P0-1.
7. **Tenencia del vehículo de escolta.** La logística auxiliar sólo cuesta por km: combustible y desgaste sin amortización. La pickup de escolta tiene amortización, seguro y patente, que se pierden salvo que se cargue también en Equipos, y entonces hay riesgo de contarla dos veces.
8. **Prorrateo de una flota en un trabajo puntual.** En precio cerrado no hay forma guiada de decir "este equipo y esta gente hacen unos 5 trabajos por mes". Existe "Compartido %", pero el % lo calcula el usuario por su cuenta.
9. **Peajes por eje o por categoría.** Hay un único monto por llamado. Es aceptable, pero un semi de 6 ejes paga distinto que la pickup de escolta.

---

## 3. UX confusa o engañosa

| # | Pantalla / campo | Problema | Evidencia |
|---|---|---|---|
| U1 | Contrato → "¿Cómo te paga el cliente?" (cotización en blanco) | Se ve "Por servicio prestado (on call)" seleccionado, con Personal y Equipo tildados, pero **no está guardado**. En "Cómo se cobra" las unidades son sólo $/día, $/hora, $/llamado, **$/mes** y Otra: no aparecen $/viaje, $/km, $/m³ ni $/t, y el $/mes no corresponde a un servicio on call. Si se tilda y destilda cualquier componente, la misma pantalla muestra las 23 unidades. | bug-unidades-contrato-por-defecto.png. check2.mjs: `contract: undefined, serviceType on_call`, unidades `day,hour,call,month,custom` → `hour,day,call,trip,km,…,custom` |
| U2 | Resultado → insignia "ILUSTRATIVO" | Aparece en las 4 cotizaciones aunque cargué todos los valores. El tooltip dice literalmente **"Incluye valores ILUSTRATIVOS: . Reemplazalos…"**, sin decir cuál. La causa es la tasa de financiamiento del 3 % por defecto (`finance.illustrative`), que no está en la lista de `illustrativeBadge` (quote-result.js:1409-1419). | check1.mjs: `BADGE title: Incluye valores ILUSTRATIVOS: . Reemplazalos…` |
| U3 | Precio cerrado → Resultado | Dice "COSTO DEL MES … / mes" y "necesitás facturar al menos **0,75 trabajos por mes**". Para una movilización puntual, el lenguaje mensual y los trabajos fraccionarios confunden y esconden que el precio absorbe un mes entero de fijos. | q3-07-resultado.png, crop-mobile-result.png |
| U4 | Fijo mensual → "Con estos datos" | Error de concordancia: "Cargá los días por mes para ver **cuántos intervenciones**…". Además, "intervención" no tiene sentido para una camioneta a disposición. | q2 modality (salida de q2.mjs) |
| U5 | Cómo se cobra → Opciones avanzadas | La disponibilidad **24/7** viene por defecto, escondida. Genera el aviso "Relevos: Cobertura 24/7 con una sola persona", cuyo botón dice "Ir a Personal" y no lleva al campo de disponibilidad. Una hidrogrúa on call diurna no debería necesitar relevos. | check1.mjs (Q1) |
| U6 | Aviso "Fecha base de los valores" (Q1) | Faltaba la fecha base del equipo, pero el botón dice "**Ir a Contrato**". El campo está en Equipos → "Fecha base y moneda". | check1.mjs |
| U7 | Movilización → "Desgaste por km" del equipo propio y neumáticos "Juego + vida útil en km" en Equipos | El mismo concepto se reparte en dos pasos. El desgaste mostrado suma los neumáticos solo (180 + 105,56). Si el usuario incluyó los neumáticos en sus "$ 180/km de desgaste", los cuenta dos veces, y nada lo advierte. | q1-05-movilizacion.png: "desgaste $ 57.111" con 180 $/km cargados |
| U8 | Equipos → ficha de un vehículo de ruta | La ficha está pensada para máquinas: pide "Horas de uso por día activo", "L/h" y "mantenimiento por hora". En un camión o una pickup el uso es en km. Tuve que poner 0 h y cargar los km en otro paso. | q2-03-equipo.png |
| U9 | Movilización → carretón "Lo transporta otro equipo" | No muestra que su juego de neumáticos por km quedó sin contar. Ver P0-1. | q3-04-movilizacion.png |
| U10 | Movilización → "¿Quién maneja? Su operador" | Hay que elegir un operador hasta para equipos sin conductor. En Q4 la pantalla de combustible sigue pidiendo precio y "¿quién paga?" aunque el proveedor incluye el combustible. | q4-03-movilizacion.png |
| U11 | Q2 → Resultado | La tarifa piso ya descuenta el ingreso esperado de km excedente, y no se ve: "para no perder" depende de vender esos km. | q2-06-resultado.png |

---

## 4. Errores de cálculo y bugs (con pasos para reproducir)

### BUG-1 (P0): se pierde el desgaste por km de un equipo transportado o arrastrado

**Pasos:**
1. Precio cerrado. Equipo propio "Carretón", con neumáticos "Juego + vida útil en km" ($ 8,4 M / 120.000 km = 70 $/km).
2. En Movilización, elegir "Lo transporta otro equipo" = tractor por sus medios, con 640 km de ida y vuelta.

**Resultado:** la línea "Carretón — operación (mant. y neumáticos)" da F 0 y v 0. El tractor sólo suma sus propios 315 $/km.

**Esperado:** sumar 1.280 km × 70 = **$ 89.600 por trabajo** (y el mantenimiento por km del remolque, que en este modo ni se puede cargar).

**Contraprueba:** si cambio el carretón a "por sus propios medios" con 0 L, el desgaste de movilización por día pasa de 100.800 a 123.200 (+22.400 × 4 días = +89.600). Evidencia en variants3.mjs.

La documentación (CALCULATION_RULES §5.1) dice "transported → 0 (el costo está en la línea del carretón / batea / camión)". Eso vale para el equipo **cargado arriba** (la excavadora), no para el **remolque** que rueda. La app trata igual un carretón enganchado a un tractor que una retro arriba de un carretón.

### BUG-2 (P0 para un usuario de logística): el contrato por defecto no se guarda y cambia las unidades disponibles

Es el caso U1. Si el usuario arranca en blanco y no toca nada del contrato, la cotización queda sin `contract` (se lee desde `serviceType`). Entonces:
- no puede elegir $/viaje, $/km, $/m³ ni $/t;
- ve $/mes dentro de un servicio on call.

No hay mensaje que explique el motivo. Un fletero no encuentra $/viaje en su primera cotización.

**Causa probable:** `applyContract` sólo se ejecuta en el `onChange` del radio o de los checkboxes (js/ui/views/quote-steps/service.js:220-262). Elegir la opción que ya está marcada no dispara ningún evento.

### BUG-3 (P2): tooltip vacío en la insignia ILUSTRATIVO

Ver U2. `illustrativeBadge` arma `parts` sólo con las líneas y el combustible, y omite `info.finance`.

### Verificaciones que dieron bien

Las cuatro cotizaciones coinciden con el cálculo manual: cargas, tenencia, combustible en ruta, desgaste, km de ruta derivados de viajes/día, gross-up de impuestos y el precio sugerido de los adicionales. La regla "km adicional" y la asignación compartida (con `fixedCostSharePct`) también se comportan como dice CALCULATION_RULES. En la UI y en mobile no hubo `pageerror`.

---

## 5. Hallazgos con severidad y propuesta de corrección

Criterio rector del dueño: nada de tipos fijos; todo moldeable. Las propuestas agregan campos opcionales y editables y no imponen valores.

| ID | Sev. | Hallazgo | Propuesta concreta |
|---|---|---|---|
| P0-1 | **P0** | El desgaste por km (neumáticos y mantenimiento) de un remolque o equipo "transportado" se pierde. En Q3 son −$ 89.600 por trabajo, y crece con cada remolque y cada km. | Separar "va cargado arriba de otro equipo" (excavadora: 0 km propios) de "va enganchado o arrastrado" (carretón, batea, cisterna: recorre los km de su tractor). En el segundo caso, sumar su desgaste por km (juego/vida en km más un $/km de mantenimiento editable) con los km de ruta del equipo que lo arrastra. Agregar un aviso de completitud si un equipo transportado tiene costos por km cargados que no se usan. Agregar un golden case con carretón y tractor. |
| P0-2 | **P0** | Cotización en blanco: el contrato que se ve no está guardado, y faltan $/viaje, $/km, $/m³ y $/t (sobra $/mes). | Al crear la cotización, guardar el `contract` por defecto (on_demand con los componentes visibles), o que `contractOf` use esos componentes cuando `contract` no existe. Test e2e: blank → Cómo se cobra → que la lista contenga `trip` y `km`. |
| P1-1 | **P1** | Un precio cerrado por un trabajo puntual carga el mes completo de sueldos, tenencia y estructura. El precio sale ~2x el mercado ($ 23,2 M contra ≈ $ 10 M), sin ningún aviso. | En precio cerrado (y en on call con pocos días), preguntar de forma opcional "¿Cuántos días por mes trabaja en total este equipo/cuadrilla (todas las obras)?". Con ese dato, **sugerir** un % de asignación (días de esta cotización / días totales), que el usuario acepta o cambia. Así no se infiere solo, como pide la decisión del dueño. Agregar un aviso informativo cuando los fijos superan, por ejemplo, el 50 % del precio de un trabajo único. En el Resultado mostrar "Este precio incluye $ X de costos fijos del mes". |
| P1-2 | **P1** | Ruta única ida y vuelta: no se pueden expresar tramos vacío/cargado, rutas triangulares ni consumos distintos. | Reemplazar "Distancia (una vía) e Ida y vuelta" por una **lista de tramos editable** (desde, hasta, km, cargado sí/no, viajes por llamado). El caso actual sería una plantilla de 2 tramos. Cada equipo de ruta tendría consumo "cargado" y "vacío", o un único consumo como hoy. |
| P1-3 | **P1** | Los km de un vehículo afectado (camioneta a disposición, colectivo) no tienen un campo propio. Hay que simular una movilización. | En el vehículo (Equipos o logística auxiliar), agregar "km por día de trabajo" o "km por mes" como driver propio. El desgaste y el combustible salen de ahí. Mantener la movilización a locación como algo aparte. |
| P1-4 | **P1** | No existe un tope de km incluidos **por mes** con excedente. El adicional "Km excedente" pide el costo a mano. | Regla "Km incluidos por mes" con "$/km excedente" (además de la regla por llamado). El costo por km del excedente se propone desde el vehículo (combustible más desgaste), editable. Mostrar que la tarifa piso descuenta el ingreso de los adicionales. |
| P1-5 | **P1** | En $/hora no se distinguen las horas de traslado de las horas en locación. Con portal a portal el piso cambia un 33 %. | Campos opcionales "Horas facturables por llamado" con criterio (portal a portal / desde la llegada / mínimo), y "Velocidad media de ruta" (por ejemplo, 60 km/h) para estimar las horas de viaje desde los km. Las horas de personal y de equipo siguen siendo las suyas. |
| P1-6 | **P1** | Viáticos como monto único por llamado, sin personas × noches ni per-diem de convenio. | Tabla de viáticos moldeable: concepto, personas (por defecto, la dotación que viaja), noches o días (por defecto, los días por trabajo − 1) y $ unitario. Que se recalcule cuando cambian la dotación o los días. |
| P1-7 | **P1** | El vehículo auxiliar (escolta, pickup de cuadrilla) no tiene costo de tenencia. Si se carga en Equipos, se puede duplicar. | Permitir elegir como vehículo auxiliar una línea de Equipos ("Usar un equipo de la cotización"). Su tenencia queda en Equipos y sus km en Logística, sin duplicar, y la regla `duplicates` lo reconoce. |
| P2-1 | P2 | El tooltip de "ILUSTRATIVO" queda vacío cuando la causa es la tasa financiera por defecto. | Incluir "tasa de financiamiento ilustrativa" en `parts` y agregar un enlace a Financiación → Opciones avanzadas. |
| P2-2 | P2 | La disponibilidad 24/7 por defecto está escondida, y el aviso de relevos lleva a Personal. | Mostrar la disponibilidad junto a los días por mes (sin esconderla) y que el aviso tenga un botón "Cambiar disponibilidad" que enfoque el campo. |
| P2-3 | P2 | El aviso de fecha base lleva a "Contrato" en vez de al equipo. | Que `focus` apunte a `equipment.N.base.period`. |
| P2-4 | P2 | En precio cerrado se habla de "Costo del mes" y de "0,75 trabajos por mes". | En unidad `job`, rotular "Costo de este trabajo (con los fijos del mes que absorbe)" y expresar el equilibrio en días o con el texto "con 1 trabajo por mes ya cubrís costos". |
| P2-5 | P2 | "cuántos intervenciones" y el término "intervención" en fijo mensual. | Corregir la concordancia ("cuántas") y en fijo mensual usar "días de servicio". |
| P2-6 | P2 | El desgaste por km está repartido entre Equipos (neumáticos) y Movilización ($/km), con riesgo de contar neumáticos dos veces. | Bajo "Desgaste por km", mostrar "Ya incluye neumáticos de Equipos: $ X/km; cargá acá sólo mantenimiento". O mover todo el costo por km a la ficha del equipo. |
| P2-7 | P2 | La ficha de equipo no se adapta a un vehículo de ruta (horas y L/h). | Si la familia es de ruta (camión, pickup, tractor), mostrar "km por día", "L/100 km" y "mantenimiento por km" como datos principales, y dejar horas y L/h en Opciones avanzadas. |
| P2-8 | P2 | La sección de combustible pide precio y quién paga aunque todo el combustible lo pone el proveedor (Q4). | Si no hay ningún consumo propio, colapsar la sección con el texto "No usás combustible propio en esta cotización". |
| P2-9 | P2 | Hay que indicar un conductor hasta para remolques sin conductor. | Ocultar "¿Quién maneja?" cuando el equipo va arrastrado o transportado. |

---

## 6. Conclusión del especialista

- **Funciona bien:** el motor es correcto en todo lo que pude verificar. Destaca el modelo de viajes físicos derivados, los externos por km y la separación entre tenencia y uso. Q4 (fletero tercerizado en $/viaje) y Q2 (fijo mensual) dan precios de mercado.
- **Lo que falla desde logística:**
  - la ruta es un solo tramo, sin cargado/vacío ni tramos;
  - los km de un vehículo afectado y el tope de km mensual no se pueden expresar;
  - los viáticos son un monto global;
  - en un trabajo puntual de precio cerrado se cargan los fijos del mes completo, y el precio sale el doble del mercado sin aviso;
  - el remolque arrastrado no suma su desgaste por km;
  - una cotización en blanco no ofrece $/viaje ni $/km si no se toca el contrato.
