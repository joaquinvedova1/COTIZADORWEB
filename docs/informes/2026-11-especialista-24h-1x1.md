# Informe: prestador de cuadrillas 24 h, diagrama 1x1 rotativo y campamentado (RATEOS v0.8.1, build 401ae8b)

**Perfil del tester:** contratista de Vaca Muerta que presta cuadrillas de guardia 24 h en locación. Diagrama 14x14: 2 personas trabajan en sitio (turno día y turno noche, de 12 h cada uno) y otras 2 están de franco. Hacen falta 4 personas en nómina para tener 2 en sitio.
**Fecha:** 07/11/2026. **Entorno:** `dist/` con Supabase simulado. El repo no se modificó.
**Scripts:** `scratchpad/work-24h/` (`builder.mjs`, `build-c1..c4.mjs`, `variants-c1.mjs`, `variants-c2.mjs`, `pend.mjs`, `mobile-check.mjs`). **Estado:** `work-24h/state.json`.
**Capturas:** `(carpeta de trabajo de la sesión)/shots/24h/`.

---

## 0. Cómo interpreté el diagrama y los supuestos de mercado

**Diagrama 1x1 (14x14) campamentado**
- Cada persona hace 14 días en locación y 14 de franco.
- En locación hay 2 posiciones simultáneas, turno día (07–19) y turno noche (19–07), de 12 h cada una.
- Cada posición tiene 2 personas que se alternan: una en sitio y otra de franco. Dotación: 2 posiciones × 2 personas = **4 en nómina**.
- Hay **un relevo cada 14 días**: 30/14 ≈ 2,14 viajes de cambio de turno por mes, cada uno de ida y vuelta Neuquén ↔ locación (120 km por tramo).
- Horas extra: la jornada de 12 h tiene **4 HE por día trabajado**, pagadas al 50 %. Esa es la lectura que uso del esquema de 12 h del convenio petrolero (adenda 2017, diagrama 2x1 de hasta 12 h). Las 4 HE corren para cada posición en cada día del mes: 2 × 4 × 30 = 240 HE por mes, unas 60 por persona.
- Feriados trabajados: 7,5 h por persona por mes al 100 %. Sale de unos 15 feriados por año, de los cuales cada persona trabaja la mitad, a 12 h cada uno.

