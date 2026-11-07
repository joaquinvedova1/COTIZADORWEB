# Informe: especialista en cuadrillas (Neuquén / Vaca Muerta) — prueba de RATEOS v0.8.1

Fecha de prueba: 07/11/2026 · Build: `v0.8.1 · build 401ae8b` (dist) · Arnés con Supabase simulado (no tocó la base real).
Scripts: `(carpeta de trabajo de la sesión)/work-cuadrillas/` (estado persistido en `state.json`, verificación con el motor en `verify.mjs` y experimentos en `exp.mjs`).
Capturas: `(carpeta de trabajo de la sesión)/shots/cuadrillas/` (en este informe se citan sólo por nombre de archivo).

Recorrido real por la UI: Recursos → Personal (alta de 4 perfiles), "Nuevo cálculo" → "Empezar en blanco" → las 5 etapas → Resultado y "Profundizá". Hice 4 cotizaciones completas y verifiqué cada número con `computeQuote` sobre la cotización guardada: **todos los números de la pantalla coinciden con el motor**, y los recalculé a mano en los puntos clave (cargas, camioneta, combustible, externos y adicionales). Probé en modo mobile (390 px): no hay scroll horizontal de página (las tablas se desplazan dentro de su contenedor).

---

## 0. Referencias de mercado (con fecha) y supuestos

