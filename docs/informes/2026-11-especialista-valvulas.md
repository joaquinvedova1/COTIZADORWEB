# Informe: especialista en servicios de válvulas (O&G, Neuquén / Vaca Muerta)

**App probada:** RATEOS v0.8.1 (build 401ae8b), `dist/`, con el arnés Playwright y Supabase simulado. No se tocó la base real ni el repo.
**Fecha:** 07/11/2026. **Tester:** especialista en diagnóstico, calibración y reparación de válvulas (esclusas, globo, retención, PSV) en taller y en campo.
**Cómo probé:** recorrí la UI de verdad: Nuevo cálculo → Empezar en blanco → las 5 etapas → Resultado, en escritorio y en mobile (390 px). Cargué los recursos de dos formas: en línea dentro de la cotización (casos 1 y 2) y desde **Recursos → Personal / Equipos** (casos 3 y 4). Después verifiqué cada número con `computeQuote` sobre el estado guardado.
**Scripts y estados:** `(carpeta de trabajo de la sesión)/work-valvulas/` (`c1*.mjs` … `c4*.mjs`, `sens1-4.mjs`, `c1.json` … `c4.json`).
**Capturas:** `(carpeta de trabajo de la sesión)/shots/valvulas/`.

---

## 0. Referencias de mercado usadas

