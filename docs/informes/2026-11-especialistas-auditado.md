# RATEOS: informe auditado de la prueba con 5 especialistas

Fecha: 07/11/2026 · Auditor independiente · Versión probada: v0.8.1, build `401ae8b` (`dist/`). También verificada contra `origin/main` `8e7c696`, que ya incluye el cambio de "llamados" (#44).
Scripts del auditor: `(carpeta de trabajo de la sesión)/work-auditor/`. Ahí están `all.mjs` (recalcula las 21 cotizaciones con las dos versiones), `v-contract.mjs`, `v-trailer.mjs`, `v-min.mjs`, `v-c4.mjs` y `v-empty.mjs`.

---

## 1. Resumen ejecutivo (para el dueño)

1. **Las cuentas están bien.** Recalculé las 21 cotizaciones de los cinco especialistas con el motor y dan exactamente lo mismo que la pantalla, en la versión probada y en la última de `main`. No se encontró ningún error de fórmula en sueldos, cargas, equipos, combustible, estructura, financiación, impuestos ni margen.
2. **Los precios sugeridos son de mercado** en casi todos los casos: diagnóstico de válvulas ≈ USD 195 por válvula, cuadrilla ≈ USD 57 por hora-hombre, guardia 24 h ≈ $ 2,9 M por día, flete y camioneta a disposición dentro de rango.
3. **La excepción son los trabajos puntuales a precio cerrado** (una movilización, una parada, una obra corta). La app carga el **mes completo** de sueldos y equipos en ese único trabajo y el precio sale hasta **2 veces el mercado**, sin avisar. No es un error de cuenta: es que nada le pregunta a quien cotiza si esa gente y esos equipos trabajan en otras obras el resto del mes.
4. **Un número falso visible:** en precio cerrado, "Total del contrato (12 meses)" multiplica la obra por 12. Por ejemplo, una obra de $ 202 M figura como $ 2.427 M. No cambia la tarifa, pero es el primer arreglo.
5. **Un costo que se pierde:** el desgaste por km (neumáticos) de un carretón o batea arrastrado no se suma. Es poco (≈ 0,6 % de esa cotización), pero es un dato que el usuario cargó y la app ignora sin decir nada.
6. **Las guardias 24 h y los diagramas (1x1, 2x1/14x7) se pueden cotizar, pero con "trucos":** viajes fraccionarios (0,07 viajes por día), personas fraccionarias (1,5 por posición) y avisos de horas que empujan al modelo equivocado. Falta que la app entienda "diagrama → personas en nómina → relevos".
7. **Válvulas:** faltan dos cosas del rubro: materiales "por válvula" (hoy se cargan "por día" y se desajustan solos si cambia el rendimiento) y elegir qué materiales se facturan aparte (hoy es todo o nada).
8. **La "tarifa piso" puede quedar debajo del costo** cuando hay adicionales. Está documentado y es intencional, pero el rótulo "precio mínimo para no perder plata" engaña si en el mes no hay adicionales.
9. **Propuesta:** una tanda **A** de 16 arreglos chicos y seguros que no cambian ningún número de las cotizaciones existentes salvo los que están mal. Después, una tanda **B** con los cambios de modelo: asistente de diagrama, materiales por unidad, mínimo en días, personal por jornal, rutas por tramos y viáticos por persona y noche.
10. Los cambios que tocan "llamados / días" del on call están marcados **"on call — coordinar"**, porque otro equipo trabaja en esa parte.

---

## 2. Cotizaciones de cada especialista

Montos sin IVA. "Costo" es el costo del mes (en precio cerrado, el del trabajo). "Piso" y "Sugerida" están en la unidad de cobro. Todo recalculado por el auditor con el motor: coincide al peso en `401ae8b` y en `main` `8e7c696`.

| Especialista | Caso | Unidad | Costo | Piso | Sugerida | Juicio vs mercado (auditor) |
|---|---|---|---:|---:|---:|---|
| Logística | Q1 Hidrogrúa on call Nqn→Añelo, chofer + rigger | $/h | 16.296.248 | 284.402 | 351.000 | **Alto.** Rango estimado $ 180–300 mil/h. El sobreprecio sale de cargar la grúa 100 % reservada para 10 días y de facturar sólo horas en locación (no portal a portal). Es un problema de datos y de modelo, no de cálculo |
| Logística | Q2 Camioneta 4x4 con chofer, fijo mensual | $/mes | 10.139.459 | 10.161.518 | 12.140.000 | Razonable (rango $ 9–13 M). El piso descuenta los km excedentes esperados |
| Logística | Q3 Movilización excavadora 30 t, Bahía Blanca→Añelo, precio cerrado | $/trabajo | 17.983.085 | 18.830.455 | 23.204.000 | **≈ 2x el mercado** ($ 9–14 M). Absorbe un mes de sueldos y tenencia. Con 5 trabajos por mes la sugerida da ≈ $ 10,3 M. Además faltan $ 89.600 de neumáticos del carretón |
| Logística | Q4 Flete de cañería con fletero tercerizado, $/viaje | $/viaje | 30.498.403 | 798.388 | 914.000 | Razonable (recargo ≈ 40 % sobre el fletero) |
| Válvulas | C1 **Diagnóstico por válvula, 2 técnicos + banco + pickup** (caso del dueño) | $/válvula | 27.248.070 | 237.022 | 282.000 | **Razonable**: ≈ USD 195 contra USD 120–300 (rango de experiencia, sin fuente pública). Con menos de 40 válvulas por mes el precio por válvula se dispara: es lo esperable si la cuadrilla está dedicada |
| Válvulas | C2 Calibración de PSV en taller | $/PSV | 28.852.458 | 106.984 | 151.000 | Parte baja del rango, **mal planteado**: el tilde global factura aparte también los consumibles |
| Válvulas | C3 Abono de mantenimiento preventivo + llamados fuera de horario | $/mes | 21.931.900 | 20.403.597 | 24.654.000 | Razonable. Piso menor que el costo (por diseño, ver H-09) |
| Válvulas | C4 Parada de planta, 120 válvulas, precio cerrado | $/trabajo | 82.618.670 | 86.240.783 | 102.251.000 | Dentro de rango (≈ USD 590 por válvula), pero carga sueldos de un mes completo en 12 días: −21/−25 % con asignación compartida |
| Cuadrillas | Q1 Cuadrilla 4+1 fijo mensual L–V | $/mes | 61.020.028 | 60.603.271 | 72.510.000 | Razonable (≈ USD 57 por hora-hombre). Vianda subcargada por el tester (≈ −$ 2 M) |
| Cuadrillas | Q2 Cuadrilla on call por hora, mínimo 8 h | $/h | 14.082.308 | 134.853 | 164.000 | Piso del rango. Sólo cierra con 40 % de asignación |
| Cuadrillas | Q3 Montaje de 300 m de cañería, precio cerrado, 18 días | $/trabajo | 53.138.635 | 55.642.550 | 68.566.000 | Razonable (≈ USD 158 por metro sin caño), con sueldos de mes completo |
| Cuadrillas | Q4 Cuadrilla 4+1 por hora-hombre | $/HH | 58.369.931 | 69.455 | 82.400 | Coherente con Q1 |
| 24 h 1x1 | C1 Guardia 24 h fijo mensual, 2 en sitio / 4 en nómina | $/mes | 70.247.873 | 73.327.634 | 86.941.000 | Razonable (≈ $ 2,9 M por día 24 h). Requirió viajes fraccionarios y saltear un aviso |
| 24 h 1x1 | C2 La misma, por día (26 días) | $/día | 67.900.424 | 2.726.049 | 3.233.000 | Razonable. El mínimo de 20 días no se puede expresar |
| 24 h 1x1 | C3 3+3 + supervisor diurno (8 en nómina) | $/mes | 147.961.724 | 154.448.564 | 183.121.000 | Razonable |
| 24 h 1x1 | C4 Guardia diurna 12 h 7x7 (mobile) | $/mes | 33.724.822 | 35.203.363 | 41.739.000 | Razonable. Camioneta sin consumo en ruta (dato faltante del tester, ver H-22) |
| 2x1 | C1 3 en sitio 14x7, fijo mensual (4,5 personas) | $/mes | 84.542.140 | 88.525.801 | 105.022.000 | Razonable, pero el proveedor real paga **5** personas (+6,2 %). La app aceptó 4,5 |
| 2x1 | C2 La misma, on call por día con mínimo | $/día | 91.626.424 | 5.330.217 | 6.324.000 | Economía correcta. Caro por día porque la nómina y el campamento son fijos |
| 2x1 | C3 Precio cerrado, 45 días | $/trabajo | 162.788.069 | 170.458.711 | 202.222.000 | Razonable. **Total del contrato mostrado: $ 2.426.664.000 (×12)** |
| 2x1 | C4 3 en nómina / 2 en sitio (mobile) | $/mes | 57.375.207 | 60.078.751 | 71.274.000 | Razonable |

---

## 3. Fuentes de mercado: cuán confiables son

| Dato | Lo que usaron | Fuerza de la fuente | Comentario del auditor |
|---|---|---|---|
| Básico CCT 644/12 petroleros | Mínimo $ 3.914.000 (abr-26) → $ 4,13 M con +16 % en 4 tramos | **Media-alta** para abr-26 (varios medios coinciden: NoticiasNQN, Cronista, LM Neuquén). **Media** para el +16 % (Diario Neuquino y LM; no verificado en el acta homologada) | Los básicos usados ($ 4,1–4,3 M) son coherentes. La negociación se reabre en nov-26 |
| Adicional Vaca Muerta | $ 380.000–402.800 | Media (prensa) | OK |
| Camioneros CCT 40/89 | Básico ≈ $ 1,1–1,35 M | **Baja-media** (sitios de cálculo; el propio tester dice que no coinciden) | En Vaca Muerta muchos choferes van por el 644 (bastante más caro): Q1 y Q3 podrían estar subcosteados en mano de obra |
| UOCRA Zona B | $ 5.517–7.548/h (jul-26) | Media (prensa) | OK. El Fondo de Cese (12 %/8 %) es correcto conceptualmente |
| Cargas patronales / ART | 24–26,4 % / 7–9 % | **Supuesto** (sitios comerciales) | Razonable. La ART real depende de cada empresa |
| Gasoil | $ 1.530 a 2.150/L sin IVA según el tester | **Baja e inconsistente** (40 % de diferencia entre testers) | Búsqueda del auditor: Diesel 500 YPF Neuquén a $ 2.183/L **con IVA** el 01/05/2026, con subas posteriores del ≈ 1 % ([NoticiasNQN 01/05/2026](https://www.noticiasnqn.com.ar/noticias/2026/05/01/333168-en-el-dia-del-trabajador-aumento-el-combustible-en-neuquen), [NoticiasNQN 14/05/2026](https://www.noticiasnqn.com.ar/amp/noticias/2026/05/14/335040-golpe-al-bolsillo-en-neuquen-ypf-volvio-a-subir-los-combustibles)). Sin IVA eso da ≈ $ 1.800 en mayo y probablemente $ 1.900–2.000 en noviembre (**estimación**). Los valores de $ 1.530–1.650 están ≈ 15–20 % bajos. Los $ 2.150 de logística salen de Infinia Diesel (premium) y están algo altos. En las cuadrillas el impacto es menor al 3 % del costo; en logística pesa más |
| Tipo de cambio | $ 1.450/USD | **Supuesto** (no verificado) | Sólo se usa para comparar con rangos en USD |
| Tarifas de mercado (hidrogrúa $/h, carretón, válvula, HH de cuadrilla, campamento $ 70–90 mil por persona y día) | Rangos | **Sin fuente pública: experiencia del tester** | Tomar como orden de magnitud. Los "juicios vs mercado" de la tabla 2 son tan fuertes como estos rangos |
| Diagrama 14x7 como forma usual de 2x1 | — | Media (Econojournal 2019, Ámbito 2017) | OK |

Conclusión: los costos de personal petrolero tienen buen sustento. El gasoil y todas las **tarifas de venta** son supuestos. Las conclusiones "dentro de mercado" son razonables, pero no son una prueba.

---

## 4. Hallazgos deduplicados, verificados y reclasificados

Estados: **CONFIRMADO**, **PARCIAL**, **NO REPRODUCE** y **ES DISEÑO** (comportamiento intencional documentado; puede seguir haciendo falta un cambio de rótulo o de modelo). Líneas de código según `origin/main` `8e7c696`. Quién lo reportó: Log = logística, Val = válvulas, Cua = cuadrillas, 24h, 2x1.

### P0 (los especialistas reportaron 4; ninguno queda en P0 tras la verificación)

| ID | Hallazgo | Reportó (sev. original) | Estado | Evidencia | Sev. auditada |
|---|---|---|---|---|---|
| H-01 | **"Total del contrato (12 meses)" en precio cerrado = precio × 12** | Cua (P0), 2x1 (P0), Val (P2) | **CONFIRMADO** | `price-composition-engine.js:137-144` multiplica por `ctx.contractMonths` sin mirar el modo. `quote-factory.js:222` pone `contractMonths: 12` por defecto. `v-contract.mjs`: 2x1 C3 da 2.426.664.000 contra 202.222.000; Cua Q3 822.792.000; Val C4 1.227.012.000; Log Q3 278.448.000 | **P1-alto.** No toca tarifa, costo ni KPIs, pero muestra un número falso en todas las cotizaciones de precio cerrado. Va en la tanda A |
| H-02 | Desgaste por km de un remolque "lo transporta otro equipo" se pierde | Log (P0) | **CONFIRMADO** | `mobilization-engine.js:84-91`: el modo `transported` no suma nada. Los neumáticos `set_km` del carretón (70 $/km) quedan sin usar. `v-trailer.mjs`: +$ 106.574 de costo (+0,6 %) si se lo pasa a "por sus propios medios" con 0 L. CALCULATION_RULES §5.1 lo define así a propósito, pensando en la carga, no en el remolque | **P1.** Se pierde un dato cargado, sin aviso; el monto es chico y hay rodeo |
| H-03 | Cotización "en blanco" sin `contract` guardado: faltan $/viaje, $/km, $/m³ y $/t, sobra $/mes y aparece "Equipo o maquinaria" marcado | Log (P0); Cua, 24h, 2x1 (P2, "en blanco no está en blanco") | **CONFIRMADO** | `v-empty.mjs`: `createEmptyQuote` (`quote-factory.js:202-260`) no crea `contract`. `contractOf` usa `fromLegacy` (`contract.js`), `modality.js:226` usa `unitChoicesFor(serviceType)` y `SERVICE_TYPE_UNITS.on_call = day,hour,call,month` (`billing-units.js:71`). `componentsFromFlags(true,true)` marca labor + machinery | **P1.** Bloquea al fletero en su primera cotización y confunde. Tanda A |
| H-04 | Aviso crítico "Unidad del proveedor" con un externo por trabajo y movilización incluida; el botón principal lleva a +$ 61 M | Cua (P0/P1) | **PARCIAL / ES DISEÑO** | La regla `external_unit_trips` (`completeness-engine.js:497-527`) es crítica a propósito (ECO-01, PLAN-2026-017) y se destraba con "Sí, cobra por trabajo". El defecto real es que el botón **primario** es "Por viaje completo" (`equipment.js:880`) y que el texto no contempla que los viajes sean de los vehículos propios | **P1.** Tanda A: botones neutros y texto. Bajar la regla a "aviso" en ese caso es decisión del dueño |

### P1

| ID | Hallazgo | Reportó | Estado | Evidencia | Sev. auditada |
|---|---|---|---|---|---|
| H-05 | **Trabajo puntual (precio cerrado o pocos días) carga el mes completo de sueldos, tenencia y estructura**; el precio llega a ≈ 2x el mercado | Log P1-1, Val P1-4, Cua H-05, 2x1 B3 | **ES DISEÑO** (fijos mensuales; `factorMeses` sólo prorratea si D > días disponibles, CALCULATION_RULES §1). La salida es "Compartida %", pero AGENTS §5.1 prohíbe inferir el % de los días | Log Q3: 18,8 M de piso con 1 trabajo contra 8,3 M con 5. Val C4: −21/−25 % con 40 % de asignación | **P1** (impacto comercial mayor). A: aviso informativo con el monto de fijos absorbidos, sin inferir nada. B: personal por jornal y duración de obra |
| H-06 | **Fijo mensual: 30 "intervenciones" por mes fijas.** El intervalo de relevo no se puede cargar y los costos por intervención se multiplican por 30 | 24h P1-2/B2, 2x1 #3/B5 | **CONFIRMADO** | El campo `activity.daysPerActivation` sólo aparece con `serviceType === 'permanent'` (`modality.js:482-489`), y `serviceTypeForContract` nunca devuelve `permanent` (`contract.js`). El motor ya lo soporta: 24h variante G da 70.247.973 | **P1.** Tanda A (mostrar el campo), coordinar porque es el mismo archivo que on call |
| H-07 | Aviso "Horas del personal" falso en turnos (2 posiciones de 12 h en una actividad de 24 h) | 24h P1-1/B1 | **PARCIAL** | `completeness-engine.js:226-235`: `required = D × H` por posición. Para la app, una "posición" cubre todas las horas de la actividad: el modelo 1 × 4 es coherente si se cargan 8 HE por día y 2 viandas. El tester bajó el costo 11 % por no ajustarlas. Igual, la app no deja decir "este puesto es de 12 h" | **P1** (induce a error). A: horas por día del puesto, que sólo usa el aviso |
| H-08 | Aviso "Horas del personal" falso cuando el trabajo dura más de un mes (D = 45) | 2x1 B2 | **CONFIRMADO** | El mismo bloque compara 45 días de demanda contra un mes de horas normales, sin `monthsFactor` (`cost-engine.js:722`) | **P2.** Tanda A |
| H-09 | **Tarifa piso menor que el costo** cuando hay adicionales, reventa o horas extra facturadas | Val P1-3/B2, Cua H-10, Log U11 | **ES DISEÑO** (CALCULATION_RULES §12, §13: "otros ingresos bajan la tarifa piso") | Val C3: costo 21,93 M y piso 20,40 M; sin llamados, cobrar el piso pierde $ 373 mil | **P1 de rótulo.** A: mostrar también el "piso sin adicionales" |
| H-10 | "Facturo los materiales aparte" es global | Val P1-2/B3 | **CONFIRMADO** | `economics-engine.js:68-77` (`pricing.materialsBilledSeparately`) aplica a todas las líneas | **P1.** Tanda A: flag opcional por línea |
| H-11 | Materiales sólo por mes, por día o por llamado: no hay "por unidad facturada" (por válvula) | Val P1-1/B1 | **ES DISEÑO / CONFIRMADO** | `materials-engine.js:34`. Pasar de 8 a 6 válvulas por día sube el material por válvula +33 %, en silencio | **P1.** Tanda B (B-2) |
| H-12 | Diagrama de rotación inexistente; personas fraccionarias sin aviso (4,5 contra 5 reales) | 24h P1-3, 2x1 #2/B4/#14 | **CONFIRMADO** (no hay aviso de dotación fraccionaria) | 2x1 C1: −6,2 % de sugerida contra 5 personas | **P1.** A: aviso informativo. B: asistente de diagrama |
| H-13 | Mínimo garantizado sólo en $ (circular con "calculá la tarifa"); no se puede pedir "mínimo 20 días" | 24h P1-4, 2x1 #8 | **CONFIRMADO** | `commercial-rules-engine.js:87,216` | **P1. B, on call: coordinar** |
| H-14 | Campamento y viáticos por persona-día en sitio o por relevo; viáticos por persona × noche | 24h P1-5, 2x1 #4, Log P1-6, Cua exp-7 | **CONFIRMADO** (ausencia) | — | **P1. B** |
| H-15 | Rutas con tramos (cargado/vacío), km por mes de un vehículo afectado, km incluidos por mes, horas portal a portal | Log P1-2..P1-5 | **CONFIRMADO** (ausencia) | — | **P1. B** (las horas portal a portal son on call: coordinar) |
| H-16 | Precio cerrado limitado a $ global o $/hito; no hay ítems ($/m, $/junta) ni lista por diámetro | Cua exp-5, Val P1-6 | **ES DISEÑO** (`CONTRACT_UNITS.closed = ['job','milestone']`) y contradice el principio "todo moldeable" | — | **P1. B** |
| H-17 | Adicional (HE, llamado fuera de horario) con costo a mano y sin 50/100 % | Cua exp-1, Val P1-7 | **CONFIRMADO** (ausencia) | — | **P2. B** |
| H-18 | Fijo mensual: "con este abono no perdés plata aun trabajando los 30 días", sin contar las horas extra de días fuera de jornada | Cua H-08 | **CONFIRMADO** (texto) | `quote-result.js:956, 992` | **P2.** Tanda A (texto) |

### P2 / P3 (UX, textos, bugs menores)

| ID | Hallazgo | Reportó | Estado | Evidencia | Sev. |
|---|---|---|---|---|---|
| H-19 | Tooltip vacío "Incluye valores ILUSTRATIVOS: . Reemplazalos…" | Log, Val, Cua | **CONFIRMADO** | `quote-result.js:1413-1417` omite `info.finance` (`quote-factory.js:556`). La insignia en sí es legítima: los testers dejaron la tasa demo del 3 % | P2 · A |
| H-20 | Marca ILUSTRATIVO en cargas reales que coinciden con el valor demo (SAC 8,33 %, 176 h, 50 %) | Cua, 24h, 2x1 | **CONFIRMADO** | `labor.js:120`: `line[key] === ILLUSTRATIVE_AGREEMENT_PARAMS[key]`; lo mismo en `product-editor.js:771` | P2 · A |
| H-21 | Plural de unidades propias: PSV→PSVES, kit→kites, END→ENDES | Val | **CONFIRMADO** | `billing-units.js:97-106` (`v-empty.mjs`) | P2 · A |
| H-22 | Equipo "por sus propios medios" sin consumo en ruta: el aviso sólo aparece en el paso, no en la completitud ni en el Resultado | 24h B5 | **PARCIAL** | El motor emite `travel_consumption` (`mobilization-engine.js:82`) y `logistics.js:37` lo muestra, pero `completeness-engine.js:421-433` no lo toma (`v-c4.mjs`) | P2 · A |
| H-23 | El aviso de fecha base lleva a "Contrato" y no al campo | Log U6, Cua H-09, 2x1 #16, Val U8 | **CONFIRMADO** | `completeness-engine.js:604`: paso `'service'` y sin `focus`, aunque las entradas traen `path` (`economic-base-engine.js:49-88`) | P2 · A |
| H-24 | Lenguaje mensual en precio cerrado ("Costo del mes", "Ganás … por mes", "0,5 trabajos por mes") | Log U3/P2-4, Val U10, Cua H-02, 2x1 #6 | **CONFIRMADO** | `quote-result.js:1316, 1480, 1575-1576, 1119` | P2 · A (rótulos) |
| H-25 | Concordancia: "cuántos intervenciones", "Valor no definida", "Costos no definida" | Todos | **CONFIRMADO** | `modality.js:396, 487`; `economic-base-ui.js:24, 35` | P3 · A |
| H-26 | Disponibilidad 24/7 por defecto y escondida: aviso de relevos en servicios diurnos | Log, Val, Cua | **CONFIRMADO** | `quote-factory.js:224`; `completeness-engine.js:208` | P2 · A, **on call: coordinar** |
| H-27 | El tramo de descuento se elige con días inflados por el mínimo por llamado | Cua H-03 | **ES DISEÑO** | Ya existe la opción `rules.volumeTierBasis = 'worked'` (`commercial-rules-engine.js:90-97`, commit 04ab4e6). El tester no la encontró | P3 · **on call: coordinar** (hacerla más visible) |
| H-28 | Equilibrio "unas 59 horas" (trabajadas, no facturadas) | Cua H-04 | **CONFIRMADO** | `quote-result.js:1675` usa `be.days × hoursPerDay` | P3 · **on call: coordinar** |
| H-29 | "Días para no perder" con mínimo garantizado: hay una ventana de pérdida no informada | 24h B3 | **CONFIRMADO** | `v-min.mjs`, con tarifa fija y mínimo 64,66 M: con 10 días gana +3,4 M, con 20 días pierde −2,4 M, y siempre dice "21 días" | P2 · B, **on call: coordinar** |
| H-30 | Precio de un trabajo cerrado sensible a "días disponibles" (30 o 31) | 2x1 B3 | **ES DISEÑO** (`factorMeses = D / disponibles`) | — | P3 · B |
| H-31 | Horas extra sólo sobre el básico | Val P2-16, 2x1 #5 | **ES DISEÑO** (CALCULATION_RULES §3) | 2x1: +9 % si se incluyen los adicionales | P2 · B (opción con default actual) |
| H-32 | $/hora-hombre: las HH no se derivan de la dotación; 10 h ocultas generan avisos falsos | Cua H-07 | **PARCIAL** (las horas por día se pueden editar en Opciones avanzadas) | — | P2 · B |
| H-33 | Precio cerrado de varios días con 1 viaje por trabajo, sin pista | Cua H-06 | **CONFIRMADO** (falta de aviso) | Q3: −$ 2,38 M (4,5 %) | P2 · A (aviso informativo) |
| H-34 | Standby $ 0 marca pendiente; rótulo "equipo en espera" | 24h B4, Cua UX-4 | **ES DISEÑO** (se resuelve con "no aplica") | `completeness-engine.js:716-720` | P3 · **on call: coordinar** |
| H-35 | El indicador de logística no incluye "otros costos" de categoría Logística | 2x1 #13 | **ES DISEÑO** (CALCULATION_RULES: "movilización y viajes") | `quote-engine.js:372` | P3 · rótulo |
| H-36 | Reparto de la tarifa mezcla materiales facturados aparte | Val U14 | **CONFIRMADO** (consecuencia de H-10) | — | P2 · con A-8 |
| H-37 | Otros de UX (piso $ 0 con costo 0, tramos visibles en $/mes, mobile largo, familias de equipos del rubro, perfil duplicado, ficha de vehículo por horas) | Varios | No verificados en detalle (UX) | — | P3 · B o backlog |

**No reproduce:** ninguno de los hallazgos de cálculo. Tampoco se reprodujo ningún error de fórmula.

**Nota de entorno:** a mitad de la sesión, el checkout local `/home/user/COTIZADORWEB` quedó en `d6540b7` (rama `claude/project-thread-teq3th`), más viejo que lo probado. Para verificar, el auditor extrajo `401ae8b` y `origin/main` con `git archive` en `work-auditor/src-401` y `src-main`, sin tocar el repo. **Antes de implementar, partir de `origin/main` (`8e7c696`).**

---

## 5. Plan de correcciones

Reglas para las dos tandas:
- Ningún número de las cotizaciones existentes cambia, salvo el total del contrato de H-01, que hoy está mal.
- Todo lo nuevo es una **opción con default** que reproduce el comportamiento actual.
- Golden cases y `npm test` en verde. Cada arreglo lleva su test.
- Sigue valiendo AGENTS §5.1: nunca se infiere el % compartido.

### Tanda A: implementar en esta ronda (bajo riesgo, alto valor)

| # | Hallazgo | Archivo:línea (`main`) | Corrección concreta | ¿Cambia números? |
|---|---|---|---|---|
| A-1 | H-01 total del contrato ×12 | `js/engines/price-composition-engine.js:137-144`; `js/ui/views/quote-result.js:1941-1955` | Si `r.contract.mode === 'closed'` (ya viene en el resultado, `quote-engine.js:719`): `contract.months = null` y se muestra "Total del trabajo" = facturación del trabajo. Si se quiere más de un trabajo, campo opcional `quote.contractJobs` (default 1): total = facturación por trabajo × trabajos. No usar `contractMonths` en ese modo. Test con 2x1 C3 → 202.222.000 | Sólo el total del contrato (estaba mal) |
| A-2 | H-03 cotización en blanco | `js/domain/quote-factory.js:202-224` | Crear `contract: { mode: 'on_demand', components: ['labor'], labor: true, equipment: false }` (no marca "maquinaria"; al sumar Vehículo o Equipo aparecen $/viaje, $/km…). Las cotizaciones ya guardadas sin `contract` siguen por legacy. Test e2e: blank → marcar Vehículo → la lista incluye `trip` y `km`. *Default a confirmar con el dueño: `['labor']` (recomendado) o ninguno* | No (sólo cotizaciones nuevas) |
| A-3 | H-02 remolque arrastrado | `js/engines/mobilization-engine.js:84-91`; `js/engines/completeness-engine.js:421-433`; doc §5.1 | Opción por línea `mobilization.towed` ("va enganchado y rueda" / "va cargado arriba", default "arriba" = hoy). Con `towed`: `km = km de ruta × cantidad`; `wear = km × (travelCostPerKm + tiresOf(line).perKm)`; sin combustible ni conductor. Aviso de completitud si una línea `transported` tiene neumáticos por km cargados y no está marcada `towed`. Golden nuevo: carretón + tractor (+89.600 por trabajo) | No (opción nueva) |
| A-4 | H-04 botón sesgado | `js/ui/views/quote-steps/equipment.js:880-881`; mensaje en `completeness-engine.js:521-522` | Las dos acciones con el mismo peso visual (ninguna `primary`). Agregar al texto: "Si los viajes son de tus vehículos y el proveedor va una sola vez, confirmá «cobra por trabajo»". La criticidad no cambia (ECO-01); bajarla cuando hay movilización incluida queda para que decida el dueño | No |
| A-5 | H-07, H-08 avisos de horas | `js/engines/completeness-engine.js:226-235` | (a) `covered = (ppp × normal + perMonth × ppp) × monthsFactor(D, disponibles) + perDay × D`. (b) Campo opcional por línea `coverageHoursPerDay` ("Horas por día que cubre este puesto", vacío = H de la actividad), que **sólo** usa el aviso. (c) El mensaje agrega "o sumá posiciones (turno día / turno noche)" | No (sólo avisos) |
| A-6 | H-06 relevos en fijo mensual | `js/ui/views/quote-steps/modality.js:482-489` | Mostrar `activity.daysPerActivation` también si `monthlyContract`, rotulado "¿Cada cuántos días hay un viaje o relevo a la locación?" (default 1 = hoy). Aviso informativo si fijo mensual, D ≥ 20, intervalo = 1 y hay costos por intervención. **On call: coordinar** (mismo archivo) | No (default 1) |
| A-7 | H-09 piso con adicionales | `js/ui/views/quote-result.js` (KPI de tarifa piso) y traza `floorRate` | Si `otherRevenue > 0`, mostrar debajo: "Sin contar adicionales ni reventa: $ X" con `X = costo / (1 − t) / unidades facturables`, y la nota "El piso supone que facturás $ Y de adicionales por mes". El piso actual no cambia | No |
| A-8 | H-10, H-36 facturar aparte por línea | `js/engines/economics-engine.js:68-77`; `js/engines/materials-engine.js:24-48`; paso de Materiales | `line.billedSeparately`: `true`/`false`/sin definir (= sigue el tilde global, como hoy). `materialsResaleOf` suma sólo las líneas que se facturan aparte. En el reparto, fila separada "materiales facturados aparte" | No (sin definir = hoy) |
| A-9 | H-19 tooltip vacío | `js/ui/views/quote-result.js:1414-1417` | `if (info.finance) parts.push('tasa de financiamiento de ejemplo')`, más un enlace "Ir a Financiación" | No |
| A-10 | H-20 ILUSTRATIVO por valor | `js/ui/views/quote-steps/labor.js:118-121`; `js/ui/views/product-editor.js:771` | Comparar por valor sólo si la línea **no** viene de un convenio o perfil propio (no ilustrativo). Si tiene origen, marcar sólo por flag | No |
| A-11 | H-21 plurales | `js/domain/billing-units.js:97-106` | Sigla en mayúsculas de ≤ 4 letras → sin cambio (PSV, END). Terminación en consonante distinta de l, n, r, d, z, j, s, x → "+s" (kit→kits). Mantener los tests de `tests/engines/billing-units.test.js:107-111` y sumar casos | No |
| A-12 | H-18, H-24, H-25 textos | `quote-result.js:956, 992` (abono "aun trabajando…" → agregar "sin contar horas extra ni días fuera de tu jornada" si hay personal); `quote-result.js:1316, 1480, 1575-1576, 1119` (en `closed`: "Costo del trabajo", "Ganás $ X por trabajo", equilibrio en días o "con 1 trabajo ya cubrís"); `modality.js:396, 487` → `T.g('cuántas','cuántos')`; `economic-base-ui.js:24, 35` → "${prefix}: sin fecha base" | No |
| A-13 | H-23 fecha base | `js/engines/completeness-engine.js:604-607` | Paso según el `path` de la primera entrada sin base (labor / equipment / materials / fuel → su paso) y `item.focus = `${path}.period``. En Equipos, botón "Misma fecha que el valor" para `costsBase` (lo elige la persona; no se inventa) | No |
| A-14 | H-22 consumo en ruta | `js/engines/completeness-engine.js:421-433` | Incluir las líneas con `travel_consumption` en el aviso `mobility` ("Falta el consumo en ruta de …: el combustible del traslado queda en 0") | No |
| A-15 | H-05, H-12, H-33 avisos informativos | `js/engines/completeness-engine.js` (regla nueva, estado `info`, no baja el score) | (a) Precio cerrado o D < días disponibles con líneas dedicadas o contratadas 100 %: "Este precio absorbe $ X de costos fijos del mes (sueldos y tenencia). Si esta gente o estos equipos trabajan en otras obras, asignales un % compartido." Nunca se aplica solo. (b) Posiciones × personas por posición no entero: "Cargaste N,5 personas; ¿cuántas hay en nómina?". (c) Precio cerrado con días por trabajo > 1 y 1 viaje: "¿La cuadrilla vuelve a la base cada día?" | No |
| A-16 | H-26 24/7 por defecto | `js/domain/quote-factory.js:224`; `js/engines/completeness-engine.js:208` | Para cotizaciones nuevas, disponibilidad sin definir, visible junto a los días; el aviso de relevos sólo si la persona eligió 24/7. **On call: coordinar** | No |

Orden sugerido: A-1, A-2, A-3, A-9, A-11, A-12 (rápidos). Después A-5, A-8, A-7, A-13, A-14, A-15 y A-4. Por último A-6 y A-16, en coordinación con el equipo de on call.

### Tanda B: próxima ronda (cambios de modelo, con plan en `.agent/PLANS.md`)

- **B-1. Diagrama de rotación → dotación** (H-12, H-07, H-06, H-14).
  - Asistente opcional por puesto, con campos libres:
    - días en sitio y días de franco (14/14, 14/7, 7/7, 20/10…);
    - turnos por día y horas por turno;
    - personas por relevo.
  - Propone, todo editable:
    - posiciones = turnos simultáneos;
    - nómina = posiciones ÷ fracción en sitio, redondeada hacia arriba, con el decimal visible;
    - relevos por mes = 30 ÷ (días en sitio ÷ grupos);
    - HE por día en sitio;
    - "personas en sitio por día", como base para el campamento.
  - Muestra "N en sitio · M en nómina" en el Resultado.
  - Agrega un driver "Relevos" propio: personas, medio de traslado, km, peajes y horas de viaje.
  - El usuario siempre puede sobrescribir lo propuesto.
- **B-2. Materiales y otros costos "por unidad facturada"** (H-11).
  - Base nueva `per_billable_unit`: `variablePerActiveDay = monto × unidades por día` (o `× Q / D`).
  - Se rotula con el nombre de la unidad ("por válvula").
  - Probabilidad de uso opcional (por ejemplo, 30 % de las PSV llevan repuesto).
  - Aplica también a Otros costos.
- **B-3. Mínimo garantizado en unidades** (H-13, H-29). **On call: coordinar.**
  - `rules.minimumGuarantee = { amount, unit: '$' | 'units' }`; en unidades = unidades × tarifa ofrecida o sugerida.
  - El equilibrio informa la ventana de pérdida ("perdés entre X e Y días").
- **B-4. Personal eventual y duración de obra** (H-05, H-30).
  - "Forma de pago" del puesto: mensual / por día / por hora, con SAC y vacaciones proporcionales y fin de obra opcional.
  - En precio cerrado: "1 trabajo de N días" en lugar de "trabajos por mes".
  - Total del trabajo = precio (completa A-1).
  - El prorrateo de fijos lo elige quien cotiza (días del trabajo ÷ 30 o mes completo); default = hoy.
- **B-5. Logística avanzada** (H-15).
  - Lista de tramos (desde, hasta, km, cargado o vacío, consumo distinto).
  - Km por día o por mes de un vehículo afectado.
  - Km incluidos por mes con excedente, con el costo por km propuesto desde el vehículo.
  - Horas facturables portal a portal con velocidad media (**on call: coordinar**).
  - Vehículo auxiliar = una línea de Equipos (sin duplicar).
  - Ficha de vehículo de ruta en km.
- **B-6. Viáticos y campamento por persona × noche o día en sitio** (H-14), con la dotación del Personal como default.
- **B-7. Adicionales armados con recursos** (H-17): HE del puesto al 50 % o 100 %, por hora-hombre o por hora-cuadrilla, y llamado = personas × horas + km + vianda.
- **B-8. Precio cerrado con cualquier unidad e ítems de precio** (H-16):
  - una planilla de ítems (cantidad × precio unitario, rendimiento propio);
  - lista por diámetro y clase;
  - tramos de descuento por cantidad.
- **B-9. Base de la hora extra configurable** (H-31): sólo básico (default actual) o básico + adicionales remunerativos.
- **B-10. $/hora-hombre derivada de la dotación** (H-32), con control de HH imposibles.
- **B-11. Visibilidad de opciones on call existentes** (H-27, H-28, H-34). **On call: coordinar.**
- **B-12. UX menor** (H-35, H-37): rótulos, familias de equipos del rubro, mobile y perfil duplicado.