| Dato | Valor usado / referencia | Fuente |
|---|---|---|
| Básico CCT 644/12 (petroleros privados), jornada de 8 h | Mínimo $ 3.914.000 (abr-2026); el tramo 2026-27 suma +16 % y lleva el mínimo a $ 4.130.864. **Usé un básico de $ 4.300.000 + $ 900.000 de adicionales (zona, adicional Vaca Muerta de $ 380.000 y presentismo)** | [LM Neuquén, may-2026](https://www.lmneuquen.com/neuquen/petroleros-cerraron-un-incremento-cuanto-cobran-mayo-2026-y-cual-sera-el-sueldo-minimo-n1236243); [Diario Neuquino, paritaria 2026-27](https://diarioneuquino.com.ar/paritaria-petrolera-2026-2027-acordaron-un-aumento-del-16-y-el-salario-minimo-supera-los-41-millones-en-la-cuenca-neuquina/) (fuente única, sin homologación confirmada) |
| Vianda CCT petrolero | **$ 35.849 por jornada** (yo cargué $ 18.000: el costo de Q1 está subestimado en unos $ 1,96 M/mes; es un error de mis datos, no de la app) | misma nota de Diario Neuquino |
| UOCRA Zona B (Neuquén) | Ayudante $ 5.517/h y oficial especializado $ 7.548/h (jul-2026). **Usé un básico mensual de $ 1.000.000 / $ 1.400.000 (≈176 h) + 25 % de adicionales** | [LM Neuquén, jul-2026](https://www.lmneuquen.com/pais/escala-salarial-uocra-julio-2026-cuanto-cobra-sueldo-cada-categoria-el-nuevo-aumento-y-bono-n1244967) |
| Contribuciones patronales | 18 % (PyME, con certificado) o 20,4 % según el caso, + 6 % de obra social → **24 %**. Para UOCRA usé **36 %** (24 % + 12 % del Fondo de Cese Laboral) | [hacecuentas, 2026](https://hacecuentas.com/calculadora-aportes-patronales-empleado-registrado-cargas-sociales-2026); [yo-facturo, 2026](https://yo-facturo.com/blog/cargas-sociales-en-argentina-2026/) (sitios comerciales: hay que verificarlo en ARCA) |
| ART | No hay una alícuota pública por actividad. Supuse **8 %** para yacimiento y **9 %** para construcción (el rango típico de esas actividades es alto) | supuesto |
| Gasoil | Supuse **$ 1.600/L sin IVA** (sin fuente web confirmada) | supuesto |
| Camioneta 4x4 doble cabina | Reposición $ 80 M, residual 30 %, 5 años; seguro $ 3,6 M, patente $ 2 M y otros (VTV, GPS, habilitación) $ 1,2 M por año; 13 L/100 km; desgaste $ 110/km | supuesto |
| Tarifa de mercado por hora-hombre de cuadrilla | **No encontré una fuente pública.** Rango de referencia según mi experiencia: **USD 40 a 70 por hora-hombre** (cuadrilla con supervisión, EPP y vehículo; sin materiales). Para convertir supuse **$ 1.450 por USD** | sin fuente: es un supuesto |

---

## 1. Cotizaciones realizadas

En todas usé: estructura 12 % sobre el costo directo, cobro a 60 días (tasa del 3 % mensual que trae la app), impuestos sobre la facturación del 4,5 % (Ingresos Brutos + impuesto al cheque) y montos sin IVA.

### Q1 — Cuadrilla de 4 operarios + 1 supervisor, fijo mensual, lunes a viernes 8 h, con camioneta y horas extra como adicional

- **Datos:** "Fijo mensual", $/mes (abono), 22 días × 8 h, 30 días disponibles (el valor por defecto). Personal de Recursos: 4 operarios CCT 644/12 (costo cargado $ 7.849.059 por persona: factor de cargas × 1,4854) y 1 supervisor ($ 11.275.470). Camioneta propia "por sus propios medios", 100 km por vía, 22 viajes de ida y vuelta por mes. Herramientas y consumibles $ 450.000/mes. Contingencia 3 %, margen 15 %. Adicional "Hora fuera de horario": 40 horas-hombre por mes a un costo de $ 54.437 por hora (calculado **a mano**: valor hora $ 24.432 × 1,5 × 1,4854).
- **Resultado** (q1-16-resultado.png): **costo $ 61.020.028/mes · tarifa piso $ 60.603.271/mes · tarifa sugerida $ 72.510.000/mes · margen 15 %**. Precio sugerido del adicional: $ 82.301 por hora.
- **Costo por hora-hombre:** 880 HH por mes → costo $ 69.341/HH (sin los adicionales, $ 66.329/HH); abono sugerido = **$ 82.398/HH ≈ USD 57**.
- **Contra el mercado:** razonable, en la mitad alta del rango. El personal es el 77 % del costo, lo esperable en una cuadrilla. Con la vianda real del convenio (35.849) el costo sube unos $ 2 M.
- **Verificación:** camioneta = (80 M − 24 M)/60 + 6,8 M/12 = $ 1.500.000/mes ✓. Combustible = 26 L × 1.600 = $ 41.600 por día ✓. Desgaste = 200 km × 110 = $ 22.000 por día ✓. Perfil del operario = 5,2 M × 1,48540 + 125.000 = $ 7.849.059 ✓.

### Q2 — Cuadrilla on call por hora (3 operarios + camioneta), con mínimo por llamado (**on call**)

- **Datos:** "Por servicio prestado", $/hora, 12 días (llamados) por mes de 6 h, mínimo por llamado de 8 h, cargo por llamado de $ 150.000. El personal y la camioneta están "compartidos" al 40 % (72 h trabajadas de 176). Ruta de 120 km. Contingencia 3 %, margen 15 %.
- **Resultado** (q2-04-resultado.png): **costo $ 14.082.308/mes · tarifa piso $ 134.853 por hora de cuadrilla · sugerida $ 164.000/h · margen 15,23 %**. Facturación: 96 horas (12 × 8 de mínimo) + 12 cargos por llamado.
- **Costo por hora-hombre:** sugerida/3 = **$ 54.667 por HH facturada (≈ USD 38)**. El costo por HH trabajada es $ 65.196 (216 HH).
- **Contra el mercado:** está en el piso del rango y sólo cierra gracias al 40 % de asignación. Si la cuadrilla queda dedicada al 100 % (que es lo habitual en una guardia on call), el costo y la tarifa suben unas 2,5 veces. La app lo modela bien, pero la decisión queda escondida en un desplegable del puesto.

### Q3 — Precio cerrado: montaje de 300 m de cañería de 4" (cuadrilla de 6 durante 18 días)

- **Datos:** "Precio cerrado", $ global por trabajo, 1 trabajo por mes de 18 días, 22 días disponibles, 9 h por día. Personal "contratado para este servicio": 2 oficiales cañistas/soldadores UOCRA, 3 ayudantes UOCRA y 1 supervisor. Equipos: 2 motosoldadoras alquiladas a $ 85.000 por día (2 L/h que pago yo), hidrogrúa tercerizada con operador "por trabajo" a $ 3.600.000 (3 días) y 2 camionetas propias. Materiales "por trabajo": electrodos 30 kg × 9.000, discos y gas $ 650.000, EPP de soldadura $ 350.000. Otros costos "por trabajo": END (radiografías) $ 480.000 y obrador con baño químico $ 1.500.000. Contingencia 8 %, margen 18 %.
- **Resultado** (q3-08-resultado.png, después de confirmar la unidad del proveedor): **costo $ 53.138.635 · tarifa piso $ 55.642.551 por trabajo · sugerida $ 68.566.000 por trabajo · margen 18 %**.
- **Costo por hora-hombre:** 972 HH → costo $ 54.669/HH y precio $ 70.541/HH. **Precio por metro: $ 228.553/m ≈ USD 158/m** (sin caño). Es razonable para el montaje de cañería soldada con radiografías en locación.
- **Verificación:** externos = 2 × 85.000 × 18 + 3.600.000 + 480.000 + 1.500.000 = $ 8.640.000 ✓. Combustible = 18 × 440 km × 0,13 × 1.600 + 2 L × 9 h × 2 × 18 × 1.600 = $ 2.684.160 ✓.

### Q4 (opcional) — La misma cuadrilla 4+1 cobrada por hora-hombre ($/HH)

- **Datos:** on call, unidad "$/hora-hombre", 880 HH por mes y 40 HH por día de trabajo (los ingresé a mano), con los mismos recursos que Q1 pero sin el adicional.
- **Resultado** (q4-01-resultado-hh.png): **costo $ 58.369.931 · piso $ 69.455/HH · sugerida $ 82.400/HH**. Es coherente con Q1 ($ 82.398/HH) ✓. Pero aparecen avisos falsos (ver H-07).

---

## 2. Lo que NO se pudo expresar (y cómo lo cobra un proveedor real)

1. **Sueldo por jornal u hora (UOCRA).** El perfil sólo acepta un "Sueldo básico mensual". La UOCRA liquida por hora: hay que multiplicar a mano el valor hora por 176. Tampoco existe "personal eventual pagado por día trabajado": en Q3 la cuadrilla contratada por 18 días cobra el mes completo (ver H-05).
2. **Fondo de Cese Laboral (UOCRA, 12 % el primer año y 8 % después)**, horas de viaje (in itinere), adicional por zona en % y desarraigo. No hay campos. Se meten a mano dentro de "Cargas patronales %" o "Adicionales $", y nada queda rotulado en el desglose.
3. **Hora extra ligada al puesto.** El adicional "Hora fuera de horario" pide "Tu costo por unidad" a mano. No toma el valor hora × recargo × cargas del puesto, no dice si la "hora" es de una persona o de toda la cuadrilla, y no distingue la HE al 50 % de la HE al 100 %. Un proveedor real cobra la HE por hora-hombre, a un precio distinto para el 50 % y el 100 % (sábado después de las 13 h, domingos y feriados).
4. **Días trabajados fuera del convenio (sábados).** En un fijo mensual de lunes a viernes, un día 23 a 26 cuesta HE al 50 % o al 100 %. La app sólo suma vianda y combustible (ver H-08).
5. **Precio cerrado con precio unitario por ítem (cómputo métrico: $/m de cañería, $/junta, $/locación).** Con "Precio cerrado" la unidad sólo puede ser "$ global" o "$/hito". La unidad $/metro existe, pero solamente en "Por servicio prestado". Esto va contra el principio del dueño de no limitar los tipos de servicio a opciones fijas.
6. **Un equipo que se usa algunos días de la obra** (hidrogrúa 3 de 18 días). La unidad "por día" de un externo toma todos los días del trabajo. Hay que inventar un monto "por trabajo", que después dispara un aviso crítico falso (H-01).
7. **Viáticos y alojamiento por persona y por noche** (cuadrilla alojada en Añelo): sólo se puede cargar "viáticos por intervención", con la cuenta personas × noches hecha a mano.
8. **Horas-hombre derivadas de la dotación.** Con "$/hora-hombre", las HH por día se escriben a mano y no se controlan contra personas × horas (H-07).

---

## 3. UX confusa o engañosa (pantalla, campo y captura)

- **Resultado → insignia "ILUSTRATIVO" con el tooltip vacío:** "Incluye valores ILUSTRATIVOS: . Reemplazalos…". La causa es la tasa financiera del 3 % que trae la app (`quoteIllustrative().finance = true`), pero `illustrativeBadge()` en `js/ui/views/quote-result.js` no la nombra (q1-18-badge-ilustrativo.png).
- **Personal → línea → "Cargas aplicadas … ILUSTRATIVO"** aparece sobre porcentajes que cargué yo, en un perfil que no marqué como ilustrativo. `illustrativeParam` en `js/ui/views/quote-steps/labor.js` lo marca si un valor coincide con el de ejemplo: SAC 8,33 %, 176 h y recargo 50 % son valores estándar y reales (q1-06-personal-4mas1.png).
- **Cómo se cobra (fijo mensual):** el texto dice "Cargá los días por mes para ver cuántos intervenciones…" (concordancia: debería ser "cuántas"). También aparece la casilla "Cada intervención se cuenta completa", que no tiene sentido en un abono (q1-02-como-se-cobra.png).
- **Equipos → línea propia:** "Valor no definida" y "Costos no definida" (concordancia de género) (q1-08-equipo-propio.png).
- **Una cotización "en blanco" no arranca en blanco:** viene marcada la plantilla "Equipo con operador" y la casilla "Equipo o maquinaria" (02-etapa1.png).
- **Fijo mensual:** se ven "Descuentos por cantidad de días: 5 tramos" y "equipo en espera sin definir", que no aplican a un abono (q1-14-margin.png).
- **Personal:** se puede agregar dos veces el mismo perfil (me pasó con el supervisor) y no hay aviso. Además, "Costo del puesto $ X por mes" no incluye las viandas, mientras que "Personal en el costo del mes" sí: son dos totales distintos con nombres parecidos.
- **On call:** la disponibilidad viene en "24/7" por defecto, escondida en Opciones avanzadas. Eso dispara el aviso de relevos ("Cobertura 24/7 con una sola persona por posición") en una cuadrilla diurna.
- **Resultado de un fijo mensual:** la tarifa piso ($ 60,6 M) queda **por debajo** del "Costo del mes" ($ 61,0 M) porque los adicionales se cuentan como ingreso con su margen. Es correcto según el §12.x del documento de reglas, pero pide una nota en pantalla (ver H-10).

---

## 4. Errores de cálculo y bugs (cómo reproducirlos y evidencia)

**H-01 · Aviso crítico falso "Unidad del proveedor" en precio cerrado.** Pasos: Q3, cargar un externo con unidad "Por trabajo" y movilización incluida, y en Movilización y viajes poner "viajes por trabajo" = 18 (la cuadrilla va y vuelve todos los días). Resultado: "RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA… cada trabajo tiene 18 viajes… Equivale a $ 200.000 por viaje". El botón principal que propone es "Por viaje completo (ida y vuelta)". Si se lo acepta, la grúa pasa a costar 18 × 3,6 M = $ 64,8 M en lugar de $ 3,6 M (**+$ 61,2 M, más que todo el trabajo**). La regla `external_unit_trips` (`js/engines/completeness-engine.js`, cerca de la línea 498) supone que los viajes de la ruta son del externo, aunque su movilización esté incluida y los viajes sean de las camionetas propias. Capturas: q3-08-resultado.png y q3-10-banner-unidad-proveedor.png. Se destraba con "Sí, cobra por trabajo".

**H-02 · El total del contrato de un precio cerrado multiplica la obra por 12.** En Q3 → Profundizá → "Total del contrato (12 meses)" figura una facturación de **$ 822.792.000** para un trabajo único de $ 68.566.000 (q3-09-resultado-profundiza.png). Pasa porque `contractMonths` = 12 por defecto también en "Precio cerrado". El resultado también dice "Ganás $ 12.341.895 por mes" y "necesitás facturar 0,74 trabajos por mes".

**H-03 · On call: el tramo de descuento por días se elige con días inflados por el mínimo.** Experimento E1 en `exp.mjs`, sobre Q2: tramos 8–15 días = 5 % y 16–30 días = 10 %. Con 12 días trabajados y un mínimo de 8 h sobre 6 h trabajadas, `billableDays` da 16 → se aplica el **tramo 16–30 (10 %)**. Sin el mínimo se aplica el tramo 8–15 (5 %). El cliente recibe el descuento de 16 días cuando se trabajaron 12. Así está definido en el §12 del documento de reglas ("días facturables = unidades / horas por día"), pero el efecto económico no es el que se espera.

**H-04 · On call: el texto del equilibrio mezcla horas trabajadas con horas facturadas.** Resultado de Q2: "necesitás aproximadamente 9,8 días activos por mes (unas 59 horas)". Las 59 h son trabajadas (9,8 × 6), pero la tarifa se cobra por hora facturada: en el equilibrio se facturan 9,84 × 8 = **78,7 h** (`breakEvenQuantity` = 78,72).

**H-05 · Precio cerrado corto: los sueldos y la camioneta se cobran como un mes completo.** Experimento E4 sobre Q3. Con 10 días por trabajo el costo da $ 48,4 M y la tarifa piso $ 50,7 M. Con 18 días, $ 53,1 M y $ 55,6 M. La mano de obra "contratada para este servicio" carga el mes completo ($ 23,6 M fijos) aunque la obra dure 10 días. En una cuadrilla UOCRA que cobra por hora, eso **sobrecostea** la mano de obra de un trabajo de 10 días en cerca del 55 %. Con más de 22 días se prorratea (`factorMeses`). Como no hay unidad de costo por día trabajado, este caso no se puede corregir sin trucos (por ejemplo, asignar el % de días/22).

**H-06 · Precio cerrado: queda "1 viaje por trabajo" en una obra de varios días y nadie avisa.** Q3 con el valor por defecto: movilización de $ 139.920 por trabajo (440 km). Con el viaje diario real (18 viajes) sube a **$ 2.518.560**, una diferencia de $ 2,38 M que equivale al 4,5 % del costo (q3-07-logistica-1viaje.png). No hay ninguna pista de que en una obra de varios días hay que poner viajes = días.

**H-07 · $/hora-hombre: las HH no se controlan contra la dotación y las horas por día ocultas siguen en 10 h.** Q4: con 40 HH por día (5 personas × 8 h), la opción oculta "Horas trabajadas por día" sigue en 10 h. Resultado: el aviso falso "22 días × 10 h = 220 h… faltan 44 h por posición". En sentido inverso (E5), con 60 HH por día y 5 personas, algo físicamente imposible, no hay aviso: los días bajan a 14,7, el costo baja a $ 56,99 M y la tarifa piso a $ 67.818/HH.

**H-08 · Fijo mensual: "con este abono no perdés plata aun trabajando los 30 días" es engañoso.** Experimento E2 sobre Q1: pasar de 22 a 30 días sólo suma $ 1,5 M (vianda y combustible). Los 8 sábados y domingos extra de una cuadrilla de lunes a viernes cuestan unas 64 h de HE al 50–100 % por persona (≈ $ 15–20 M). La app avisa `labor_hours`, pero el texto grande del resultado afirma lo contrario.

**H-09 · Estado "Revisar" que el usuario no puede resolver.** El aviso "3 valores no tienen fecha base (Camioneta — valor, Camioneta — costos, Combustible)" sigue en todas las cotizaciones. La fecha base de un equipo propio cargado en blanco está escondida en "Fecha base y moneda" y la del combustible en otra sección, lejos de donde se cargó el dato. Es leve.

**H-10 · La tarifa piso queda por debajo del costo con adicionales.** E3 sobre Q1: sin el adicional, costo $ 58,37 M y piso $ 61,12 M; con el adicional, costo $ 61,02 M y **piso $ 60,60 M**. La tarifa piso del abono da por cobradas las 40 HE con su margen. Si en un mes no hay HE, el abono "piso" sí pierde plata. La fórmula es coherente con el §12.x, pero la etiqueta "Precio mínimo para no perder plata" lo oculta.

---

## 5. Hallazgos priorizados y correcciones propuestas

| # | Sev. | Hallazgo | Corrección propuesta |
|---|---|---|---|
| H-02 | **P0** | Precio cerrado: el "Total del contrato (12 meses)" multiplica la obra por 12 ($ 822,8 M contra $ 68,6 M). | Con `contract.mode = closed`, que el total sea = trabajos × tarifa (o la suma de hitos) y que `contractMonths` no se use o quede "según duración". Cambiar "por mes" por "por trabajo" en "Ganás…" y en el equilibrio. |
| H-01 | **P0/P1** | Aviso crítico falso "Unidad del proveedor" que bloquea con "NO UTILIZAR". El botón primario lleva a un error de +$ 61 M. | No disparar la regla si el externo tiene la movilización incluida o un modo distinto de "por sus propios medios", o si los viajes son de otros vehículos. Usar los viajes **del propio equipo**, no los de la ruta general. Que la acción primaria sea "Sí, cobra por trabajo" o que no haya una primaria. |
| H-05 | P1 | En un precio cerrado de pocos días se cobran sueldos y amortización del mes completo. No hay costo de personal por día ni por hora. | Agregar al puesto una "Forma de pago": mensual / por día trabajado / por hora (jornal). Con jornal, costo = valor × días (u horas) × factor de cargas. En precio cerrado, permitir "duración de la obra" y prorratear lo fijo contratado por la obra. |
| H-06 | P1 | Obra de varios días con 1 viaje por trabajo: se subestima el traslado diario sin aviso. | Si los días por trabajo son más de 1 y los viajes 1, preguntar: "¿La cuadrilla vuelve a la base cada día?" y ofrecer viajes = días o alojamiento por noche. |
| H-08 | P1 | Fijo mensual: "no perdés aun trabajando 30 días" ignora la HE de los días fuera de la jornada. | Pedir "días de la jornada normal" (lunes a viernes = 22) separados de los días disponibles. Fuera de la jornada, costear la HE del tramo que corresponda o, como mínimo, cambiar el texto por "sin contar horas extra" y enlazar al aviso `labor_hours`. |
| H-03 | P1 (on call) | El tramo de descuento se elige con días inflados por el mínimo por llamado. | Elegir el tramo con los días trabajados (D) o dejar elegir la base (días trabajados o facturados). Mostrar el tramo aplicado y por qué. |
| H-07 | P1 | $/HH sin relación con la dotación; 10 h ocultas que generan avisos falsos; HH imposibles aceptadas. | Derivar las HH por día de Σ(posiciones × horas por día) y dejar editarlas. Sincronizar las horas por día. Avisar si las HH por día superan personas × 24 o difieren más del 10 % de lo derivado. |
| Exp-1 | P1 | Hora extra como adicional: costo manual, "hora" ambigua, sin 50/100 %. | En "Hora fuera de horario", ofrecer "Calcular desde el puesto" (valor hora × recargo × cargas × personas) y una unidad explícita (hora-hombre / hora-cuadrilla). Unificarlo con "Horas extra facturadas aparte" del puesto, que hoy es un segundo camino paralelo. |
| Exp-5 | P1 | Precio cerrado limitado a "$ global" o "$/hito": no hay precio unitario por ítem ($/m, $/junta, $/locación). | Permitir cualquier unidad (incluida una personalizada) también en precio cerrado, con "cantidad total de la obra" en lugar de "por mes". Ideal: una planilla de ítems con cantidad × precio unitario. |
| H-10 | P2 | Tarifa piso menor que el costo cuando hay adicionales. | Nota bajo la piso: "Supone que facturás $ X de adicionales por mes; sin adicionales, la piso es $ Y". |
| H-04 | P2 (on call) | "unas 59 horas" son horas trabajadas, no facturadas. | Mostrar las horas facturadas en el equilibrio (78,7 h) y aclarar cuántas son trabajadas. |
| UX-1 | P2 | Tooltip vacío de la insignia "ILUSTRATIVO" cuando la causa es la tasa financiera. | Agregar `info.finance` a `parts` ("tasa financiera de ejemplo") y un enlace a Financiación. |
| UX-2 | P2 | "ILUSTRATIVO" en las cargas del puesto cuando el valor coincide con el de ejemplo (SAC 8,33 %, 176 h, 50 %). | Marcar por origen (perfil o convenio ilustrativo) y no por igualdad de valor. |
| Exp-2 | P2 | Sin Fondo de Cese Laboral (UOCRA), horas in itinere ni zona en %. | Agregar al puesto una lista libre de "otros conceptos" (nombre, % o $, si lleva cargas o no) en lugar de campos fijos. |
| Exp-6 | P2 | Un externo "por día" no puede usarse sólo algunos días del trabajo. | Agregar "días de uso por trabajo" (o % de los días) en la línea del externo. |
| Exp-7 | P2 | Viáticos sólo "por intervención". | Ofrecer viáticos por persona y noche × dotación × noches. |
| UX-3 | P2 (on call) | Disponibilidad 24/7 por defecto y oculta: aviso de relevos falso en cuadrillas diurnas. | Preguntarla de forma visible o tomar por defecto la ventana horaria según el contrato o las plantillas. |
| UX-4 | P2 | En fijo mensual se ven tramos de descuento, equipo en espera y "cada intervención se cuenta completa". | Ocultarlos cuando la unidad es $/mes (o mostrar "no aplica al abono"). |
| UX-5 | P2 | La cotización "en blanco" trae "Equipo con operador" y "Equipo o maquinaria" marcados. | Arrancar sin componentes ni plantilla marcada. |
| UX-6 | P2 | Errores de concordancia: "cuántos intervenciones", "Valor no definida", "Costos no definida". | Usar el género de `activationTerms` y "Valor sin definir" / "Costos sin definir". |
| UX-7 | P2 | El mismo perfil agregado dos veces sin aviso. "Costo del puesto" sin viandas contra un total con viandas. | Avisar si el perfil ya está en la cotización ("¿sumar posiciones?"). Rotular "Costo fijo del puesto" y "+ variable por día". |
| H-09 | P2 | Fechas base de la camioneta y del combustible pendientes y escondidas. | Poner "Mes del valor" junto a "Valor de reposición" y junto al precio del combustible. Llevar el "Ir al campo" del aviso a ese lugar. |

**Lo que funciona bien (para no romperlo):** las cargas y el factor (× 1,4854) son claros y "Ver cálculo" cierra al peso. Están bien la separación entre tener y usar un equipo, la movilización "por sus propios medios" con desgaste por km, el tratamiento fiscal de los externos (el IVA recuperable no es costo), el gross-up de impuestos sin doble conteo, el adicional con precio sugerido que respeta el margen, el aviso `labor_hours` y la asignación compartida de personal y equipos. En mobile no hay scroll horizontal y no hubo errores de JavaScript en ninguna corrida.