| Dato | Valor usado | Fuente / criterio |
|---|---|---|
| Salario petrolero (CCT 644 privados, Neuquén) | Técnico: básico $ 3.000.000 + adicionales $ 1.200.000 = $ 4,2 M brutos | El mínimo de convenio era $ 3.914.000 brutos por jornada de 8 h desde abril 2026 (+8,6 %): [noticiasnqn 21/04/2026](https://www.noticiasnqn.com.ar/noticias/2026/04/21/331776-petroleros-cerraron-paritaria-con-8_6por_ciento-de-aumento-y-sueldo-minimo-supera-los-3_9-millones), [LM Neuquén mayo 2026](https://www.lmneuquen.com/neuquen/petroleros-cerraron-un-incremento-cuanto-cobran-mayo-2026-y-cual-sera-el-sueldo-minimo-n1236243). Para julio 2026 a marzo 2027 se informó un +16 % en 4 tramos ([Diario Neuquino](https://diarioneuquino.com.ar/paritaria-petrolera-2026-2027-acordaron-un-aumento-del-16-y-el-salario-minimo-supera-los-41-millones-en-la-cuenca-neuquina/), una sola fuente). |
| Personal de taller (casos 2 a 4) | Oficial $ 2,6–2,7 M + adic.; ayudante $ 1,7–1,8 M + adic. | Supuesto: convenio de taller (no petrolero). **Si la cuadrilla está bajo CCT 644, el ayudante tiene que subir a ≥ $ 3,9 M y el precio sube alrededor de 15–20 %.** |
| Tipo de cambio | 1 USD = $ 1.450 | Supuesto razonable a nov-26. No lo verifiqué en la web. |
| Gasoil sin IVA | $ 1.550/L | Supuesto. La app trae $ 1.500 ILUSTRATIVO. |
| Banco portátil de diagnóstico / prueba | USD 45.000 · lapeadora in situ USD 35.000 · unidad de prueba hidráulica USD 14.000 · banco de calibración PSV de taller USD 70.000 | Rangos típicos de importación (equipos tipo Climax/EFCO/Hydratight o bancos de PSV). No encontré precios públicos argentinos. |
| Precio de mercado del servicio | Diagnóstico en campo: USD 120–300 por válvula. Calibración de PSV en taller (≤ 2–3"): USD 90–250 sin repuestos. Overhaul en parada: USD 400–1.500 por válvula según diámetro y clase | **No hay tarifas públicas.** La búsqueda (07/11/2026) sólo devolvió proveedores (p. ej. SERMIS SRL, Neuquén: calibración in situ y en taller habilitado) sin precios. Los rangos salen de experiencia del rubro y hay que tomarlos como orden de magnitud. |

---

## 1. Cotización 1 (OBLIGATORIA): diagnóstico de válvulas en campo, cobrado por válvula, 2 técnicos + 1 máquina

**Datos cargados (UI):**
- **Contrato:** "Por servicio prestado (on call)". Componentes: Personal, Vehículo, Equipo.
- **Cómo se cobra:** "Otra / personalizada" → unidad **"válvula"**. 120 válvulas por mes, **8 válvulas por día de trabajo**. 22 días disponibles, 10 h por día. Disponibilidad pasada a "franja horaria".
- **Personal:** 1 puesto "Técnico de válvulas (CCT 644)" × **2 posiciones**. Básico $ 3,0 M + adicionales $ 1,2 M. ART 8 %. 2 h extra por día al 50 %. Vianda $ 25.000. Seguros, EPP y capacitación $ 130.000 por mes.
- **Equipos:**
  - **Banco de pruebas portátil + kit de diagnóstico**, propio: USD 45.000, residual USD 4.500, 8 años, "No usa combustible". Seguro $ 1,3 M/año, certificaciones $ 1,5 M/año, mantenimiento $ 3.000 por hora, 7 h por día.
  - **Pickup 4x4**, propia: $ 62 M, residual $ 20 M, 5 años, 0 h de trabajo en locación.
- **Movilización:** Neuquén → Loma Campana, 120 km por vía, ida y vuelta, 1 viaje por "llamado" (1 día). La pickup va por sus propios medios (13 L/100 km, desgaste $ 140/km, la maneja el técnico). El banco va "Lo transporta otro equipo" = la pickup.
- **Materiales:** consumibles $ 18.000 por válvula × 8 = $ 144.000 **por día activo**. Es una conversión manual (ver hallazgo P1-1).
- **Otros costos:** inducciones y permisos $ 180.000 por mes. Estructura 12 %. Cobro a 60 días (facturo a 10 días). Contingencia 3 % + improductivos 5 %. Margen 15 %. Impuestos sobre la facturación 4,2 %. Standby: no aplica.

**Resultado de la app** (`c1-12-resultado.png`, mobile `c1-m01-resultado-mobile.png`):

| | Valor |
|---|---|
| Costo del mes | **$ 27.248.070** (120 válvulas, 15 días) |
| Tarifa piso | **$ 237.023 por válvula** (≈ USD 163) |
| Precio objetivo (15 %) | $ 281.024 por válvula · sugerida **$ 282.000** (≈ USD 195) |
| Equilibrio | 94,03 válvulas por mes (la UI muestra "94,1") |
| Reparto por válvula | Mano de obra $ 132.665 · equipos $ 18.487 · combustible $ 6.045 · materiales $ 18.000 · logística $ 4.200 · estructura $ 21.528 · financiero $ 9.323 · contingencia $ 16.820 · impuestos $ 11.844 · ganancia $ 43.089 |

**Verificación numérica, a mano contra el motor: cierra al peso.**
- **Personal:** factor de cargas (1 + 8,33 % + 4 %) × (1 + 24 % + 8 %) = 1,48276. Por persona: 4,2 M × 1,48276 + 130.000 = 6.357.575, × 2 = **12.715.150** ✓. Horas extra: 3,0 M / 176 × 1,5 × 2 h × 1,48276 = 75.823 por posición, × 2 + viandas 50.000 = **201.646 por día** ✓.
- **Banco:** (65,25 M − 6,525 M) / 96 = 611.719, + seguro 108.333 + certificaciones 125.000 = **845.052 por mes** ✓.
- **Traslado:** 240 km × 15 = 3.600 km. Combustible 3.600 × 0,13 × 1.550 = 725.400; desgaste 504.000 → **1.229.400** ✓.
- **Estructura:** 12 % sobre los directos ✓. **Contingencia:** 8 % sobre directos + estructura + financiero ✓. **Piso:** 27.248.070 / 0,958 / 120 = 237.022 ✓.

**¿El precio por válvula cubre técnicos + máquina + traslado?** Sí, y la composición es transparente en "Ver reparto de la tarifa". Las sensibilidades (`sens1.mjs`) se comportan bien:

| Escenario | Días | Costo | Piso por válvula | Sugerida por válvula |
|---|---:|---:|---:|---:|
| 120 válvulas, 8 por día (base) | 15 | 27,25 M | 237.022 | 282.000 |
| 60 válvulas, 8 por día | 7,5 | 22,98 M | 399.845 | 475.000 |
| 40 válvulas, 8 por día | 5 | 21,56 M | 562.668 | 668.000 |
| 12 válvulas, 8 por día | 1,5 | 19,57 M | 1.702.427 | 2.019.000 |
| 120 válvulas, **6 por día** (material sin tocar) | 20 | 30,09 M | 261.755 | **311.000** |
| 120 válvulas, 6 por día (material corregido a mano) | 20 | 29,18 M | 253.868 | **301.000** |
| 200 válvulas, 8 por día (25 días > 22 disponibles) | 25 | 35,49 M | 185.215 | 220.000 |

**¿Es razonable frente al mercado?** $ 282.000 por válvula (≈ USD 195) está **dentro del rango** de un diagnóstico en campo con banco portátil y dos técnicos petroleros. La mano de obra es el 47 % del precio, lo esperable. El punto débil es el modelo mensual: con volúmenes bajos (12–40 válvulas por mes) el precio por válvula explota ($ 0,7–2 M) porque carga **sueldos completos y la posesión de un mes entero**. Un proveedor real con poco volumen comparte la cuadrilla entre clientes o cotiza por jornada. La app lo permite ("Compartida, asignás un %"), pero no lo sugiere (P1-4).

---

## 2. Cotización 2: calibración y mantenimiento de PSV en taller, por válvula, con repuestos

**Datos:** on call, unidad propia **"PSV"**, 160 por mes, 10 por día, 22 días disponibles, 9 h por día.
- **Personal:** técnico calibrador ($ 2,6 M + $ 0,7 M) y ayudante ($ 1,7 M + $ 0,35 M).
- **Banco de calibración PSV:** USD 70.000, 10 años, sin combustible, seguro $ 1,2 M/año, certificaciones $ 2,5 M/año, otros $ 1,8 M/año, mantenimiento por **presupuesto** $ 250.000 por mes.
- **Camioneta de retiro y entrega:** **compartida al 40 %**.
- **Retiros:** para expresar "4 retiros por mes", puse **días por llamado = 4** (es un rodeo, ver P1-5), con 2 viajes por llamado y 110 km.
- **Materiales:** consumibles $ 25.000 por PSV → 10 por día. Repuestos: 30 % de las PSV × $ 150.000 → 3 por día, **facturados aparte con 25 % de recargo**.
- **Otros:** alquiler del taller $ 1,8 M (estructura), estructura 12 %, cobro a 60 días, contingencia 4 %, margen 18 %, impuestos 4,2 %.

**Resultado** (`c2-04-resultado.png`):

| | Valor |
|---|---|
| Costo del mes | $ 28.852.458 |
| Facturación | $ 37.160.000 = tarifa $ 24,16 M + **materiales facturados aparte $ 13,0 M** |
| Tarifa piso | **$ 106.984 por PSV** |
| Sugerida | **$ 151.000 por PSV** (≈ USD 104) |
| Margen | 18,16 % |

**¿Es razonable?** USD 104 por PSV, sin repuestos, está en la parte **baja** del rango de mercado (USD 90–250). **Pero el número está mal planteado por cómo funciona el tilde "Facturo los materiales aparte"** (hallazgo P1-2). El tilde es **global**: también factura aparte los **consumibles** ($ 4,0 M por mes), que en la práctica van incluidos en el precio de la calibración, y además descuenta del precio por PSV el **recargo de reventa de los repuestos**.

| Variante (`sens2.mjs`) | Piso por PSV | Sugerida por PSV |
|---|---:|---:|
| Base (todo facturado aparte) | 106.984 | 151.000 |
| Sin facturar materiales aparte | 188.234 | 232.000 |

Si el proveedor cobra $ 151.000 y factura aparte sólo los repuestos, factura 24,16 M + 9,0 M = 33,16 M. Neto de impuestos: 31,77 M, contra un costo de 28,85 M. **El margen real es 8,8 %, no 18 %.**

Otros puntos del caso:
- **Error de texto:** el plural de "PSV" sale **"PSVES"** en todas las pantallas (`c2-01-modalidad.png`, Resultado: "160 PSVES").
- **Modo "Sí, ya tengo la tarifa"**, probado en el motor con $ 261.000 por PSV (USD 180): equilibrio en 59,6 PSV, margen 43 %. Coherente.

---

## 3. Cotización 3: contrato fijo mensual de mantenimiento preventivo en planta, con adicionales por llamado fuera de horario

**Recursos cargados primero en Recursos** (`r-03-equipo-form.png`, `r-04-equipos-lista.png`): Oficial mecánico de válvulas, Ayudante mecánico, lapeadora in situ (USD 35.000, familia "Otro / Personalizado"), unidad de prueba hidráulica (USD 14.000, familia "Bomba") y pickup 4x4. Después los agregué a la cotización con "Agregar desde tus recursos" (`c3-02-personal-desde-recursos.png`). La cotización muestra el origen y la base ("De Recursos · copiado el…", "Base: nov-26").

**Datos:**
- **Contrato:** "Fijo mensual" ($/mes, abono). 20 días por mes, 9 h por día, 22 disponibles. 2 h extra por día por persona (el control de cobertura avisó que 20 × 9 = 180 h > 176 h: bien).
- **Equipos:** lapeadora 4 h por día ($ 4.000/h), unidad de prueba 3 h por día. Las dos van en la pickup, que viaja todos los días 105 km por vía.
- **Materiales:** $ 900.000 por mes. Estructura 12 %, cobro a 60 días, contingencia 3 %, margen 15 %, impuestos 4,2 %.
- **Adicional "Llamado fuera de horario":** 3 por mes, costo **cargado a mano** $ 551.000 por llamado (2 personas × 6 h al 100 % + viaje de 210 km + vianda, calculado afuera de la app).

**Resultado** (`c3-03-resultado.png`, `c3-04-adicionales.png`, mobile `c3-m01-adicionales-mobile.png`):

| | Valor |
|---|---|
| Costo del mes | $ 21.931.900 |
| Tarifa piso | **$ 20.403.597 por mes** |
| Abono sugerido | **$ 24.654.000 por mes** |
| Adicional sugerido | **$ 829.942 por llamado** (3 por mes = $ 2,49 M) |
| Margen | 15 % |

**¿Es razonable?** Un abono de alrededor de $ 24,7 M (≈ USD 17.000) por una cuadrilla de 2 con lapeadora y unidad de prueba, de lunes a viernes, es **razonable** para el mercado de Neuquén. El adicional (≈ USD 570 por llamado nocturno) también. **Pero la "tarifa piso" del abono ($ 20,40 M) es MENOR que el costo del mes ($ 21,93 M)** (hallazgo P1-3, `sens3.mjs`):

| Escenario | Costo | Piso del abono | Resultado |
|---|---:|---:|---:|
| Base, con 3 llamados | 21,93 M | 20,40 M | — |
| Sin adicionales | 19,92 M | **20,79 M** | — |
| Abono cobrado = piso mostrado (20,40 M) y **ningún llamado** en el mes | 19,92 M | — | **−$ 373.474 (−1,8 %)** |

El piso del abono descuenta la ganancia esperada de los adicionales. Por eso "Precio mínimo para no perder plata" no es cierto si no hay llamados.

---

## 4. Cotización 4 (opcional): parada de planta, 120 válvulas, precio cerrado

**Datos:**
- **Contrato:** "Precio cerrado", $ global por trabajo, **1 trabajo por mes de 12 días**, 12 h por día.
- **Personal:** 2 oficiales + 4 ayudantes desde Recursos, 4 h extra por día, "Contratada para este servicio".
- **Equipos:** 2 lapeadoras, 2 unidades de prueba y 2 pickups. **Hidrogrúa tercerizada** a $ 1,3 M por día, con operador, combustible y movilización incluidos, IVA 21 % recuperable.
- **Materiales y campamento:** juntas $ 45.000 × 120 **por llamado**. Campamento y viáticos $ 8,64 M por llamado (6 personas × 12 noches × $ 120.000).

**Resultado** (`c4-01-resultado.png`):

| | Valor |
|---|---|
| Costo del mes | $ 82,6 M |
| Piso | $ 86,24 M |
| Sugerida | **$ 102.251.000 por trabajo = $ 852.000 por válvula** (≈ USD 590) |
| Equilibrio | "**0,69 trabajos por mes**" |

**¿Es razonable?** USD 590 por válvula en una parada, con grúa y campamento, está **dentro de rango** (USD 400–1.500). Pero (`sens4.mjs`):
- Con el personal "Contratada para este servicio" la app carga **el sueldo de un mes completo** para un trabajo de 12 días.
- Compartida al 40 % (12 de 30 días) da **$ 80,5 M** (−21 %). Con equipos propios también al 40 %: **$ 77,0 M** (−25 %).

Para el mismo trabajo, la diferencia es de 25 % según una casilla escondida en "¿Trabaja sólo para este servicio?" (P1-4). Además, "0,69 trabajos por mes" y "Ganás $ 15,3 M **por mes**" no tienen sentido en un precio cerrado único (P2).

---

## 5. Lo que NO pude expresar (y cómo lo cobra un proveedor real)

1. **Materiales por unidad facturada (por válvula / por PSV).** Sólo existen "Por mes / Por día activo / Por llamado" (`materials-engine.js:34`). En el rubro, juntas, empaquetaduras, precintos, placas de calibración y repuestos se presupuestan **por válvula**. Hay que convertir a mano (× rendimiento) y la conversión **se rompe en silencio** cuando cambia el rendimiento.
2. **Facturar aparte sólo algunos materiales.** Un taller cobra los repuestos aparte, pero no los consumibles.
3. **Repuestos con probabilidad de uso** ("30 % de las PSV llevan resorte o disco"). Hoy sólo se puede cargando una cantidad promedio.
4. **Precio por tamaño o clase de válvula.** Un proveedor real cotiza una **lista de precios por diámetro y rating** (2" #150, 4" #300, 6" #600…), o un precio base por válvula más un adicional por tamaño. RATEOS admite una sola unidad facturable por cotización. Los "Adicionales" sirven de parche, pero tienen costo manual y no derivan días de trabajo.
5. **Adicional armado con recursos.** "Llamado fuera de horario" pide "Tu costo por unidad" como un solo número con una sola categoría. Un proveedor lo arma con personas × horas al 100 % + km + vianda, y quiere que se actualice cuando cambia la escala.
6. **Personal eventual o por días** para paradas y trabajos puntuales: jornal × días + SAC y vacaciones proporcionales + indemnización por fin de obra. Hoy sólo hay 100 % del mes o un % manual.
7. **Logística por lote independiente del rendimiento** (p. ej. 4 retiros por mes en un taller que factura por PSV). Sólo se logra deformando "días por llamado".
8. **Descuento por volumen de unidades** (p. ej. más de 100 válvulas: −5 %). Los tramos existen sólo por días, con $/día o $/hora.
9. **Costo por válvula dentro de un abono** (KPI secundario "tu abono equivale a $ X por válvula intervenida"). Es lo que pide el cliente para comparar.

---

## 6. UX confusa o engañosa (pantalla / campo exacto)

| # | Pantalla / campo | Qué pasa | Captura |
|---|---|---|---|
| U1 | Cómo se cobra → unidad propia "PSV" | El plural sale "PSVES". `pluralizeUnit`: "kit" → "kites", "END" → "ENDES", 'PSV 2"' → 'PSVES 2"es'. No hay campo para corregir el plural. | `c2-01-modalidad.png` |
| U2 | Cómo se cobra, on call con unidad propia | La campaña de diagnóstico habla de "8 válvulas **por llamado** · 15 **llamados** por mes", y la opción "**Cada llamado** se cuenta completo". Para una campaña es "jornada" o "salida". | `c1-03-modalidad-valvula.png` |
| U3 | Opciones avanzadas → Disponibilidad on-call | Por defecto "**24/7**, respuesta en 4 h" aun en un servicio por unidad. En Personal genera el aviso "Relevos: Cobertura 24/7 con una sola persona por posición". | `c1-05-puesto-blanco.png` |
| U4 | Resumen en vivo con costo 0 | Muestra "Tarifa piso **$ 0 / válvula**" en lugar de "—". | `c1-04-personal-vacio.png` |
| U5 | Equipos → "Falta el consumo de combustible" de la pickup | Una pickup que sólo traslada (0 h de trabajo) dispara un aviso por L/h trabajando. El consumo real se pide después, en ruta. | `c1-07-equipos.png` |
| U6 | Equipos → Fecha base y moneda = USD | La moneda sólo convierte reposición y residual. Seguro, certificaciones y mantenimiento quedan en ARS, y la pantalla no lo dice. | `c1-07-equipos.png` |
| U7 | Resultado → insignia "ILUSTRATIVO" | Aparece aunque todos los valores son propios. La dispara la tasa financiera de 3 % por defecto (`finance.illustrative`), y el tooltip queda vacío ("Incluye valores ILUSTRATIVOS: . Reemplazalos…") porque `illustrativeBadge` no contempla `finance`. Tampoco hay ítem de completitud que diga qué cambiar. | `c1-12-resultado.png` |
| U8 | Resultado → "BORRADOR — revisar 1 punto" | La única causa es "valores sin fecha base" (un aviso). Bloquear la palabra "borrador" por eso desalienta. | `c1-12-resultado.png` |
| U9 | Resultado, cantidad | "94,1 válvulas" y "0,69 trabajos por mes": unidades indivisibles con decimales. | `c4-01-resultado.png` |
| U10 | Resultado de precio cerrado | "Ganás $ X **por mes**" y "Total del contrato (12 meses)" en un trabajo único de 12 días. | `c4-01-resultado.png` |
| U11 | Fijo mensual → "Cargá los días por mes para ver cuántos intervenciones…" | Error de concordancia ("cuántas intervenciones"). | `c3-01-modalidad.png` |
| U12 | Margen y precio → Tramos por días | Con $/válvula se muestran 5 tramos "No aplica": ruido. | `c1-11-precio.png` |
| U13 | Movilización → "¿Qué equipo lo transporta?" | Lista cualquier equipo (una bomba puede "transportar" una lapeadora y viceversa). Sólo da un aviso naranja. | `c3-05-resultado-final.png` |
| U14 | Reparto de la tarifa con materiales facturados aparte | Muestra "Materiales $ 45.511 por PSV" como parte de una tarifa de $ 151.000 que ya **no** cubre materiales: mezcla las dos facturas. | `c2-04-resultado.png` |
| U15 | Recursos → Equipos → Familia | No hay familias del rubro: banco de pruebas, lapeadora o rectificadora in situ, unidad de prueba hidráulica, torquímetro hidráulico. Hay que usar "Otro". | `r-03-equipo-form.png` |
| U16 | Mobile, Cómo se cobra | En la captura de página completa, el "Resumen en vivo" fijo tapa la tarjeta "Sí, ya tengo la tarifa". Conviene verificarlo con scroll real. No hay scroll horizontal (scrollWidth = 390 en todas las pantallas probadas). | `c3-m01-adicionales-mobile.png` |

---

## 7. Errores de cálculo y bugs (reproducción y evidencia)

- **B1. El costo de materiales por válvula cambia solo cuando cambia el rendimiento (P1, error silencioso).**
  - Reproducir: cotización 1, cambiar "Válvulas por día de trabajo" de 8 a 6.
  - Los materiales siguen en $ 144.000 por día × 20 días = $ 2,88 M, es decir **$ 24.000 por válvula en lugar de $ 18.000** (+33 %).
  - La sugerida pasa a $ 311.000 en lugar de $ 301.000 (+3,3 %). Con 10 por día ocurre al revés: $ 14.400 por válvula (−20 %).
  - No hay aviso. Se ve en la UI (`c1-m02-modalidad-6xdia-mobile.png`: "Sugerida $ 311.000").
- **B2. La tarifa piso queda por debajo del costo porque descuenta la ganancia de "otros ingresos" (P1).**
  - Cotización 3: costo $ 21,93 M, piso $ 20,40 M.
  - Si el mes no tiene llamados, cobrar el piso da **−$ 373.474**.
  - Igual en la cotización 2: el recargo del 25 % sobre repuestos baja el piso por PSV.
  - Es coherente con §12.x y §13 de CALCULATION_RULES, pero contradice el rótulo "Precio mínimo para no perder plata".
- **B3. "Facturo los materiales aparte" es global (P1).** Cotización 2: los consumibles incluidos se facturan aparte y bajan la tarifa de $ 232.000 a $ 151.000 por PSV. Si en la realidad no se facturan, el margen real es **8,8 %, no 18 %**.
- **B4. Pluralización de unidades propias** (P2): PSV → PSVES, kit → kites, END → ENDES.
- **B5. Tooltip vacío de la insignia ILUSTRATIVO** cuando sólo es ilustrativa la financiación (P2). `quote-result.js:1409-1419`: `parts` queda vacío.
- **Errores de JS** (`pageerror`): ninguno en todas las corridas.

---

## 8. Hallazgos priorizados y correcciones propuestas

No encontré **P0**: todos los números verificados cierran al peso con las fórmulas documentadas y nada bloqueó cotizar.

### P1: no se puede expresar algo común, o induce a error

| ID | Hallazgo | Propuesta concreta (sin limitar tipos de servicio: todo moldeable) |
|---|---|---|
| P1-1 | Materiales sin base "por unidad facturada"; la conversión manual se rompe al cambiar el rendimiento (B1) | Agregar `basis: 'per_billable_unit'` ("Por válvula", con el nombre de la unidad de la cotización). En el motor: `variablePerActiveDay = monto × unidades por día` (o `× Q / D`). Con unidad "día", "mes" o "trabajo", ofrecer "por trabajo" y "por día" como hoy. Aplicarlo también a "Otros costos". Aviso migratorio: si una línea por día activo tiene "N por día" en la descripción y N ≠ rendimiento, sugerir convertirla. |
| P1-2 | "Facturo los materiales aparte" es un tilde global (B3) | Pasarlo a la línea de material ("¿Se factura aparte?" Sí / No + recargo de reventa propio). Mantener el tilde global como "aplicar a todos". En el Resultado, separar "Tarifa del servicio" de "Materiales facturados aparte (estimado)". |
| P1-3 | La tarifa piso descuenta la ganancia de adicionales y reventa (B2) | Mostrar **dos pisos**: "Piso sin contar adicionales ni reventa" (costo sin esos ítems / (1 − t)) y "Piso contando lo que esperás facturar aparte". Rotular el actual como "si se cumplen los adicionales estimados". Aviso si piso < costo del mes. |
| P1-4 | Trabajos puntuales (parada, campaña de pocas válvulas) cargan el sueldo y la posesión de un mes entero; la alternativa está escondida | En Personal, opción "**Eventual / por días del trabajo**": costo = días × jornal cargado + proporcional de SAC y vacaciones + fin de obra opcional. En equipos propios: "Imputar sólo los días usados" (% = D / días disponibles, explícito y visible). Con contrato "Precio cerrado" o cantidad baja, sugerirlo en un aviso informativo (nunca automático). |
| P1-5 | No hay logística por lote ni por período independiente del rendimiento (retiros semanales de válvulas al taller) | En Movilización, "¿Cada cuánto viajás?": por llamado (hoy) / **N viajes por mes** / por cada X unidades. Así "días por llamado" deja de usarse como rodeo. |
| P1-6 | Una sola unidad y un solo precio por cotización: no hay lista de precios por diámetro o clase | "Ítems de precio" dentro de la cotización: cada uno con unidad, cantidad por mes, rendimiento propio y consumos por unidad, sumando días de trabajo. O permitir que los adicionales deriven días de trabajo y consuman recursos. Mínimo: una tabla "precio por tamaño = base × coeficiente". |
| P1-7 | El costo del adicional se carga a mano y con una sola categoría | Armar el adicional con recursos de la cotización: personas × horas × recargo (del convenio del puesto) + km de la ruta + vianda, con la categoría de cada parte, y que se recalcule con la escala. Mantener "monto manual" como opción. |

### P2: confuso o mejora

| ID | Hallazgo | Propuesta |
|---|---|---|
| P2-1 | Plural de unidades propias (U1/B4) | No pluralizar siglas en mayúsculas ni palabras terminadas en consonante distinta de n, l, r, s, z, d. Agregar el campo opcional "Plural" junto a "¿Cómo se llama tu unidad?". |
| P2-2 | Término "llamado" en campañas por unidad (U2) | Con unidad cantidad o propia y contrato on call, permitir elegir el nombre: llamado / jornada / salida / campaña (es texto: no cambia la magnitud). |
| P2-3 | Disponibilidad 24/7 por defecto (U3) | Default "Franja horaria" salvo plantillas on call 24/7. No disparar el aviso de relevos si la unidad no es día u hora. |
| P2-4 | "Piso $ 0" con costo 0 (U4) | Mostrar "—" mientras el costo sea 0. |
| P2-5 | Aviso de combustible en un vehículo que sólo traslada (U5) | Con horas de uso en 0, no pedir L/h trabajando: pedir el consumo en ruta en Movilización. |
| P2-6 | Alcance de la moneda del equipo (U6) | Texto junto a "Moneda": "Convierte valor de reposición y residual; seguro, certificaciones y mantenimiento van en ARS" (o permitir moneda por campo). |
| P2-7 | Insignia ILUSTRATIVO por la tasa financiera y tooltip vacío (U7/B5) | Incluir `finance` en el tooltip ("tasa de financiamiento de ejemplo"), sumar un ítem de completitud con "Ir al campo" y quitar la marca al confirmar "Es mi tasa". |
| P2-8 | "BORRADOR" sólo por fechas base (U8) | Reservar "BORRADOR" para críticos. Las fechas base van como "aviso" sin cambiar el estado. |
| P2-9 | Unidades indivisibles con decimales (U9) | En unidades propias, trabajos y válvulas, mostrar el equilibrio redondeado hacia arriba ("95 válvulas"), con el decimal en "Ver cálculo". |
| P2-10 | Lenguaje mensual en precio cerrado (U10) | Con contrato cerrado y 1 trabajo, hablar de "este trabajo" (resultado, margen y total) y ocultar "Total del contrato (12 meses)" o preguntar cuántos trabajos al año. |
| P2-11 | Concordancia "cuántos intervenciones" (U11) | Usar el género de `activationTerms` (cuántas). |
| P2-12 | Tramos por días visibles con $/válvula (U12) | Colapsarlos con "No aplica a $/válvula" y ofrecer **tramos por cantidad** (ver P1-6 / §5.8). |
| P2-13 | Transportista sin filtro (U13) | Listar primero los equipos de ruta (camioneta, camión, carretón) y marcar con error el transporte circular. |
| P2-14 | Reparto mezcla materiales facturados aparte (U14) | Excluir del reparto por unidad lo que se factura aparte, o mostrarlo en una fila separada fuera de la tarifa. |
| P2-15 | Familias de equipo del rubro (U15) | Agregar al catálogo: banco de pruebas de válvulas, banco de calibración PSV, máquina de lapeado o rectificado in situ, unidad de prueba hidráulica, torquímetro hidráulico, equipo de emisión acústica. Siguen siendo editables. |
| P2-16 | Valor hora de horas extra sólo con el básico | Hacer configurable si los adicionales integran la base de horas extra (depende del CCT: en el petrolero varios adicionales sí la integran). |
| P2-17 | Desglose del precio por válvula por recurso | En "Reparto de la tarifa", permitir ver por recurso (técnicos / banco / pickup / traslado), no sólo por categoría EECC: "Equipos propios" hoy mezcla banco y pickup. |
| P2-18 | Resumen fijo en mobile (U16) | Verificar con scroll real que el panel fijo no tape la primera tarjeta, y en mobile colapsarlo por defecto. |

---

## 9. Conclusión del especialista

RATEOS calcula **bien y de forma auditable** (cada número cerró al peso): costos de personal con cargas, posesión y operación de equipos, traslado, estructura, financiero, contingencia y el gross-up de impuestos. El caso pedido por el dueño, diagnóstico **por válvula** con 2 técnicos + 1 máquina + traslado, **se puede cotizar** y el precio resultante (≈ USD 195 por válvula) es de mercado. El precio responde correctamente a la cantidad mensual y al rendimiento.

Lo que hoy induce a error en el rubro de válvulas son tres cosas:
- **Los consumos y repuestos son "por válvula"**, y la app obliga a pensarlos "por día".
- **"Tarifa piso"** puede quedar por debajo del costo cuando hay adicionales o reventa de materiales.
- **Los trabajos puntuales** (paradas, campañas cortas) cargan meses completos de sueldo y equipos salvo que el usuario descubra el % compartido.

Resolver P1-1 a P1-4 haría a la app confiable para talleres y contratistas de válvulas sin limitar ningún tipo de servicio.
