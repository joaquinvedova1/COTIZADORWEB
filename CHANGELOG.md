# Changelog

Todos los cambios relevantes de RATEOS se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/). Los tags `v0.x.x` se crean sólo para hitos (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-tags-y-versiones)).

Reglas para este archivo:

- Todo cambio de fórmula económica se anota aquí **y** en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md), indicando qué resultados cambian.
- Todo cambio de `SCHEMA_VERSION` se anota con la migración correspondiente.
- Secciones: Agregado, Cambiado, Obsoleto, Eliminado, Corregido, Seguridad.

## [Unreleased]

## [0.25.1] - 2026-11-25

**Auditoría de la 0.23.0: el mes completo de un recurso se guarda como decisión, no como horas.** Informe en project files `auditoria-0-23-0/INFORME.md` (ingeniería económica, auditor independiente con oráculo propio, prestador y QA en navegador). Sin cambio de esquema. Ninguna cotización guardada cambia sus números: la fórmula nueva sólo se usa donde alguien marca la casilla. Reglas: docs/CALCULATION_RULES.md §36.5.

### Corregido

- **"Sólo tiene este trabajo: cobrar su mes completo acá"** ahora es una casilla en la tarjeta de cada puesto y de cada equipo propio (y un botón por recurso en el aviso). Guarda la decisión (`fullMonth`) y el recurso se costea como dedicado: su mes entero como costo fijo. Antes el botón escribía las horas de la cotización como "horas que trabaja por mes": si después cambiaban los días, la cotización cobraba dos sueldos (de 2 a 4 días) o medio (de 2 a 1, sin aviso), y el equilibrio y el margen por día dejaban de ser ciertos. Se deshace destildando.
- El botón era uno solo para todos los recursos del aviso (técnico y grúa juntos): ahora se elige recurso por recurso.
- El aviso "Más horas que las del mes del recurso" ya no tapa al de "Horas del mes que esta cotización no paga", y su texto no manda a "sumar otro recurso igual" cuando el problema son horas del mes mal cargadas.
- Puestos con relevos (más personas que puestos): el mes del puesto es el de todas sus personas (sin exceso falso) y lo que queda sin cobrar cuenta todas las nóminas.
- **Recursos › Usado en** cuenta las mismas horas que cobra la cotización (antes podía decir 17 % donde el costo cobraba 45 %), muestra "cobra su mes completo" y avisa si más de una cotización cobra el mes completo del mismo recurso. Los avisos de más del 100 % aclaran que RATEOS no sabe en qué mes se hace cada trabajo ni qué propuestas son alternativas.
- "Actualizar en esta cotización" desde Recursos conserva la decisión de mes completo.
- Resultado: el aviso de horas del mes sin cobrar se ve arriba, junto al precio, con el monto (antes quedaba dentro de "¿Te falta cargar algo?").
- "Horas que le cobrás a clientes por mes" pasa a llamarse "Horas que trabaja para clientes por mes, entre todos tus trabajos": se leía como las horas de un cliente y, con 16 cargado, una cotización de 64 h costaba cuatro sueldos.
- Traslados: la ayuda del desgaste por km ya no pide cargar la amortización si el vehículo también está en Equipos (se contaba dos veces).
## [0.25.0] - 2026-11-24

**Menos preguntas, segunda parte.** Auditoría para cerrar la beta, tanda 4 (project files `auditoria-beta/PLAN-TANDA-4.md`, PLAN-2026-029): PR 4, 6, 7, 8 y 9 del plan, y la decisión D3. **Esquema 11, sin cambio ni migración.** Sin cambio de fórmulas: ninguna cotización ni producto guardado cambia sus números (foto nueva `tests/fixtures/tanda4-sin-cambio-0-25.json`, sacada con el motor de la 0.24.0 antes de tocar el código: cotizaciones, productos y fichas de equipos). Reglas: docs/CALCULATION_RULES.md §39.

### Agregado

- **"¿Cómo le cobrás al cliente?" antes de crear la cotización** (PR 4, W-12): "Nuevo servicio" empieza con cuatro tarjetas (Por hora, Por día, Por mes, Por trabajo) y "Otra unidad…", que abre el campo de la unidad. La cotización nace con esa unidad y la forma de contrato que le corresponde (por hora o por día a demanda, por mes mensual, por trabajo cerrado con un trabajo por mes). Las plantillas siguen debajo ("O empezá desde una plantilla") y dicen su unidad. En la lista de unidades, sin escribir, se ven las comunes y las del rubro de la empresa (petróleo y gas, minería y energía); escribiendo, aparecen todas.
- **Horas por mes del equipo** (PR 6, P-08/P-09): en Recursos › Equipos, una sola pregunta, la misma que en Personal: "¿Cuántas horas por mes trabaja para clientes, entre todos tus trabajos?". Con ese dato el $/hora de la ficha sale del costo del mes ÷ esas horas, y es el mismo valor hora que muestra la cotización al asignarlo. Un equipo guardado sin el dato sigue con horas disponibles × utilización (el campo muestra ese número como sugerido) y no cambia nada.
- **"Agregar otra persona igual"** (D3): en Personal copia la línea debajo. En el selector de operador de un equipo, los puestos repetidos se numeran ("Chofer 1", "Chofer 2").
- **Productos** (PR 7): "= 350 g por unidad que vendés" debajo de cada ingrediente por tanda, y "= 6 min de trabajo por unidad que vendés" en Personal (R-05); "Son mis valores" en las cargas de una persona con valores de ejemplo (R-06, `ownParams`); "No remunerativo por mes" junto a los adicionales (R-07); "Agregar algo que va en cada unidad" y "Mover a…" en lugar de "¿Dónde va?" (R-10); en Recursos se ofrecen primero materiales e insumos; con equilibrio 0, "Cualquier venta te deja ganancia" (W-23); "Ver un ejemplo: Chipá" en la lista vacía.
- **Dos avisos informativos** (PR 8; no cambian el puntaje ni los números): "El combustible de «…» no se está sumando" cuando el cliente pone el combustible y un equipo externo tiene consumo sin combustible incluido (P-20), y, por tiempo usado sin horas extra, "«Soldador»: 22 días × 10 h por día son 220 h, más que sus 176 horas normales del mes" (P-22).

### Cambiado

- **Recursos, alta más corta** (PR 9, W-14, W-18, W-19): familias generales primero y las de pozo al final ("(pozo)"), salvo en petróleo y gas; "¿Cuánto cuesta uno nuevo hoy?"; "Patente" en lugar de "Dominio"; mantenimiento y neumáticos plegados con lo cargado en el resumen; "Por tenerlo / Por usarlo"; en la tabla, "Costo por hora" y "Costo por mes" (sin "Costo por día usado" ni "Utilización"). En el puesto, la hora al 50 % y al 100 % van plegadas; sin convenio, "Cargas sociales de este puesto"; un convenio por crear dice "(nuevo)". El número de cada pestaña se lee una sola vez.
- **Productos**: con responsable inscripto los precios de compra dicen "(sin IVA)"; sin condición frente al IVA, una línea con enlace a Configuración (R-04). La merma dice "% extra que tenés que comprar por lo que se pierde" (R-12; la cuenta sigue siendo cantidad × (1 + merma), decisión D5). La tabla de la tanda dice la unidad del producto (R-13). Una línea nueva nace sin nombre.
- **El modo de cobro** (W-09): sin el pliegue vacío cuando no hay nada que mostrar.

### Corregido (revisión de la 0.25.0)

Sin cambio de fórmulas: la foto `tanda4-sin-cambio-0-25` pasa sin regenerarse (sólo se le agregaron casos).

- **"Otra unidad…"** ya no abre la cotización con "por día" elegido: el buscador arranca vacío, muestra primero viaje, km, m³, tonelada…, y dice "Todavía no elegiste la unidad. Si no elegís, queda por día." (se guarda por día, como siempre, con la marca opcional `unitPending`, que se borra al elegir). La lista dice "Unidad sin elegir" y el resultado lo muestra como aviso informativo. El texto de la tarjeta ya no se corta, "Nuevo servicio" se titula "Empezá tu cotización" y no queda "tipo de servicio" en las plantillas (que dicen su unidad, "Por día" si no tienen).
- **Equipos**: un equipo creado en la 0.25.0 y editado después vuelve a escribir sus horas disponibles al 100 % (una pestaña anterior leía otro $/hora) y no dice "los datos que cargaste antes". Con más horas para clientes que disponibles, los días usados de la ficha no pasan de los del mes. La ayuda de las horas en Recursos dice que en una cotización por día o por mes cuentan los días de esa cotización. "¿Cuánto cuesta uno nuevo hoy?" en Recursos y en la cotización; "Por tenerlo / Por usarlo" también en el encabezado y la leyenda.
- **Combustible del cliente** (P-20): el aviso nombra «¿Quién paga el combustible?» y el consumo del externo dice "(lo pone el cliente: no se suma)". En L/100 km o km/L sin km de ruta no avisa.
- **Horas sobre las normales del mes** (P-22): cuenta las personas por puesto (relevos) y los meses de un trabajo largo, como el control de siempre; no avisa si el puesto tiene horas extra cargadas, y los puestos iguales van en un solo aviso ("«Chofer» (2 personas)").
- **Personal**: las tarjetas de puestos repetidos se numeran como el selector de operador ("Chofer 1", "Chofer 2") y la copia nueva se muestra y enfoca. En una línea de antes con varias personas, el botón dice "Agregar otro puesto igual (N personas)".
- **Productos**: con equilibrio 0, "Sin gastos fijos cargados" (y cómo cargarlos), no "Cualquier venta te deja ganancia". El no remunerativo dice que no lleva aguinaldo, vacaciones ni contribuciones patronales, y que la obra social o la cuota sindical van en el % del convenio. Como responsable inscripto: sin IVA con factura A; con factura C o ticket, el precio completo. "Mover a…" convierte la cantidad (por tanda ↔ por unidad) y el costo no cambia. "Costo por bolsa" y "Ganás por bolsa" en el resumen. "= N g por unidad" dice "(sin la merma; comprás …)" y pasa a kg antes de mostrar "1.000 g". En un producto de ejemplo las cargas siguen marcadas como de ejemplo.
- **Inicio público**: "Un servicio (por hora, por día, por mes o por trabajo)".

### Test Lab

- Foto `tanda4-sin-cambio-0-25`: se agregan 88 fichas de equipo en la cotización (`equipmentCardAtQuote`), con y sin horas por mes en la línea, sacadas con el motor de la 0.24.0; los demás casos no cambiaron (revisión de la 0.25.0, P-6).
- Foto `tanda4-sin-cambio-0-25` (cotizaciones, productos, fichas de equipos y la línea que produce cada equipo). Control estático `UX-TERM-HOURS` (no quedan los rótulos de horas de antes). Invariante PINV-11 (el no remunerativo de un producto suma sin cargas patronales). Escenario PRD-11-NON-REMUNERATIVE; sondas PRB-25 y PRB-26. Navegador E2E-33 (unidad antes de crear), E2E-34 (valor hora del equipo en Recursos y en la cotización) y E2E-35 (Productos: "sin IVA" y la cantidad por unidad); E2E-31 y E2E-32 usan las tarjetas de la unidad.

## [0.24.0] - 2026-11-24

**Menos preguntas.** Auditoría para cerrar la beta, tanda 4 (project files `auditoria-beta/PLAN-TANDA-4.md`, PLAN-2026-028): PR 1, 2, 3 y 5 del plan. **Esquema 11, sin cambio.** Sin cambio de fórmulas: ninguna cotización ni producto cambia sus números (foto de `computeQuote` antes de tocar el código, `tests/engines/tanda4-sin-cambio.test.js`: KPIs, estructura de costos y completitud de la demo, los fixtures y los escenarios y sondas del Test Lab; de la completitud sólo cambia el paso al que apunta cada pendiente). Reglas: docs/CALCULATION_RULES.md §38.

### Cambiado

- **Sin el paso "Cómo se cobra"** (P-12, P-13, G15): la cotización tiene 10 pasos en 5 etapas (El servicio, Los recursos, Otros gastos, El precio, Resultado). El ritmo de trabajo va en "El servicio", "Horas extra del trabajo" al final de "Personal", "¿Cómo viaja el personal a la locación?" en "Movilización y viajes", y la hora fuera de horario, la guardia y los adicionales cargados antes en "El precio" (bloque "Cargado antes"). Salen "Lo que ya cargaste", "Con tu tarifa" y "Ver tarifas según el margen" (están en el resumen en vivo y en el Resultado). Un enlace viejo `…/modality` abre "El precio". Los pendientes de la completitud llevan al paso donde está el campo.
- **Un solo campo de precio a mano**: "¿Ya tenés un precio? (opcional, sin IVA)", a la vista debajo del margen. Reemplaza "Tu tarifa" y "Tarifa ofrecida a mano"; con el mismo precio los dos daban los mismos números (INV-33). En una cotización "ya tengo la tarifa", "Borrar mi precio y usar el sugerido" (con confirmación). `pricingMode` sigue en el modelo.
- **Un solo precio en el Resultado y en el resumen** (W-01): una cifra grande ("Precio sugerido" o "Tu precio") y la línea "Te cuesta $ X · ganás $ Y (Z %)". La tarifa mínima pasa a "¿Hasta cuánto puedo bajar?" con su "Ver cálculo"; las demás tarjetas quedan en "Todos los indicadores". En el resumen en vivo, a la vista sólo el precio.
- **Datos de la empresa una sola vez** (W-10): mientras la Configuración sea de ejemplo, Inicio y "Nuevo servicio" muestran la tarjeta "Datos de tu empresa" (combustible, plazo de cobro, tasa, imprevistos, margen y condición frente al IVA). "Guardar" los deja como propios y la cotización siguiente nace sin "ILUSTRATIVO". En la cotización, "Guardar como valor de mi empresa" para el combustible y la tasa; en las creadas antes, "Son los valores de mi empresa" en el aviso (el número no cambia).
- **IVA** (P-11): con una empresa responsable inscripta y los dos valores cargados, la cotización nueva nace con "¿Facturás con IVA?" = Sí y muestra una línea en vez de la pregunta ("Cambiar sólo acá"). Un externo nuevo sigue naciendo con "¿Recuperás ese IVA?" sin definir. Botón "Recupero el IVA de todos (responsable inscripto)" para los externos sin definir, con una confirmación que dice cuánto baja el costo: con el IVA de la cotización aplicado, "Sí" da crédito fiscal y baja el costo financiero (es lo correcto si recuperás el IVA); sin el IVA aplicado, el costo no cambia (INV-34). Es un cambio de números sólo por esa acción de la persona; la regla no cambia sola (D6).
- **Mismo rótulo en Configuración y en la cotización** (P-19): "Plazo de cobro", "Redondeo", "Imprevistos" y "Precio del combustible".
- **Campos que no mueven números** (P-14): "Tiempo máximo de respuesta" sale del ritmo y queda en "Detalle de la guardia". "Categoría" del puesto, en la cotización sólo si tiene texto y en Recursos en "Más detalle". "Valor actual", "Velocidad estimada" y "Combustible" del modelo, sólo si ya tienen valor. Interno, modelo, año, dominio y capacidad del equipo, en "Datos de la unidad (opcional)". "¿Quién lo provee?": "Lo pago yo" y "Lo pone el cliente"; "Tercero contratado por nosotros" sólo donde ya estaba elegida. Nada se borra.
- **"Suba de precios" e "Inflación"** (P-15) se ocultan sólo si están en 0 y el precio ya contempla la inflación.
- **Textos**: "Aportes del trabajador (% del remunerativo)" (el motor ya los calculaba así); "Viáticos y alojamiento" dice lo mismo que el bloque de viajes (P-10); "Horas asignadas a este trabajo" (P-21); en Productos, "Precio piso" pasa a **"Precio mínimo"** (W-11, D4).

### Corregido (revisión de la 0.24.0)

Project files `auditoria-beta/revision-0-24-0/` (UX.md y COSTOS.md). Ningún número cambia salvo por una acción de la persona (botones con confirmación o "Usar los de mi empresa").

- **IVA de externos** (B-1): un externo nuevo vuelve a nacer con "¿Recuperás ese IVA?" sin definir. Con el IVA de la cotización aplicado, "Sí" baja el costo financiero (crédito fiscal): "Recupero el IVA de todos" pide confirmación y dice cuánto baja el costo.
- **"Te cuesta · impuestos · ganás"** (B1, C-7): la línea muestra los impuestos sobre lo que facturás del motor y suma el precio facturado.
- **Margen de "ganás"** (B-2, C4): el pedido sólo si la diferencia es de redondeo; si no, el real del motor (p. ej. 55,4 % con el mínimo garantizado, no 15 %). "El precio" usa el mismo criterio.
- **Precio a mano** (C-1, C-2, C1): en "ya tengo la tarifa", vaciar el campo hace lo mismo que "Borrar mi precio y usar el sugerido"; sin asterisco; el texto de muestra depende del modo. La confirmación avisa si faltan los días del mes y lleva a ese campo; no dice "$ 0".
- **Cobro por mes sin "Movilización y viajes"** (C-3): "¿Cómo viaja el personal?" se ve en "El servicio".
- **Datos de la empresa** (C-4, C-5, C7, C8, C9): el aviso de una cotización creada antes muestra los dos valores y, si difieren, "Usar los de mi empresa" o "Dejar estos". "Precio del combustible (con IVA)" para monotributo y exento. Con responsable inscripto, la tarjeta pide el IVA que facturás y los días hasta pagarlo. En "Nuevo servicio" la tarjeta va después de las opciones y "Ahora no" se recuerda en la sesión. "Margen que querés ganar (sobre el precio)" en los dos lados.
- **Resultado y resumen** (C-6, C5, C6, C11): con descuento, la pista de la cifra grande dice lo que se cobra; la cifra se pinta en rojo si se pierde y en naranja bajo el objetivo; el precio a mano se llama "Tu precio" en todos lados; la barra del celular muestra el rótulo y la cifra enteros.
- **Textos y orden** (C2, C3, C10, P2–P6, P10): "Cargado antes" va antes de "Opciones comerciales"; un enlace viejo `…/modality?campo=` va al paso del campo; sin "piso" en textos visibles ("por debajo de la tarifa mínima"); la hora fuera de horario cargada antes se quita con confirmación y dice dónde están las horas extra; "Horas extra del trabajo" antes del total de Personal; "Usar $ X como tu precio"; el pliegue del precio nombra el ejemplo de margen; el plazo de cobro lleva la pregunta "¿A cuántos días te paga el cliente?".

### Test Lab

- Controles estáticos `UX-TERM-STEP` (ningún texto cita "Cómo se cobra") y `UX-TERM-FLOOR` (ningún texto dice "piso", ampliado en la revisión). Invariantes INV-33 (ampliado en la revisión: `kpis` enteros salvo la completitud, EECC, facturación estimada y precio vacío) e INV-34 (corregido en la revisión: con el IVA aplicado, "Sí" ≤ sin definir). Sonda PRB-24. Navegador E2E-26 a E2E-32. La foto `tanda4-sin-cambio` suma `especialista-24h-c2` con mínimo de 20 unidades (sacado con el motor de la 0.23.0).

## [0.23.0] - 2026-11-23

**Horas del mes que la cotización no paga.** Sale de la evaluación contra la ruta y de la simulación E-01 de la beta (hidrogrúa y operador cobrando por día: el costo por día era igual con 20 o con 2 días de trabajo y no se avisaba). Sin cambio de fórmulas ni de esquema: ninguna cotización cambia sus números.

### Agregado

- **Aviso "Horas del mes que esta cotización no paga"** (Resultado, Personal y Equipos; cotizaciones por tiempo usado): cuando un recurso propio queda cubierto en menos de la mitad de su mes, dice cuántas horas paga la cotización de las de su mes y cuánta plata por mes queda sin cobrar acá. Explica cuándo está bien (otros trabajos pagan ese tiempo) y qué hacer si no. En Personal y Equipos el aviso trae el botón "Sólo tiene este trabajo: cobrar su mes completo acá": pone en cada recurso, como horas que trabaja por mes, las que esta cotización le paga, y su valor hora pasa a cubrir el mes entero (se deshace borrando ese dato). Elegido por el dueño entre avisar, avisar y dejar elegir, o cargar el mes completo por defecto. CALCULATION_RULES §36.4.
- **Aviso "Más horas que las del mes del recurso"**: cuando el trabajo estimado le pide a un recurso más horas que las de su mes.
- **Recursos › Usado en**: las cotizaciones por tiempo usado ahora suman su parte del mes del recurso (horas del trabajo estimado ÷ horas del mes), así que "Más del 100 % adjudicado" también las cuenta. Antes figuraban sin %.

### Cambiado

- Resultado: los avisos de "Para tener en cuenta" que piden revisar algo se muestran en naranja con la etiqueta "Revisar".
- Traslados: el desgaste por km de un vehículo aclara que ahí se cobra sólo por los km y que un vehículo propio que queda en el trabajo va en Equipos.

## [0.22.0] - 2026-11-23

**Auditoría para cerrar la beta, tanda 3: una sola lista "Insumos y materiales".** Plan en project files `auditoria-beta/PLAN-TANDA-3.md` (PLAN-2026-027). **Esquema 11.** Sin cambio de fórmulas: ninguna cotización guardada cambia sus números (comparado con `computeQuote` antes y después en la demo, los fixtures, las plantillas y los escenarios del Test Lab). Reglas: docs/CALCULATION_RULES.md §37.

### Cambiado

- **Una sola lista "Insumos y materiales"** (antes "Materiales" con secciones y, aparte, "Otros costos" con "Va a"). Cada línea tiene un **Tipo** junto a "¿Qué es?": Material que queda en la obra, Insumo o consumible, Herramienta menor (reposición), EPP especial u Otro gasto. Un gasto se clasifica una sola vez. Debajo de la lista, lo que suma cada tipo.
- **El tipo se elige una vez, en Recursos** (pestaña "Insumos y materiales") y viaja con la línea al agregarla. Si en la cotización es otro, la línea lo dice y ofrece "Usar el de Recursos" o "Guardar este tipo en Recursos". "Agregar en blanco" lleva al lado un selector de tipo que empieza en "Insumo o consumible" y recuerda el último que usaste mientras no cierres la pestaña.
- **Recursos no guarda cuánto se usa** (P-03): un insumo o material de Recursos tiene qué es, tipo, unidad, costo unitario y fecha base (merma, flete y quién lo provee en "Más detalle"). Ya no pide cantidad, frecuencia ni markup. Al agregarlo a una cotización la cantidad queda vacía (se pide con su nombre) y "¿Cada cuánto se consume?" arranca según cómo cobrás: "Por válvula" si cobrás por válvula, "Por mes" por mes, día u hora, por trabajo con precio cerrado. Antes un kit "1 por mes" de Recursos agregado a una cotización por válvula se contaba 1 por válvula (40 kits por mes). Lo que cargaste antes en Recursos se conserva, sin uso.
- **"Otros costos" guardados se ven como "Gastos cargados antes"**: siguen sumando igual, en el mismo renglón ("Suma en: Personal", "Suma en: Gastos de estructura"…). No se agregan nuevos. Los que suman en "Insumos y materiales" tienen el botón **"Pasar a la lista"**: pasan como un "Otro gasto" (cantidad 1, unidad global, el mismo monto) y la cotización suma exactamente lo mismo. Si uno suma en Gastos de estructura y además cargaste un % de estructura, se avisa que puede estar contado dos veces (aviso informativo, no cambia la completitud).
- **"¿Qué incluye?" tiene 4 casillas**: Personal, Equipos y vehículos, Insumos y materiales y Viajes (antes 10). Cada una dice dónde se carga y cuánto hay cargado. Se guardan los mismos datos que antes: una cotización guardada abre con las casillas que le corresponden.
- **Estructura de costos y Resultado**: el renglón se llama "Insumos y materiales" y se abre sólo en los tipos que tienen monto (antes mostraba los marcados en $ 0); con la casilla marcada y nada cargado, un renglón "Insumos y materiales" en $ 0. Los equipos propios se llaman siempre "Equipos y vehículos". El PDF para el cliente dice "Incluye" con las 4 casillas. Actualizar tarifa usa los mismos tipos y rótulos ("EPP especial", "Otros gastos"); las actualizaciones guardadas siguen valiendo.
- **Ropa de trabajo y EPP básico** de cada persona siguen en su puesto (Personal), con ese nombre; "EPP especial" en la lista es sólo el del trabajo (trajes, respiradores, arneses).
- **Completitud**: una línea con precio y sin cantidad dice "tiene precio y falta la cantidad" (y cuántas más hay así); los textos hablan de "insumos y materiales" y de "El servicio no usa insumos ni materiales".
- **Revisión UX y de costos**: el EPP especial arranca "Por mes" aunque cobres por unidad (un arnés dura muchos trabajos); un "Otro gasto" pregunta "¿Cada cuánto lo pagás?" y explica qué hacer con un pago único; el PDF para el cliente dice "Incluye" también con lo cargado aunque no se haya marcado la casilla; los subtotales por tipo se leen como renglones; un insumo nuevo en Recursos arranca como "Insumo o consumible".

### Esquema

- `SCHEMA_VERSION` 10 → **11** (`migrateV10ToV11`): cada insumo o material de Recursos recibe el tipo con que lo usan tus cotizaciones y plantillas, sólo si todas coinciden; si no se usa o hay tipos distintos queda "Sin tipo" (la tabla de Recursos lo marca y hasta elegirlo se lee como Materiales). No cambia ninguna cotización ni plantilla, no borra la cantidad, la base ni el markup guardados y es idempotente. Una pestaña abierta con una versión anterior de RATEOS abre estos datos en sólo lectura hasta recargar.

## [0.21.1] - 2026-11-23

**Beta pública: reportes, respaldo, privacidad.** Revisión de lanzamiento (project files `beta-publica/`). Sin cambio de esquema del workspace ni de fórmulas: ninguna cotización cambia sus números. Requiere aplicar en Supabase las migraciones `20261123221818` y `20261123223000` y volver a desplegar la Edge Function `bug-report-submit`.

### Agregado