**Personal (perfil cargado en Recursos → Personal)**
- Operador de guardia (CCT 644/12): básico $ 4.300.000 y adicionales $ 1.600.000. Los adicionales incluyen el adicional Vaca Muerta de $ 380.000, zona, turno rotativo/nocturno y horas de viaje.
- Cargas: SAC 8,33 %, vacaciones 5 %, contribuciones 24 %, ART 7 %. Seguros $ 30.000, EPP $ 60.000 y capacitación $ 40.000 por mes. Costo por persona: **$ 8.889.276 por mes con cargas**.
- Referencias públicas:
  - Piso de Petroleros Privados ≈ $ 3.914.000 brutos desde abril de 2026: [Cronista](https://www.cronista.com/economia-politica/paritaria-record-el-gremio-que-acordo-un-salario-basico-de-3914000-y-un-bono-extra-para-abril/) y [NoticiasNQN 21/04/2026](https://www.noticiasnqn.com.ar/noticias/2026/04/21/331776-petroleros-cerraron-paritaria-con-8_6por_ciento-de-aumento-y-sueldo-minimo-supera-los-3_9-millones).
  - Paritaria 2026-27 con +16 % en 4 tramos hasta marzo de 2027, con impacto desde julio de 2026: [Diario Neuquino](https://diarioneuquino.com.ar/paritaria-petrolera-2026-2027-acordaron-un-aumento-del-16-y-el-salario-minimo-supera-los-41-millones-en-la-cuenca-neuquina/).
  - Adicional Vaca Muerta $ 380.000.
  - Por eso usé un básico de $ 4,3 M para noviembre de 2026: es el piso más unos 2 tramos.
  - lmneuquen.com no se pudo abrir: el dominio está fuera de la red permitida en esta sesión.

**Supervisor diurno:** básico $ 6.200.000 y adicionales $ 1.800.000. Costo: **$ 12.006.984 por persona por mes**.

**Campamento (alojamiento + 4 comidas):** $ 75.000 por persona por día en sitio. **No encontré una fuente pública** con tarifas de campamentos industriales; es un rango que estimé yo, de $ 60.000 a 90.000.

**Otros supuestos**
- Gasoil: $ 1.650/L sin IVA (supuesto).
- Camioneta 4x4: reposición $ 55 M, 5 años de vida útil, residual 30 %.
- Estructura: 12 % sobre el costo directo.
- Financiación: cobro a 60 días, tasa 2,5 % mensual.
- Contingencia: 3 %.
- Impuestos sobre la facturación: 4,2 % (IIBB 3 % + débitos y créditos 1,2 %).
- Margen objetivo: 15 %.

---

## 1. Cotizaciones hechas en la UI, hasta el Resultado

Recorrido en cada una: Nuevo cálculo → Empezar en blanco → 5 etapas → Resultado. El personal se agregó desde Recursos.

### C1: servicio 24 h fijo mensual, 2 en sitio + 2 de franco (COT-0001)

**Datos cargados**

| Paso | Valor |
|---|---|
| Contrato | Fijo mensual. Componentes: Personal, Vehículo, Viáticos |
| Cómo se cobra | 30 días por mes, 24 h por día, 30 días disponibles |
| Personal | Operador: **2 posiciones × 2 personas = 4** · HE 50 % 4 h por día activo · tramo HE 100 % "Feriados" 7,5 h por mes por persona |
| Equipos | Camioneta 4x4 propia en locación, 4 h de uso por día · "No requiere movilización" |
| Otros costos | Campamento: $ 150.000 por día activo (2 × 75.000), categoría Logística · Exámenes e inducciones: $ 180.000 fijo por mes (categoría Mano de obra) |
| Movilización | Camioneta de relevo, 120 km por vía, 12 L/100 km, $ 220/km de desgaste · **0,0714 viajes por intervención** · viáticos $ 2.143 por intervención (truco explicado en el hallazgo P1-2) |

**Resultado de la app** (`shots/24h/c1-9-resultado.png`)

| Indicador | Valor |
|---|---:|
| Costo del mes | **$ 70.247.873** |
| Tarifa piso | **$ 73.327.635 / mes** |
| Tarifa sugerida (15 %) | **$ 86.941.000 / mes** |
| Costo por día de servicio 24 h | $ 2.341.596 (sólo aparece en la EECC, como "Equivalente por día") |
| Piso por día 24 h | ≈ $ 2.444.000 |
| Sugerida por día 24 h | ≈ $ 2.898.000 |
| Por hora-hombre en sitio (720 h-h por mes) | sugerida ≈ $ 120.750 |

**Verificación a mano (coincide con el motor `computeQuote` al peso)**
- Factor de cargas = 1,1333 × 1,31 = 1,48462. Remunerativo cargado = 5.900.000 × 1,48462 = 8.759.276; más no remunerativo 130.000 = **8.889.276 por persona**.
- HE 100 % por mes: (4.300.000 / 176) × 2 × 1,48462 × 7,5 = 544.080 por persona.
- **Fijo de mano de obra = 4 × 9.433.356 = 37.733.425.** Incluye a los 4 en nómina y no sólo a los 2 en sitio. Más 180.000 de exámenes = 37.913.425, igual que la EECC.
- Variable = 2 posiciones × (4 h × 24.431,8 × 1,5 × 1,48462 = 217.632) = **435.264 por día**. Las HE sólo corren para los 2 en sitio, que es lo correcto.
- Mano de obra del mes = 37.913.425 + 435.264 × 30 = 50.971.345, que coincide con la app.
- Camioneta: posesión 1.108.333 + operación 4 h × (4.000 + 1.000 + 3 × 1.650) × 30 = 1.194.000.
- Relevo: 30 × 0,0714 × 240 km = 514 km por mes.
- Suma con estructura, financiación y contingencia: 70,25 M, igual que la app.

**¿Es razonable?** Sí, si la carga es la correcta.
- Costo por persona en nómina con cargas: ~$ 9,4 M por mes. Con un piso bruto de ~$ 3,9 a 4,3 M, más adicionales y 60 HE, es coherente con el sector.
- La mano de obra pesa 73 % del costo, lo típico en una guardia.
- El precio sugerido de ~$ 2,9 M por día de servicio 24 h (2 operarios + camioneta + campamento) está en un rango creíble para una operadora.
- **Pero** llegar a este número exigió saltear el aviso de la app y "trucar" los relevos (ver P1-1 y P1-2).

### C2: la misma cuadrilla cobrada por día de servicio 24 h, con mínimo de días (COT-0002)

**Datos cargados**
- Por servicio prestado, unidad $/día, 26 días facturados por mes.
- "Días de trabajo por llamado" = 14, que uso como intervalo de relevo: da 1,86 "llamados" por mes.
- Mismo personal (2 × 2) y misma camioneta.
- Campamento como **fijo mensual** ($ 4.500.000), porque la cuadrilla se queda en el campamento aunque el cliente no use el día.
- Relevo: 1 viaje por llamado y $ 30.000 de viáticos por llamado.

**Resultado de la app** (`shots/24h/c2-9-resultado.png`)

| Indicador | Valor |
|---|---:|
| Costo del mes (26 días) | **$ 67.900.424** |
| Tarifa piso | **$ 2.726.049 / día** |
| Tarifa sugerida | **$ 3.233.000 / día** |
| Días para no perder | 20,97 (la app dice "aprox. 21 días; colchón de 5") |

- La diferencia con C1 por día es razonable: la tarifa diaria tiene que cubrir los fijos de 4 personas con menos días facturados.
- **No pude cargar "mínimo 20 días por mes".** Ver P1-4.
- Probé el mínimo como $ 20 × 3.233.000 = $ 64.660.000 con la tarifa fijada:
  - Con 15 días: facturás 64,66 M contra un costo de 61,44 M, margen +0,77 %.
  - Con 20 días: margen −3,77 %.
  - En todos los casos la app sigue diciendo "**necesitás aprox. 21 días**". Ver P2-6.

### C3: 3 en sitio + 3 de franco, con supervisor diurno (COT-0003)

**Datos cargados**
- Operador: 3 posiciones × 2 personas.
- Supervisor diurno: 1 posición × 2 personas, en 14x14, con 4 HE por día.
- **8 en nómina.** Campamento: 4 en sitio × 75.000 = $ 300.000 por día.
- Traffic de relevo.

**Resultado de la app** (`shots/24h/c3-9-resultado.png`)

| Indicador | Valor |
|---|---:|
| Costo del mes | **$ 147.961.724** |
| Tarifa piso | **$ 154.448.564 / mes** |
| Tarifa sugerida | **$ 183.121.000 / mes** |
| Por día 24 h (costo / sugerida) | $ 4.932.057 / ≈ $ 6.104.000 |
| Mano de obra | $ 109,6 M: "8 personas en 4 posiciones" |

- Verificado: 6 × 9.433.356 = 56.600.138 y 2 × 12.006.984 = 24.013.968.
- **El aviso de horas también salta en el supervisor diurno.** Le pide 720 h por mes a un puesto que por definición es sólo de día. Ver P1-1.

### C4: guardia diurna de 12 h, 7x7, con 2 personas que se reemplazan, sin campamento, en modo **mobile** (COT-0004)

**Datos cargados**
- Fijo mensual, 30 días, **12 h por día**.
- 1 posición × 2 personas, vianda $ 18.000 por día.
- Camioneta "por sus propios medios" desde Añelo (25 km).
- 1 viaje por intervención: acá sí es cierto que el traslado es diario.

**Resultado de la app:** costo **$ 33.724.822**, piso **$ 35.203.364/mes** y sugerida **$ 41.739.000/mes**.
- Sin aviso de horas: 30 × 12 = 360 h, contra 2 × 176 + 120 = 472 h cargadas.
- Éste es el **único** caso donde los supuestos del modelo (1 intervención por día y la posición cubriendo todas las horas de la actividad) coinciden con la realidad.

**Mobile (390 px):** se pudo cargar todo y no hay scroll horizontal de página (`scrollWidth = 390`). Las tablas de Logística y Reglas comerciales (514 a 574 px) quedan con scroll contenido. Capturas `mobile-*.png` y `c4m-*.png`.

---

## 2. Lo que NO pude expresar (y cómo lo cobraría un proveedor real)

1. **Frecuencia de relevo en un fijo mensual.**
   - Con "Fijo mensual", el campo "¿Cada cuántos días hay una intervención?" (`activity.daysPerActivation`) sólo aparece si `serviceType === 'permanent'` (`js/ui/views/quote-steps/modality.js:462`).
   - Ninguna cotización nueva puede ser "permanent": `serviceTypeForContract` sólo devuelve lump_sum, configurable, equipment_only, on_call, equipment_with_operator o crew (`js/domain/contract.js:237-244`).
   - Resultado: **30 intervenciones por mes fijas**, y cada costo "por intervención" (viaje, peajes, viáticos) se multiplica por 30.
   - Lo real: 2,14 relevos por mes.
2. **Horas por día de cada puesto.** Hay un único dato de "horas por día" para toda la actividad (24 h). No se puede decir "este puesto es de 12 h" ni "el supervisor es diurno".
3. **Dotación en sitio vs en nómina como dato explícito.** Se modela como "posiciones × personas por posición". Funciona, pero en ningún lado se pregunta por el diagrama (7x7, 14x14, 2x1). El cálculo de "personas de franco" lo tiene que hacer el usuario.
4. **Costos por persona en sitio por día** (campamento, vianda de campamento). Sólo existe "Vianda por día activo" por posición. El campamento tuve que cargarlo como "otro costo" multiplicando a mano (2 × 75.000).
5. **Mínimo de días garantizados.** Sólo existe un "Mínimo mensual" en $. Un proveedor real escribe "mínimo 20 días/mes a la tarifa diaria".
6. **Viaje de relevo por persona o por cambio de turno** (por ejemplo, un pasaje en combi de $ X por persona por relevo). No hay una base "por relevo" ni "por persona".
7. **Días en sitio sin facturar** (la cuadrilla queda campamentada aunque el cliente no use el día).
   - Existe "Días en espera" (standby), pero está rotulado "**equipo** en espera".
   - El standby sólo costea la variable del personal: no el campamento ni el combustible de la camioneta de guardia.
8. **Hora nocturna o adicional nocturno** como concepto propio. Lo metí en "Adicionales" del sueldo. Los tramos de HE permiten "Otro recargo", pero no hay recargo nocturno por horas.

---

## 3. UX confusa o engañosa (pantalla / campo / captura)

- **Etapa 2 → Personal, aviso "Horas del personal"** (`c1-3-personal.png`, `c3-3-personal.png`).
  - Con el modelo correcto (2 × 2) dice "Faltan 233 h por posición: sumá personas por posición".
  - Si le hacés caso (1 posición × 4 personas), el aviso desaparece **y el costo baja $ 7,9 M por mes (−11 %)**, porque las HE y la vianda pasan a contarse para 1 sola persona en sitio en vez de 2.
  - El aviso empuja hacia el número equivocado.
- **Etapa 1 → Cómo se cobra (Fijo mensual)**, bloque "Opciones avanzadas": muestra "INTERVENCIONES POR MES 30" y no hay forma de cambiarlo (`c1-2-como-se-cobra.png`).
- **Movilización y viajes → "Viajes por intervención"**: para un relevo cada 14 días hay que escribir 0,0714. La app lo muestra como "17,1 km por intervención" (`c1-6-movilizacion.png`).
- **C2 (on call), terminología.** La cuadrilla está dedicada y es 24 h, pero todo dice "llamado", "DISPONIBILIDAD ON-CALL" y "1,86 llamados por mes".
  - En la ficha del listado figura "Por servicio (on call)".
  - "Días de trabajo por llamado" no es el concepto de relevo.
- **Personal → Opciones avanzadas**: las cargas aparecen como "ILUSTRATIVO" (SAC 8,33 %, contribuciones 24 %, 176 h) aunque las cargué yo en Recursos con fuente "Convenio / escala vigente".
  - Además, SAC 8,33 % es el valor legal.
  - La marca sale de comparar el valor con el default (`labor.js` → `illustrativeParam`).
- **Copy, Cómo se cobra:** "Cargá los días por mes para ver cuántos **intervenciones**…" (`modality.js:396`). El término es femenino y el texto no usa `T.feminine`.
- **Empezar en blanco:** el contrato arranca con "Equipo o maquinaria" marcado (se deriva de las marcas labor/equipment). Aparece el pendiente "El servicio usa equipos pero no hay equipos cargados" aunque yo no elegí maquinaria.
- **Resultado (fijo mensual):** no muestra el **costo o la tarifa por día de servicio 24 h** ni el **costo por persona en nómina**.
  - Son los números que pide una operadora para comparar.
  - Sólo están escondidos en la EECC ("Equivalente por día… $ 2.341.596").
- **"Mínimo mensual garantizado" en "Cómo se cobra" (C2)** pide $/mes, mientras la tarifa diaria todavía la está calculando la app. Es circular.

---

## 4. Errores de cálculo o bugs (con reproducción)

**B1. El aviso de cobertura de horas está mal planteado para turnos (P1). Evidencia: `variants-c1.mjs`.**
- Reproducción: Fijo mensual, 30 días × 24 h, personal con 2 posiciones × 2 personas y 4 HE por día.
- Esperado: sin aviso (cada posición de 12 h necesita 360 h y tiene 2 × 176 + 4 × 30 = 472).
- Obtenido: `labor_hours` exige 720 h por posición.

| Variante | Costo del mes | ¿Aviso? |
|---|---:|---|
| A. 2 posiciones × 2 personas (correcto) | 70.247.873 | sí |
| B. 1 posición × 4 personas (lo que sugiere el aviso) | **62.339.466** | no |
| C. 2 posiciones × 1 persona (sin franco) | 47.395.002 | sí |
| F. igual que A con "horas por día" = 12 | 70.247.873 | no |

- F silencia el aviso sin cambiar el costo, pero miente sobre el servicio (dice 12 h cuando es 24 h).

**B2. Los costos "por intervención" se multiplican por 30 en un fijo mensual (P1). Evidencia: variante E.**
- Reproducción: cargar el relevo como lo haría cualquier usuario: 1 viaje y $ 30.000 de viáticos por intervención.
- Resultado: costo **$ 74.648.261 (+$ 4,4 M por mes, +6 %)**. Logística pasa de $ 4,68 M a $ 6,98 M.
- Con `daysPerActivation = 14` el motor da el número correcto (variante G: 70.247.973), pero la UI no deja cargarlo.

**B3. "Días para no perder" ignora el mínimo garantizado (P2). Evidencia: `variants-c2.mjs`.**
- Con tarifa fija de $ 3.233.000 y mínimo de $ 64,66 M, el margen es −3,77 % con 20 días y +0,77 % con 15 días.
- La app igual dice "necesitás aprox. 21 días" en todos los niveles.
- La relación costo/días deja de ser monótona y el mensaje no lo explica.

**B4. Standby a $ 0 marca un pendiente (P2).** Variante D de C2: `standby` aparece como pendiente cuando se carga una tarifa de espera de $ 0. Para una cuadrilla en campamento sin facturar es un caso legítimo.

**B5. C4: camioneta "por sus propios medios" sin consumo en ruta (P2, a confirmar).**
- La movilización propia quedó en $ 0 por km. El único pendiente fue "Falta definir quién maneja".
- No hubo aviso por el consumo en ruta en 0.

No hubo errores de JavaScript en ninguna corrida (`app.errors = []`).

---

## 5. Hallazgos priorizados y propuesta de corrección

**P0:** ninguno. Con la carga correcta, los números del motor son exactos y el costo incluye a toda la dotación (los 4 de nómina, verificado a mano).

**P1-1. Aviso de horas y horas por puesto.**
- Problema: el aviso de horas asume que cada posición cubre todas las horas de la actividad, y empuja a un modelo que subcotiza 11 %.
- Propuesta:
  - Agregar "horas por día de este puesto" por línea de personal (vacío = las de la actividad).
  - Que el control use `D × horas del puesto`.
  - En el texto del aviso, mencionar también "sumá posiciones (turno día y noche)", no sólo personas.

**P1-2. Relevos en un fijo mensual.**
- Problema: no se puede cargar la frecuencia de relevo; las intervenciones quedan fijas en 30 por mes.
- Propuesta:
  - Mostrar "¿Cada cuántos días hay un relevo o intervención?" también con contrato fijo mensual, como un dato moldeable con nombre editable ("relevo", "cambio de turno"). Hoy depende de un `serviceType` inalcanzable.
  - Si no hay dato, avisar cuando haya costos por intervención con 30 intervenciones por mes.

**P1-3. Diagrama como asistente opcional.**
- Problema: no hay un dato explícito de dotación en sitio vs en nómina ni de diagrama.
- Propuesta: agregar en Personal un asistente opcional "Diagrama", no una lista cerrada:
  - Días en sitio / días de franco (7x7, 14x14, 2x1 o libre) y turnos por día.
  - Propone posiciones, personas por posición, relevos por mes y HE por día, todo editable. Así cumple el principio de no limitar a opciones fijas.
  - Mostrar en el Resultado "N en sitio · M en nómina".

**P1-4. Mínimo de días garantizados.**
- Problema: no existe un mínimo en días.
- Propuesta: agregar "Mínimo mensual" con unidad seleccionable ($ o unidades de la tarifa, por ejemplo días). Que se recalcule con la tarifa ofrecida o sugerida y que "Días para no perder" lo tenga en cuenta (también B3).

**P1-5. Costos por persona en sitio por día.**
- Problema: no hay costos de campamento por persona en sitio.
- Propuesta: agregar en "Otros costos" el comportamiento "por persona en sitio por día" y "por persona en nómina por mes", tomando las posiciones y la dotación del Personal. También "por relevo" y "por persona por relevo" para los pasajes.

**P2-1.** Contrato "por día" para un servicio dedicado: permitir elegir y renombrar el término ("día de servicio", "relevo") en vez de forzar "llamado" y "ON-CALL" cuando la unidad es el día y la disponibilidad es 24/7.

**P2-2.** Resultado de un fijo mensual: agregar los equivalentes **por día de servicio**, **por persona en nómina** y **por hora-hombre en sitio**, debajo de los 4 números o en "Ver más".

**P2-3.** Rótulo "ILUSTRATIVO": que dependa del origen del dato (perfil propio con fuente cargada), no de que el valor coincida con el default. SAC 8,33 % es legal.

**P2-4.** Standby: rotularlo "personal / equipo en espera". Permitir incluir otros costos diarios (campamento) y que la tarifa $ 0 no sea un pendiente.

**P2-5.** "Empezar en blanco" no debería premarcar "Equipo o maquinaria".

**P2-6.** "Días para no perder" con mínimo garantizado: explicar el tramo protegido o calcularlo con el mínimo (B3).

**P2-7.** Copy: "cuántos intervenciones" → concordar el género con `T.feminine`. "Viajes por intervención" con fracciones: mostrar también "≈ 2,14 viajes por mes".

**P2-8.** Equipo "por sus propios medios" sin consumo en ruta: avisar (B5).

---

## 6. Resumen de números

| Cotización | En sitio / nómina | Costo del mes | Tarifa piso | Sugerida (15 %) | Por día 24 h (sugerida) |
|---|---|---:|---:|---:|---:|
| C1 fijo mensual 1x1 | 2 / 4 | 70.247.873 | 73.327.635 /mes | 86.941.000 /mes | ≈ 2.898.000 |
| C2 por día (26 días facturados) | 2 / 4 | 67.900.424 | 2.726.049 /día | 3.233.000 /día | 3.233.000 |
| C3 3+3 + supervisor | 4 / 8 | 147.961.724 | 154.448.564 /mes | 183.121.000 /mes | ≈ 6.104.000 |
| C4 diurna 12 h 7x7 (mobile) | 1 / 2 | 33.724.822 | 35.203.364 /mes | 41.739.000 /mes | ≈ 1.391.000 (por día de 12 h) |