- **Reportar un problema · tipo**: primero se elige qué se quiere contar (Algo no funciona · Un cálculo no me cierra · Un texto o campo confuso · No encuentro o no entiendo algo · Una sugerencia) y las dos preguntas cambian según el tipo. En el celular, etiquetas cortas.
- **RATEOS Admin › Reportes** (#/admin, sólo la cuenta master): pendientes, sin revisar, a corregir y resueltos; severidad (crítica, alta, media, baja), estado, tipo, versión en que se corrigió y nota de seguimiento. Nunca muestra quién reportó. Abrir y actualizar queda auditado.
- **Historial del trabajo de cada empresa** (`private.workspace_state_history`): una foto cada 30 minutos como máximo mientras se trabaja, hasta 100 fotos y 25 MB por empresa, 30 días. Restauración desde el SQL Editor (`docs/BACKUPS.md`). Sin acceso desde la API.
- **Privacidad y condiciones de la beta** (#/privacidad): qué se guarda, dónde, quién lo ve, reportes, copias, borrar la cuenta, contacto. Enlazada en el pie y en "Crear cuenta". `SUPPORT_EMAIL` en `js/config.js`.

### Cambiado

- **Editor**: "Continuar" se recalcula al cambiar la cotización: al agregar un equipo, lleva a "Movilización y viajes" (antes salteaba el paso hasta volver a entrar).
- Días de trabajo por mes: hasta 31 (antes aceptaba hasta 366).
- Cuenta sin plantillas: "¿Qué servicio vas a cotizar?" ya no pide elegir una plantilla que no existe.

### Seguridad

- Los reportes **ya no se publican solos en GitHub** (repositorio público) y el plan B si falla el envío es copiar el texto o el email de soporte, nunca un sitio público (S-04).
- El contexto de un reporte guarda sólo las claves conocidas (modo, idioma, tipo) (S-03).
- `bug-report-submit`: el límite por origen usa la IP que pone Cloudflare y corta por tamaño antes de leer (S-05).

## [0.21.0] - 2026-11-23

**Auditoría para cerrar la beta, tanda 1: números y PDF para el cliente.** Informe en project files `auditoria-beta/VEREDICTO.md`. Sin cambio de esquema ni de fórmulas del motor de cotizaciones: ninguna cotización guardada cambia sus números.

### Agregado

- **PDF para el cliente** (Resultado): una hoja con la empresa, el cliente, el servicio, qué incluye y UN precio en su unidad (sin IVA); cobrando por mes dice qué cubre (días × horas) y, si se actualizó, de qué período son los valores. Con pendientes críticos o valores de ejemplo pide confirmación antes de imprimir. El PDF de siempre pasa a llamarse "Análisis interno (PDF)" y su ayuda dice que tiene tus costos y tu ganancia (W-16).
- **Tarifa vigente arriba del Resultado**: si la tarifa se actualizó por EECC, el Resultado la muestra primero ("Tarifa vigente: $ X por hora, actualizada a …") y el PDF para el cliente usa ésa. Antes el listado y el Inicio mostraban la actualizada y el Resultado y el PDF la original, sin aviso (W-15).
- **Productos · Una tanda**: la tabla suma el empaque (antes el "costo variable de la tanda" lo dejaba afuera, −8,7 % en una torta) y agrega el costo completo de la tanda, su precio sin y con IVA, los impuestos sobre la venta y lo que ganás (R-01, R-02: "¿cuánto valen 40 tortas?").

### Cambiado

- **Cobro por mes · horas de cada recurso**: el personal y los equipos propios que se asignan arrancan con las horas del servicio (días × horas por día del paso 1) cuando son menos que su mes. Si el campo queda vacío (todo el mes), o si después cambian los días u horas del servicio, se avisa con el botón "Usar N h"; con menos horas que su mes, la tarjeta dice que el resto lo tienen que pagar otros trabajos. Antes un técnico de 4 días × 8 h costaba el mes entero sin avisar (W-07). Queda guardado como dato de la línea: el motor no cambia y lo fijo sigue fijo en los escenarios.
- **Resumen en vivo**: sin impuestos sobre la facturación, la tarifa mínima es el mismo número que el costo: se muestra uno solo (antes diferían en $ 1 por redondeo) (W-02). Además se corrige un aviso de consola del resumen ("No se pudo calcular un indicador").
- **Tarifas**: el aumento acumulado se muestra con los mismos decimales que el diálogo de actualizar tarifa.
- **Personal · cargas patronales**: la ayuda dice que se aplican sólo sobre lo remunerativo (con aguinaldo y vacaciones), nunca sobre las sumas no remunerativas. Se verificó que el motor ya lo hace así (personal, productos, aumentos del convenio y Actualizar tarifa); no cambia ningún número.

## [0.20.1] - 2026-11-23

Textos y pantalla, sin cambio de cálculos (observaciones del dueño sobre la 0.20.0).

### Cambiado

- **Movilización y viajes · detalle**: cada bloque se muestra sólo si tiene algo ("Vehículos y equipos que van por sus medios", "Vehículos cargados por km, peajes y alojamiento") y ya no llevan letras A / B / C. Un bloque en $ 0 hacía pensar que la camioneta no estaba contada.
- **Equipos · valor hora**: la pregunta es "¿Cuántas horas por mes trabaja, entre todos tus trabajos?" y la ayuda aclara que no es un costo más: es con cuántas horas se reparte el costo del mes del equipo.

## [0.20.0] - 2026-11-23

**La cotización en la unidad de cobro (primera tanda de la evaluación contra la ruta).** El ritmo de trabajo se pregunta apenas se elige la unidad, las pantallas y el Resultado dicen cada cifra primero en la unidad de cobro, y se corrigen dos errores de costo. Sin cambio de esquema. Reglas: docs/CALCULATION_RULES.md §36.3.

### Cambiado

- **El ritmo va en el paso 1**: cuántas unidades por mes y por día, días del trabajo y horas por día se cargan en "El servicio", debajo de la unidad de cobro (antes, en "Cómo se cobra", después de los recursos). "Cómo se cobra" lo muestra y enlaza al paso 1. Los pendientes y avisos de esos datos llevan al paso 1.
- **Primero la unidad de cobro**: cobrando por hora, día o unidad, el resumen en vivo dice "Costo $ X / válvula" y el Resultado "Te cuesta $ X / válvula" y "Ganás $ X / válvula" (lo del mes queda debajo). Los totales de Personal, Equipos, Movilización, Imprevistos, Estructura y Financiación se leen "$ X por válvula · $ Y por mes". La estructura de costos suma una columna "Por válvula".
- El paso 1 se llama "El servicio" en todos los textos (antes algunos decían "Contrato").
- **Sin "horas por m3"** (pedido del dueño): cobrando por cualquier cantidad (m³, válvula, unidad propia…) el rendimiento del día se carga una vez en el paso 1 y cada recurso dice sus horas por día de trabajo; el costo por unidad se calcula y se muestra. Las horas por unidad ya cargadas se siguen viendo y contando igual. Por trabajo se siguen pidiendo las horas en el trabajo. No cambia ningún resultado.

### Corregido

- **Vehículos por tiempo usado**: un vehículo agregado a la cotización se trata como cualquier equipo (horas asignadas × su valor hora completo). Antes nacía con 0 h de uso y un camión con chofer cobrado por hora no sumaba combustible ni mantenimiento (en la simulación, −46 % de costo). Las líneas ya guardadas no cambian.
- **Cobro por mes**: un equipo con horas asignadas por mes usa esas horas, no el día entero de servicio. **Cambia el resultado** de esas cotizaciones (baja el costo de uso a las horas asignadas).
- Ya no se sugiere sumar las horas de viaje a las horas asignadas (se contaban dos veces con el traslado por km).

### Pendiente (próxima versión)

- Ver la capacidad ociosa y la sobreasignación de un recurso entre cotizaciones por tiempo usado.
- Que la misma camioneta cueste lo mismo cargada en Traslados o en Equipos.
- Menos pantallas, campos y palabras.

## [0.19.0] - 2026-11-20

**Una sola pregunta por recurso, en la unidad de cobro (correcciones del dueño a la 0.18.0).** Cada recurso propio asignado dice sus horas para esta cotización y su costo es esas horas × su valor hora. Sin cambio de esquema; dato nuevo opcional `assignedHoursPerUnit` en las líneas de personal y de equipos. Ninguna cotización guardada cambia de números. Reglas: docs/CALCULATION_RULES.md §36.1 y §36.2.

### Agregado

- **Horas en la unidad de cobro** (`assignedHoursPerUnit`): cobrando por una unidad contable (válvula, pozo, pieza, viaje, unidad propia…) la cotización pregunta "horas por válvula"; cobrando por trabajo o por llamado, las horas en el trabajo. El motor las lleva a horas por día con el rendimiento cargado (unidades por día, o días del trabajo). Cobrando por día, por hora o por una unidad de medida (km, m³, kg…) se siguen pidiendo por día; por mes, por mes. Al cambiar la unidad de cobro esas horas se limpian, con aviso.
- **Aviso de horas de más**: si las horas de un recurso superan el día de trabajo, la línea lo dice (antes se recortaban en silencio y el costo quedaba de menos).
- Tarjeta del equipo propio: "Por mes" y "Valor hora" (tenerlo + usarlo por hora; en un vehículo que sólo viaja, sólo tenerlo: su uso va por km).

### Cambiado

- **Personal**: el campo se llama "Horas efectivas de trabajo" (las de ese puesto para esta cotización).
- **Equipos propios**: una sola pregunta, "Horas asignado a esta cotización". Su costo = esas horas × el valor hora completo. Las horas con el motor andando quedan como dato opcional en "Cambiar sus datos…" (vacío = todas las asignadas) y un equipo agregado desde Recursos ya no las trae precargadas con las horas del día (así las horas asignadas mandan). Los vehículos siguen llegando con 0 h en la locación.
- Las cuentas de cada línea y el total de Equipos se dicen en la unidad cuando se cobra por unidad contable ("0,5 h por válvula × $ … la hora = $ … por válvula").
- El aviso de "Cobertura de todo el día" lleva al campo de horas cuando el puesto es de una persona.

### Eliminado

- "Cantidad" en personal y en equipos propios: un recurso asignado es ese recurso; si van dos, se asigna dos veces. Una línea que ya tenía otra cantidad la sigue mostrando. En alquilados y tercerizados sigue.

### Pendiente (análisis de costos 2026-11-20, para la versión siguiente)

- Horas de viaje del equipo y del chofer dentro de la movilización; valor hora del equipo con un divisor propio del recurso (hoy, sin horas del mes cargadas, depende de la jornada de la cotización); resumen y resultado por unidad primero; la misma pregunta para alquilados, tercerizados y personal tercerizado; materiales y otros gastos "por unidad" por defecto; horas sin absorber por recurso.

## [0.18.0] - 2026-11-20

**Cada recurso asignado dice sus horas en el trabajo (pedido del dueño).** Un recurso asignado es ese recurso: ya no se pregunta "¿cuántas personas van?". Se paga por mes, así que la cotización pide cuántas horas lo usa: con ellas y el valor de su hora (costo del mes ÷ horas del mes) sale su costo. Sin cambio de esquema. Ninguna cotización guardada cambia de números. Reglas: docs/CALCULATION_RULES.md §36.

### Cambiado

- **Personal en la cotización**: primero "Horas por día en este trabajo" (antes "Horas por día de cada una en esto"); vacío = todo el día de trabajo. La cantidad ya viene en 1 ("Cantidad", antes "¿Cuántas personas de «Chofer» van?") y sólo se cambia si van varias personas con el mismo sueldo.
- **Equipos propios en la cotización (por trabajo, hora, día o unidad)**: campo nuevo "Horas por día en este trabajo" (`assignedHoursPerDay`). Con el dato, tenerlo (amortización, seguro, patente) se cobra por esas horas; antes se cobraba siempre el día de trabajo entero aunque se usara 2 h. Vacío = el día de trabajo entero, como antes. Las horas con el equipo andando (combustible, mantenimiento) sin dato pasan a ser esas mismas horas; el campo queda en "Cambiar sus datos…".
- **Cobro por mes**: personal y equipos propios piden "Horas por mes en este servicio" (`assignedHoursPerMonth`) en vez de "todo su mes / una parte con %". Vacío = todo el mes; con menos horas se guarda el % = horas ÷ horas del mes del recurso (`fixedCostSharePct`, la regla de siempre). Un % cargado a mano antes se sigue viendo como estaba.

## [0.17.0] - 2026-11-19

**Menos texto y el precio primero (comparación con cotizadores del mercado, ver docs/informes/2026-11-mercado.md).** Sin cambio de esquema ni de fórmulas: ninguna cotización cambia de números.

### Cambiado

- Cada paso de la cotización abre con la pregunta y, como mucho, una línea corta; sin antetítulo "Etapa N de 6" ni "Término técnico".
- Tarjetas de elección: explicaciones de pocas palabras.
- Resumen en vivo: el precio primero y más grande; debajo costo, mínimo y para no perder.
- Proveedor tercerizado: sólo se listan los datos que faltan.
- Textos más cortos en Personal, Equipos, Movilización y viajes, Cómo se cobra, Impuestos, Imprevistos, Gastos de estructura y Resultado.

## [0.16.0] - 2026-11-19

**Asignar personal, sin plantillas para partir y formulario de recurso con aire (observaciones del dueño sobre 0.15.0).** Sin cambio de esquema ni de fórmulas: ninguna cotización guardada cambia de números.

### Cambiado

- **Asignación de personal en la cotización**: cada puesto de Recursos muestra juntos "¿Cuántas personas de «Chofer» van?" (con el mismo sueldo; 2 = el doble de costo) y "¿Cuánto de su tiempo usa esta cotización?": por trabajo, hora o día, las horas por día que trabaja en esto (`coverageHoursPerDay`, ya usado por el costo por tiempo usado); por mes, todo su mes o una parte con su % (`assignment` / `fixedCostSharePct`, la regla de siempre). Antes estaban escondidos en "Más detalle". El selector pasa a "Asignar personal de tus Recursos".
- La cuenta del costo del puesto con una parte del mes muestra el % dentro de la cuenta (2 personas × $ … × 50 % de su mes).
- Por tiempo usado ya no aparece "Horas del día sin cubrir" cuando una persona trabaja menos horas que el servicio: son las horas que dedica a esta cotización.
- **Formulario de recurso** (Nuevo puesto y el resto de Recursos): más ancho en PC, sin cajas dentro de cajas, y a pantalla completa en el celular.

### Eliminado

- "Partir de una plantilla (opcional)" en el paso 1 de la cotización. Las plantillas propias (Servicios) siguen.

## [0.15.0] - 2026-11-19

**Carga más simple (observaciones del dueño sobre 0.14.0).** Sin cambio de esquema: `contractedStaff` es opcional y, ausente, ningún número cambia.

### Agregado

- **Personal tercerizado** en el paso Personal de la cotización: qué hace, cuántas personas, cuánto se le paga y cada cuánto (por hora, por día o por mes). Campo `quote.contractedStaff[]` y motor `js/engines/contracted-staff-engine.js`: va al rubro Mano de obra, sin cargas sociales, y se paga como proveedor. Completitud: pide el valor y, por hora, las horas. Detalle en [docs/CALCULATION_RULES.md §35](docs/CALCULATION_RULES.md#35-personal-tercerizado-y-salidas-que-sólo-se-preguntan-si-se-pagan-0150-2026-11-19).
- **Convenio al crear un puesto**: "Nuevo puesto" ofrece los convenios propios y los del catálogo que todavía no se cargaron; al guardar con uno del catálogo se crea en Convenios con porcentajes de ejemplo (ILUSTRATIVOS) para revisar.
- "Crear un puesto nuevo" desde la cotización abre el mismo formulario de Recursos (sueldo completo), lo guarda en Recursos y lo suma al servicio.

### Cambiado

- **Unidad de cobro: un solo desplegable.** Se quitan las tarjetas "Por mes / Por trabajo / Por hora / Por día / Por unidad / Otra unidad…". El buscador lista primero $/mes, $/día, $/hora y $/trabajo, después el resto, y al final "$/ otro…": lo que se tipea y no está en la lista se usa como unidad propia.
- **Tarjeta de insumo por pasos**: ¿Qué es? → ¿Cuánto usás? (cantidad, unidad, cada cuánto se consume) → ¿Cuánto te cuesta?. "Producción por día" y "% que lo usan" sólo aparecen cuando hacen falta (si no, en "Más detalle"). El resultado se llama "Te cuesta" y se muestra en la unidad en que se consume (por ejemplo, por diagnóstico) en vez de "$ 0 por mes".
- **Salidas**: "días por salida / salidas por día / salidas por mes" sólo se preguntan si algo se paga por salida (traslado, insumo o costo por salida, mínimo o cargo por salida, o se cobra por llamado, trabajo, viaje o km). Lo que se llamaba "intervención" pasa a llamarse "salida". Sólo presentación: el motor no cambia.
- Actualizar tarifa: el % de Mano de obra propuesto por los convenios avisa qué parte del personal cubre cuando hay personal tercerizado. El aviso de jornales cuenta a los tercerizados por día o por hora.
- Recursos: "Por intervención (llamado o salida)" pasa a "Por salida (o llamado)".

### Eliminado

- "Cargar uno que no está en Recursos" en el paso Personal: el personal propio se carga en Recursos. Las líneas ya cargadas así siguen funcionando.

## [0.14.0] - 2026-11-18

**Costo financiero del IVA (K-03, auditoría externa).** Sin cambio de esquema: los campos nuevos son opcionales y, ausentes, sin decidir o incompletos, ningún número cambia.

### Agregado

- **¿Facturás con IVA?** En el paso Financiación: Sí / No y, con Sí, "IVA que facturás" y "Días entre que facturás y pagás el IVA" (con "Usar los de mi empresa"). Campo `quote.finance.vat = { applies, ratePct, payLagDays }`. Con monotributo o exento no se pregunta y nunca aplica.
- Valores de la empresa en Configuración → Parámetros económicos, junto a "Tu condición frente al IVA": `settings.defaultVat = { ratePct, payLagDays }`, sin valores precargados (RATEOS no trae alícuotas ni fechas de vencimiento). Cada cotización nueva los copia; arranca en "Sí" sólo si están los dos y la empresa es responsable inscripta.
- **Costo financiero del IVA** en el precio: `t_iva = IVA × tasa mensual × max(0, plazo de cobro − días hasta pagar el IVA) / 30` (puntos del precio), en el mismo divisor que el margen y los impuestos: `precio = costo / (1 − m − t − t_iva)`. Tarifa mínima y objetivo, resultado, margen, equilibrio, tramos, adicionales, escalera de márgenes, escenarios y comparador de modelos lo usan igual. Detalle en [docs/CALCULATION_RULES.md §34](docs/CALCULATION_RULES.md#34-costo-financiero-del-iva-k-03-0140-2026-11-18).
- **Alivio por crédito fiscal** (criterio conservador): sólo el IVA recuperable que se conoce de los alquilados y tercerizados × tasa × días / 30 se resta del costo financiero (nunca lo deja negativo), con tope en el IVA que se factura (IVA % × costo antes del alivio; el resto es saldo a favor; con IVA 0 % no hay alivio). Lo demás cuenta como crédito 0.
- Composición del precio: fila y grupo **Costo financiero del IVA** (sólo si hay) y control "Facturación = costo + impuestos + costo financiero del IVA + resultado". "Ver cálculo" del costo financiero con la fórmula, los números y la nota "El IVA no es costo ni ganancia: sólo cuesta financiarlo".
- Completitud: "¿Facturás con IVA?" sin decidir con plazo de cobro → amarillo sin restar puntaje; Sí con un dato faltante → amarillo. Validación `vatRate` (0 a < 100 %) y días 0–720; margen + impuestos + costo financiero del IVA < 100 %.
- Golden cases `iva-costo-financiero-gross-up` (IVA 21 %, cobro a 60, IVA a 20, tasa 3 % → 0,84 puntos; tarifa objetivo 5.000.000 → 5.053.057,10) e `iva-costo-financiero-credito-externo` (alquiler con IVA recuperable: financiero 726.000 → 642.000; tarifa objetivo 6.340.750 → 6.397.422,94).

### Cambiado

- Sólo con "Sí" y los dos datos cambian las tarifas y el resultado (y, con externos con IVA recuperable, el costo financiero). Lo que se muestra como "impuestos" sigue siendo sólo los impuestos sobre la facturación.

## [0.13.0] - 2026-11-18

**Inflación con precio fijo (K-01, auditoría externa).** Sin cambio de esquema: el campo nuevo es opcional y, ausente o sin decidir, ningún número cambia.

### Agregado

- **¿El precio se ajusta durante el contrato?** En el paso del precio, sólo fuera de precio cerrado y con más de un mes de contrato: "Sí, con una cláusula de ajuste" (se usa Actualizar tarifa) o "No, queda fijo todo el contrato" con un solo número, la inflación mensual que esperás (0 a 30 %; RATEOS no propone ninguno). Campo `quote.priceAdjustment = { mode, expectedMonthlyInflationPct }`; las cotizaciones nuevas empiezan sin decidir.
- Renglón nuevo de la estructura de costos **Inflación esperada (precio fijo)**: `(f − 1) ×` todo el resto, con `f = ((1 + π)^n − 1) / (n × π)` (costo promedio del contrato ÷ costo de hoy). Tarifa mínima, sugerida, equilibrio, escenarios y composición del precio lo incluyen. "Ver cálculo" muestra f, el costo del último mes y el margen del primer y del último mes. Detalle en [docs/CALCULATION_RULES.md §33](docs/CALCULATION_RULES.md#33-inflación-esperada-con-precio-fijo-k-01-0130-2026-11-18).
- Completitud: ítem "Ajuste del precio" (sin decidir: amarillo sin restar puntaje; precio fijo sin % o con f > 2: amarillo), aviso de precio fijo con actualizaciones de tarifa y aviso de **doble conteo** si la contingencia ya tiene % por inflación o variación de precios. Validación `inflationPct` (0–30 %).
- Golden case `inflacion-precio-fijo-12-meses-3`: 3 % mensual, 12 meses → f = 1,182669; costo 40.000.000 → 47.306.765,21; tarifa objetivo 5.000.000 → 5.913.345,65 por día.

### Cambiado

- Sólo con precio fijo y el % cargado cambian costo, tarifas y márgenes (ver el golden). En "Actualizar tarifa" la inflación acompaña sola, como financiero e imprevistos.

## [0.12.4] - 2026-11-18

**Auditoría externa, segunda tanda (2026-11-18, pedido del dueño: carga simple y guiada, el cálculo por dentro).** Sin cambio de esquema. Con los campos nuevos vacíos ningún monto cambia.

### Agregado

- **Otras cargas y provisiones del convenio (K-09):** % sobre el remunerativo (fondo de cese laboral, provisión por despido, ausentismo, licencias…), vacío por defecto, sin aguinaldo ni cargas encima. Se carga una vez en el convenio y lo toman sus puestos; en "Actualizar tarifa" se mueve con el aumento del remunerativo.
- **¿Cómo calculo el impuesto al cheque? (K-10):** con la alícuota del banco y el IVA con el que facturás da el % sobre lo facturado sin IVA (alícuota × (1 + IVA)) y, en el detalle, "Usar este %".
- **Tu condición frente al IVA (K-05)** en Configuración → Parámetros económicos: con monotributo o exento, los precios de compra (materiales e ingredientes) se piden con IVA y el IVA de venta del producto queda vacío. No cambia fórmulas.
- **Deshacer al borrar (B-02)** una cotización o un producto: el aviso queda 15 s (se pausa con el mouse o el foco encima).

### Corregido

- Al aplicar un convenio en una cotización o un producto también se copian sus contribuciones fijas, cargas sobre el no remunerativo, otras cargas y aportes del trabajador.

## [0.12.3] - 2026-11-18

**Correcciones de la auditoría externa (2026-11-18, pedido del dueño).** Sólo errores reales y sin cambios de estructura; ningún monto calculado cambia salvo el de una cantidad escrita como "0.250". Veredicto por observación en `auditoria-externa/VEREDICTO.md` (archivos del proyecto).

### Corregido

- **A-01:** una cantidad escrita con punto y cero adelante ("0.250", "0.500") se tomaba como miles (250, 500). Ahora es 0,25 / 0,5. "1.250" sigue siendo 1250.
- **A-02:** al salir de un campo numérico se muestra el número que se usa en el cálculo (el mismo formato con el que el campo se abre).
- **A-03:** aviso en Productos cuando un mismo gasto fijo o máquina suma más de 100 % entre productos (se cobraría más de una vez). Sólo avisa.
- **A-04:** aviso cuando la contingencia (general + riesgos elegidos) suma 100 % o más; cada % se valida entre 0 y 100.
- **A-05:** un descuento del 100 % (comercial, continuidad o por volumen) es error con explicación, en vez de una tarifa "—".
- **A-06:** aviso en el producto con un IVA de 100 % o más (antes se ignoraba sin decir nada).
- **B-01:** al ingresar, si la red no responde en 12 s se avisa que está tardando y qué hacer.
- **F-01:** la página no encontrada sin sesión se muestra con la marca, un título y enlaces que funcionan sin cuenta.
- **K-02:** la ayuda del costo de capital aclara que es una tasa real (sin inflación), porque el equipo ya se valúa a reposición.
- **D-01 (documentación):** README y AGENTS.md reflejan el registro libre decidido el 2026-11-16.

## [0.12.2] - 2026-11-18

**La demo con la regla de un ítem.** La cotización demo COT-0001 pasa al modelo actual: un solo precio por día, horas extra dentro del costo del personal y contrato con la unidad primero. Sin cambio de fórmulas ni de esquema. Las cotizaciones guardadas de cada empresa no cambian.

### Cambiado

- **Demo COT-0001 "Hidrogrúa por día — Añelo"** (antes "Hidrogrúa on-call — Añelo"):
  - las 4 h extra por día que estaban en el puesto pasan a "Horas extra del trabajo": algunas horas, 4 h al 50 % por llamado de 2 días, **además** de las 10 h de cada día de trabajo. El motor cobra en esas horas el uso de la hidrogrúa y la pickup; con 4 h por llamado (y no 8) se cuida no contar dos veces los equipos que ya trabajan las 10 h. Lo dicen las notas de la cotización y la demo guiada ("Horas extra" en el paso 1);
  - sin guardia (`availability: 'none'`): no cobraba nada, pero mostraba la tarjeta "Guardia (cargada antes)" de las cotizaciones viejas;
  - sin mínimo por llamado (1 día, que no cambiaba nada con llamados de 2 días) y sin tramos con descuento (3 / 5 / 8 %): 0.10.0 ya no los ofrece en cotizaciones nuevas;
  - contrato guardado: el modo sale de la unidad (`modeForUnit('day')`, por servicio prestado) y las categorías de gasto son Personal, Vehículos, Equipos y maquinaria, Herramientas, Insumos y Materiales; cada material tiene su `component`;
  - el caso de referencia COT-0002 queda sin contrato, como antes.
- **Números de la demo** (ILUSTRATIVOS, 8 días por mes):

  | | Antes | Ahora |
  |---|---:|---:|
  | Costo del mes | 15.776.498 | 16.380.305 (+3,8 %) |
  | Tarifa piso | 2.033.054 | 2.047.539 por día |
  | Tarifa sugerida | 2.259.000 | 2.276.000 por día (+0,8 %) |
  | Break-even | 6,4 días | 6,7 días |

  - Sacar los tramos baja la sugerida a 2.192.000, porque ya no se sube la de lista para cubrir el 3 % del tramo de 8 días.
  - Las horas extra del modelo nuevo suman 1.190.087 por mes (16 h), contra 716.870 de las horas extra del puesto (32 h):
    - personal 438.087, con la hora al 50 % de básico más adicionales (27.380 contra 22.402 de antes, que tomaba sólo el básico);
    - 752.000 de uso de la hidrogrúa y la pickup en esas 16 h (47.000 por hora).
  - Sobre eso se suman estructura, financiación e imprevistos.
- **Plantilla demo "Hidrogrúa por día"** (antes "Hidrogrúa on-call"): copia las horas extra del trabajo. Una cotización nueva desde la plantilla cuesta lo mismo que la demo: 16.380.305 contra 14.861.801.
- **Demo guiada (`#/demo`):** "Está disponible todo el mes, pero sólo cobrás los días que te llaman", sin "on-call". Los nombres cambian también en la landing ("hidrogrúa por día en Añelo", "Servicio por día"), el análisis, configuración, inicio y docs.
- **Test Lab:**
  - el oráculo independiente calcula "algunas horas" de horas extra del trabajo (§28);
  - INV-31 cuenta esas horas como cobertura;
  - el baseline de regresión se regeneró para los 9 casos que salen de la demo; las variantes por hora y por mes derivan el modo de la unidad.

## [0.12.1] - 2026-11-18

### Agregado

- "Actualizar tarifa": el % de **Mano de obra** se propone solo con los aumentos de los convenios de los puestos de la cotización entre los dos meses (remunerativo y no remunerativo ponderados por su peso en cada puesto). Se puede corregir; dice de dónde sale, qué parte del costo cubre y el último aumento cargado. Detalle en [docs/CALCULATION_RULES.md §31](docs/CALCULATION_RULES.md).

## [0.12.0] - 2026-11-18

**Personal por convenio (2026-11-18, pedido del dueño).** El sueldo de cada puesto se carga como en el recibo (remunerativo, no remunerativo y aportes del trabajador), las cargas sociales salen del convenio y cada paritaria se aplica con "Aplicar aumento" a todos los puestos del convenio, con historial. Los puestos ya cargados y las cotizaciones guardadas no cambian de números. Sin cambio de versión de esquema. Detalle en [docs/CALCULATION_RULES.md §32](docs/CALCULATION_RULES.md).

### Agregado

- Puesto (Recursos → Personal): **No remunerativo** por mes (`nonRemunerativeMonthly`, sin cargas) y **Aportes del trabajador** (`workerContributionsPct`, sólo para mostrar el neto). Debajo del sueldo: Bruto, Neto, Costo empleador del mes (para comparar con el recibo) y Te cuesta por mes.
- Convenio: **Contribuciones fijas por persona** (`params.fixedContributionsMonthly`, ej. contribución extraordinaria petrolera; costo sin cargas), **Cargas sobre el no remunerativo** (`params.nonRemunerativeChargesPct`, 0 por defecto) y aportes del trabajador.
- **Aplicar aumento** por convenio: % sobre el remunerativo y sobre el no remunerativo (vacío = el mismo), desde un mes y con nota, con vista previa por puesto. Queda en `agreement.raises` con los valores anteriores de cada puesto; **Ver historial** y **Deshacer** el último aumento (con confirmación).
- `js/domain/agreement-raises.js`: `applyAgreementRaise`, `undoLastAgreementRaise`, `profilesToPropagate`, `agreementRaiseFactor(agreement, desde, hasta)` (aumento acumulado entre dos meses, para que "Actualizar tarifa" proponga el % de mano de obra).
- Lista de convenios con número de CCT: Petroleros Privados (644/12 y Chubut / Santa Cruz), Petroleros Jerárquicos (637/11), UOCRA Yacimientos (545/08), UOCRA Construcción (76/75), Camioneros (40/89), UOM (260/75), Comercio (130/75), Gastronómicos (389/04), Seguridad privada (507/07). Sin valores: los porcentajes los carga cada empresa.

### Cambiado

- Convenios vuelve a **Recursos** (segunda pestaña); `#/configuracion/convenios` redirige a `#/recursos/convenios`.
- Un puesto **sigue a su convenio**: si se cambian las cargas del convenio, se actualiza en cada puesto cada valor que era igual al anterior (clave por clave); los que tienen valores propios no se tocan ("Volver a los valores del convenio"). Al elegir otro convenio en un puesto, toma sus valores.
- "Otros pagos fijos" y la vianda por día salen del bloque principal del sueldo (la vianda pasa a "Más detalle"; "Otros pagos remunerativos" se ve sólo si ya estaba cargado).

## [0.11.0] - 2026-11-18

**Actualizar tarifa por estructura de costos (2026-11-18, pedido del dueño).** Detalle en [docs/CALCULATION_RULES.md §31](docs/CALCULATION_RULES.md). Sin cambio de fórmulas de costo ni de versión de esquema; las cotizaciones no cambian sus números.

### Agregado

- Cotizaciones → vista **"Tarifas"**: ítem, unidad, valor vigente, período de la tarifa y botón **"Actualizar tarifa"** (también en "Más opciones").
- Cuadro "Actualizar tarifa": período base, mes destino, % de aumento por categoría de la EECC con su incidencia y aporte, aumento ponderado ("60 % × 2 % + 40 % × 5 % = 3,2 %") y tarifa nueva; historial y "Deshacer la última".
- `quote.rateUpdate` (opcional) con el período base, la foto de la base (tarifa y montos por categoría al actualizar por primera vez), los pasos y los historiales archivados; motor `rate-update-engine.js` (índices encadenados por categoría). Si la cotización cambió después, aviso y "Tomar la cotización actual como nueva base".

### Cambiado

- La tarifa de los listados e Inicio muestra la vigente ("act. nov-26") cuando la cotización se actualizó.

## [0.10.0] - 2026-11-18

**La unidad primero (2026-11-18, pedido del dueño).** Lo primero que se elige al cotizar es en qué unidad se le cobra al cliente; de ahí salen las preguntas y las etapas. Las categorías de gasto que se marcan en "¿Qué incluye el servicio?" son las secciones del paso Materiales y los renglones de la estructura de costos. Sin cambio de fórmulas, de totales ni de versión de esquema. Detalle en [docs/CALCULATION_RULES.md §30](docs/CALCULATION_RULES.md).

### Agregado

- **"¿En qué unidad le cobrás al cliente?"** en el paso "Contrato": Por mes, Por trabajo, Por hora, Por día, Por unidad (con su nombre: "¿Cómo se llama tu unidad?") y "Otra unidad…" (buscador con viaje, m³, km, hora-hombre…). Debajo: "Vas a cotizar: $ por diagnóstico" (o "tarifa por mes", "precio del trabajo").
- `modeForUnit` (`js/domain/contract.js`): el modo del contrato se deriva de la unidad (`month` → por mes, `job`/`milestone` → por trabajo, otra → por unidad trabajada).
- Campo opcional `component` en cada material y otro costo (herramientas, insumos, materiales, EPP, otros) y desglose `children` del renglón Materiales de la EECC (`costStructure`); `byComponent` en `computeMaterials` y `componentCostAt` en el motor.
- Paso Materiales: una sección por categoría elegida, con sus líneas, su "Agregar" (también desde Recursos) y su subtotal. Cada material puede cambiar de categoría ("Categoría", en "Más detalle").

### Cambiado

- "¿Cómo te paga el cliente?" (Fijo mensual / Por servicio prestado (on call) / Precio cerrado) ya no se muestra: la unidad lo define. Los listados dicen "Por hora · personal + vehículos" en vez de "Por servicio (on call) · …".
- "Cómo se cobra" ya no tiene el selector de unidad: "Cobrás por hora. Se cambia en «Contrato»". Por hora o por día los textos hablan de tu precio por hora / por día y los días del mes quedan como estimación (con costo por tiempo usado y sin fijos del mes, "Sólo se usa para estimar la facturación del mes; no cambia tu precio por hora").
- Plantillas: ayuda opcional plegada al final ("Partir de una plantilla (opcional)"); sugieren sólo la unidad.
- Categorías de gasto: 10, sin redundancias. "Químicos" pasa a "Insumos y consumibles" y "Residuos y disposición" a "Otros costos" (al leer un contrato guardado se traducen solos).
- Resultado: la estructura de costos y "¿En qué se va el costo?" muestran Materiales desglosado por categoría y no muestran renglones en $ 0 de categorías no elegidas. Rótulos: Personal, Equipos y vehículos, Servicios de terceros, Viáticos y traslados, Imprevistos.
- Mínimo mensual garantizado, mínimo por llamado y descuentos por cantidad de días: sólo se muestran si la cotización ya los tiene cargados (los motores no cambian).
- Textos: "cobrando por trabajo" en vez de "precio cerrado" en Imprevistos, Financiación y el aviso de costos fijos.
- **Cotizaciones guardadas sin contrato:** cambiar la unidad (o lo que incluye el servicio) ahora crea el contrato y DERIVA el modo de la unidad nueva. Un precio cerrado que pasa a hora, día o mes deja de calcular como precio cerrado (desde ahí calcula como "por servicio" o "por mes"); abrirla sin tocar la unidad no cambia nada.

### Corregido (revisión de costos y UX, sin cambio de montos)

- **Aviso de unidad falso (C1):** con sólo Personal y unidad viaje, km, kg, litro… ya no sale "Esta cotización quedó guardada para cobrar en…". Sólo se avisa si el modo guardado no es el de la unidad (`modeForUnit`); `unitFitsContract` acepta "por servicio" con cualquier unidad que no sea mes, trabajo ni hito.
- **Modo guardado incoherente (C2):** elegir de nuevo la misma unidad sólo deriva el modo (no borra cantidades ni tarifas) y tocar "¿Qué incluye?" guarda el modo de la unidad. No se corrige solo al abrir: cambiaría el precio de una cotización guardada sin que nadie lo pida.
- **Subtotales de Materiales (C3):** cada sección muestra lo que suma en el renglón Materiales (igual que el Resultado) y, aparte, "Además $ X van a «Servicios de terceros»". El motor lo da en `computeQuote(...).componentCosts` (`componentCostSplitAt`), con lo del trabajo y el equivalente por unidad cobrada.
- **Adicional con categoría Materiales (C4):** en el desglose cae en "Otros costos" (no en "Materiales"). Sólo cambia el hijo; el renglón y los totales no.
- **Aviso de costos fijos con varios trabajos por mes (C5):** "2 trabajos de 3 días (6 días de trabajo en el mes)" en vez de "Un trabajo de 6 días".
- **Cobros de guardia al cobrar por mes o por trabajo (C6):** al cambiar a una unidad cuyo modo deja de ser "por servicio" se borran, con aviso, el fijo por estar de guardia, el plus por llamado y el mínimo mensual garantizado en $ (ya no se mostraban y seguían pesando en el precio).
- **"Llamado" (U2):** en cotizaciones armadas por componentes sólo se habla de "llamado" si se cobra por llamado; si no, "intervención" (el tipo de servicio no cambia, sólo el nombre).
- **De cantidad a hora o día (U6):** quedan los días de trabajo que ya salían de la cantidad ("Quedaron 20 días de trabajo por mes; revisalo en «Cómo se cobra»").
- **Pantallas:** una categoría con gastos cargados no se desmarca ("EPP tiene 1 gasto cargado…: borralo en «Materiales»…", U1); "Personal" y "Equipos" se saltean si no se eligieron y no tienen nada cargado (U4); EECC sin "Servicios de terceros" ni "Combustible" en $ 0 si no corresponden y el renglón de equipos se llama "Vehículos", "Equipos y maquinaria" o "Equipos y vehículos" según lo elegido (U7); "¿Cada cuánto se consume?" ofrece primero "Por diagnóstico" (o "Por trabajo") y no ofrece "Por llamado" si no se cobra por llamado (U3); sin "Otro componente [Agregar]" (U8); ayuda del paso 1 en la unidad (U9); textos de "Cómo se cobra", "tarifa del mes", "Unidad de cobro definida", "precio/del trabajo" cobrando por un trabajo y resumen de Materiales con las categorías elegidas (U5, U10–U12).

## [0.9.0] - 2026-11-18

**Costo por tiempo usado (2026-11-18, pedido del dueño).** En una cotización NUEVA que no se cobra por mes, el personal y los equipos propios cuestan las horas que les lleva el trabajo por el valor de su hora, y ya no se pregunta "qué % de su costo fijo asignás a esta cotización" ni "¿trabajan sólo para este servicio?". Las cotizaciones guardadas no cambian ningún número (no tienen `costBasis`); cobrando por mes rige el método de siempre. Sin cambio de versión de esquema. Detalle en [docs/CALCULATION_RULES.md §29](docs/CALCULATION_RULES.md).

### Agregado

- **`quote.costBasis = 'time'`** en las cotizaciones que crea la persona (en blanco o desde plantilla). Valor de la hora = costo del mes ÷ horas facturables por mes; costo = horas del trabajo × valor de la hora (personal: por posición; equipos propios: las horas del día de trabajo).
- **Horas que vende por mes** (`billableHoursPerMonth`) en cada perfil de personal de Recursos, opcional: si la persona vende menos horas que las normales, cada hora cuesta más y el tiempo libre queda cubierto. Vacío = las horas normales. Los equipos propios usan las horas disponibles × la utilización esperada de su ficha.

### Cambiado

- **Trabajo puntual:** una instalación de 3 días ya no carga el mes entero del operario cuando no se contesta la dedicación (ej.: de 2.000.000 a 272.727 con un operario de 2.000.000 por mes y 176 h). Sólo en cotizaciones nuevas.
- Estructura "por empleado", horas extra de todo el trabajo y "Usado en" siguen a las horas del trabajo en esas cotizaciones.

**Regla de un ítem y unidad de cobro: correcciones de la auditoría (2026-11-18).** Cada cotización nueva da un solo ítem con un solo precio y habla en su unidad de cobro. Las cotizaciones guardadas conservan sus números, salvo dos correcciones de cálculo (abajo). Sin cambio de esquema. Detalle en [docs/CALCULATION_RULES.md §28.1–28.4](docs/CALCULATION_RULES.md).

### Corregido

- **Horas extra de todo el trabajo con más días que los disponibles (A1):** las horas que ya paga el sueldo crecen con los meses de sueldo (D ÷ disponibles); antes se cobraban como hora extra completa. Bajan costo y precio sugerido de las cotizaciones con `overtimeWork.mode = 'all'` y más días que los disponibles (ej.: 45 días de 8 h, 1 persona: horas extra de 5.460.000 a 4.140.000 de costo directo).
- **Equilibrio con horas extra de todo el trabajo (M1):** equilibrio, días para el margen objetivo, tramos y matriz recalculan esas horas con cada cantidad de días (recargo hasta las horas pagas, completa después). Cambian esos indicadores en cotizaciones con `mode = 'all'`; no el precio ni el costo estimados.
- **Cambio de modalidad (M8):** las horas de "algunas horas" (por mes ↔ por trabajo) se limpian con aviso.
- **Costo del puesto (M2):** las horas extra del trabajo se suman al "Costo de este puesto", a su "Ver cálculo" y a la explicación del total de Personal.
- **Aviso "Horas del personal" (M4):** no aparece con "todo el trabajo", cuenta las horas de "algunas horas" y manda a "Horas extra del trabajo" (cambia el % de completitud de esas cotizaciones, no los montos).
- **Segunda tanda (verificación y UX, 2026-11-18; sin cambios de montos):** cambiar la unidad en "Cómo se cobra" también limpia las "algunas horas" con aviso en cotizaciones sin contrato (N2); la explicación del costo del puesto y del total de Personal en precio cerrado cierra con el total ("× 1,5 = … (1,5 meses de sueldo) + horas extra = …", N1); con "todo el trabajo" vuelve el aviso de horas si una persona tendría que trabajar más de 16 h por día (N5); un precio cerrado de UN trabajo más largo que el mes ya no se marca como error (sin alerta naranja ni "Revisá cómo cobrás"; nota informativa "El trabajo dura 1,5 meses…" y "Duración del trabajo" en lugar de la utilización), la alerta sigue con varios trabajos por mes que no entran (UX 1). Textos: análisis avanzado "del trabajo" en precio cerrado de un trabajo (N3), pista del campo viejo de horas extra del perfil (N4), "Te cuesta $ X en el trabajo", "≈ $ X por hora" sin cortes, "en el trabajo" sin cortar palabras, un solo desplegable "Opciones comerciales" y "Mínimo por llamado" escondido en 0 en cotizaciones viejas.

### Cambiado

- **Sin cobros aparte en cotizaciones nuevas (A2, A3, A5, A6, B5):** "Opciones comerciales" ya no ofrece fijo de guardia, plus, movilización, km adicional ni equipo en espera; Materiales no ofrece facturarlos aparte ni el markup de reventa; un puesto nuevo no hereda horas extra del perfil ni ofrece facturarlas aparte; el Resultado no propone modelos de dos partes (abono + tarifa, take-or-pay, paquete + excedente). Una cotización que ya los tenía los sigue mostrando "(cargado antes)" con **Quitar**.
- **Plantillas (A4, B4):** guardar como plantilla y crear desde una plantilla (también las guardadas antes) dejan afuera adicionales y cobros aparte; "Horas extra del trabajo" sí pasa. La plantilla demo "Hidrogrúa on-call" ya no trae horas extra en el puesto, guardia ni tramos con descuento; los perfiles demo no traen horas extra. La cotización demo COT-0001 no cambia.
- **Unidad de cobro (M3, M6, M7, B1, B2):** la tarjeta "Horas extra del trabajo", estructura, financiación, imprevistos y el Resultado hablan "en el trabajo" en precio cerrado; por hora, día o cantidad las cifras del mes llevan "≈ $ X por <unidad>". "Hora de sueldo con cargas". Sin "(sin contar horas extra)" si hay horas extra del trabajo.
- **Textos (M5, B7):** nada manda a "Adicionales" ni sugiere cobrar aparte; el adicional de guardia del personal va en "Otros pagos fijos por mes".

**Horas extra del trabajo dentro del precio único (#67, 2026-11-18).** "Cómo se cobra" pregunta si el trabajo lleva horas extra (No / Sí, todo el trabajo al 50 % o 100 % / Sí, algunas horas) y su costo se suma dentro del personal (`quote.overtimeWork`, `overtime-work-engine.js`, línea `labor:overtime-work`). Con "todo el trabajo", las horas que ya paga el sueldo llevan sólo el recargo y las que pasan, la hora completa. Las cotizaciones nuevas no ofrecen adicionales ni precio por hora fuera de horario ni guardia; el puesto no pide horas extra. Las cotizaciones guardadas conservan sus números (adicionales y guardia con Quitar). Ver [§28](docs/CALCULATION_RULES.md).

**Precio cerrado en el trabajo (#66, 2026-11-18).** En precio cerrado, el costo de cada puesto, Personal, Equipos, Materiales y Viajes, "Lo que ya cargaste", el resumen en vivo y el costo del Resultado se dicen "en el trabajo" (lo del mes ÷ trabajos por mes), no por mes; por servicio los totales de los pasos de recursos suman "≈ $ X por hora/día". Los atajos de horas se desmarcan al tipear. Sólo presentación: ningún número cambia.

**Cotización para novatos (2026-11-16).** Dos agentes "novato" cotizaron un semi on call, una instalación a precio cerrado y un fijo mensual; 49 hallazgos. Cambios de interfaz y textos, sin cambios de fórmulas: vehículos nuevos arrancan con 0 h de uso en la locación y piden primero el consumo en ruta (lo de "trabaja parado" queda plegado; las cotizaciones guardadas no cambian); la fecha base faltante, el equipo en espera sin días y los materiales no marcados dejan de ser pendientes (sube el % de completitud, no los montos); precio cerrado habla de "precio" y "del trabajo"; El precio muestra una sola cifra (la sugerida) y agrupa reglas y descuentos en "Opciones comerciales"; el Resultado deja 4 desplegables a la vista y el resto en "Análisis avanzado"; ILUSTRATIVO dice qué valor es de ejemplo; avisos repetidos de combustible y de viajes, avisos flotantes apilados y etiquetas redundantes eliminados; montos en tipografía normal; en celular "Reportar un problema" pasa al menú y el paso a paso dice el nombre de la etapa. 706 cotizaciones comparadas: montos idénticos.

**Registro libre (2026-11-16, decisión del dueño).** `FEATURES.publicSignup = true`: la landing y el ingreso vuelven a ofrecer "Crear cuenta" y `#/registro` muestra el formulario. Requiere en Supabase "Allow new users to sign up" encendido y un SMTP propio (con el SMTP por defecto el correo de confirmación sólo llega al equipo del proyecto). El error `email_address_not_authorized` ya no habla de invitaciones. Sin cambios de cálculo ni de esquema.

**PLAN-2026-026 — Recursos como dueños de los datos, cotización con cantidades y flujo más simple.** Las cotizaciones guardadas no cambian ningún número: los campos nuevos nacen vacíos y sin ellos el motor calcula igual que antes (golden, baseline de regresión y lab sin re-aprobar). Esquema sin cambio de versión. Detalle en [docs/CALCULATION_RULES.md §27](docs/CALCULATION_RULES.md).

### Agregado

- **Valor de la hora por recurso:** cada perfil de personal de Recursos muestra su hora normal, al 50 % y al 100 % (calculadas con su sueldo y cargas) y puede traer un valor propio para la hora al 50 % y al 100 % (`overtimeRate50`, `overtimeRate100`), porque cada convenio paga distinto. La tabla de Recursos suma las columnas "Hora al 50 %" y "Hora al 100 %".
- **Horas extra como cantidad:** en la cotización, cada puesto carga "Horas al 50 % por mes" y "Horas al 100 % por mes" de cada persona (`overtime50HoursPerMonth`, `overtime100HoursPerMonth`); el costo usa el valor de la hora de ESE puesto.
- **Fuera de horario, cada uno acumulado:** "Cómo se cobra" muestra lo que cuesta una hora normal, al 50 % y al 100 % de cada puesto y de toda la cuadrilla. Si algún puesto trae su valor propio, la hora de la cuadrilla es la suma de la de cada persona.
- **Resultado en una carilla:** tarifa, costo, ganancia en $ ("Ganás") y margen, con la tarifa mínima debajo. El análisis sigue en "Ver el detalle".

### Cambiado

- **Sin datos repetidos:** un puesto o un equipo que viene de Recursos ya no vuelve a pedir sueldo, cargas, valor, vida útil, seguro, consumo ni mantenimiento: la cotización pide sólo cantidad y horas. Esos datos quedan plegados en "Cambiar sus datos sólo en esta cotización (opcional)". Un puesto o equipo cargado en la cotización sí los pide, con * en lo necesario.
- **Recursos → perfil de personal:** secciones "Sueldo", "Cargas sociales", "Valor de la hora" y "Más detalle (opcional)". "Horas extra por día" ya no se pide en el perfil (es una cantidad de cada cotización; si un perfil anterior la tenía, se sigue viendo).
- **Cómo se cobra:** dividido en "Lo necesario" (unidad, cuánto esperás trabajar, si trabajan sólo para este servicio) y "Opcional" (fuera de horario, mínimo garantizado, adicionales). El tope de días del mes y "¿Cómo son los llamados?" pasan a "Más detalle (opcional)" cuando están en el caso común; ya no se muestra el % de utilización.
- **Lenguaje:** "día activo" → "día de trabajo"; "tarifa piso" → "tarifa mínima"; "Costos y condiciones" → "Otros gastos"; "Opciones avanzadas" → "Más detalle (opcional)"; "Profundizá" → "Ver el detalle"; preguntas de cada etapa reescritas.
- **El servicio:** "Base económica de la oferta" pasa a un bloque plegado "Fecha de la oferta y de los precios (opcional)".

### Eliminado

- **Pregunta de guardia / sin guardia** (pedido del dueño): las cotizaciones nuevas no la muestran. Las que ya tenían guardia cargada la conservan igual (mismos cobros) en "Guardia (cargada antes)", con un botón para quitarla.

**Revisión UX y de costos previa a publicar (correcciones del veredicto).** Ningún número cambia: sólo foco, textos, estilo y documentación.

### Corregido

- **Foco después de elegir la unidad (UX-B1):** el foco vuelve al buscador de "¿En qué unidad cobrás?" con la lista cerrada; Tab sigue al campo de cantidad (antes quedaba en la página y Tab volvía al principio de la etapa).

### Cambiado

- **Cómo se cobra:** el atajo de horas elegido se ve marcado (estilo y `aria-pressed`) y el rótulo pasa a "Atajos:"; "Plus por cada llamado" muestra la unidad `$/llamado`; con un precio a mano por debajo del costo ya no se suma el aviso "Queda más barata que tu hora normal"; "$ … por mes + $ … por día" no corta "por / día" en móvil; el aviso de cambio de unidad nombra también la cantidad por día ("los m³ por mes y por día") y la unidad de los insumos congelados ("40 hectáreas por día").
- **Personal y Equipos:** sin responder la dedicación, la ficha dice "Sin elegir: por ahora paga el 100 % (se elige en "Cómo se cobra")" en vez de darla por respondida; en móvil los dos botones de "Agregar" de Equipos tienen el mismo ancho.
- **Materiales:** cobrando por día u hora sin unidad propia, "Cantidad", la ayuda del % de uso y la fórmula dicen "unidad" (nunca "día/día"); la fórmula usa el plural ("40 hectáreas/día").
- **El precio:** el mínimo por llamado con hora o día dice "cada llamado factura 8 horas aunque se trabajen 6" (antes "suma unidades facturables"); la nota de los días en espera va en su propio párrafo.
- **Revisión de costos:** la ayuda del externo "Global" en precio cerrado dice que se reparte en "Trabajos que cubre el total" (vacío = 1); se corrigió el texto de qué cotizaciones cambian por V-02; CALCULATION_RULES documenta que la hora-hombre (V-34) cuenta a toda persona de la cuadrilla aunque esté compartida y que con «Cada trabajo se cuenta entero» el global también se redondea por trabajo; el oráculo del lab lee un contrato sin modo como el motor (on demand).
- **Resultado:** "Supone que además facturás $ … por mes de horas fuera de horario; si no ocurren, necesitás más días."; con la guardia cubriendo todo, "Tus tarifas" dice "La que acuerdes" en el horario normal y la tarifa piso muestra "—" como la sugerida; el plus por llamado muestra sólo el monto; la columna de nombres de "Tus tarifas" es más ancha; los enlaces "Ir a "…"" van todos entre comillas.

**Correcciones de la ronda de testeo 2026-11-15, tanda 3 (V-15 a V-33): limpieza y textos.** Ningún número cambia: costos, tarifas y facturación de las cotizaciones guardadas quedan iguales (golden y baseline de regresión sin re-aprobar). Sólo se mueve el puntaje de completitud de las cotizaciones que tenían el aviso "falta quién maneja" (V-22: sube). Esquema sin cambio de versión. Detalle en [docs/CALCULATION_RULES.md §26](docs/CALCULATION_RULES.md).

### Cambiado

- **Un solo nombre para los cargos de guardia (V-32):** "Fijo por mes por estar de guardia" y "Plus por cada llamado" (o salida, trabajo o intervención, según la cotización) en "Cómo se cobra", en las reglas comerciales de "El precio" y en el Resultado. Antes convivían "Guardia pasiva / activa", "Abono de disponibilidad" y "Cargo por llamado (call-out)". "Activa" y "pasiva" quedan sólo para el tipo de guardia.
- **"¿Quién maneja?" es opcional (V-22):** ya no genera aviso ni pendiente; ningún cálculo usa el conductor elegido.
- **La nota de la hora fuera de horario dice para qué sirve (V-26)** cuando se cobra por viaje, km, unidad, abono o precio cerrado: es el precio de cada hora fuera de horario además de lo cotizado, y si un viaje entero cae fuera de horario se cobra el viaje más el recargo por hora. El rótulo dice "Te cuesta por hora (gente)" si no hay equipos propios trabajando.
- **Horas fuera de horario estimadas (V-27):** se aclara que son además de las horas normales del mes; en el Resultado, el margen y el equilibrio dicen cuánto viene de esas horas.
- **Guardia que cubre todo (V-28):** si la guardia y los adicionales ya pagan el costo y el margen, el Resultado lo dice y muestra el margen del mes en vez de "aparece cuando haya costos y días activos cargados".
- **Equipo en espera (V-29):** con días cargados se avisa que bajan la tarifa principal; en precio cerrado la fila no aparece vacía.
- **"No usa combustible" en un vehículo que viaja (V-30):** ayuda nueva en la casilla, nota en "¿Cómo llega?" y aviso informativo (no resta puntaje) en Equipos y en el Resultado.
- Textos (V-31 y V-33): peajes de todos los viajes de la salida, capital de trabajo, % de dedicación contra las horas normales, "de 8 a 17 con una hora de almuerzo = 8 h", alquiler por día, total del contrato de un trabajo único, "Otros por año (RTO, GPS, habilitaciones)" y "Vacío = 100 %".

### Corregido

- La base que se muestra para el % de estructura sobre el costo directo no incluía a los proveedores (V-15; el motor sí los incluía: el número no cambia).
- "Lo que cuestan tus recursos" mostraba sólo la parte fija cuando había fija y variable (V-16).
- Con fuera de horario activo se seguían ofreciendo "Feriado o fin de semana" y "Llamado fuera de horario" como adicionales (V-17).
- La salida de caja de un alquiler mensual decía "$ 0 por día activo" (V-18).
- El buscador de unidades no encontraba m³ ni m² escribiendo "m3" o "m2" (V-19).
- El sello ILUSTRATIVO del combustible aparecía aunque nadie consumiera combustible (V-20).
- El material nuevo nacía sin proveedor y dejaba un pendiente (V-21): ahora nace con "Nosotros".
- Un alquilado con consumo por km pedía además "Consumo en ruta", que no se usaba (V-23).
- Al pasar a "Por servicio prestado" la unidad quedaba en $/hora en vez de $/día (V-24).
- Con la lista de recursos vacía se mostraba un selector vacío con su botón "Agregar" (V-25).

**Correcciones de la ronda de testeo 2026-11-15, tanda 2 (V-07 a V-10, V-12 a V-14, V-34 y V-38).** V-34 y V-38 (decisiones del dueño) cambian el precio sugerido de las horas fuera de horario; el resto no cambia precios. La tarifa principal y los costos no cambian en ninguna cotización (golden y baseline de regresión sin re-aprobar). Las reglas de completitud nuevas mueven el puntaje de algunas cotizaciones guardadas. Esquema sin cambio de versión. Detalle en [docs/CALCULATION_RULES.md §24 y §25](docs/CALCULATION_RULES.md).

### Cambiado

- **Hora-hombre: la hora fuera de horario parte de la tarifa (V-34; cambia números).** Cobrando por hora-hombre, la hora normal de referencia es `tarifa por HH × personas de la cuadrilla`, como cuando se cobra por hora (antes salía del costo de los recursos). **Cambian** las cotizaciones por hora-hombre con horas fuera de horario sugeridas: suben el precio de esas horas y, si tienen horas estimadas, la facturación del mes. Cuadrilla de 3 a $ 58.000 por HH: hora al 50 % de $ 192.834 a $ 227.858 y al 100 % de $ 246.692 a $ 281.717, igual que la misma cuadrilla cobrada por hora. La tarifa principal y los precios cargados a mano no cambian. En pantalla y en "Tus tarifas" esas horas dicen "por hora de toda la cuadrilla (3 personas)".
- **Las horas fuera de horario sugeridas se redondean como la tarifa (V-38; cambia números).** Hacia arriba, con el paso de redondeo de la cotización (acotado al 1 % del precio). Se redondea en el motor, así el precio que se ve en "Cómo se cobra", en "Tus tarifas", en el PDF y el que se usa para la facturación estimada es el mismo. **Cambia** la cifra publicada de las cotizaciones guardadas con horas fuera de horario sugeridas (menos de un paso por hora: $ 227.858 → $ 228.000) y, con horas estimadas, la facturación y el margen del mes suben en esa diferencia × horas. No cambian el costo, la tarifa principal ni los precios cargados a mano.
- **"Tus tarifas" lista todo lo que se cobra (V-12):** además de las horas fuera de horario y la guardia, el mínimo por llamado, el mínimo garantizado por mes y cada adicional con precio; aparece también cuando sólo hay mínimos o adicionales. El margen aclara cuánto viene del mínimo garantizado.

### Corregido

- **Insumos "por unidad producida" (V-07).** Avisos nuevos cuando el rendimiento está cargado dos veces con números distintos (en la línea y en "Cómo se cobra") y cuando, cobrando por día o por hora, la línea no dice qué se produce y cuenta 1 por día. El pendiente "Producción por día" lleva a "Cómo se cobra" si la línea sigue a la unidad de cobro, y el campo ya no dice "día/día".
- **El aviso "cada llamado hace menos de una unidad" recomendaba un valor que daba mal (V-08).** Ahora da los dos posibles: una sola ida para toda la cantidad del mes o una salida por unidad (6 trailers a 0,75 por día: 8 días por llamado o 1,33). "¿Cómo son los llamados?" pasa a la vista cuando salta el aviso.
- **Los avisos de adicionales aparecían en "El servicio" (V-09).** Ahora se ven en "Cómo se cobra", donde se corrigen; en el Resultado van en su propia lista ("Adicionales para revisar:") y la fila de la hora fuera de horario avisa si el precio a mano queda más barato que la hora normal.
- **Mínimo por llamado cobrando por km (V-13):** el texto dice qué factura cada llamado y cuántos llamados son la cantidad del mes, y el pendiente "Viajes y km de la ruta" compara la ruta con los km trabajados (la cotización ya no queda en borrador para siempre).
- **"Sin contar adicionales" podía dar más que la tarifa sugerida (V-14):** quitaba el ingreso de los adicionales pero dejaba su costo. Es un dato informativo; ninguna tarifa cambia.

### Agregado

- Completitud: `materials_output_mismatch` y `materials_output_unit` (V-07), y la regla de actividad pide los días que lleva cada llamado, trabajo o hito cuando están vacíos (V-10; se calculaba con 1 día sin aviso).

**Correcciones de la ronda de testeo 2026-11-15, tanda 1 (V-01 a V-06 y V-11).** Sólo V-02 cambia números de cotizaciones guardadas (estaban mal). Las reglas nuevas de completitud bajan el puntaje de algunas cotizaciones guardadas, nunca el precio. Esquema sin cambio de versión. Detalle en [docs/CALCULATION_RULES.md §25](docs/CALCULATION_RULES.md) y en la tabla de externos (§4).

### Corregido

- **Proveedor "Global" en precio cerrado (V-02; cambia números).** Un externo con tarifa "Global" en un trabajo a precio cerrado se dividía por los meses de contrato (12 al nacer la cotización): una grúa de $ 5.600.000 entraba como $ 466.667. Ahora es un monto **por toda la obra**: `neto por trabajo = precio × cantidad ÷ trabajos de la obra` (`quote.contractJobs`, vacío = 1). **Cambian** las cotizaciones de precio cerrado con un externo "Global": el monto ya no depende de los meses de contrato sino de "Trabajos que cubre el total" (vacío = 1). Con más de 1 mes de contrato el costo suele subir. Con 1 mes cambia si se hace más o menos de un trabajo por mes. En todos los casos el externo pasa de costo fijo del mes a costo por trabajo (corregido en la revisión de costos). Fuera de precio cerrado sigue dividiéndose por los meses de contrato. En pantalla: "Global (toda la obra)".
- **Cambiar la unidad de cobro ya no deja números en la unidad anterior (V-03).** Cantidad por mes, cantidad por día, capacidad por viaje, mínimo por llamado y mínimo garantizado en unidades se borran con aviso (el mínimo por llamado se sigue convirtiendo entre día y hora); los insumos "por unidad producida" quedan atados a la unidad anterior para que su costo no cambie. Una sola regla (`applyUnitChange`, `js/domain/unit-change.js`) para "Cómo se cobra" y para el cambio de modalidad.
- **"Horas de trabajo por día" a la vista con cualquier unidad (V-04).** Cobrando por cantidad o por evento el campo no aparecía y quedaba en 10. Ahora está en "Cómo se cobra" con atajos 8 / 9 / 10 / 12 h; en hora-hombre se deduce de las HH por día ÷ personas. Los avisos de horas del personal dicen dónde corregirlo.
- **Dedicación: "Sí" ya no aparece elegido sin que nadie lo elija (V-01).** Una cotización sin respuesta muestra la pregunta sin marcar y avisa cuánto paga el servicio mientras tanto; elegir "Sí" guarda la respuesta en todas las líneas. El aviso de costos fijos lleva a esa pregunta y no sale cuando el servicio ya ocupa el mes entero.
- **El desplegable de unidad no se reabre después de elegir** (un clic en el campo siguiente cambiaba la unidad) y la etiqueta de unidad del encabezado se actualiza (V-05).

### Agregado

- Completitud: `equipment_hours` (faltan las horas por día y hay equipos con costo por hora, V-04), `dedication_stale` (el % de dedicación cargado difiere más de 5 puntos del que dan los días y horas de ahora, V-11) y `equipment_insurance` (vehículo propio que circula, sin seguro ni patente, V-06).

### Cambiado

- **Seguro y patente del equipo propio y vianda del puesto a la vista** (antes en "Opciones avanzadas", V-06).

**Cotización guiada por recursos: primero cuánto te cuesta, después cómo lo cobrás (2026-11-15, pedido del dueño, PLAN-2026-025).** Ningún número de una cotización existente cambia (golden y baseline de regresión sin re-aprobar): las tarifas fuera de horario son líneas nuevas y opcionales (`extras[i].kind = 'overtime'`), y el % de dedicación sólo se aplica cuando el usuario lo elige. Esquema sin cambio de versión.

### Agregado

- **Tarifas de cada persona** en Personal: costo por mes con cargas, **hora normal**, **hora extra 50 %** y **hora extra 100 %** (`perPerson.overtimeHourlyCost50` / `overtimeHourlyCost100` = básico por hora × 1,5 o × 2 × factor de cargas).
- **"Trabajo fuera del horario normal (opcional)"** en "Cómo se cobra": RATEOS calcula la hora al 50 % y al 100 % con los recursos de la cotización (horas extra de la gente + uso de los equipos propios) y sugiere su precio: nunca menos que la hora normal más el recargo. Se cobran aparte, con precio propio y horas estimadas opcionales. Motor nuevo `out-of-hours-engine.js`; resultado `outOfHours` en `computeQuote`.
- **"¿Tu gente y tus equipos trabajan sólo para este servicio?"** (on call y precio cerrado): si también hacen otros trabajos, RATEOS propone el % del mes que les ocupa este servicio (horas del servicio ÷ horas normales del mes) y lo aplica a personal y equipos propios como % explícito (`serviceTimeSharePct`, `proposeServiceShares`).
- **"Lo que cuestan tus recursos"**: resumen de personal, equipos y materiales al entrar a "Cómo se cobra".
- **"Tus tarifas (sin IVA)"** en Resultado: horario normal, cada hora fuera de horario, guardia pasiva y plus de guardia activa.

### Cambiado

- **Orden de pasos: los recursos primero.** El servicio → Personal, Equipos, Materiales, Viajes → **Cómo se cobra** (etapa nueva, antes "modalidad" dentro de la etapa 1) → Costos y condiciones → El precio → Resultado. Las URLs de cada paso no cambian.
- **Guardia opcional y al final**: "¿El cliente te paga por estar de guardia?" (No por defecto). Con guardia: **"Guardia pasiva: fijo por mes"** (el abono de disponibilidad de siempre, `rules.availabilityFeeMonthly`) y **"Guardia activa: plus por cada llamado"** (`rules.calloutFeePerActivation`). El detalle (24/7 o franja, días de guardia, tiempo de respuesta) queda en "Detalle de la guardia".
- **Mantenimiento del equipo a la vista** en la tarjeta del equipo (antes dentro de "Opciones avanzadas").
- El adicional predefinido "Hora fuera de horario" (costo a mano) se reemplaza por las tarifas derivadas; los adicionales ya cargados siguen igual.
**Logo nuevo (2026-11-15).** Sólo imagen de marca: ningún cálculo, texto ni dato cambia.

### Cambiado

- Logo rediseñado y elegido por el dueño: símbolo de dos barras (costo, y costo más margen en naranja) con el nombre "rateos" en minúsculas, en trazados SVG. Reemplaza al cuadrado con degradé y a un monograma R intermedio que se leía como P. Ícono de pestaña nuevo. Guía en [docs/BRAND.md](docs/BRAND.md).

**On call sin guardia y nombres más claros (2026-11-10).** Ningún costo ni facturación cambia; esquema sin cambio de versión (nuevo valor `activity.availability = 'none'`).

### Cambiado

- "Disponibilidad requerida" pasa a **"¿Tenés que estar de guardia?"** y va primero: **Sin guardia** (nuevo: sale cuando lo llaman, en su horario), Guardia 24/7 o Guardia en una franja. "Tipo de guardia" sólo aparece con guardia.
- "Días disponibles (de guardia)" se muestra como **"Días de guardia por mes"** sólo con guardia; sin guardia (o sin elegir) queda en Opciones avanzadas como "Días del mes en que podés trabajar" (vuelve a la vista si los días con trabajo lo superan). Sin guardia no se muestra el tiempo de respuesta.
- "Horas trabajadas por día con llamado" pasa a **"Horas de trabajo por día"** (de 8 a 17 = 9 h).

**Guardia activa o pasiva y relevos con números (2026-11-07).** Ningún costo ni facturación cambia; esquema sin cambio de versión (campo opcional `activity.guardType`).

### Agregado

- **"Tipo de guardia"** en on call: **Activa (en el lugar)** o **Pasiva (localizable)**.
- **Guardia activa → relevos con números** (pendiente `relief`): días disponibles × horas de guardia = horas por posición en el mes, contra personas por posición × horas normales (+ extra). Dice cuántas personas por posición hacen falta (más francos y vacaciones), con foco en la nómina. RATEOS no las agrega solo. Con guardia activa no se repite el aviso de horas del personal (`labor_hours`), que queda incluido.
- **Guardia pasiva**: el aviso de "una sola persona por posición" ya no aplica (se rota quién está de guardia); informativo `guard_allowance` para cargar el adicional de guardia en "Adicionales" del puesto si no hay ninguno.
- Un puesto que cubre sólo un turno ("Horas por día que cubre este puesto" u horas por turno del diagrama) cubre esas horas de la guardia; las horas extra (por mes y por día activo) también cuentan.
- **Puntaje de completitud**: `relief` aparece también con guardia activa en franja; con pasiva 24/7 queda ok aunque haya 1 persona por posición; con activa no se evalúa `labor_hours`.
- Informativo **`availability_unpaid`**: on call 24/7 o con guardia activa cobrando sólo lo trabajado, sin abono de disponibilidad ni mínimo mensual garantizado.

**Plantillas como puntos de partida y esquemas de trabajo del personal (2026-11-07, pedido del dueño, PLAN-2026-024).** Ningún número de una cotización existente cambia (golden y baseline de regresión sin re-aprobar): los campos nuevos (`contract.templateId`, `activity.travelPattern`, `labor[i].rotation.pattern`) son opcionales y sin ellos todo se calcula como antes. Esquema sin cambio de versión.

### Cambiado

- **Plantillas rápidas → selector buscable y agrupado "¿Qué querés cotizar?"**, primero en el paso Contrato. Un solo catálogo (`SERVICE_TEMPLATES`), 11 plantillas en 5 grupos (Personal, Equipos y vehículos, Servicio integral, Por resultado o precio global, Terceros): nuevas cuadrilla por hora-hombre, cuadrilla por día de trabajo, servicio técnico por hora, personal en campo con diagrama (abono), servicio integral, servicio por unidad ejecutada y precio global. Limpieza industrial, mantenimiento edilicio y cuadrilla con químicos pasan a ser palabras de búsqueda. Además de marcar componentes, una plantilla sugiere modalidad y unidad **sólo si no hay tarifa ni mínimo cargados** (si no, ofrece "Usar la sugerencia"); nunca quita un componente que ya tiene líneas cargadas. Se recuerda de cuál se partió ("Partiste de … y lo ajustaste"). No cambia ningún número.
- **Fijo mensual: "¿Qué cobertura vendés en el abono?"** con "Días de servicio por mes" y "Horas de servicio por día" (antes "Días de trabajo por mes que cubre el fijo" / "Horas por día que cubre el fijo"), atajos Lun a vie (22) / Lun a sáb (26) / Todos los días (30) y 8 / 9 / 12 / 24 h, y "Personal para esta cobertura" (en sitio, nómina, esquema y horas por persona). Sin la frase de utilización ni "días para no perder" (se factura 1 abono).
- **"Días entre viajes o relevos" sale de la cobertura** y pasa a "¿Cómo viaja el personal a la locación?": va y vuelve cada día (1 viaje por día) / se queda en campo y viaja con cada relevo (**toma los relevos del diagrama del puesto: el diagrama se carga una sola vez**) / otro intervalo. Sin elegir, el número guardado (como siempre) y un aviso si un puesto rota. Se quitó el botón "Usar como días entre relevos".
- **Diagrama de rotación → "Esquema de trabajo"** con "¿Cómo cubre el servicio?": *trabaja los días del servicio* (5x2, 6x1: nómina = en sitio, sin relevos) o *rota en campo* (7x7 = 1x1, 14x7 = 2x1, 14x14, 20x10). **Corrige el 5x2**, que proponía 4 × 7 ÷ 5 = 6 personas y 6 relevos por mes para una cuadrilla de lunes a viernes (al aplicarlo, +50 % de costo): ahora 4. La nómina rotativa usa la cobertura vendida (días de servicio ÷ días del mes). Sólo cambia la PROPUESTA; el costo cambia al tocar "Aplicar al puesto", como siempre.

### Agregado

- **Horas por persona del esquema** (días trabajados × horas por turno) frente a las horas normales del puesto y horas por semana en la peor ventana de 3 semanas (14x7 con 12 h → 56 h), con la referencia legal general (Ley 11.544, art. 201 LCT, tope de 30 h extra por mes del Decreto 484/2000) y "tu convenio puede fijar otro régimen". Botón explícito **"Cargar N h como horas extra por mes"** (un tramo editable "HE esquema … (verificar convenio)" con el recargo de referencia del puesto). Nunca se carga solo.
- **"Qué revisar en tu convenio para este esquema"**: diagrama y turnos habilitados, adicionales de campo, vianda, traslado, feriados y francos trabajados. Sin valores inventados.
- **Aviso "Mismo costo en dos lugares"** (`double_cost_hints`): vianda del puesto + comidas de los viáticos, traslado del puesto + vehículos de la logística, EPP del puesto + EPP en materiales. Sólo avisa; aparece sólo con una señal.

### Anterior sin publicar

**Franja horaria en horas (2026-11-07, pedido del dueño).** Ningún número de una cotización existente cambia; esquema sin cambio de versión (campo opcional `activity.availabilityHoursPerDay`).

### Cambiado

- **"Franja horaria" pasa de texto libre a número: "Horas de guardia por día"** (on call, disponibilidad "Franja horaria"). El texto anterior no lo leía ningún cálculo ni se imprimía; si una cotización lo tenía, se muestra en el (i) del campo nuevo.
- **"Horas trabajadas por día con llamado" a la vista** en on call, al lado de los días (antes escondida en Opciones avanzadas como "10 h por día activo"). Es la que mueve números: horas facturables si cobrás por hora, uso y combustible de equipos y $/hora. Las horas de guardia NO se facturan ni cambian el costo.
- Tooltip de "Disponibilidad requerida": ya no dice "No cambia los números"; explica que es cuándo te pueden convocar, no lo que facturás.

### Agregado

- **Aviso de fuera de horario** (`availability_window`): si cada día con llamado se trabajan más horas que la franja de guardia, dice cuántas quedan fuera de horario y que se cobran en "Adicionales". Sólo avisa.
**Revisión UX y de costos de la tanda B (2026-11):** asistente de diagrama más corto (atajos y 3 campos a la vista, el resto en "Grupos, turnos y redondeo"), marca "aplicado al puesto" y foco que no se pierde; ventana de pérdida como franja "cubre el mínimo · perdés · ganás" con tu estimación marcada; burbujas (i) fijas abajo en celular; aviso del proveedor en rojo o amarillo según su gravedad. Avisos nuevos: nómina menor que los que están en sitio, y tarifa sugerida que no cuenta el mínimo garantizado (con botón "Usar $ X como tarifa ofrecida"). El aviso del proveedor sólo baja a amarillo por vehículos propios si se eligió cómo llega el externo.

**Tanda B — materiales por unidad, mínimo en unidades y aviso del proveedor (2026-11, B-2 y B-3 del informe auditado `docs/informes/2026-11-especialistas-auditado.md`, PLAN-2026-022).** Ninguna cifra de una cotización existente cambia (golden 42/42 y baseline de regresión sin re-aprobar; 118 cotizaciones de los especialistas comparadas con `main`: mismos costos, tarifas, márgenes y equilibrios). Esquema sin cambio de versión: los campos nuevos son opcionales.

### Agregado

- **Materiales y otros costos "Por unidad producida" con % de unidades que lo usan** (B-2, H-11; unificado con PLAN-2026-021 al integrar con `main`): una sola base, `per_output`. Costo del mes = monto × unidades producidas del mes (con merma y logística como siempre), opcionalmente × "% de las unidades que lo usan" (por ejemplo 30 % de las PSV llevan repuesto; vacío = 100 %). Sin producción propia en la línea, las unidades salen de "Cómo se cobra": cantidad o horas por día (como en PLAN-2026-021) y ahora también 1 por día cobrando por día y hitos ÷ días por trabajo cobrando por llamado, trabajo o hito (sin el relleno del mínimo por llamado). Válvulas C1: $ 18.000 por válvula con 8, 6 o 10 válvulas por día (antes, cargado por día, pasar a 6 por día lo subía a $ 24.000, +33 %); con 30 % de las válvulas, $ 648.000 por mes. Funciona con "¿Se factura aparte?" por línea, con la reventa y en Otros costos (salvo con abono mensual). La base `per_billable_unit` de la rama de la tanda B nunca se publicó: se lee como `per_output`.
- **Mínimo garantizado en unidades** (B-3, H-13): "¿Cómo se expresa el mínimo?" En $ por mes (default, como siempre) o en días / horas / válvulas por mes, que el motor valoriza con la tarifa ofrecida o sugerida (sin circularidad: la sugerida se calcula sin el mínimo). 24 h C2: mínimo 20 días = $ 64.660.000 con la tarifa de $ 3.233.000.
- **Ventana de pérdida con mínimo garantizado** (B-3, H-29): el Resultado y "Ver cálculo" dicen "hasta 15,85 días el mínimo cubre tus costos; entre 15,85 y 20,97 días perdés plata; desde 20,97 días ganás" (antes decía siempre "21 días" aunque con 10 se ganaba). El tono del equilibrio sigue al resultado del mes estimado. El break-even no cambia.
- Aviso informativo: cobrando por cantidad, un material "por día" con la misma cantidad que las unidades por día pregunta si es por unidad (nunca se convierte solo).

### Cambiado

- **Aviso "Unidad del proveedor"** (decisión del dueño, H-04, ECO-01): baja de crítico a **aviso común** (amarillo: no dice "RESULTADO NO CONFIABLE") cuando el externo cobra por trabajo / salida con la movilización incluida, o cuando los viajes de la ruta los hacen vehículos propios y el externo no va por sus medios. En los demás casos sigue crítico como siempre. Los tests de ECO-01 que usaban la movilización incluida del fixture E3 ahora la dejan sin definir para seguir protegiendo el caso crítico.

### Corregido

- La unidad junto a "Cantidad" de un material mostraba "—" por una referencia rota (`BASIS_PER`); ahora dice "u./día", "u./mes", "u./llamado" o "u./válvula".

**Más unidades de medida (2026-11-07, pedido del dueño).** Ningún número de una cotización existente cambia; esquema sin cambio de versión (las unidades se guardan por id, como siempre).

### Agregado

- **25 unidades de facturación nuevas, en español**: energía y potencia ($/kWh, $/MWh, $/MJ, $/GJ, $/MMBTU, $/kW-día, $/kVA-día para grupos electrógenos, $/HP-hora para bombas y compresores), $/m³ de gas, $/hora de equipo, $/día-equipo, $/jornal, $/guardia, $/etapa, $/metro perforado, $/conexión, $/pulgada-diámetro, $/junta soldada, $/boca, $/pallet, $/contenedor, $/tambor, $/bolsa, $/muestra y $/análisis. Todas se calculan como las de cantidad (cantidad ÷ rendimiento = días de trabajo). Volt, amper, psi o caudal no se agregan como unidad de cobro: describen el equipo.
- **"¿En qué unidad cobrás?" con buscador** (por nombre o sinónimo: "joule", "potencia", "soldadura") y el grupo de cada unidad; sin resultados ofrece "Otra / personalizada".
- **Aviso** si con $/jornal, $/día-equipo o $/hora de equipo lo facturado por día no coincide con las personas o equipos cargados (los costos salen de lo cargado).
- Capacidad por viaje también para m³ de gas (GNC), pallets, contenedores, tambores y bolsas. Más unidades de materiales: bidón, caja, rollo, par, juego, pallet, big bag, barril, m³ de gas, kWh.

**Pendientes de componentes (2026-11, PLAN-2026-021).** Ninguna cifra de una cotización existente cambia; esquema sin cambio de versión (campos opcionales).

### Agregado

- **Insumos por unidad producida:** en Materiales, "¿Cada cuánto se consume?" ofrece "Por unidad producida (m², m³, pieza…)": químicos por m³ tratado, pintura por m², consumibles por pieza. La producción por día sale de "Cómo se cobra" (si cobrás por cantidad u hora) o se carga en la línea. Sin ese dato, pendiente "Producción por día". Ver CALCULATION_RULES §6.
- **Viáticos por personas y noches:** en Movilización y viajes, "Calcular viáticos por personas y noches" llena el monto por salida (personas × noches × alojamiento + personas × días × comidas).

### Cambiado

- Con "Vehículo" como único equipo del servicio y la camioneta cargada en Viajes con costo por km, "Costo de equipos" pasa de pendiente crítico a aviso (ese costo no cubre amortización, seguro ni patente).

**Reportes por Supabase encendidos (2026-11-07).** Con autorización del dueño se aplicó la migración `20261107021710_rateos_bug_reports` y se desplegó la Edge Function `bug-report-github`; `FEATURES.bugReportsCloud = true`: con sesión, "Reportar un problema" se envía desde la app sin cuenta de GitHub.

**Tanda B — diagrama de rotación (2026-11, B-1 del informe auditado, PLAN-2026-023).** Ningún número de una cotización existente cambia (golden cases y foto de regresión iguales); esquema sin cambio de versión (campos opcionales).

### Agregado

- **Diagrama de rotación (opcional) en cada puesto de Personal** (H-12, H-07, H-06, H-14): días en sitio, días de franco, personas en sitio a la vez, grupos que entran escalonados, turnos por día y horas por turno, todos libres (7x7, 14x14, 14x7, 20x10 y 5x2 son atajos editables). Propone la nómina (`en sitio × ciclo ÷ días en sitio`, hacia arriba o exacta con el decimal a la vista), los relevos por mes (`días del mes ÷ días en sitio × grupos`), los días entre relevos y las personas en sitio por día (base para campamento). Sólo propone: el costo cambia al tocar **"Aplicar al puesto"**. Motor puro `js/engines/rotation-engine.js` con "Ver cálculo".
- **Personas en nómina (total del puesto)** (`labor[i].payrollHeadcount`): el costo fijo usa la nómina; las horas extra por día y las viandas siguen a las posiciones. 3 en sitio con 5 en nómina sin cargar 1,6667 ("5,0001 personas"). Botones "Cargar la nómina total" / "Cargar personas por posición" (mismo costo al cambiar). Sin el campo, igual que siempre.
- **"Usar como días entre relevos"** (fijo mensual y servicio permanente): carga "Días entre viajes o relevos" con los días entre relevos del diagrama, así el relevo se costea con 1 viaje entero por relevo y sin el truco de viajes con decimales.
- **"N en sitio · M en nómina"** en el puesto y en el Resultado ("Personal: 2 en sitio · 4 en nómina · diagrama 14x14, 2,14 relevos por mes").

### Cambiado

- **Aviso "Horas del personal"**: si el puesto no tiene "Horas por día que cubre este puesto", usa las horas por turno del diagrama (24h C1 con turnos de 12 h ya no da el aviso falso); cuenta la nómina total como personas por posición. Los avisos de relevos 24/7 y de personas no enteras también usan la nómina total. Sólo avisos: el costo no cambia.

Casos reales: 24h C1 (14x14, 2 en sitio) → 4 en nómina; con 14 días entre relevos y 1 viaje por relevo, $ 70.247.973 (con el truco eran $ 70.247.873; sugerida $ 86.941.000 en los dos). 2x1 C1 (14x7, 3 en sitio) → 4,5 → 5 en nómina: costo $ 84.542.140 → $ 89.810.129 y sugerida $ 105.022.000 → $ 111.566.000 al aplicar (con redondeo exacto, sin cambios). Fuera de alcance: costo por persona en sitio por día en Otros costos (B-6) y un driver propio de relevos para otros contratos.

**Testeo con especialistas — UI (2026-11, tanda A del informe auditado `docs/informes/2026-11-especialistas-auditado.md`).** Ningún número de una cotización existente cambia; esquema sin cambio de versión (`contract` ya era opcional y `activity.availability` puede quedar sin definir).

### Agregado

- **Fijo mensual: "¿Cada cuántos días hay un viaje o relevo a la locación?"** (A-6, H-06). El intervalo, que el motor ya usaba, ahora se ve también en un contrato fijo mensual (1 = un viaje por día, como antes). Ej.: diagrama 14x14 con relevo cada 14 días → 30 ÷ 14 = 2,1 relevos por mes; los costos por intervención se cuentan esas veces y no 30.
- **"Sin contar adicionales: $ X"** debajo de la tarifa piso (A-7, H-09) cuando hay adicionales, reventa u otros ingresos: el piso los supone facturados; el (i) dice cuánto y cuál es el mínimo si no llegan. Lo calcula el motor (`floorWithoutOtherRevenue`); la tarifa piso no cambia.

### Cambiado

- **Cotización en blanco** (A-2, H-03): nace con el contrato "Por servicio prestado" y sólo **Personal** marcado (antes se leía como "personal y equipos" y aparecía "Equipo o maquinaria"). Al sumar Vehículo o Equipo aparecen $/viaje, $/km, $/m³… Las cotizaciones guardadas sin contrato se siguen leyendo como antes.
- **Disponibilidad** (A-16, H-26): una cotización nueva (en blanco o de una plantilla que no la define) la trae **sin definir**, y el selector 24/7 / franja horaria sale de Opciones avanzadas y queda junto a los días. El aviso de relevos sólo aparece si elegís 24/7. No cambia ningún número (las guardadas conservan su 24/7).
- **Aviso "Unidad del proveedor"** (A-4, H-04): "Por viaje completo" y "Sí, cobra por…" tienen el mismo peso (ninguna es la sugerida), con la aclaración "Si los viajes son de tus vehículos y el proveedor va una sola vez, confirmá «cobra por…»".
- **Precio cerrado con un trabajo por mes** (A-12, H-24): "Costo del trabajo", "Ganás $ X por trabajo" y el equilibrio en trabajos enteros ("con 1 trabajo ya cubrís todos tus costos") en lugar de "0,6 trabajos por mes".
- Abono que alcanza aun trabajando todos los días: con personal aclara "(sin contar horas extra)" (A-12, H-18).

### Corregido

- Insignia ILUSTRATIVO vacía ("Incluye valores ILUSTRATIVOS: .") cuando la causa es la tasa de financiamiento de ejemplo: ahora la nombra (A-9, H-19).
- Parámetros de convenio reales marcados ILUSTRATIVO por coincidir con el valor de ejemplo (SAC 8,33 %, 176 h, 50 %): si la línea viene de un convenio o perfil propio, sólo cuenta la marca (A-10, H-20; personal de cotizaciones y de productos).
- Plurales de unidades propias: siglas de hasta 4 letras en mayúsculas sin cambio (PSV, END) y "+s" en terminaciones de otro idioma (kit → kits) (A-11, H-21).
- Concordancias: "cuántas intervenciones", "Valor: sin fecha base" / "Costos: sin fecha base" en lugar de "Valor no definida" (A-12, H-25).

**Revisión UX y de costos de la tanda A:** los avisos informativos nuevos se ven también en su paso ("Para tener en cuenta" con "Ir al campo"); resumen en vivo con "Costo del trabajo" y trabajos enteros en precio cerrado; "¿Cómo viaja?" (Va cargado arriba / Va enganchado y rueda) en lugar de una casilla, así la pregunta de neumáticos por km queda respondida con cualquiera de las dos; "Días entre viajes o relevos"; el aviso de costos fijos absorbidos ya no incluye al personal contratado para este servicio y sí a lo compartido sin % válido; "Ver cálculo" de movilización muestra el remolque enganchado.

**Tanda A de correcciones, motor y avisos (2026-11, informe auditado de 5 especialistas: `docs/informes/2026-11-especialistas-auditado.md` §5, A-1, A-3, A-5, A-8, A-13, A-14 y A-15).** Ningún número de una cotización existente cambia, salvo el total del contrato en precio cerrado (estaba mal). Todo lo nuevo es opcional y su default reproduce el comportamiento anterior. Esquema sin cambio de versión (campos opcionales: `quote.contractJobs`, `equipment[i].mobilization.towed`, `labor[i].coverageHoursPerDay`, `materials[i].billedSeparately`).

### Corregido

- **Total del contrato en precio cerrado (A-1, H-01).** Multiplicaba el precio por los 12 meses de contrato (2x1 de 45 días: 2.426.664.000 en lugar de 202.222.000). Ahora el Resultado muestra **"Total del trabajo"** (facturación, costo, impuestos y ganancia de un trabajo = valores del mes ÷ trabajos por mes; por hito, tarifa × hitos del trabajo). Campo opcional **"Trabajos que cubre el total"** (en Contrato, Más datos de la cotización; vacío = 1). Fijo mensual y on call siguen igual.
- **Aviso "Horas del personal" (A-5, H-07/H-08).** Con un trabajo más largo que los días disponibles, las horas por mes ahora se prorratean como los costos fijos (el 2x1 de 45 días ya no da un aviso falso). Nuevo campo opcional **"Horas por día que cubre este puesto"** (opciones del puesto, grupo Horas) que **sólo usa el aviso**: un turno de 12 h en una operación de 24 h. El mensaje sugiere también "o sumá posiciones (turno día / turno noche)".
- **Fecha base (A-13, H-23):** el aviso lleva al paso y al mes del primer valor sin fecha (antes, siempre a Contrato).
- **Consumo en ruta (A-14, H-22):** un equipo por sus propios medios sin L/100 km en ruta ahora es un pendiente de "Movilización de equipos" (antes sólo se veía en el paso).

### Agregado

- **Remolque arrastrado (A-3, H-02).** En "Lo transporta otro equipo", la casilla **"Va enganchado y rueda (remolque, carretón o batea arrastrada)"**: suma km de ruta × (desgaste por km + neumáticos por km) del remolque, sin combustible ni conductor. Sin marcar = cargado arriba (como siempre). Aviso si un equipo transportado tiene neumáticos por km y no está marcado. Golden nuevo `movilizacion-remolque-arrastrado` (+89.600 por trabajo).
- **Facturar aparte por material (A-8, H-10/H-36).** "¿Se factura aparte?" en las opciones de cada material: sí / no / como el resto (sigue el tilde global). Sólo las líneas que se facturan aparte suman a la reventa; en el reparto de la tarifa su costo va en la fila "Materiales facturados aparte".
- **Avisos informativos (A-15; no bajan el puntaje):** costos fijos del mes que absorbe un precio cerrado o un mes con menos días que los disponibles ("asignales un % compartido"; nunca se aplica solo); personas no enteras ("Cargaste 4,5 personas; ¿cuántas hay en nómina?"); precio cerrado de varios días con 1 viaje ("¿La cuadrilla vuelve a la base cada día?").

**Reportar un problema desde la app (2026-11, PLAN-2026-020).** Pedido del dueño: "una sección donde los usuarios puedan reportar errores… vinculado a GitHub". Ninguna fórmula cambia; esquema de datos de la app sin cambios.

### Agregado

- **Reportar un problema**: al pie del menú lateral (y en la demo y el pie del sitio). Dos preguntas (qué pasó / qué esperabas), contexto técnico automático y "Ver exactamente lo que se envía". Con sesión se envía sin cuenta de GitHub y devuelve una referencia `R-XXXXXX`; sin sesión abre el issue ya escrito en GitHub.
- Supabase: `private.bug_reports` + `public.submit_bug_report` (sólo con sesión, con límite por persona) y `public.admin_bug_reports` (RATEOS_ADMIN). Edge Function `bug-report-github` que crea el issue con label `reporte-app` sin datos de la persona. Plantilla `.github/ISSUE_TEMPLATE/reporte-app.yml`. Cómo revisarlos: [docs/BUG_REPORTS.md](docs/BUG_REPORTS.md).

### Seguridad

- Beta Security Gate: se permiten las RPC `submit_bug_report` y `admin_bug_reports` y una sola Edge Function (`bug-report-github`, nombre literal, sólo desde `js/data/feedback-gateway.js`). El test de migraciones acepta grants al rol `service_role` (nunca claves).

**Llamados más claros en on call (2026-11).** Pedido del dueño: "¿qué es llamado? es re confuso… si me llaman una vez por día, ¿qué hago?". Ninguna fórmula cambia; esquema sin cambios (se sigue guardando `activity.daysPerActivation`).

### Cambiado

- "¿Cuánto dura cada llamado?" (un desplegable con dos opciones) pasa a **"¿Cómo son los llamados?"** con tres opciones: **Uno por día** (por defecto, sin otro dato), **Uno dura varios días** (pide días por llamado) y **Varios en un día** (pide llamados por día). El (i) define el llamado: cada vez que el cliente te convoca y salís a trabajar. Lo mismo para salidas e intervenciones.
- Los **días disponibles** (en on call, "Días disponibles (de guardia)") salen de Opciones avanzadas y quedan al lado de los días con trabajo cuando la actividad se carga en días: el aviso de utilización mayor a 100 % compara dos números a la vista.
- El aviso de utilización dice los números y cómo corregirlo ("Cargaste 21 días de trabajo y hay 20 disponibles…"); el recuadro "Con estos datos" se pone naranja y lo explica.
- "Cada llamado se cuenta completo" sólo aparece cuando cambia algo (llamados por mes no enteros) o si ya está encendida.
- "Horas trabajadas por día activo" → "Horas por día de trabajo".

**Servicio moldeable por componentes (2026-11, PLAN-2026-019).** Pedido del dueño: "¿Qué incluye?" limitaba a tres opciones. Se relevaron con agentes 26 tipos de recurso y 22 servicios reales. Ninguna fórmula cambia; esquema sin cambio de versión (`contract.components` es opcional).

### Agregado

- **"¿Qué incluye el servicio?" por componentes**, en cualquier combinación: Personal, Vehículo, Equipo o maquinaria, Servicio de terceros, Herramientas, Insumos y consumibles, Químicos, Materiales que quedan en obra, EPP especial, Residuos y disposición, Viáticos y alojamiento, Otros costos, y componentes propios con nombre libre ("Otro componente").
- **Plantillas rápidas:** Técnico con camioneta e insumos, Cuadrilla con químicos, Equipo con operador, Vehículo con chofer, Alquiler sin operador, Limpieza industrial, Mantenimiento edilicio, Sólo personal, Servicio de un tercero.
- "Dónde se carga cada uno": link al paso de cada componente y cuántas líneas tiene cargadas.
- El listado de cotizaciones muestra el contrato y lo que incluye ("Por servicio (on call) · personal + vehículo + químicos").

### Cambiado

- Sin personal ni equipos (sólo insumos u otros costos) ya no se exige ninguno de los dos. Un equipo o vehículo sin personal sigue siendo alquiler sin operador.
- Al sumar un componente de materiales, si el paso estaba como "no usa materiales" se vuelve a pedir (nunca se marca solo). Al sumar "Viáticos" con "Sin traslados", se reabre "Movilización y viajes" con aviso.

**Contrato primero y adicionales (2026-11, PLAN-2026-018).** Pedido del dueño: el "tipo de servicio" mezclaba cómo paga el cliente con qué recurso se ofrece. Se investigaron modalidades reales (mensualizado, on call, day rate, por unidad, precio cerrado, fijo + variable, mínimo garantizado) y se simularon 6 cotizaciones reales contra el motor. Esquema sin cambio de versión: `contract` y `extras` son opcionales.

### Agregado

- **Paso "Contrato":** primero "¿Cómo te paga el cliente?" (Fijo mensual · Por servicio prestado (on call) · Precio cerrado) y después "¿Qué incluye?" (Sólo personal · Equipo o vehículo con operador o chofer · Equipo o vehículo sin operador). El transporte es un vehículo con chofer, no una categoría aparte.
- **Adicionales cobrados aparte** en "Cómo se cobra", en la misma cotización: concepto, unidad, cantidad por mes, tu costo y precio (vacío = sugerido con el margen objetivo). Atajos: hora fuera de horario, feriado o fin de semana, llamado fuera de horario, km excedente. Suman ingreso y costo al mes y aparecen en "Cómo se factura el servicio".
- **Mínimo mensual garantizado** a la vista en "Cómo se cobra" cuando se cobra por servicio prestado.
- Con fijo mensual, "Cómo se cobra" pregunta qué cubre el fijo (días y horas incluidos) y no pregunta la unidad.

### Corregido

- Una cuadrilla on call sin equipos ya no queda con el pendiente crítico "Costo de equipos" ni pide "equipo en espera" (sólo con contrato nuevo; las cotizaciones anteriores se evalúan igual que antes).

### Revisión de especialistas (UX y estructura de costos)

- El precio sugerido de cada adicional cubre su costo **cargado** (estructura %, financiero y contingencia): al sugerido deja exactamente el margen objetivo y no baja el margen total.
- Con margen objetivo inválido no se sugiere precio de adicionales (aviso), igual que la tarifa principal. Precio a mano bajo el costo: aviso. Precio 0 a mano = bonificado.
- Los adicionales se cobran encima del mínimo mensual garantizado (no lo completan).
- Textos más cortos en las tarjetas del contrato y los adicionales (detalle en (i)); "Otro adicional" abre con el concepto vacío y enfocado.

**Auditoría de unidades y simplificación visual (2026-11).** Tres auditorías con servicios reales simulados (diagnóstico de válvulas, END por soldadura, prueba hidráulica por pozo, movilización por km, agua por m³, carga por viaje / tonelada / ton-km, cuadrillas por hora, pintura por m², cañería por metro, residuos por tonelada, llave en mano) con ~380 valores calculados a mano. Esquema sin cambios.

### Agregado

- **Varias intervenciones por día:** "¿Cuánto dura cada intervención?" ofrece [Cada una dura uno o más días] o [Hago varias por día] (N por día; se guarda `daysPerActivation = 1 / N`). Antes había que escribir "0,333 días". Los textos dicen "3 intervenciones por día".
- **Unidades de medida en español (UN/ECE Rec. 20):** $/pieza (válvula, instrumento…), $/pozo, $/ensayo, $/hora-hombre, $/litro, $/barril, $/hectárea y $/juego o kit. Con muchas unidades la elección es una lista desplegable.
- Avisos: menos de una unidad por intervención (p. ej. medio pozo: la movilización se contaría dos veces), menos de un viaje por salida, y mínimo diario/horario de un externo cobrado en cada una de varias intervenciones por día.
- **Lo elige quien cotiza** (decisión del dueño): "¿Con qué días se elige el tramo?" de descuento (facturados, por defecto, o trabajados; `rules.volumeTierBasis`) y "Capacidad por viaje" (opcional) para transporte por m³, t, litro, barril o kg: los viajes por salida se calculan solos (⌈cantidad por salida ÷ capacidad⌉; `activity.unitsPerTrip`). Sin cargarlos, todo calcula igual que antes.
- Test Lab: 10 escenarios nuevos (SRV-19B…19K) y `tests/engines/audit-2026-11.test.js`.

### Cambiado

- **Menos texto en pantalla:** las ayudas de campos, indicadores, preguntas y del resumen en vivo pasan a un ícono (i) que se lee al pasar el cursor, tocar o enfocar con el teclado. Los avisos y errores siguen siempre visibles.
- **Tarifa sugerida (servicios):** el paso de redondeo nunca supera el 1 % de la tarifa (ver CALCULATION_RULES §18). Cambian sólo las sugeridas de unidades baratas (kg, km, m, m², m³, ton-km…): p. ej. 100,23 $/kg ya no se sugiere a 1.000 $/kg sino a 101 $/kg.
- **"Cada salida se cuenta completa" con la unidad "viaje":** el ajuste ya no redondea km ni viajes (siguen a los viajes facturados), sólo peajes, viáticos y cargos por salida (CALCULATION_RULES §2.1).

### Corregido

- Plural de unidades propias en mayúsculas ("UNIDADES", no "UNIDADes") y de varias palabras ("pruebas hidráulicas", "puntos de inspección").
- Por hora o día con mínimo por llamado, el equivalente "por día" incluye el mínimo.
- Textos: "1 trabajo" (no "1 trabajos"), mayúscula en "Válvulas para lograr el margen", nota de redondeo con formato de moneda y sólo si hay tarifa, "Sin días activos no hay tarifa por hora" con la unidad real.
- Equilibrio con "cada salida completa" y muchas salidas por día: se evalúan todos los saltos del mes (antes se cortaba en 500).

**ECO-01 (PLAN-2026-017): bloqueantes económicos de la beta (H-01, H-02, H-03).** Ninguna fórmula cambia y ningún dato guardado se reinterpreta: golden 39/39 sin tocar y las mismas cifras que `main` en 2.097 cotizaciones y 13 productos sintéticos. Cambia qué se puede cargar (una unidad nueva) y qué se marca como pendiente. Esquema sin cambios (sigue en 10), sin migraciones.

### Agregado

- **(H-01) Unidad "Por viaje completo (ida y vuelta)"** para equipos y servicios externos: un viaje ida y vuelta es 1 unidad (`external.tripBasis = 'round_trip'`, opcional). En la cotización (Equipos) y en Recursos ("¿Qué cobra?"). La línea y "Ver cálculo" muestran viajes completos, tramos y el equivalente por km.
- **(H-01) Pendiente crítico "Unidad del proveedor"**: un externo "Por salida" en una ruta con más de un viaje por salida, con salidas, viajes y el equivalente por viaje; [Por viaje completo (ida y vuelta)] o [Sí, cobra por salida]. La confirmación guarda el supuesto (tarifa, viajes por salida y ruta, `equipment[].externalUnitConfirmed`) y deja de valer si cambia.
- **"RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA"** arriba de los números del Resultado (a la vista y en el PDF) con un doble abono, un "por salida" sin confirmar o un puesto sin sueldo; el margen, el cálculo de días y el resumen del editor dicen "NO CONFIABLE" en lugar de "Ganás…". Las cifras no cambian.
- **(H-02) "Cómo se compone la facturación del mes"** en el Resultado (`revenueComposition`): tarifa, abono de disponibilidad, cargos, ajuste al mínimo y total, con los números del motor.
- **(H-02) Pendiente crítico "Dos abonos por mes"** (`monthly_fee_overlap`): tarifa en $/mes + abono de disponibilidad. El resultado queda como borrador hasta dejar un solo abono; "El precio" lo avisa junto al campo. Abono solo, disponibilidad + tarifa por uso y mínimo garantizado siguen igual.
- **(H-03) Puesto usado sin sueldo básico:** "Personal" pasa a **crítico**, nombra el puesto y lleva a su básico (también en "Equipo sin operador" si se cargó un puesto con posiciones); la línea muestra el aviso. En productos, un puesto con minutos por tanda y sin básico es un error.
- Regresiones: `tests/engines/eco-01.test.js` (20 tests; 12 fallan en `main`) y E2E-17 a E2E-20.

### Cambiado

- Rótulos de las unidades de externos: "Por viaje (cada ida o vuelta)" → **"Por tramo (cada ida o cada vuelta)"** (mismo significado y mismos números) y "Por km" → "Por km recorrido".
- El puntaje de completitud cambia sólo en las cotizaciones donde aparece uno de los avisos nuevos.

**Beta Perimeter v1 (PLAN-2026-016).** Prepara el perímetro de la beta cerrada con 3–5 empresas: HD-02 queda resuelto en el código, HD-03 del lado de la app y HD-01 preparado. Sin cambios en motores ni fórmulas (golden 39/39), **ni en la base** (ninguna migración) **ni en el esquema de datos** (sigue en 10). **Todavía no hay beta:** falta lo que configura el dueño (registro apagado en Supabase, SMTP propio y dominio: [docs/BETA_PERIMETER.md](docs/BETA_PERIMETER.md) §5).

### Seguridad

- **(HD-02) Sin staging en el origen de producción.** El deploy publica sólo producción (`push` a `main` y rollback manual): sin `workflow_run`, sin job de preview y sin `scripts/stage-preview.mjs`. El build falla si `dist/` trae `preview/`; después de publicar, el workflow verifica que `version.json` tenga el commit desplegado y que `/preview/` y `/preview/version.json` respondan 404 (si no, el deploy queda en rojo). Pages reemplaza el sitio entero en cada deploy: el primer deploy con este cambio borra también los archivos del preview viejo. Nuevo control SEC-17 del Beta Security Gate.
- **(HD-03) Beta por invitación en la app.** `FEATURES.publicSignup = false`: la app no ofrece "Crear cuenta" (las llamadas a la acción llevan a Ingresar), `#/registro` explica el acceso por invitación sin formulario y `signUp` no llama a Supabase; `signup_disabled` / `email_provider_disabled` muestran el mensaje de la invitación. La barrera real es apagar "Allow new users to sign up" en Supabase Auth: paso del dueño (la configuración de Auth no se tocó).
- El Beta Security Gate rotula HD-01, HD-02 y HD-03 como REQUISITO pendiente antes de habilitar usuarios reales (18 controles y 17 archivos de tests).

### Agregado

- `docs/BETA_PERIMETER.md`: estado de HD-01/02/03, cómo reactivar más adelante un staging aislado (otro origen y otra base), alta por invitación, procedimiento del dominio propio (dato que falta, DNS, Pages, HTTPS, URLs de Supabase, rollback), prueba A/B real, checklist del dueño y riesgos.
- `scripts/check-auth-perimeter.mjs`: lee la configuración pública de Auth y verifica registro cerrado, proveedor Email activo, confirmación de email activa y ningún otro método de ingreso; el SMTP propio (no es público) queda como verificación manual.
- **Prueba A/B real** (manual, nunca en CI ni en `npm test`): `tests/live/perimeter-ab.mjs` (dos usuarios autenticados y dos organizaciones sintéticos `@rateos.invalid`; la app compilada en un navegador y la API con JWT reales: acceso, aislamiento A↔B, guardado, logout, cambio de usuario en la misma pestaña y refresh token revocado) y `supabase/tests/live_ab.sql` (alta, identificación, verificación y limpieza sólo de lo sintético). Preparada, no ejecutada: la red del entorno de desarrollo no llega a Supabase.
- (HD-01) Soporte para un segundo origen: `PUBLIC_SITE_URLS` (cada sitio usa sus propios enlaces de email, porque el enlace PKCE vuelve al origen donde se pidió) y `MOVED_TO_SITE_URL` (mudanza desde github.io antes de iniciar sesión, apagada hasta verificar el dominio).
- E2E `REGISTRO-01` (escritorio y celular): `#/registro` sin formulario ni campo de contraseña, ningún enlace a "Crear cuenta", y siguen Ingresar y "¿Olvidaste tu contraseña?".

### Corregido

- Con el SMTP por defecto de Supabase (sólo envía correos al equipo del proyecto) la recuperación respondía "te enviamos un enlace" aunque el correo no saliera: con la beta por invitación, nadie de afuera habría podido elegir su contraseña, sin ningún aviso. `email_address_not_authorized` tiene código propio: fuera de sesión la respuesta sigue neutra (no revela qué emails tienen cuenta) y queda un aviso técnico sin el email; con la sesión iniciada, "Cambiar contraseña" avisa que el correo no se pudo enviar (también ante cualquier otra falla). El SMTP propio pasa a ser paso obligatorio del dueño antes de la primera alta.

### Eliminado

- El staging público `/preview/` dentro del sitio de producción y `scripts/stage-preview.mjs` (queda en el historial de git, `998b932`). Un staging futuro tiene que estar aislado en origen y en base.

## [0.8.1] - 2026-10-17

**RATEOS v0.8.1: parche de seguridad y de pérdida de datos — Beta Readiness v1 (PLAN-2026-015).** Versión de parche sobre v0.8.0 (`0c213a3`, punto de retorno; el tag `v0.8.0` lo crea el dueño). Sin fórmulas nuevas ni cambios en los motores: ningún costo, tarifa ni golden cambia (39/39). **Sin cambios en la base** (ninguna migración) **ni en el esquema de datos** (sigue en 10): los datos y backups de v0.8.0 se abren igual. Auditoría completa en [docs/BETA_SECURITY.md](docs/BETA_SECURITY.md): 0 P0 de seguridad (ningún acceso entre empresas, ni con IDs conocidos; el admin de plataforma no lee contenido económico); 2 P0 de pérdida de datos, 3 P1 de sesión y 4 P2, corregidos (BS-01…BS-09); 9 decisiones del dueño.

**Todavía no hay beta con empresas externas.** Requisitos obligatorios antes de habilitar usuarios reales (decisión del dueño, 2026-10-17): **HD-01** dominio propio para producción; **HD-02** staging separado de producción en origen y en base de datos, o `/preview/` deshabilitado temporalmente; **HD-03** registro cerrado o por invitación. El Beta Security Gate los informa como REQUISITO pendiente en cada corrida.

### Agregado

- **Tests de negación en la base** `supabase/tests/beta_security_test.sql` (132 controles, todo se deshace): A→B y B→A con los IDs reales de la otra empresa (leer, escribir, borrar, altas con `organization_id` ajeno, upsert, columnas de control, filtros manipulados, búsqueda por contenido), roles OWNER/ADMIN/ESTIMATOR/VIEWER, miembro quitado, RATEOS ADMIN sintético (metadata sí, contenido no), anon, JWT sin usuario y el catálogo en vivo (RLS, grants, `security definer`, Storage, Realtime).
- **Beta Security Gate** (`npm run test:security`; también dentro de `npm test` y como paso de CI): 17 controles estáticos y dinámicos (secretos en lo publicado, superficie de Supabase del navegador, migraciones, cobertura del test SQL, la nube nunca se pisa con datos "recuperados", pestañas, `organizationId`, sesión, PKCE, logs, eventos, backup, CSP, admin, dependencias) + 15 archivos de tests; reporte JSON + Markdown en `reports/security/`. Las decisiones del dueño se informan siempre (no bloquean) y HD-01, HD-02 y HD-03 se rotulan REQUISITO pendiente antes de habilitar usuarios reales.
- Tests de tenancy, recuperación, varias pestañas, acceso perdido y memoria de sesión (`tests/data/beta-security.test.js`) y controles E2E `SESION-01/02` (escritorio y celular): al cerrar sesión no queda nada de la empresa en pantalla ni en el DOM, y otra cuenta en la misma pestaña no ve nada de la anterior, ni con los ids de sus cotizaciones o productos.

### Corregido

- **(P0 pérdida de datos, BS-01)** Si los datos de la nube no se podían leer con la versión abierta (dañados o con estructura inesperada; por ejemplo escritos por otra versión con el mismo esquema, como el staging, que comparte la base), la cuenta cargaba un espacio **vacío** o "reparado" y **lo subía solo**, pisando la única copia compartida. Ahora se abren en **sólo lectura** con un aviso, sin subir nada, y queda una copia en el navegador (también al "Recargar"). Si lo ilegible era una copia local sin subir, se abre la versión de la nube y la copia queda en recuperación.
- **(P0 pérdida de datos, BS-02)** Con varias pestañas, un guardado exitoso en una **borraba** la copia de cambios sin subir de otra (sin conexión o en conflicto): al cerrarla, esos cambios se perdían sin aviso. Ahora cada pestaña tiene su propia copia (`rateos.cloud.<u>.<o>.pending.<pestaña>`); al abrir se retoma la más nueva hecha sobre la revisión actual y las demás quedan en copias de recuperación. La copia única de v0.8.0 se sigue leyendo.
- **(P1 sesión, BS-03 y BS-04)** Al cerrar sesión o entrar con otra cuenta en la misma pestaña quedaban en memoria los borradores no guardados (se restauraban por id de cotización, sin mirar la cuenta), los sliders y las secciones abiertas; y el menú y la barra ocultos conservaban la empresa, su base, el nombre, el email, el título y las migas de la sesión anterior. Ahora los borradores son de cada cuenta y todo lo demás se borra al cerrar la cuenta.
- **(P1 sesión, BS-05)** Los datos del modo local anterior se ofrecían a cualquier cuenta que ingresara en el navegador aunque otra ya los hubiera importado. Ahora quedan "reclamados" (huella, sin datos ni ids) y no se ofrecen a otra cuenta. `rateos.state` nunca se borra.
- (P2, BS-06) Un miembro quitado de la empresa veía "Tu rol no permite guardar" y seguía con los datos en pantalla: ahora se cierra la cuenta en pantalla ("Ya no tenés acceso a esta empresa"), sin reintentos, y sus cambios sin subir quedan en el navegador.
- (P2, BS-09) Las copias de recuperación de cambios que nunca llegaron a la nube (`cloud-unsynced`, `cloud-conflict-local`) tienen su propio cupo de 3: importar o migrar ya no las rota.
- (P2, BS-08) "Conservar una copia" (conflicto) descarga siempre la versión actual de la pestaña: antes, si al abrir se había apartado una copia vieja de cambios sin subir, descargaba esa copia vieja.

### Seguridad

- (P2, BS-07) Toda escritura de una cuenta deja cada entidad con la organización de la cuenta: nunca se guarda el `organizationId` que mande el navegador o un backup (el límite real sigue siendo RLS: nunca hubo acceso entre empresas por esto).

## [0.8.0] - 2026-10-17

**RATEOS v0.8.0: decisiones del dueño LAB-D1…D8 (PLAN-2026-014) y RATEOS Test Lab v1 (PLAN-2026-013).** **Esquema de datos 10** (`migrateV9ToV10`: sólo sube la versión, no cambia ni marca ningún dato; una versión anterior abre estos datos en sólo lectura). Ningún golden anterior cambia (39/39: 37 + 2 nuevos de D1).

**Decisiones del dueño LAB-D1…D8 (PLAN-2026-014).** Cierra las ocho decisiones que dejó Test Lab v1. **Ninguna fórmula cambia para los datos que ya existen**: ninguna cotización ni producto cargado cambia sus números (COT-0009, COT-0010, COT-0011, la demo y los 37 golden anteriores, idénticos; dos golden nuevos aprobados para D1). Cambian números sólo cuando la persona carga un dato nuevo: la financiación de un producto (D3) o la marca "No usa combustible" en un equipo (D5); y una línea de equipo cargada con más de 24 h por día (un dato inválido que la validación ya marcaba como error) ahora se calcula con 24 h por unidad. Lo que sí cambia, a la vista: el **puntaje de completitud** de una cotización cuya operación pide más horas de cobertura que las cargadas para el puesto (aparece el aviso de D2; p. ej. 100 % → 98 %) y el de una cotización real nueva con el precio de combustible de ejemplo (D7); costos y tarifas, iguales. Detalle y fórmulas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §2, §2.1, §3, §4, §4.1, §5.1, §5.2, §6, §19 y §23.1.

**RATEOS Test Lab v1 (PLAN-2026-013): QA interno, simulación y auditoría.** No es una funcionalidad visible ni se publica en `dist/`: oráculo económico independiente, candado de golden, 68 escenarios curados (todos los tipos de servicio, las 18 unidades comerciales, las 7 de externos y productos), 20 sondas de contradicción, escenarios generados con seed (pairwise), 35 invariantes, auditor de consistencia UX, auditoría en navegador (escritorio y celular, Supabase simulado), mercado offline y reportes JSON + Markdown. La primera campaña encontró 11 problemas distintos y la revisión del código 1 más; se corrigen acá, cada uno con un test que falló antes del fix (`tests/engines/lab-findings.test.js`). Las 8 decisiones del dueño que dejó (HUMAN DECISION REQUIRED) se cierran en esta misma versión (PLAN-2026-014). **Ningún costo, tarifa ni golden cambia**; sí cambia qué se marca como pendiente, y por eso el puntaje de completitud de las cotizaciones afectadas. Test Lab no cambia el esquema. Detalle en [docs/TEST_LAB.md](docs/TEST_LAB.md); reglas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §19 y §20.

### Agregado

- **Financiación de productos (D3).** `product.finance`: días entre producir y vender, plazo de cobro, tasa mensual y cuándo se paga cada grupo de costos, con el **mismo** `computeFinance` de las cotizaciones (sin duplicarlo). El costo financiero entra al costo por unidad, a los precios, al equilibrio y al resultado del mes; se ve en "Precio y margen" (capital financiado, costo financiero y efecto en el precio con tu margen), en el desglose y en "Ver cálculo". La amortización y el costo de capital no se financian. Es una **estimación financiera sobre costos netos**: el IVA de compras no está incluido en ese capital de trabajo (no es una simulación completa de caja) y la tarjeta "Financiación", el resultado del mes y "Ver cálculo" lo dicen siempre. Un producto nuevo arranca sin plazos ni tasa (nunca se inventan) y uno anterior calcula exactamente igual. Ejemplo: chipá del golden + 10 días de stock, cobro a 20 días y 3 % mensual → costo $ 345 → **$ 355,35**, precio con margen 30 % $ 492,86 → **$ 507,64**.
- **"No usa combustible" (D5)** en cada equipo propio, en la cotización y en Recursos (eléctrico, manual o estacionario): no se pide consumo ni precio de combustible por ese equipo, no consume trabajando ni en ruta y no impide el 100 % de completitud. Un consumo 0 **sin** la marca sigue siendo un dato faltante (nunca se infiere). En la demo, el tráiler y el kit de herramientas vienen marcados.
- **Horas de cobertura del personal (D2).** Pendiente "Horas del personal" (naranja, sólo cuando falta cubrir horas): "La operación requiere más horas de cobertura que las horas cargadas para este puesto. Revisá dotación, turnos y/o horas extra.", con el cálculo del mes (días × horas por día contra personas × horas normales por mes + horas extra), las horas que faltan por posición y botón a "Personas por posición". Es un control mensual: RATEOS no tiene un dato de jornada diaria y no habla de jornada. Nunca agrega horas extra, turnos ni personas.
- **Menos de una salida por mes (D1).** Aviso informativo (no resta puntaje) con salidas promedio, salidas costeadas y efecto del redondeo, y botón a "Cada salida se cuenta completa". Golden `salidas-menos-de-una-promedio` y `salidas-menos-de-una-completa`.
- **Km facturables ≠ km de ruta (D4).** Con la unidad "km", "Ver cálculo", "Cómo se cobra", "Movilización y viajes" y el Resultado muestran los dos números y su relación (km facturables por km de ruta); nunca se deriva uno del otro ni se pisa lo cargado.
- Test Lab: escenarios `SRV-D1…D8`, sondas PRB-20b y PRB-21, PRD-04 financiado, invariantes INV-29…31 y PINV-08…10, factores nuevos del generador y auditoría de terminología estática y dinámica (`UX-TERM-HARDCODED`, `UX-TERM-FOREIGN`, `UX-TERM-JORNADA`) y del alcance de la financiación de productos (`UX-PRODUCT-FINANCE-SCOPE`). Navegador: controles de cada decisión (escritorio y celular).
- `npm run test:lab` (campaña estable: falla si un golden cambia, si falta cobertura o si queda un P0/P1 sin triage), `npm run test:lab:extended` (con seed) y `npm run test:lab:e2e` (navegador). Reportes en `reports/lab/` (ignorado por git; artefactos en CI).
- Workflow **Test Lab** (`.github/workflows/test-lab.yml`): PR gate en cada PR (lab estable + build + navegador escritorio/celular) y Extended Lab sólo manual. Sólo lectura, sin deploy; Playwright con versión fija fuera del repo (RATEOS sigue con cero dependencias).
- Avisos informativos (no restan puntaje): puesto con sueldo y 0 posiciones ("no suma costo") y "el servicio no usa materiales" con materiales cargados ("no se suman al costo"), con botón al campo.

### Cambiado

- **Terminología de la activación (D8).** Una magnitud, un nombre por cotización (`js/domain/activation-terms.js`): **llamado** en on-call o con la unidad "llamado", **salida** en transporte, **trabajo** en llave en mano y precio cerrado, **intervención** en el resto (también en servicios permanentes: es el término neutral, RATEOS no sabe si cada activación es un relevo o un cambio de turno). Aplica a formulario, ayudas, avisos, "Ver cálculo", Resultado e impresión (PDF). "Viaje", "día de trabajo", "turno" y "salida de caja" son otras magnitudes y no cambian. La unidad de facturación "llamado" pasa a decir "$/llamado".
- **"Cada salida se cuenta completa" (D1)**: la semántica no cambia y se explicita: apagada = promedio; encendida = los costos indivisibles por salida con salidas enteras. Los textos dicen "promedio", "costeadas" y "efecto del redondeo".
- **Precio de combustible de ejemplo (D7)**: en una cotización real **nueva** (configuración de ejemplo o plantilla de demostración) el $ 1.500/l ILUSTRATIVO no cuenta como definido: la completitud lo marca en rojo, con el valor y su base, hasta "Es mi precio vigente" o un precio propio (`fuel.requiresConfirmation`). Las cotizaciones anteriores y la demo conservan el aviso naranja de siempre. Sin precio automático, scraping ni actualización.
- **CALCULATION_RULES (D6)**: se documentan tres reglas reales que no estaban escritas (IVA "Parcial" sin % = 0 % recuperable; "Otros costos" con categoría "Equipos y servicios externos" = costo directo del grupo Proveedores; las horas por día de una línea de equipo, que no tenían tope y que el dueño unificó después en 24 por unidad, ver abajo). El oráculo de Test Lab ya no tiene huecos.
- **Horas de equipo por día: 24 h por unidad (decisión del dueño)**: `hoursPerActiveDay` de una línea de equipo, propia o externa, son las horas de uso **por unidad** y tienen el mismo tope físico que la actividad (24 h); la cantidad de equipos va en `quantity`, que multiplica (2 equipos × 20 h = 40 equipo-horas por día, nunca 1 × 40 h). Más de 24 h sigue siendo un error de validación y el motor ya no calcula por encima del tope (`equipmentHoursPerDay` en `computeEquipmentLine` y `computeExternalLine`; "Ver cálculo" lo explica en la línea). Antes → después: 30 h × $ 1.000/h de operación = $ 30.000 → **$ 24.000 por día**. Sin cambio de esquema; ningún golden ni escenario anterior usaba más de 24 h.
- Los golden cases se leen con un harness compartido (`tests/golden-cases/harness.js`) que usa también el Test Lab; los casos y sus valores no cambian.

### Corregido

- **Indicador de externos con "Cada salida se cuenta completa"** (LAB-F1): sumaba el combustible por km del proveedor y quedaba más alto que la fila de externos de la EECC (COT-0011 con 13 viajes y 35 L/100 km: $ 9.205.000 → **$ 9.100.000**; caja $ 11.116.000 → **$ 11.011.000**). El costo total y las tarifas no cambian.
- **Unidad "km" con más km facturados que los de la ruta** (LAB-F3): 8.000 km facturados con una ruta de 4.000 km quedaba 100 % completo; ahora es un pendiente a revisar con los dos números y botón a "Viajes por llamado" (no se deriva: decisión del dueño). Una vuelta vacía (más km de ruta que facturados) no se avisa.
- **Unidad "viaje" o "km" con "Sin traslados"** (LAB-F4) y **"Sin traslados" con un equipo que viaja** por sus medios o con vehículo de apoyo (LAB-F5): se avisaba nada; ahora el pendiente dice qué no se suma y lleva a "Sin traslados".
- **Externo $/hora sin horas** (LAB-F6): sumaba $ 0 en silencio; ahora es **crítico** ("Horas del proveedor") con botón a las horas de la línea o de la actividad. **Cobro por hora con 0 horas por día** (LAB-F7): la actividad queda crítica (no hay unidades facturables).
- **Combustible por km con "Sin traslados"** (LAB-F2): el botón llevaba a la distancia (que con "Sin traslados" no resuelve nada); ahora explica y lleva a "Sin traslados".
- **Material con precio y cantidad 0** (LAB-F8): sumaba $ 0 sin aviso; ahora es un pendiente con botón a la cantidad, y `validateQuote` valida cantidades, costos y % de materiales y el monto de otros costos (una cantidad negativa es un error; con "El servicio no usa materiales" las líneas ocultas no se validan).
- **Botón al campo exacto** (LAB-F10/F11/F12): actividad, margen, tarifa conocida, plazo de cobro y costo de equipos llevan al campo; dentro de cada paso, "Ir al campo" usa el campo que indica el motor (antes faltaba en varios avisos nuevos y viejos).

## [0.7.2] - 2026-10-16

**Pulido desde casos reales de transporte (COT-0010 / COT-0011).** Las dos cotizaciones $/viaje que probó el dueño se reproducen al peso (golden): costo $ 12.864.478, piso $ 1.128.463, objetivo $ 1.261.224, sugerida **$ 1.262.000 por viaje**, margen 10,05 %, equilibrio 8,55 viajes. Se corrige un bug de viajes físicos, se ordena la completitud y se suman opcionales pedidos (combustible por km, recursos compartidos, "Usado en"). Las cotizaciones existentes conservan sus números (foto de 99 casos y COT-0009 idénticas), salvo las $/viaje con un dato de viajes inconsistente. **Esquema de datos 9** (`migrateV8ToV9`: sin cambios de datos). Plan: PLAN-2026-012; fórmulas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §4.1, §4.2, §5.2, §7, §15 y §19.

### Corregido

- **Viajes físicos con la unidad "viaje" (bug P0):** la ruta usaba "Viajes por llamado" (1 por defecto) aunque se vendieran 2 o 3 viajes por día. Ahora los viajes por intervención se **derivan**: viajes por día × días por intervención. Antes → después, COT-0011 con "Viajes por llamado" en 1: 6 viajes físicos y 1.200 km para 12 facturados, proveedor $ 3.900.000, costo $ 8.320.447, sugerida $ 816.000 → 12 viajes, 2.400 km, $ 7.800.000, $ 12.864.478 y **$ 1.262.000**. Con 1, 2 o 3 viajes por día y los mismos viajes facturables, los km y el costo de un proveedor por km no cambian. El dato guardado no se toca: un aviso explica el cambio y [Entendido] lo iguala. Las demás unidades siguen con "Viajes por llamado".
- **Completitud de combustible (P0):** sólo pide consumo a lo que consume combustible a tu cargo. Un externo con combustible incluido ya no deja "Falta el consumo" (COT-0010 / COT-0011: **92 % → 100 %** sin inventar consumo); provisto por el cliente, sin costo; si no hay nada a tu cargo, "No aplica". El botón lleva al **campo exacto** (`?campo=`) o no se muestra.
- **Equilibrio sin costos fijos:** en lugar de "0 viajes" y "los ingresos fijos ya alcanzan" (falso sin ingresos fijos): "Sin costos fijos: cada viaje vendido cubre su costo variable. Desde el primer viaje hay contribución positiva." El caso de ingresos fijos tiene su propio texto.
- Proveedor por km o por viaje **sin ruta**: pasa de "revisar" a **crítico** ("Falta definir la ruta/distancia para calcular este proveedor."), cuenta en la completitud y la línea dice "Falta la ruta" en lugar de $ 0, con [Definir la ruta].

### Agregado

- **Viajes y km del mes** en "Cómo se cobra", "Movilización y viajes" y el Resultado: viajes facturables, viajes físicos costeados, días de trabajo, km por viaje y km por mes, con "Ver cálculo" (12 ÷ 2 por día = 6 días; 12 viajes × 200 km = 2.400 km; 2.400 × $ 3.250 = $ 7.800.000).
- **Distancia / actividad del proveedor** separada de la movilización propia ("12 viajes · 200 km/viaje · 2.400 km/mes · $ 3.250/km = $ 7.800.000" y "Movilización propia y vehículos de apoyo: $ 0").
- **Tarifa ligada a la ruta**, sin forzar $/km: "Neuquén → Añelo · 200 km por viaje · $ 650.000 por viaje · equivalente $ 3.250/km"; en el Resultado, la tarifa por viaje con su equivalente por km.
- **Combustible de un externo por km** (opcional): L/100 km o km/L sobre los km físicos de la ruta (2.400 km × 35 L/100 km = 840 L = $ 1.260.000), en Combustible y aparte de la tarifa; sin duplicar con L/h, la movilización propia ni "combustible incluido". También en Recursos → Servicios externos.
- **Recursos compartidos** (opcional, PLAN-2026-006 §3.1): personal dedicado / compartido (%) / contratado para el servicio y equipo propio reservado / compartido (%). El % es explícito y mueve sólo los costos fijos ($ 3.280.036 × 25 % = $ 820.009; posesión $ 5.000.000 × 30 % = $ 1.500.000); horas extra, viandas y variables siguen el uso real. Sin dato = 100 %. La estructura por empleado usa la dotación equivalente. Aviso del resto no cubierto.
- **"Usado en"** en Recursos (personal, equipos y servicios externos): cada cotización con su estado y su % asignado; adjudicadas = compromiso, borrador / enviada = potencial; aviso si lo adjudicado supera el 100 % (no bloquea). Sin módulo de contratos.
- "Ver cálculo" del proveedor con la ruta (viajes, km, neto del mes, salida de caja, IVA que se adelanta y crédito fiscal) además del plazo, los días financiados y el costo financiero.
- Golden cases `cot-0010-transporte-1-viaje-por-dia`, `cot-0011-transporte-2-viajes-por-dia`, `cot-0010-transporte-3-viajes-por-dia` y `cot-0011-viajes-por-llamado-inconsistente`.

### Cambiado

- Estructura: aclara que Ingresos Brutos, el impuesto al cheque y sellos van en "Impuestos sobre lo que facturás" y avisa si un rubro desglosado parece uno de esos impuestos (doble conteo). No hay capa nueva ni alícuotas.
- Esquema de datos 8 → 9 (`migrateV8ToV9`, sólo sube la versión): campos opcionales `labor[].assignment` / `fixedCostSharePct`, `equipment[].assignment` / `fixedCostSharePct` y `external.fuelMode` / `fuelLitersPer100Km` / `fuelKmPerLiter`. Una versión anterior abre los datos v9 en sólo lectura.
- Ya estaban en v0.7.0 y sólo se confirman con tests: unidad visible de materiales y horas extra HE 50 % / HE 100 %.

## [0.7.1] - 2026-10-13

**Salidas completas y plazo de pago por proveedor.** Dos mejoras aprobadas por el dueño después de la auditoría de COT-0009, ambas opcionales: con la opción apagada y sin plazos propios, **todas las cotizaciones dan exactamente igual** (COT-0009 golden y foto de 99 casos idénticas). **Esquema de datos 8** (`migrateV7ToV8`: sin cambios de datos). Plan: PLAN-2026-011; fórmulas en [docs/CALCULATION_RULES.md §2.1 y §8](docs/CALCULATION_RULES.md).

### Agregado

- **"Cada salida / intervención se cuenta completa"** (en "Cómo se cobra", apagada por defecto). Las intervenciones estimadas siguen siendo un promedio (10,42) y la producción y la facturación no cambian; sólo los costos físicamente indivisibles por salida se costean con salidas enteras (11): movilización por sus medios, logística auxiliar (vehículos, peajes, viáticos), externos por llamado / viaje / km o con mínimo por llamado, movilización del proveedor, materiales y otros costos por llamado, con su estructura (si es %), su financiación y su contingencia. Sueldos, tenencia de equipos, estructura mensual y producción no se redondean. Se muestra "Intervenciones estimadas: 10,42 · Intervenciones costeadas: 11" y cuánto suma; apagada, cuánto sumaría. Ejemplo COT-0009 con 2.500 m³: +52.930,94 por mes (0,5833 salidas × 90.738,75).
- El equilibrio, los días para el margen objetivo y el comparador de modelos evalúan cada salto del costo (inicio de cada salida) para no saltear una pérdida.
- **"¿A cuántos días pagás a este proveedor?"** en cada equipo o servicio externo. Con plazo propio, ese externo se financia con su plazo; vacío, con el general de "Proveedores". El costo del externo no cambia: sólo el capital de trabajo y el costo financiero. Ejemplo COT-0009: pickup a 15 días → +42.000 de costo financiero. "Ver cálculo" muestra, por proveedor, la salida de caja, el plazo, los días financiados, el capital de trabajo y el costo financiero asociado; la tabla de Financiación agrega una fila por proveedor con plazo propio.
- Una "Condición de pago" de Recursos o un plazo cargado antes como dato informativo no se usan solos: la línea ofrece [Usar X días].

### Corregido

- Celular: los montos de "Equipos y servicios externos en el mes" (resultado) ya no se salen de la pantalla (bug de v0.7.0, visto en las pruebas de punta a punta).

### Cambiado

- El campo informativo "Plazo de pago al proveedor" del tratamiento fiscal se reemplaza por el plazo activo de "Pago al proveedor" (el dato anterior se conserva y se ofrece usarlo).
- Esquema de datos 7 → 8 (`migrateV7ToV8`, sólo sube la versión): campos opcionales `activity.fullActivations` y `equipment[].supplierPayDays`. Una versión anterior abre los datos v8 en sólo lectura.

## [0.7.0] - 2026-10-12

**Auditoría y pulido desde una cotización real (COT-0009).** Los números de COT-0009 (auditados externamente) se mantienen al peso y quedan protegidos por un golden case. Se corrige un bug económico (financiación de externos con IVA), cada número del reporte gana trazabilidad y se pulen las pantallas que podían inducir a cotizar mal. **Esquema de datos 7** (`migrateV6ToV7`: sin cambios de datos). Plan: PLAN-2026-010; fórmulas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §3.1, §4.1, §7, §8, §10, §17 y §19.

### Corregido

- **Financiación de equipos y servicios externos (bug P0):** el costo financiero se calculaba sobre el costo económico del externo; ahora se calcula sobre la **salida de caja** (neto + IVA + percepciones + cargos no recuperables). El IVA recuperable y las percepciones no son costo, pero se adelantan al proveedor hasta cobrar. **Sin tratamiento fiscal definido no cambia nada** (COT-0009 y las cotizaciones existentes sin IVA cargado quedan iguales). Antes → después, pickup tercerizada $ 2.800.000/mes financiada 45 días al 3 % mensual: IVA 21 % recuperable $ 0 → $ 26.460 por mes; IVA parcial 50 % $ 14.847 → $ 28.077; IVA recuperable + percepciones 3 % $ 0 → $ 30.240; IVA no recuperable $ 29.694 (sin cambio). La movilización que cobra el proveedor aparte también se financia con su IVA.
- Sin plazo de cobro, el costo financiero ya no se describe como "no calculado": se explica que es parcial (sólo los días hasta facturar) y cuánto da.
- Celular: la barra de resumen del editor ya no se sale de la pantalla cuando un valor es un texto ("No se alcanza"); los números abreviados no se cortan (bug preexistente, visto en el recorrido de rutas).

### Agregado

- Golden case `cot-0009-prueba-real` con todos los números del PDF: costo 28.367.260, piso 12.441,78/m³, objetivo 13.905,52/m³, sugerida 14.000/m³, facturación 33.600.000, impuestos 1.680.000, resultado 3.552.740, margen 10,5736 %, equilibrio ≈ 1.929,05 m³.
- **BORRADOR arriba del resultado** cuando quedan puntos materiales: "BORRADOR — revisar N puntos antes de usar esta tarifa", separando **crítico** (cambia el costo o el precio, por ejemplo un externo sin tarifa), **revisar** e **informativo** (no resta puntaje).
- Línea externa incompleta nombrada ("Equipo alquilado" no tiene tarifa del proveedor) con [Completar] y [Quitar]; asistente de datos del proveedor (tarifa, unidad, IVA, recuperable, percepciones, operador, combustible, seguro, movilización) sin inventar tasas.
- **Impacto incremental** de cada externo en "Ver cálculo": cuánto sube el costo total con la línea (proveedor + estructura + financiación + contingencia). COT-0009: la pickup de $ 2.800.000 sube el costo $ 3.221.400.
- **Horas extra por tramos** (HE 50 %, HE 100 %, otro recargo; editables, no normativa), por día activo o promedio por mes, con detalle por persona y la pregunta "¿Estas horas extra se facturan aparte al cliente?" (siguen siendo costo y además suman ingreso). Sin tramos, el campo único de siempre da lo mismo al centavo.
- **"Desglosar estructura"**: rubros con su propio método (administración % sobre directo, HSE por empleado, seguros por contrato…), guardables como política de la empresa en Configuración y reutilizables. El modo simple sigue igual.
- Comparador de modelos en la unidad comercial ($/m³, $/viaje, $/unidad): tarifa por unidad, abono + tarifa, facturación mínima (take-or-pay) + tarifa, paquete con unidades incluidas + excedente; equilibrio en la unidad. Los modelos por día no cambian.
- "Equivalencias operativas" de una tarifa por cantidad ($/m³, $/viaje…): $ por día de trabajo, $ por hora de trabajo y facturación del mes, con su cálculo.
- Viajes con el detalle A/B/C: A. movilización de los equipos principales (salidas, km por salida y por mes, litros, combustible y desgaste por mes), B. vehículos y logística auxiliar, C. total con su incidencia; "Ver cálculo" de la logística con los pasos por mes. Cada costo sigue en un solo lugar.
- Materiales: unidad visible con opciones habituales (unidad, L, kg, g, t, m, m², m³, paquete, bolsa, tambor) o propia, y la fórmula "10 L/día × $ 5.000/L = $ 50.000/día · 20 días = $ 1.000.000/mes".
- Resumen por intervención (m³ por salida, costo por salida) y aviso si las salidas por mes no son enteras (el costo por salida es un promedio).
- Fecha base: lista de los valores sin base o con base vieja y la opción **"Usar [mes] (mes de la oferta) en los N sin base…"**, con confirmación; nunca pisa una base definida y queda marcada como "Mes de la oferta".
- Aviso informativo de equipo propio sin costo de capital (opcional; no es la financiación del contrato).
- Contrato a 12 meses: "Valores constantes a base [mes]. No incluye actualización ni escalación".

### Cambiado

- "Días por viaje o llamado" → **"Duración promedio de cada salida / intervención"**.
- La tarjeta de equilibrio dice con qué tarifa se calculó ("a $ 14.000/m³").
- EECC: "Fijo del mes" y "Variable por día de trabajo" en columnas separadas (el "$/día activo" mezclaba los fijos); los montos no cambian.
- Eje X del gráfico en la unidad de la cotización (m³, viajes, días…).
- Contingencia: ayuda, aviso en 0 % y nota para no duplicarla con el margen. Estructura: texto neutro en lugar de "es el método más usado".
- Financiación: tasa anual → mensual (÷ 12, interés simple) y explicación de qué se financia.
- Esquema de datos 6 → 7 (`migrateV6ToV7`, sólo sube la versión): campos opcionales `labor[].overtime`, `labor[].overtimeBilled`, `indirect.mode`, `indirect.items`, `settings.indirectPolicy` y fuente de base `'offer'`. Una versión anterior abre los datos v7 en sólo lectura.

## [0.6.0] - 2026-10-12

**Unidades de facturación según el tipo de servicio.** Elegir "Servicio por unidad producida" ya no deja sólo $/día, $/hora o $/mes: cada tipo de servicio ofrece sus unidades (m³, viaje, tonelada, km, llamado, turno, trabajo, hito… y siempre una propia), la actividad se carga en esa unidad y el equilibrio se lee en ella ("6.000 m³ para no perder"). Motor generalizado a **cantidad facturable × precio por unidad** con los costos calculados por días de trabajo (**unidad de costo ≠ unidad de venta**). **Esquema de datos 6** (`migrateV5ToV6`: sin cambios de datos). Plan: PLAN-2026-009; fórmulas en [docs/CALCULATION_RULES.md §12.1](docs/CALCULATION_RULES.md#121-unidad-de-facturación-según-el-tipo-de-servicio-plan-2026-009).

### Agregado

- Unidades por tipo de servicio, con "Otra / personalizada" siempre: on-call ($/día, $/hora, $/llamado o salida, $/mes); permanente ($/mes, $/día, $/hora, $/turno); cuadrilla ($/día, $/hora, $/turno, $/mes); equipo con o sin operador ($/día, $/hora, $/mes, $/viaje); por unidad producida ($/unidad, $/m³, $/tonelada, $/kg, $/metro, $/m², $/km, $/lote); transporte ($/viaje, $/km, $/tonelada, $/ton-km, $/m³, $/hora, $/día); llave en mano y precio cerrado ($ global por trabajo, $/hito); horas y materiales ($/hora, $/día); configurable (todas).
- Unidad propia: se escribe el nombre ("pozo", "muestra") y la cotización cobra "$/pozo" y pregunta "¿Cuántos pozos esperás facturar por mes?".
- Actividad en la unidad comercial: cantidad a facturar por mes y cantidad por día de trabajo (rendimiento); por llamado o trabajo, cuántos por mes y cuántos días de trabajo lleva cada uno (y hitos por trabajo). RATEOS deriva los días de trabajo, que son los que consumen personal, equipos y combustible, y avisa si superan los días disponibles.
- Cantidad de equilibrio en la unidad ("Viajes para no perder: 20 viajes", "Unidades para no perder: 200 u."), con sus días de trabajo y "Ver cálculo" por unidad (costo variable y contribución por m³, viaje…).
- Horas y materiales: opción **"Facturo los materiales aparte (al costo más un recargo)"** en Materiales (marcada al elegir ese tipo de servicio): lo que se cobra por los materiales (costo × (1 + markup de reventa)) suma a la facturación; el costo no cambia.
- Golden cases A–E (`unidad-bombeo-m3`, `unidad-transporte-viaje`, `unidad-movimiento-suelo-m3`, `unidad-inspeccion-unidad`, `unidad-on-call-dia`) y tests del motor y de los textos por unidad.

### Cambiado

- Al elegir el tipo de servicio, la unidad pasa a la habitual de ese tipo (por ejemplo $/unidad o $/viaje) si todavía no hay tarifa ni mínimo por llamado cargados; si ya los hay, no se cambia (el número se leería en otra unidad) y se avisa.
- Cambiar de unidad con una tarifa cargada entre unidades sin conversión segura (por ejemplo de m³ a toneladas) pide borrarla o cancelar; día ↔ hora se sigue convirtiendo.
- Resultado, "El precio", resumen en vivo, matriz, gráfico, sensibilidad, escenarios y listado muestran tarifas "/ m³", "/ viaje"… y cantidades en la unidad; nunca "/ día" si no se cobra por día. El mínimo por llamado se carga en la unidad (m³, viajes…) y no aplica por llamado o trabajo.
- Los descuentos por cantidad de días se aplican sólo con tarifa por día u hora (con otras unidades se explica que no aplican; los tramos quedan guardados).
- Una unidad que no es habitual para el tipo de servicio (por ejemplo $/día en "por unidad producida") calcula igual y muestra "Revisá cómo cobrás".
- **$/día, $/hora y $/mes calculan exactamente igual que antes** (comparación completa de 99 casos idéntica). En "Ver cálculo" el rótulo "Unidades facturables (mess)" se corrige a "(meses)".

### Datos

- `SCHEMA_VERSION` 5 → 6. `migrateV5ToV6` no cambia ni borra datos; una versión anterior abre los datos v6 en sólo lectura (no calcula "por día" una cotización por m³). Campos nuevos opcionales: `quote.unitName`, `activity.billableQuantityPerMonth`, `activity.unitsPerActiveDay`, `activity.unitsPerActivation`, `pricing.materialsBilledSeparately`.

## [0.5.1] - 2026-10-12

Servicios y productos en una misma experiencia de costeo y precio. **Sólo interfaz, navegación y textos**: no cambia ninguna fórmula, ningún motor, el esquema de datos (sigue en 5), Supabase ni RLS. Cotizaciones y productos siguen siendo modelos distintos por debajo.

### Cambiado

- El botón principal del menú pasa de "+ Nueva cotización" a **"+ Nuevo cálculo"** (`#/nuevo`), que pregunta primero **"¿Qué querés calcular?"**: **Servicio** ("Calculá cuánto cuesta prestar un servicio y cuánto deberías cobrar.") lleva a la pantalla de siempre para elegir el servicio y su tipo (on-call, permanente, cuadrilla, equipo con operador, transporte, llave en mano, precio cerrado…); **Producto** ("Calculá cuánto cuesta producir cada unidad y a qué precio venderla según el margen que buscás.") lleva al editor de productos existente.
- **Inicio**: "¿Qué querés calcular hoy?" con dos accesos, **[Nuevo servicio]** y **[Nuevo producto]**.
- "Nuevo servicio" y "Nuevo producto" muestran "Inicio / Nuevo cálculo" en la ruta de navegación y un enlace para cambiar al otro tipo de cálculo.
- Bienvenida: "Calcular un servicio", "Calcular un producto" o "Configurar recursos".
- Landing y textos públicos: "Sabé cuánto te cuesta. Definí cuánto cobrar." para servicios, contratos, productos, producción y comercio (sin limitarse a Oil & Gas); "Empezar a calcular" lleva a "¿Qué querés calcular?".
- El menú lateral sigue con Cotizaciones, Productos, Recursos, Servicios y Escenarios.

## [0.5.0] - 2026-10-11

**Productos**: además de servicios, RATEOS calcula el costo y el precio de un producto (chipá, facturas, viandas…) paso a paso. Motor nuevo (las cotizaciones **no cambian**: mismas fórmulas y mismos números) y **esquema de datos 5** (`migrateV4ToV5` agrega `products: []`, con copia previa). Plan: PLAN-2026-008.

### Agregado

- Sección **Productos** en el menú, con lista (costo por unidad, precio sugerido, margen, equilibrio y estado), duplicar y eliminar, y un **ejemplo "Chipá"** con valores ILUSTRATIVOS.
- Editor en 7 pasos: **El producto** (tanda, pérdida, ventas por mes) → **Ingredientes y materiales** (por tanda o por unidad; g ↔ kg, ml ↔ l, unidad ↔ docena; precio por unidad o del paquete; merma) → **Personal** (sueldo, convenio y cargas, minutos por tanda) → **Máquinas y equipos** (uso por tanda: luz o gas y mantenimiento; tenencia: amortización y seguro como fijo del mes con el % que decide la empresa) → **Gastos fijos** (alquiler, servicios, contador… con el % para el producto) → **Precio y margen** (margen sobre el precio, impuestos sobre la venta, redondeo hacia arriba, IVA opcional y precio de hoy) → **Resultado** (costo por unidad, precio piso, precio sugerido, ganancia por unidad, equilibrio en unidades por mes, resultado del mes y análisis del precio actual). "Así va tu producto" en vivo en cada paso y "Ver cálculo" en cada número.
- Personal: cuántas horas del mes dedica cada persona a este producto (por ejemplo "75 h de las 176 h que trabaja") y aviso si las ventas necesitan más horas de las que hay. Es informativo: el costo sigue siendo por minuto de tanda.
- Traer personal, equipos y materiales de **Recursos** con copia: si el recurso cambia, el producto avisa y se elige [Actualizar en este producto] o [Conservar valor original].
- Convenios: tipos **Empleados de Comercio (CCT 130/75)**, **Panaderos / pasteleros** y **Gastronómicos** (sólo nombres; los parámetros siguen siendo los de cada empresa o los genéricos ILUSTRATIVOS).
- Golden case `producto-chipa-costo-y-precio.json` (costo $ 345, precio $ 492,86 con 30 % de margen, equilibrio 848,7 u/mes) y tests del motor, de la migración v4 → v5, del repositorio y de la interfaz. Fórmulas en [docs/CALCULATION_RULES.md §23](docs/CALCULATION_RULES.md#23-productos-costo-por-unidad-y-precio-plan-2026-008).

### Cambiado

- Esquema de datos **4 → 5**: agrega la lista de productos; no cambia ni borra ningún dato. La versión 0.4.x abre los datos v5 en sólo lectura.
- Textos de la landing, Inicio y README: "servicios y productos".
- Formulario de impuestos sobre la facturación: textos propios cuando se usa en un producto.

### Corregido

- Antes de publicar: guardar o eliminar un producto en una cuenta se subía a la nube recién con la siguiente escritura de otra cosa. Ahora se sube enseguida, como el resto, y un test verifica que **toda** escritura del repositorio local se sincroniza con la cuenta.

## [0.4.1] - 2026-10-06

Cierre del MVP: revisión completa (sólo errores) después de publicar 0.3.0 y 0.4.0. **No cambia ninguna fórmula**, ningún motor ni el esquema de datos (sigue en 4).

### Corregido

- **Deploy:** producción ya no puede volver atrás sola. Cada corrida elige el commit de `main` al empezar. Un deploy de `/preview/` que arrancaba antes de un merge y terminaba después volvía a publicar en producción la versión anterior de `main`. Ahora el job `deploy` vuelve a leer el último commit de `main` justo antes de publicar y, si cambió, no publica: lo hace la corrida del commit nuevo. Un rollback pedido a mano sigue publicando el commit o tag pedido. Detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- `.agent/PLANS.md`: los planes ya mergeados (001, 002 y 007) figuraban "en curso". Se agrega la lista de pendientes de UX y funcionalidades registrados en el cierre, sin implementar.

## [0.4.0] - 2026-10-06

Mantenimiento y neumáticos con forma de carga (PR #15).

Corrige una UX que inducía errores: un mantenimiento mensual o anual cargado en el campo "$/h" se interpretaba como costo por hora (caso real: autoelevador con $ 3.000.000 "por hora" → $ 360.000.000 en 15 días). **Cambia el motor de equipos** (formas de carga nuevas) y **sube el esquema de datos a 4** (sin cambios de datos). Con los datos existentes **ningún número cambia**: sin forma de carga se sigue usando "por hora" (golden cases, baseline y migración con los mismos resultados). Plan: PLAN-2026-007.

### Agregado

- **Mantenimiento**: costo por hora de uso; **service** (costo cada N horas de uso → $/h); o **presupuesto mensual o anual** → costo FIJO de tenencia (se suma a la posesión; nunca se divide por horas).
- **Neumáticos**: costo por hora; **juego + vida útil en horas** (→ $/h); **juego + vida útil en km** para equipos de ruta (→ $/km, se suma al desgaste en ruta de la movilización).
- "**Así lo calcula RATEOS**" en vivo, antes de guardar, en el legajo del equipo y en la línea de la cotización (por ejemplo "$ 600.000 cada 250 h = $ 2.400 por hora de uso" o "$ 3.000.000 por mes de COSTO FIJO de tenerlo").
- **Avisos de sentido común** (no bloquean ni corrigen): "Revisá este valor. Con el mantenimiento cargado, 100 horas de uso cuestan más que el valor del equipo. ¿Seguro que el importe está expresado por hora?"; mantenimiento o neumáticos desproporcionados; presupuesto anual mayor que el equipo; neumáticos por km absurdos; residual mayor que reposición; vida útil 0; falta el intervalo del service o la vida útil del juego. En la cotización se ven siempre (fuera de las opciones avanzadas).
- Tests de migración: el número (código) de cada cotización no cambia en v2 → v3 → v4 ni en v3 → v4, y una cuenta v3 en la nube pasa a v4 con copia previa en el navegador y los mismos resultados.
- Tests de la regla on-call: con 1, 15 o 30 días trabajados, la amortización, el seguro, la patente, las certificaciones, el mantenimiento por presupuesto y el costo de capital cuentan el mes completo (15 días ≠ 50 % del fijo); combustible, neumáticos y operación crecen con el uso.

### Cambiado

- Esquema de datos **4** (`migrateV3ToV4`: no cambia datos; copia previa automática). Una versión anterior abre los datos v4 en sólo lectura.
- Los datos cargados no se modifican: un valor guardado "por hora" sigue siendo por hora hasta que la persona lo cambie.

### Seguridad

- `supabase/tests/rls_admin_test.sql` corre también con el bootstrap del master ya consumido (la base de producción): usa como RATEOS ADMIN a la cuenta que lo consumió, sin que su id salga del bloque, y verifica que el bootstrap no se pueda volver a usar. Siguen siendo 32 controles y todo se deshace al terminar.

## [0.3.0] - 2026-10-06

Carga inicial de empresa, recursos y personal (PR #14). Iteración corta de UX y catálogos para la carga inicial de empresa, recursos y personal. **No cambia ninguna fórmula**, ningún motor ni el esquema de datos (`schemaVersion` sigue en 3): los campos nuevos son descriptivos y opcionales.

### Agregado

- **Sector de la empresa buscable** (Bienvenida y Configuración → Tu empresa): 20 sectores amplios tomados de las secciones de la ClaNAE (INDEC; el CLAE de ARCA usa las mismas), con "Petróleo y gas" aparte de "Minería" y **Otro / Personalizado**. Se busca sin tildes y por palabras clave ("petróleo", "Vaca Muerta", "camiones"…). No se cargan códigos fiscales. Catálogo en `js/domain/industry-catalog.js`; componente `searchSelectField` (combobox accesible) en `js/ui/components.js`.
- **Actividad / especialidad** (opcional, texto libre con sugerencias según el sector: servicios al pozo, transporte de cargas, mantenimiento industrial, construcción civil, servicios ambientales, montaje, ingeniería, limpieza industrial…). Se guarda en `organization.activity`; pasa a la empresa propia al "Empezar en limpio" y al importar el modo local.
- **Catálogo de equipos ampliado** a 29 familias (se suman camión atmosférico / vacío, batea, tanque, cargadora frontal, motoniveladora, equipo de soldadura y torre de iluminación) con **variantes descriptivas sugeridas** (p. ej. Vactor 5 / 10 / 12 / 15 yd³, camión tractor 4x2 / 6x2 / 6x4, semirremolque 3 ejes tándem / 1+2 / 1+1+1 / sider / carretón / batea / tanque). Sin precios, consumos ni especificaciones económicas.
- **Mis equipos**: sección "¿Qué equipo es?" (familia → variante → nombre) y campo **Capacidad / especificación** (`capacity`, opcional). Elegir una variante completa la capacidad y, si el nombre está vacío, sugiere el nombre; todo queda editable y "Personalizado" deja escribir la propia. La capacidad se ve en la lista. Los modelos del Catálogo usan las mismas sugerencias.

### Cambiado

- **Personal**: el sueldo y su base económica van juntos en "Sueldo y base económica (por persona)": **Sueldo básico mensual · Período base (mes del sueldo) · Fuente · Referencia** (antes la base estaba al final del formulario). La lista de Personal tiene la columna **"Base del sueldo"** ("Base: sep-26" o "Base no definida"), también en la vista de tarjetas.
- Familias renombradas para que se entiendan solas: "Vactor / camión combinado", "Carretón" (la batea es ahora su propia familia), "Camioneta", "Compresor / motocompresor", "Otro / Personalizado". Los ids no cambian: los equipos guardados siguen en su familia.
- Tipos de empresa anteriores: "Servicios petroleros" se lee como sector *Petróleo y gas* y "Mantenimiento industrial" como *Industria manufacturera*, con esa descripción como actividad; el dato guardado sólo cambia cuando la persona edita el sector o la actividad.

## [0.2.0] - 2026-10-05

Tres cambios en esta versión:

1. **Rediseño de experiencia de usuario**: simple en la superficie, potente por debajo. No cambia ninguna fórmula económica. Ninguna capacidad se eliminó: lo avanzado quedó colapsado o en pantallas secundarias. Guía en [docs/UX.md](docs/UX.md).
2. **Impuestos sobre la facturación con gross-up exacto** (PLAN-2026-002, a partir del análisis conceptual de una estructura de costos profesional: [docs/REFERENCE_COST_STRUCTURE.md](docs/REFERENCE_COST_STRUCTURE.md)). **Es un cambio de regla de negocio** y **sube el esquema de datos a 2** (con migración). Con los impuestos sin definir —el estado de todas las cotizaciones existentes y de la demo— **ningún número cambia** (baseline de regresión). Detalle abajo.
3. **Usuarios reales con Supabase** (PLAN-2026-003): cuentas con Supabase Auth, datos de cada empresa en la nube protegidos con Row Level Security y demo pública aislada. **No cambia ninguna fórmula** ni el esquema de datos (`schemaVersion` sigue en 2). Detalle en [docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md) y [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md).
4. **RATEOS ADMIN** (PLAN-2026-004): rol de plataforma separado de los roles de empresa, con un panel `#/admin` de **metadata** (usuarios, empresas, actividad). Administrar la plataforma ≠ leer los datos de los clientes: el admin no ve cotizaciones, costos, márgenes ni tarifas. **No cambia ninguna fórmula** ni el esquema de datos.
5. **Recursos con base económica, snapshots, equipos propios / externos y movilización** (PLAN-2026-005, versión **0.2.0**). **Sube el esquema de datos a 3** (con migración) y agrega reglas de cálculo nuevas para alquilados, tercerizados, movilización y moneda. Con los datos existentes **ningún número cambia** (baseline de regresión de 21 casos y migración v2 → v3 con los mismos resultados). Detalle en [docs/RESOURCE_MODEL.md](docs/RESOURCE_MODEL.md): RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN.

### Agregado

- **Versión visible** en el menú lateral, la landing y Configuración → Acerca de: "v0.2.0 · build abc1234 · fecha" (para saber si estás viendo la versión actualizada). `package.json` pasa a 0.2.0.
- **Base económica** en cada valor económico (sueldos, valor y costos de equipos, tarifas externas, materiales, combustible, tipos de cambio): mes, moneda, fuente y referencia, visible como **"Base: sep-26"** o **"Base no definida"** (nunca se inventa una fecha).
- **Snapshot por línea de cotización**: cada línea guarda qué copió de Recursos y cuándo ("De Recursos · copiado el …"). Si después cambia el recurso: "El costo de X fue actualizado desde que hiciste esta cotización." con valor utilizado vs valor actual y **[Actualizar en esta cotización] [Conservar valor original]**. La cotización nunca cambia sola.
- **Base económica de la oferta**: fecha de la oferta (`quote.offerDate`) como base general, base por rubro y avisos "Esta cotización usa valores con diferentes fechas base", bases de más de 6 meses y valores sin base (en "Tipo de servicio" y en Resultado → Profundizá).
- **Recursos**: pestañas **Servicios externos** y **Catálogo de equipos**. Catálogo de 22 familias (vactor, hidrogrúa, carretón, retro…, sólo descriptivo y sin precios) + modelos propios de la empresa; **Mis equipos** con legajo por unidad (interno, modelo, dominio, obtención, valor, costos, operación, movilidad) con divulgación progresiva.
- **Equipos propios, alquilados o tercerizados**: tarifa NETA del proveedor por hora, día, mes, viaje, km, llamado o global, con mínimo; qué incluye (operador, combustible, movilización, seguro) y **tratamiento fiscal** (IVA y si es recuperable Sí / No / Parcial, percepciones, cargos no recuperables, plazo de pago). Costo económico ≠ salida de caja ≠ crédito fiscal. Motor `js/engines/external-engine.js`.
- **Movilización del recurso principal** ("¿Cómo llega cada equipo al lugar del servicio?": por sus propios medios, lo transporta otro equipo, con un vehículo de apoyo, no requiere) separada de la **logística auxiliar**. Si maneja su operador no se suma otra persona; el desgaste por km no incluye amortización. Motor `js/engines/mobilization-engine.js`. El paso "Viajes" pasa a llamarse **"Movilización y viajes"**.
- **Moneda y tipo de cambio**: valores en USD o EUR se convierten con el tipo de cambio PROPIO de cada cotización (lo carga la empresa); sin tipo de cambio no se suman y la cotización queda en rojo. Configuración: fecha base del combustible y tipos de cambio por defecto. Motor `js/engines/currency-engine.js`.
- Operador asignado a cada equipo (de los puestos de Personal), con aviso si la tarifa del proveedor ya incluye operador.
- Reglas de completitud nuevas: `mobility`, `external_terms`, `duplicates`, `economic_base`, `base_age`, `currency` ([CALCULATION_RULES.md §19](docs/CALCULATION_RULES.md#19-cost-completeness-score)).
- Golden cases: `externo-alquiler-iva-recuperable`, `externo-alquiler-iva-no-recuperable`, `externo-minimo-por-llamado`, `movilizacion-autopropulsada-160km`. Tests de integración de los casos A–F (`tests/engines/resource-cases.test.js`).
- **Staging seguro**: en `/preview/` y en el servidor local (que comparten la base con producción) la app pregunta antes de actualizar el formato de los datos de una cuenta ("Versión de prueba: ¿actualizar el formato de tus datos?") o de crear el espacio de una cuenta nueva; si no, los abre en sólo lectura sin escribir nada.
- Recursos en otra moneda: la ficha de un equipo en USD se calcula con el tipo de cambio por defecto de Configuración (si no hay, se informa en lugar de mezclar dólares con pesos); los costos de materiales se muestran en su moneda.
- Al importar datos del modo local, los tipos de cambio y la fecha base del combustible de la cuenta no se pisan con valores vacíos.
- Un backup con plantillas mal formadas se rechaza al importarlo (antes fallaba después, al crear la cotización).
- Deploy de staging: un deploy de `/preview/` atrasado (cola de runners o re-run de un CI viejo) ya no puede pisar uno más nuevo; antes de publicar se verifica que el commit siga siendo el último de la rama.
- **RATEOS ADMIN** (rol de plataforma): panel `#/admin` con usuarios totales, organizaciones totales, usuarios registrados en los últimos 7 / 30 días y workspaces activos, más una tabla de usuarios (nombre, email, empresa, rol de empresa, fecha de alta, última actualización). La entrada "RATEOS Admin" del menú y la insignia "RATEOS ADMIN" en la cuenta sólo aparecen si la base confirma el rol; un usuario normal que entra a `#/admin` ve "No tenés permisos para acceder a esta sección.". Migración `supabase/migrations/20261005034916_rateos_platform_admin.sql` (tablas en `private`, funciones `am_i_platform_admin` / `admin_overview` / `admin_users`, auditoría `ADMIN_PANEL_OPEN`). Detalle en [docs/AUTH_ARCHITECTURE.md §6.1](docs/AUTH_ARCHITECTURE.md#61-rol-de-plataforma-rateos-admin).
- **Staging público en `/preview/`** del mismo GitHub Pages: producción (`/COTIZADORWEB/`) se construye siempre desde `main`; `/preview/` desde la rama de desarrollo (cuando su CI pasa), con la franja "RATEOS · STAGING · rama · build", `noindex` y "[STAGING]" en el título. Un deploy de preview nunca reemplaza producción: el workflow se lee siempre de `main`, la raíz sólo publica commits de `main` y `scripts/stage-preview.mjs` falla si cambia un archivo de producción. El código de la rama se construye sin permisos de escritura. Detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#githubworkflowsdeploy-pagesyml--deploy-rateos-a-github-pages).
- **Impuestos sobre lo que facturás** (Ingresos Brutos, débitos y créditos, sellos, otros cargos sobre lo facturado). No son costo: se pagan sobre el precio, así que se cubren con un gross-up exacto junto con el margen: `facturación necesaria = costo / (1 − margen − impuestos)`. Costo 100, margen 10 %, impuestos 10 % → **125** (no 121 ni 123,46); tarifa piso 111,11. Se cargan como "Un % total" o "Detalle por impuesto" (excluyentes) o se elige "No incluir impuestos sobre la facturación en esta cotización" (una elección de cálculo, no una afirmación fiscal). **RATEOS no trae alícuotas**: sin definir, la tarifa piso no los incluye y se avisa. Valor de la empresa (`settings.defaultBillingTaxes`) para cotizaciones nuevas. Fórmulas en [docs/CALCULATION_RULES.md §13.1](docs/CALCULATION_RULES.md#131-impuestos-sobre-la-facturación-gross-up).
- **"¿Cómo se forma tu precio?"** en el Resultado (desplegable de "Profundizá", cerrado por defecto): de cada $ 100 que facturás, cuánto es costo, cuánto impuestos sobre lo que facturás y cuánto ganancia (100 % del precio; la estructura de costos sigue sumando 100 % del costo). "Ver apropiación y total del contrato": cuánto de cada día (u hora, o mes) cobrado va a cada rubro, a impuestos y a ganancia —suma la tarifa neta; ÷ factor de descuentos = tarifa de lista— y el total del contrato. "Los números cierran" en "Ver cálculo completo": controles automáticos de cuadre. Motor `js/engines/price-composition-engine.js` (`priceComposition`), sin fórmulas en la interfaz.
- `js/engines/billing-taxes-engine.js` (`billingTaxInfo`, `billingTaxConfigInfo`, `traceBillingTaxes`), `js/domain/billing-taxes.js` (forma de los datos) y en `pricing-engine` `priceFromMarginAndTaxes`, `markupWithTaxesPct`, `profitOnCostPct`, `isValidMarginAndTaxes`, `readMarginInput`. Nuevos KPIs: `billingTaxes`, `billingTaxPct`, `billingTaxesDefined`, `billingTaxesInvalid`, `targetMarginInvalid`, `targetMarkupPct`, `targetProfitOnCostPct`, `profitOnCostPct`, `priceToCostMultiplier`; traza "Impuestos sobre lo que facturás".
- **Convención de montos explícita: "Montos sin IVA"** (`quote.vatTreatment = 'excluded'`, `VAT_TREATMENTS` en el catálogo). RATEOS siempre calculó sin IVA; ahora cada cotización lo declara, el editor lo muestra al empezar ("Esta cotización usa costos, precios y tarifas sin IVA: si tenés un valor con IVA, descontalo antes de cargarlo") y en cada etapa, y los formularios de equipos, materiales y combustible lo aclaran. Una cotización con otra convención no se calcula en silencio: `validateQuote` informa un error. Preparado para soportar otra convención en el futuro sin cambiar la forma de los datos.
- Regla de completitud `billing_taxes` (peso 1): naranja si están sin definir, rojo si hay un % inválido.
- Validación: cada impuesto entre 0 y < 100 %, total < 100 % y margen + impuestos < 100 % ("Con X % de impuestos sobre la facturación, el margen tiene que ser menor a (100 − X) %").
- Golden cases: `gross-up-impuestos-facturacion` (125), `tarifa-piso-con-impuestos` (111,11), `markup-con-impuestos` (25 %: precio 125 = costo 100 × 1,25), `ganancia-sobre-costo-con-impuestos` (12,5 %), `on-call-break-even-con-impuestos` (11,54 días), `on-call-tarifa-minima-6-dias-con-impuestos` (6.666.666,67) y `on-call-cotizacion-con-impuestos` (piso 4.444.444,44, objetivo 5.000.000, resultado 10 %). Tests de invariantes: facturación = costo + impuestos + resultado.
- **Red de seguridad** `tests/engines/regression-baseline.test.js` + `tests/fixtures/baseline-v1.json`: con impuestos sin definir, KPIs, EECC, matriz y tramos de 21 casos (demo, referencia, plantillas y variantes sintéticas) son idénticos a los del motor anterior.
- [docs/REFERENCE_COST_STRUCTURE.md](docs/REFERENCE_COST_STRUCTURE.md): lógica conceptual de una estructura de costos profesional y decisiones de diseño, sin datos de la planilla de referencia (privada, fuera del repo). Las planillas (`.xls`, `.xlsx`, `.ods`…) quedan excluidas por `.gitignore` y un test de arquitectura.

- **Sitio público separado de la aplicación.** Landing en `#/` ("Cotizá servicios sabiendo cuánto te cuestan."), con mockup del producto calculado en vivo sobre la demo ILUSTRATIVA, tres resultados (cuánto te cuesta, cuánto cobrar, cuánto necesitás trabajar), "¿Te pasa esto?", cómo funciona en 3 pasos y para quién.
- **Demo guiada** `#/demo` de "Hidrogrúa on-call — Añelo" en 4 pasos antes del análisis completo, con un selector de días activos que recalcula la tarifa piso sin guardar cambios. `QuoteService.ensureDemoQuote()` vuelve a crear la demo si se había borrado (con un código nuevo; nunca reutiliza códigos).
- **Ingresar / Crear cuenta / Bienvenida** (`#/login`, `#/registro`, `#/bienvenida`). Primero fueron un flujo preparado sin cuentas; en esta misma versión pasaron a ser **cuentas reales** (ver abajo). El onboarding guarda el tipo de empresa (`organization.industry`, campo opcional) y la base operativa.
- **Cuentas reales (Supabase Auth):** registro con nombre, empresa, email y contraseña (mínimo 8), **confirmación de email** ("Revisá tu email"), ingreso, cierre de sesión y recuperación de contraseña, con mensajes humanos (nunca errores técnicos). Enlaces de email PKCE bajo `/COTIZADORWEB/` compatibles con el router por hash (`?auth=confirm&next=…` antes del `#`; el código se limpia de la URL). La sesión se restaura al recargar; si vence: "Tu sesión terminó. Volvé a ingresar." sin perder los cambios. SDK oficial `@supabase/supabase-js` 2.117.2 vendorizado (`js/data/vendor/`, hash verificado; sigue sin dependencias npm).
- **Base de datos** (migración `supabase/migrations/20261005013833_rateos_identity_workspace.sql`, aplicada con el plugin de Supabase): `profiles`, `organizations`, `organization_members` (OWNER / ADMIN / ESTIMATOR / VIEWER) y `workspace_states` (estado versionado de cada empresa con `revision`). Al registrarse se crean la empresa, la membresía OWNER y un espacio de trabajo **vacío**. **RLS en todas las tablas**, sin permisos para `anon`, `update` sólo por columna, columnas de control fijadas por trigger. Tests: `supabase/tests/rls_test.sql` (40 controles, usuarios A/B, anon, escalada de rol) y `tests/supabase/migrations.test.js`.
- **Tres estados separados:** visitante (landing, ingreso, registro, recuperar contraseña), **demo** sin cuenta (`#/demo`, `#/demo/analisis`, en memoria: nunca escribe en el navegador ni en la nube) y usuario autenticado (`#/inicio` y toda la app). Las rutas protegidas sin sesión van a `#/login?next=…` (sólo destinos internos) y no se muestra nada protegido mientras se restaura la sesión.
- **`SupabaseRepository`:** mismo estado y validaciones que el modo local, guardado en la nube con **control de revisión** (nunca *last-write-wins* silencioso: "Tus datos cambiaron en otro dispositivo." con [Recargar] [Conservar una copia]); sin conexión: "No pudimos sincronizar tus cambios.", copia local recuperable y reintentos; "Guardado" sólo cuando la nube lo confirmó. Estado de sincronización en el menú lateral.
- **Datos del modo local → cuenta:** "Encontramos datos guardados en este navegador." con [Importarlos a mi cuenta] [Empezar en limpio]. Nunca importa la demo, la empresa ficticia ni datos ILUSTRATIVOS; guarda una copia antes y nunca borra `rateos.state`. Un backup importado en una cuenta queda siempre dentro de la empresa de esa cuenta.
- **Cuenta nueva vacía:** "Hola, <nombre>. ¿Qué querés hacer primero?" con [Crear mi primera cotización] [Configurar mi empresa] y la demo opcional; la empresa real en el menú. Zona de cuenta en el menú lateral (nombre, email, rol, "Mi cuenta", "Cerrar sesión") y **Configuración → Cuenta** (nombre editable, email, empresa, rol, cambiar contraseña, cerrar sesión).
- Landing: "Crear una cotización" lleva a crear la cuenta y después a la cotización nueva (con sesión, directo); el encabezado dice "Ingresar / Crear cuenta" o "Abrir RATEOS".
- Pantalla **Escenarios** (`#/escenarios`, `#/escenarios/:id`) para analizar sensibilidad, escenarios y modelos comerciales de una cotización sin modificarla.
- Componentes de interfaz: `disclosure`, `bigStat`, `pageIntro`, `linkButton`, `stepIndicator` y `emptyState` con título, texto y acción. `formatMoneyCompact` ("$ 15,8 M", hacia arriba para tarifas). `QuoteService.latestDraft()`.
- [docs/UX.md](docs/UX.md): principios, arquitectura de información, copy y checklist de carga cognitiva.

### Cambiado

- **Esquema de datos 2 → 3** (`migrateV2ToV3`, con copia de recuperación previa): todo valor existente queda con "Base no definida" y la moneda de la empresa; equipos con familia (desde el tipo anterior), obtención "propio" y movilidad sin definir; nuevas colecciones `resources.externalServices` y `resources.equipmentModels`; líneas con snapshot `legacy`; cotizaciones con `currency`, `offerDate` (= fecha de creación) y `exchangeRates`. Ningún número cambia. Una pestaña con la versión anterior abierta pasa a sólo lectura al ver datos v3.
- **EECC con 9 categorías**: "Equipos" pasa a "Equipos propios" y se agrega "Equipos y servicios externos" (0 en los datos existentes). La incidencia mostrada sigue sumando 100,00 %.
- El indicador logístico pasa a "Movilización y viajes" (movilización de equipos + logística auxiliar); la demo carga la hidrogrúa y la pickup como movilización por sus propios medios (mismos números).
- **Completitud**: las reglas nuevas suman peso; la demo pasa de 93,48 % a 94,44 % (caso de referencia y cotización en blanco sin cambios). La regla `logistics` acepta como "algo se mueve" un equipo con movilización definida o un externo con movilización incluida; `equipment_cost` pide tarifa > 0 a los externos.
- Equipos propios: "Otros costos anuales de tenerlo" (`otherAnnual`: habilitaciones, GPS…) dentro de la posesión en efectivo (0 en los datos existentes).

- **Regla de negocio — tarifas con impuestos sobre la facturación** (sólo cuando la cotización los define; con `t = 0` todo queda igual):
  - Tarifa piso = costo / (1 − t); precio objetivo = costo / (1 − margen − t); resultado = facturación × (1 − t) − costo; margen = resultado / facturación (antes del impuesto a las Ganancias); markup = precio / costo − 1 = (m + t) / (1 − m − t) (AGENTS.md §9: costo 100, margen 10 %, impuestos 10 % → 25 %); ganancia sobre el costo = resultado / costo = m / (1 − m − t) (12,5 %), rotulada aparte: no es el markup.
  - Break-even: contribución por día = tarifa × (1 − t) − variable (caso básico con t 10 %: 11,54 días; sin impuestos sigue en **10 días**). Tarifa mínima para D días = (F / D + v) / (1 − t).
  - Matriz tarifa × días, tramos de descuento, escalera de precios, escenarios, sensibilidad y comparador de modelos usan el mismo t (el mínimo garantizado del comparador pasa a `Fijos / (1 − t)`).
  - Una tarifa que cubre el costo pero no los impuestos ahora es "bajo piso" (pierde plata).
- **Regla de negocio — margen objetivo inválido.** Un margen ≥ 100 %, negativo o no numérico, o margen + impuestos ≥ 100 %, ya **no** se reemplaza por 0 % en silencio: no hay precio objetivo ni tarifa sugerida, la cotización queda "con riesgo" y las trazas lo explican (antes la "sugerida" quedaba igual a la piso). Un margen vacío sigue calculándose con 0 % (y la completitud lo marca en rojo).
- **Completitud**: la regla nueva suma peso 1 a todas las cotizaciones. Con impuestos sin definir, la demo pasa de 95,45 % a 93,48 % y el caso de referencia de 78,57 % a 76,67 %; una cotización en blanco sube de 33,33 % a 34,21 %. Una cotización apenas por encima de 85 % o de 60 % puede cambiar de color o quedar "con riesgo" hasta que se definan los impuestos o se elija no incluirlos.
- **Esquema de datos 1 → 2** (`migrateV1ToV2`): cada cotización recibe `billingTaxes` sin definir y `vatTreatment: 'excluded'`, y la configuración `defaultBillingTaxes: null`; nada se borra (valores ajenos van a `legacy`) y antes se guarda la copia `pre-migration-v1`. Datos v1 con estructura inesperada se migran y reparan; el texto original queda en esa copia de recuperación. Una pestaña con la versión anterior abierta pasa a sólo lectura al ver datos v2. Los backups v1 se importan migrándolos.
- La aplicación arranca en `#/inicio`: "Hola. ¿Qué querés cotizar hoy?", continuar el último borrador, **3 indicadores** (cotizaciones activas, margen promedio, en riesgo) y "Tus cotizaciones"; el resto de los indicadores y atajos, colapsado.
- Menú lateral simplificado: Inicio, Cotizaciones, Recursos (personal, equipos, materiales, ubicaciones), Servicios, Escenarios y, separado, Configuración (empresa, parámetros económicos, convenios, datos y backup, acerca de). Navegación mobile con menú desplegable.
- Editor de cotización agrupado en **5 etapas** (El servicio, Los recursos, Las condiciones, El precio, Resultado) sobre los mismos 11 pasos internos y las mismas URLs; cada paso abre con una pregunta y por qué importa; datos principales separados de "Opciones avanzadas"; resumen en vivo reducido a 4 números.
- Resultado con nueva jerarquía: la primera vista responde sólo cuánto cuesta, cuánto cobrar (tarifa piso y sugerida), cuánto trabajar (frase con los días para cubrir los costos) y cuánto margen queda, con las alertas críticas. Todo lo demás va en "Profundizá", cerrado por defecto: "¿Cómo se forma tu precio?", "¿En qué se va el costo?" (rubros agrupados y estructura completa), reparto de la tarifa y total del contrato, matriz tarifa × días, escenarios, sensibilidad, reglas comerciales, margen vs markup, completitud y cálculo completo (se abren todos al imprimir).
- Copy revisado en castellano claro (p. ej. "¿Cuántos días por mes esperás trabajar?" en lugar de "factor de utilización").
- Sistema de diseño: escala tipográfica, espaciado, radios y sombras nuevos; acción principal en azul Neuquén profundo.
- Enlaces viejos (`#/biblioteca/...`, `#/dashboard`) redirigen a las rutas nuevas.

### Seguridad

- Los mensajes de datos dañados o no migrables ya no muestran claves internas de almacenamiento: indican "Configuración → Datos y backup → Copias de recuperación".
- El catálogo global de familias de equipos no contiene precios ni datos de clientes; marcas, modelos y valores son privados de cada organización.

- **RATEOS_ADMIN se decide sólo en Postgres** (`private.platform_admins` + `private.is_platform_admin()` con `auth.uid()`): ningún email, metadata, claim del JWT, `localStorage` ni `organizationId` del cliente da el rol, y no hay ningún email hardcodeado en el frontend (lo verifica un test de arquitectura). El alta del master es un bootstrap server-side de un solo uso que exige email **confirmado** y normalizado. Las funciones de admin vuelven a verificar el rol en cada llamada, nunca devuelven el contenido de un workspace, y las políticas RLS de los datos de clientes no cambiaron. Tests contra la base: `supabase/tests/rls_admin_test.sql` (32 controles).
- En el navegador sólo la URL de Supabase y la **publishable key**; un test busca en todo el repo `service_role`, secret keys (`sb_secret_…`) y connection strings con contraseña. RATEOS **no guarda contraseñas** en ningún lado.
- CSP: `connect-src` sólo `'self'` y el proyecto de Supabase.
- Revisión de seguridad adversarial de las cuentas, con correcciones: copias de recuperación por usuario y organización (otra persona en el mismo navegador no las ve ni las restaura; en pantalla sólo fecha y motivo), enlaces de email **sólo PKCE** (se rechazan los `?token_hash=`, que podían abrir la cuenta de otra persona en el navegador de la víctima), cerrar sesión borra siempre la sesión local aunque el SDK falle, cambio de usuario en otra pestaña reabre la cuenta correcta, `?next=` sin codificaciones ambiguas y RATEOS no funciona dentro de un iframe (anti-clickjacking).
- Si la base rechaza el token, se intenta renovar la sesión una vez; si no se puede, se cierra con "Tu sesión terminó. Volvé a ingresar." (los cambios quedan en la copia local).

### Corregido

- **Caché después de un deploy (cache busting).** GitHub Pages cachea cada archivo 10 minutos y los JS/CSS tenían URLs fijas: tras un deploy el navegador podía mezclar módulos viejos y nuevos (menú "Dashboard / Bibliotecas / Plantillas de servicio" con "Acerca de" mostrando el build nuevo) y sólo Ctrl+Shift+R lo arreglaba. Ahora el build publica todos los JS, CSS y assets en `build/<sha corto>/`, `index.html` carga `boot.js`, que lee `version.json` sin caché y carga ese build completo (los imports relativos mantienen todo el grafo en la misma carpeta). `version.json` suma el manifiesto `build`. Si una pestaña abierta durante un deploy no puede cargar una pantalla, el botón pasa a ser "Recargar la página". Detalle en [docs/DEPLOYMENT.md §4.1](docs/DEPLOYMENT.md). No cambia ninguna fórmula ni el formato de los datos.

Revisión adversarial económica y de UX de esta versión (sin funcionalidades nuevas):

- **Markup con impuestos** (regla de negocio, AGENTS.md §9): el "markup" que se mostraba con impuestos era la ganancia sobre el costo (12,5 % con costo 100, margen 10 %, impuestos 10 %), pero el precio es 125 = costo × 1,25. Ahora "Markup (recargo sobre el costo)" = 25 % y "Ganancia sobre el costo" = 12,5 % por separado (escalera, "Margen vs markup", trazas y consejos del paso "El precio"). Sin impuestos no cambia nada (11,11 %).
- Un margen escrito como texto ("12,5") se lee igual que en la validación; uno inválido ya no se muestra como 0 % en avisos, comparador ni trazas.
- La tarifa piso distingue impuestos sin definir de impuestos inválidos; la composición del precio con pérdida suma 100 con 1 decimal; descuento del 100 % y 0 días explican por qué no hay composición; el semáforo de descuentos no dice "bajo el objetivo" si no hay margen objetivo válido.
- Configuración → Parámetros económicos guardaba mal los impuestos de la empresa al cambiar de modo (se perdían valores cargados): ahora se copian sin pérdida.
- Cambiar la unidad (día ↔ hora) convierte también el mínimo por llamado con las horas por día activo (antes 1 día pasaba a ser 1 hora); si no se puede convertir, se avisa.
- **Copy de impuestos sin afirmaciones fiscales**: "No incluir impuestos sobre la facturación en esta cotización" en lugar de "No pago impuestos sobre lo que facturo".
- Accesibilidad: "Ver cálculo" con nombre accesible por indicador, foco tras agregar o quitar renglones de impuestos, ayudas asociadas a las casillas, avisos con `role="status"`; alertas del resultado legibles en mobile.

## [0.1.0] - 2026-10-03

Primera versión funcional (MVP) de RATEOS — motor de costos y tarifas para servicios industriales. 100 % frontend (GitHub Pages + `localStorage`), sin backend, sin dependencias npm, sin analytics y sin IA. **Todos los datos demo son ILUSTRATIVOS.**

### Agregado

**Cotizaciones**

- Flujo de cotización de 11 pasos en orden fijo: tipo de servicio, modalidad, personal, equipos, materiales, logística, costos indirectos, financiamiento, riesgo / contingencia, margen y reglas comerciales, resultado.
- Dos modalidades: "Conozco la tarifa" (días mínimos, break-even, resultado y margen esperados) y "Conozco la actividad" (tarifa piso y tarifas con margen 5 %, 10 %, 15 % y personalizado).
- 11 tipos de servicio (on-call, permanente, cuadrilla, equipo con/sin operador, por unidad, transporte, llave en mano, time & materials, lump sum, configurable) y unidades de tarifa $/día, $/hora y $/mes.
- Crear cotizaciones en blanco o desde plantilla, duplicar, eliminar (con confirmación), estados (borrador, enviada, ganada, perdida, archivada) y códigos `COT-0001`…
- Editor con resumen en vivo, recálculo inmediato y guardado automático.
- Dashboard: cotizaciones activas, valor total cotizado, margen promedio, cotizaciones con riesgo y servicios bajo piso.
- Bibliotecas reutilizables: personal (perfiles), convenios parametrizables (Petroleros Privados, Petroleros Jerárquicos, Camioneros, UOCRA, Fuera de convenio, Personalizado), equipos con ficha $/hora · $/día · $/mes, materiales y ubicaciones.
- 12 plantillas de servicio (Cuadrilla 24/7, Hidrogrúa on-call, Transporte, Water Transfer, Servicio ambiental, Movimiento de suelo, Taller móvil, Inspección, Soldadura, Mantenimiento, Generador, Camión con chofer).
- Datos demo: Patagonia Servicios SRL (ficticia), cotización "Hidrogrúa on-call — Añelo" y "Caso de referencia on-call (prueba del motor)".

**Motor económico** (`js/engines/`, funciones puras)

- CostEngine: modelo `Costo(D) = F × factorMeses + v × D`; personal con factor de cargas, relevos (posiciones cubiertas), horas extra cargadas y vianda; equipos con costo de posesión vs operación, amortización y costo de capital; logística (km, litros, costo por activación, por día activo y mensual); materiales (merma, logística, proveedor, base de cálculo); otros costos; estructura con 6 métodos de absorción; standby.
- FinancialEngine: días financiados por grupo de pago, capital de trabajo, costo financiero e impacto en margen.
- Contingencia general + ítems de riesgo.
- Estructura de costos (EECC) en 8 categorías con monto e incidencia %; la incidencia mostrada suma exactamente 100 % (método del mayor resto).
- PricingEngine: margen vs markup diferenciados, conversiones, escalera de precios, redondeo comercial hacia arriba.
- CommercialRulesEngine: minimum call, standby, call-out fee, movilización, km adicional, fee de disponibilidad, mínimo mensual garantizado, descuento por tramos de días (1, 2–7, 8–15, 16–30, +30), descuento por continuidad y descuento comercial; semáforo verde / naranja / rojo por tramo.
- BreakEvenEngine: fórmula cerrada, problema inverso (tarifa mínima para N días) y búsqueda numérica robusta (grilla de 0,1 día + bisección) para reglas no lineales; días para margen objetivo.
- UtilizationEngine: utilización y matriz tarifa × utilización (5, 8, 10, 15, 20 días + actividad estimada).
- ScenarioEngine: sensibilidad con tarifa comercial fija (salarios, combustible, materiales, utilización, plazo de pago, descuento comercial), escenarios pesimista / base / optimista y comparador de 4 modelos comerciales.
- Cost Completeness Score con 14 reglas determinísticas y pendientes priorizados.
- Trazas "Ver cálculo" (costo total, break-even, tarifa piso, precio objetivo, resultado esperado, costo financiero, logística, margen vs markup).

**Datos y persistencia**

- `StorageRepository` (contrato asíncrono) con `LocalStorageRepository`; estado en `rateos.state` con `schemaVersion` 1.
- Migraciones explícitas (`migrateV0ToV1`), copias de recuperación automáticas (`rateos.recovery.*`), reparación de datos dañados sin borrarlos y modo sólo lectura ante datos de una versión más nueva.
- Exportar e importar backup JSON versionado, con validación, resumen y confirmación antes de sobrescribir.
- Pantalla de recuperación si la app no puede iniciar (descarga de los datos guardados tal cual).
- Entidades con UUID, `organizationId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (preparadas para multiempresa).

**Calidad, build y despliegue**

- Suite `npm test` con el test runner de Node (≥ 20), sin dependencias: core, datos (migraciones, esquema, backup, repositorio), servicios, motores, golden cases en JSON (`tests/golden-cases/`), reglas de arquitectura y seguridad, build y sitio estático bajo `/COTIZADORWEB/`.
- `npm run build` genera `dist/` con `version.json` (versión, commit corto, fecha de build, ref) y valida que todas las rutas sean relativas; `npm start` sirve la app en `http://localhost:8080/COTIZADORWEB/` (`--dist` para servir el build).
- Workflow "Deploy RATEOS a GitHub Pages" (push a `main` y `workflow_dispatch` con `ref` para rollback, sólo commits o tags que ya están en `main`): test → build → deploy; no despliega si fallan los tests; permisos mínimos por job.
- Workflow de CI para pull requests y ramas; Dependabot para GitHub Actions.
- Versión visible en Configuración → Acerca de ("RATEOS · v0.1.0 · build abc1234").

**Documentación**

- README, AGENTS.md (constitución para agentes), CHANGELOG, `docs/ARCHITECTURE.md`, `docs/CALCULATION_RULES.md`, `docs/DEPLOYMENT.md`, `docs/DATA_MODEL.md`, `docs/AUTH_ARCHITECTURE.md`, `docs/SUPABASE_PLAN.md`, `docs/AGENT_ROLES.md`, `.agent/PLANS.md` y plantilla de Pull Request.

### Seguridad

- Content Security Policy estricta (`script-src 'self'`, sin inline ni terceros) y `referrer: no-referrer`.
- DOM sin `innerHTML`/`eval`/`new Function`; texto siempre con nodos de texto.
- Protección contra prototype pollution en rutas de edición y en backups importados; límite de 5 MB por backup.
- Logger centralizado sin contexto sensible en producción; eventos internos con lista blanca y sin envío a terceros.
- `.gitignore` excluye `.env*`, secretos y credenciales.

### Correcciones de la revisión multidisciplinaria

Antes del merge se hizo una revisión desde Economía, QA, Seguridad, Datos, UX y cumplimiento. Los hallazgos confirmados se corrigieron con tests de regresión (`tests/data/review-regressions.test.js` y tests de motores, core y servicios). **Los golden cases no cambiaron** y los resultados de las cotizaciones demo (costo, tarifas, facturación, break-even, completitud) son los mismos. Entre paréntesis, el identificador del hallazgo.

**Persistencia y datos**

- Varias pestañas (DATA-01, crítico): una pestaña con una copia vieja en memoria reescribía el estado completo y borraba cotizaciones creadas en otra, y reutilizaba códigos `COT-NNNN`. Ahora el repositorio relee `rateos.state` antes de cada lectura o escritura y adopta los cambios de otras pestañas (`syncFromStorage`); la pantalla se refresca con el evento `storage` (`ctx.onExternalChange`); los códigos usan el contador monotónico `settings.lastQuoteNumber` leído actualizado. Si otra pestaña con una versión más nueva migró los datos, se adoptan en sólo lectura; si el cambio es ilegible, error `stale_state` sin escribir. Limitación documentada: si dos pestañas editan la misma cotización a la vez, gana el último guardado.
- Almacenamiento lleno con datos guardados (DATA-02): ya no se abre la demo en memoria; `createRepository` lanza `quota_exceeded` y la app muestra la pantalla de recuperación para descargar los datos.
- Guardado que falla (DATA-03): el editor conserva el borrador sin guardar aunque se salga y se vuelva a entrar, pide confirmación al cerrar la pestaña y ofrece "Descargar backup con estos cambios" (un backup que sí incluye esos cambios). El mensaje de cuota explica cómo liberar espacio.
- Validaciones de importación (DATA-04, SEC-02): se rechaza un JSON sin versión que no tiene ninguna colección de RATEOS (por ejemplo, un `package.json`, que antes reemplazaba todo por una empresa vacía) y un backup v1 con colecciones de tipo incorrecto (antes se vaciaban en silencio).
- Copias de recuperación (DATA-05): se pueden eliminar desde Configuración (`deleteRecoverySnapshot`); una importación o restauración de la demo que falla por cuota ya no deja una copia huérfana.
- Datos dañados sin espacio para la copia (DATA-06): `init()` lanza `corrupt_no_space` y la app muestra la pantalla de recuperación (descargar los datos tal cual); antes abría la demo en sólo lectura y "Exportar backup" exportaba la demo.
- Modo memoria (DATA-07): el editor dice "Sólo en esta sesión (no se guarda)" en lugar de "Guardado".
- Copias `invalid` (SPEC-03): igual que las `corrupt`, se cuentan aparte con su propio cupo de 3; las importaciones posteriores ya no borran la única copia del original con estructura inválida.

**Seguridad**

- Forma de las cotizaciones (SEC-01): `validateState` revisa la forma interna de cada cotización (líneas como listas de objetos, sub-objetos como objetos); un backup con una cotización malformada se rechaza. Además, los motores ignoran líneas que no son objetos (`objectList`) y `QuoteService` marca con `{ error: true }` una cotización que no se puede calcular: una cotización mala ya no rompe el dashboard ni el listado.
- Deploy manual (SEC-03): el input `ref` sólo acepta commits o tags que ya están en `main` (`git merge-base --is-ancestor`); antes permitía publicar una rama sin mergear, sin PR. Procedimiento de rollback actualizado en `docs/DEPLOYMENT.md`.
- Permisos por job (SEC-04): el workflow sólo da `contents: read`; `build` agrega `pages: read` y sólo `deploy` tiene `pages: write` e `id-token: write`.
- Eventos internos (SEC-05): los enums sólo aceptan letras minúsculas y guion bajo (sin dígitos, así no pasan montos) y `serviceType` se normaliza al catálogo (`unknown` si no está).
- `.gitignore` (SEC-06): `secrets` (archivo o carpeta), `*credentials*`, `*credenciales*`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*service-account*.json` y `.npmrc`.

**Motor económico** (cambios de cálculo y qué resultados cambian; detalle en `docs/CALCULATION_RULES.md`)

- Semáforo de tramos con minimum call (ECO-01, §14): cada tramo se evalúa con la menor cantidad de días **activos** que alcanza su "desde" en días **facturables** (`minActiveDaysForBillableDays`). Cambian `evaluatedDays`, resultado, margen y color de los tramos **sólo** cuando el minimum call supera las unidades por activación. Ejemplo: referencia con minimum call 2 días y 20 % en 8–15 → el tramo 8–15 se evalúa con 4 días (resultado −8.400.000) y pasa de verde a **rojo**.
- `belowFloor` vs `belowFloorRate` (ECO-02, §20): `belowFloor` ("bajo piso: perdés dinero") exige ahora tarifa neta bajo el piso **y** resultado negativo; el nuevo `belowFloorRate` informa sólo lo primero. Cambia con mínimo garantizado que cubre el costo: referencia + mínimo 40.000.000 → resultado +2.000.000, antes `belowFloor = true`, ahora `false` (`belowFloorRate = true`); también el contador "servicios bajo piso".
- Sensibilidad y escenarios con días activos mayores a los disponibles (ECO-04, §17): sin variación de actividad los días no se tocan, y una variación nunca recorta por debajo de la base. Referencia con 35 días y 30 disponibles: sin variaciones Δ resultado pasa de −10.000.000 a 0; el optimista ya no da menos que la base.
- "No aplica standby" (ECO-05, §12): anula días, costo e ingreso de standby aunque los campos tengan valores. Cambian costo, otros ingresos y tarifas sólo en cotizaciones con standby cargado y "no aplica" marcado (demo con 4 días × 500.000 y "no aplica": tarifa piso neta de 1.795.180 a 1.972.062, la misma que sin standby).
- Margen sin tarifa comercial (ECO-06, §20): `kpis.marginPct` y `kpis.markupPct` son `null` si no hay tarifa comercial (antes se calculaban sobre otros ingresos, p. ej. −533,33 %) y ya no entran al margen promedio del dashboard.
- Traza de break-even (ECO-08, ECO-09, §15): la descomposición lineal (`result.linear`) y la traza se arman en el punto de equilibrio, donde rige el tramo que realmente aplica; la entrada se rotula "Ingreso por tarifa por día activo (tarifa neta por <unidad> × unidades del día)". El break-even no cambia; cambian las entradas mostradas (demo: tarifa neta 2.259.000 y contribución ≈ 1.415.864 en lugar de 2.191.230 y 1.348.094). Ejemplo de la documentación corregido.
- Traza de margen vs markup (ECO-10, §11): con 2 decimales (`money2`): $ 111,11 vs $ 110,00, diferencia $ 1,11.
- Comparador de modelos (ECO-13, §17): el fee de disponibilidad y el mínimo garantizado se prorratean con `factorMeses` igual que los costos fijos. Cambia sólo con días estimados mayores a los disponibles: "Fee + tarifa" pasa de 3,08 % a 10 % de margen (referencia con 35 días).
- Traza de tarifa piso (UX-01, ECO-07, §13): pasa por la tarifa piso neta y termina en la tarifa piso **de lista**, el número que se muestra.
- Umbrales de completitud (ECO-14, §19): un solo criterio en toda la interfaz (`completenessTone`): verde ≥ 85 % (`COMPLETENESS_GREEN_THRESHOLD`), naranja ≥ 60 %, rojo < 60 % (`COMPLETENESS_RISK_THRESHOLD`); antes el editor usaba 90/70.
- Tarifas mínimas mostradas hacia arriba (ECO-12, §18): `formatMoneyCeil` / formato `moneyCeil` (4.444.444,44 → $ 4.444.445). Sólo cambia la presentación; el motor no cambia.
- Defaults ILUSTRATIVOS (SPEC-02, §19): una cotización nueva en blanco deja `activity.activeDaysPerMonth` en `null`; con la configuración ILUSTRATIVA de la demo deja además el plazo de cobro en `null`, la contingencia en 0 y el combustible marcado `fuel.illustrative` (el Cost Completeness Score lo pide confirmar en naranja). Cambia el puntaje de las cotizaciones **nuevas** (una en blanco con la configuración demo da 33,33 %); las cotizaciones existentes no cambian.
- Configuración central (SPEC-04): `defaultSettings()` y los motores toman `LOCALE`, `CURRENCY`, `DEFAULT_MATRIX_DAYS` y `DEFAULT_MARGIN_LADDER` de `js/config.js`.

**Interfaz y datos ILUSTRATIVOS**

- Marca ILUSTRATIVO por línea (UX-02, SPEC-01, QA-E2E-05): las líneas copiadas de plantillas o recursos de biblioteca de demostración llevan `illustrative: true` (también los vehículos y `fuel.illustrative`); `illustrativeInfo(quote)` resume `{ any, quote, lines, fuel }` para badges y avisos. No requiere migración.
- Números en formato argentino (QA-E2E-02): `parseDecimalInput` interpreta `1.800.000`, `1.800.000,50` y `8,5` (antes "1.800.000" se guardaba como 1,8 y "8,5" como 85, sin error); `numberField` pasa a `type="text"` y la prop `step` se ignora.
- Valores inválidos al tipear (QA-E2E-03): un valor intermedio inválido ya no queda guardado como prefijo (margen "150" → 15); al confirmar un valor inválido el campo vuelve al valor anterior y el editor no autoguarda mientras haya campos marcados.
- Tarifa piso y precio objetivo en base de LISTA (lo que se escribe en la cotización) con la neta como dato secundario, iguales en el resumen, el paso Modalidad, el Resultado y su "Ver cálculo" (UX-01, ECO-07, ECO-11); tarifas mínimas mostradas siempre hacia arriba (ECO-12); nombres unificados "Precio objetivo" / "Precio comercial sugerido" (UX-11).
- Editor: checkbox "Son valores propios y vigentes" por línea, banner de valores ilustrativos, formulario antes del resumen en pantallas < 1200 px (UX-03), stepper horizontal en el paso Resultado hasta 1600 px (UX-04), tablas de vehículos/otros costos como tarjetas en pantallas angostas (UX-08), "Guardar como plantilla" (UX-13), confirmación al quitar líneas (QA-E2E-11), conversión día ↔ hora al cambiar la unidad con `convertRateUnit` del motor de pricing (QA-E2E-08), paso inválido en la URL redirige a "Tipo de servicio" (QA-E2E-13), campos de standby deshabilitados con "No aplica" (ECO-05). Helpers de presentación compartidos en `js/ui/views/quote-steps/shared.js`.
- Resultado: matriz dividida en "Tarifas necesarias" y "Resultado con tu tarifa comercial", gráfico al ancho real del contenedor, todas las columnas visibles en 1280–1440 px (UX-04, QA-E2E-09); con abono mensual, textos coherentes y "días máximos de actividad sin pérdida" (ECO-03, QA-E2E-10); aviso informativo cuando la tarifa está bajo piso pero el mínimo garantizado cubre la diferencia (ECO-02).
- Configuración se guarda sola (UX-05); contraste WCAG AA (UX-06); "Ver cálculo" con `aria-label` descriptivo (UX-10); tasa de financiamiento por defecto de demo marcada ILUSTRATIVA (`finance.illustrative`).

**Documentación**

- README, `docs/ARCHITECTURE.md`, `docs/CALCULATION_RULES.md`, `docs/DATA_MODEL.md`, `docs/DEPLOYMENT.md`, `docs/SUPABASE_PLAN.md`, `docs/AGENT_ROLES.md` y `.agent/PLANS.md` actualizados al código: persistencia con varias pestañas (y su limitación), pantallas de recuperación, validaciones de importación, procedimiento de rollback con commits de `main`, ejemplos numéricos recalculados (break-even §15, tramos §14, sensibilidad y comparador §17). Se corrigió la referencia colgante de `docs/ARCHITECTURE.md` (`catalogs.js` incluye `COST_CATEGORY_IDS`, `EQUIPMENT_TYPES` y `DEFAULT_VOLUME_TIERS`) y el estado de PLAN-2026-001 queda "En curso — pendiente de merge" (SPEC-07).

[Unreleased]: https://github.com/joaquinvedova1/COTIZADORWEB/compare/f6b3c08...HEAD
[0.2.0]: https://github.com/joaquinvedova1/COTIZADORWEB/compare/v0.1.0...f6b3c08
[0.1.0]: https://github.com/joaquinvedova1/COTIZADORWEB/releases/tag/v0.1.0
