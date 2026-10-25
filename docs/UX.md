# UX de RATEOS — "Simple en la superficie, potente por debajo"

Guía permanente de experiencia de usuario. Complementa [AGENTS.md](../AGENTS.md) (§17 UX), [ARCHITECTURE.md](ARCHITECTURE.md) y el sistema de diseño [DESIGN.md](../DESIGN.md) (tokens, tipografía, marcas de riesgo, componentes y checklist de accesibilidad). Si una pantalla nueva contradice esta guía, se discute antes de mergear.

## 1. Objetivo

RATEOS tiene que producir dos reacciones distintas:

1. **Al entrar:** "Ah, entiendo. Me ayuda a saber cuánto tengo que cobrar."
2. **Al profundizar:** "Puedo analizar prácticamente toda la economía del servicio."

La complejidad del motor (EECC, matriz tarifa × utilización, escenarios, sensibilidad, descuentos, reglas comerciales, break-even, margen vs markup, trazas) **sigue existiendo completa**. La interfaz la revela de a poco (*progressive disclosure*). Simplificar la interfaz nunca significa eliminar una capacidad ni cambiar una fórmula.

## 2. Principios

Inspirados en SaaS B2B modernos (Linear, Stripe, Vercel, Ramp, Buildxact, ServiceTitan), sin copiar diseños:

1. **Una pregunta principal por pantalla.** El título es la pregunta ("¿Qué querés cotizar hoy?", "¿Cuántos días por mes esperás trabajar?").
2. **Un CTA evidente** por pantalla; como mucho uno secundario al lado. Nunca 8 botones compitiendo.
3. **Números grandes sólo cuando importan:** costo, tarifa piso, tarifa sugerida, margen y días para no perder.
4. **Lo secundario se colapsa** (`disclosure()` = `<details>`), va a una pestaña o detrás de "Ver más". Lo que hace **perder plata** (debajo del piso, margen negativo, datos incompletos) nunca se esconde.
5. **Contexto antes del input:** cada pregunta explica en una o dos líneas por qué importa. El término técnico aparece como ayuda secundaria.
6. **Defaults visibles y modificables.** Datos principales arriba; el resto en "Opciones avanzadas". Si un campo avanzado tiene un error, su sección se abre sola.
7. **Estados vacíos con salida:** título + texto + acción (nunca una tabla vacía).
8. **Mucho aire, tipografía protagonista, azul Neuquén / Patagonia.** Nada de fotos de pozos, gráficos decorativos ni animaciones innecesarias (y se respeta `prefers-reduced-motion`).

## 3. Arquitectura de información

```
SITIO PÚBLICO (sin menú lateral)              APLICACIÓN (menú lateral)
#/            Landing                          #/inicio          Inicio
#/demo        Demo guiada (ejemplo)            #/cotizaciones    Cotizaciones (+ /nueva, /:id/:paso)
#/login       Ingresar                         #/recursos/:tab   Personal · Equipos · Servicios externos ·
                                                                 Materiales · Ubicaciones · Catálogo
#/registro    Crear cuenta                     #/servicios       Plantillas de servicio
#/bienvenida  Onboarding (3 pantallas)         #/escenarios(/:id) Análisis de escenarios
                                               ── separador ──
                                               #/configuracion/:tab  Empresa · Parámetros económicos ·
                                                                     Convenios · Datos y backup · Acerca de
```

Flujo principal: **Landing → entender → probar demo / ingresar / crear cuenta → app → primera cotización → resultado simple → detalle avanzado.**

Enlaces viejos (`#/biblioteca/...`, `#/dashboard`) redirigen a las rutas nuevas.

## 4. Pantallas clave

### Landing (`#/`)

Vende **resultados**, no funcionalidades. Debe pasar el **test de los 10 segundos** con el dueño de una PyME industrial que nunca vio RATEOS:

| Pregunta | Respuesta que tiene que quedar obvia |
|---|---|
| ¿Qué es? | Una plataforma para calcular cuánto cuesta prestar un servicio y cuánto cobrar. |
| ¿Para quién? | Empresas de servicios (industriales, Oil & Gas, mantenimiento, transporte, construcción, minería). |
| ¿Qué me da? | Costo real, tarifa piso y rentabilidad. |
| ¿Qué hago ahora? | Crear una cotización o probar con un ejemplo. |

El mockup del hero muestra **producto** (la demo "Hidrogrúa on-call — Añelo" calculada en vivo por el motor, marcada como ejemplo ilustrativo). La landing no muestra KPIs, alertas, EECC ni configuraciones.

### Ingresar / Crear cuenta / Bienvenida

Cuentas reales con Supabase Auth (ver [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md)): registro con nombre, empresa, email y contraseña; confirmación por email ("Revisá tu email"); ingreso; recuperación de contraseña. Mensajes humanos, nunca técnicos; la contraseña nunca se guarda ni queda en pantalla. "Probar la demo sin cuenta" siempre a mano.

### Demo guiada (`#/demo`)

Antes del resultado completo, cuatro pasos de una pregunta cada uno: el servicio → lo que cuesta prestarlo → el resultado (4 números) → "¿Y si te llaman menos días?". Termina en el análisis completo o en "Crear mi propia cotización".

### Inicio (`#/inicio`)

"Hola, <nombre>. ¿Qué querés cotizar hoy?" + [Crear nueva cotización]; luego "Continuar cotización" (último borrador); **máximo 3 indicadores** (cotizaciones activas, margen promedio, cotizaciones en riesgo) y "Tus cotizaciones" (servicio, cliente, estado, tarifa, margen). El resto, colapsado.

**Cuenta nueva (vacía):** "Hola, <nombre>. ¿Qué querés hacer primero?" con [Crear mi primera cotización] [Configurar mi empresa] y un enlace opcional a la demo ("está aparte y no toca tus datos"). Sin botones repetidos, sin datos de ejemplo. El menú lateral muestra la empresa real, la cuenta ("Mi cuenta", "Cerrar sesión") y el estado de sincronización ("Guardado en la nube", "Cambios sin sincronizar", "Sin conexión…", "Conflicto…").

### Editor de cotización

Los 11 pasos internos siguen existiendo (y sus URLs), agrupados en **5 etapas**:

| Etapa | Pasos internos |
|---|---|
| 1. El servicio | Tipo de servicio, modalidad |
| 2. Los recursos | Personal, equipos (propios, alquilados o tercerizados), materiales, movilización y viajes |
| 3. Costos y condiciones | Gastos de estructura, financiamiento, imprevistos |
| 4. El precio | Margen, impuestos sobre lo que facturás y reglas comerciales |
| 5. Resultado | Resultado |

Resumen en vivo con el costo del mes, la tarifa piso, la tarifa cobrada, el margen esperado, los días para no perder y el resultado esperado, sin abrir nada; "Ver más" deja el precio para tu margen y la completitud. En la barra compacta (1180 px o menos) van cuatro números: costo, piso, tarifa cobrada (destacada) y margen con su palabra ("cumple", "debajo", "pierde", "no confiable"); el resto, en "Ver detalle". La tarifa piso dice si incluye los impuestos sobre lo que facturás (naranja si están sin definir).

**Convención de montos: sin IVA.** Es una convención explícita de cada cotización (`vatTreatment`), no un supuesto silencioso: la primera etapa lo dice al empezar ("Esta cotización usa costos, precios y tarifas sin IVA: si tenés un valor con IVA, descontalo antes de cargarlo"), cada etapa muestra la marca **"Montos sin IVA"**, los formularios de equipos, materiales y el precio del combustible lo repiten donde suele llegar un precio con IVA, y el resultado y la impresión lo rotulan.

**Impuestos sobre lo que facturás** (etapa "El precio", PLAN-2026-002): pregunta "¿Qué parte de lo que facturás se va en impuestos?", con **Un % total** (lo más simple) o **Detalle por impuesto** (Ingresos Brutos, débitos y créditos, sellos, otros cargos), excluyentes, y "No incluir impuestos sobre la facturación en esta cotización" (una elección de cálculo, no una afirmación fiscal sobre la empresa). La ayuda dice qué incluir y qué no (IVA, Ganancias, retenciones, costo financiero) y cómo evitar el doble conteo. "Usar los de mi empresa" / "Guardar como valor de mi empresa" conectan con Configuración → Parámetros económicos. RATEOS no trae alícuotas.

**Recursos y snapshots** (PLAN-2026-005, [RESOURCE_MODEL.md](RESOURCE_MODEL.md)):

- Cada línea dice de dónde viene ("De Recursos · copiado el 05/10/26 14:30" o "Cargado en esta cotización") y de qué mes es su valor (**"Base: sep-26"** / **"Base no definida"**, en naranja).
- Si el recurso cambió en Recursos, la línea lo avisa con el valor utilizado y el actual (con sus bases) y dos botones: **[Actualizar en esta cotización] [Conservar valor original]**. Nunca se actualiza sola; el aviso no bloquea.
- La fecha base y la moneda de cada línea están en "Fecha base y moneda" (cerrado): cambian sólo esa cotización.
- **Equipos**: "¿Cómo lo obtenés?" (Propio / Alquilado / Tercerizado) cambia la ficha: un propio muestra valor de reposición, vida útil y consumo (lo demás en "Opciones avanzadas"); un externo muestra proveedor, tarifa neta, unidad, mínimo, vigencia y "¿Qué incluye la tarifa?"; el tratamiento fiscal queda en un desplegable con su resumen ("IVA 21 % · sí, lo recupero"). "Operador (de Personal)" vincula el puesto que lo opera.
- **Movilización y viajes**: primero "¿Cómo llega cada equipo al lugar del servicio?" (una fila por equipo, con km, litros y $ por llamado y "Ver cálculo"); después "Logística auxiliar: vehículos de apoyo y de personal", con la advertencia de no cargar dos veces un equipo que ya se moviliza solo.
- **Tipo de servicio**: "Base económica de la oferta" con la fecha de la oferta, la base por rubro, las advertencias y los tipos de cambio de la cotización.

### Recursos → Personal (`#/recursos/personal`, RES-02)

- Arranca **agrupado por convenio**: cada grupo es un desplegable (teclado: Enter o Espacio en su encabezado) con nombre, "N perfiles · M personas" y el costo empresa de las personas cargadas. Si falta la cantidad en algún perfil, dice "M personas en K de N perfiles" y "Subtotal parcial". "Sin convenio indicado" va siempre abierto, con la salida a Configuración → Convenios.
- Búsqueda y filtro por convenio arriba; quedan en la dirección, así que se pueden recargar o compartir. "Plegar todo" / "Desplegar todo".
- Cada fila: puesto (y categoría), personas ("sin dato" si falta), bruto mensual (y el básico si hay adicionales), mes base, costo empresa por persona con "Ver cálculo", "Usado en" y **"Editar sueldo"**, además de Editar y Eliminar.
- "Editar sueldo" es un diálogo corto: bruto, cuánto es básico (opcional), mes base, vista previa antes → después y el aviso de que las cotizaciones hechas no cambian. Con horas extra y sin básico pide confirmar que se valúan sobre el bruto completo.
- En el celular, los grupos aparecen en la primera pantalla: el resumen es una línea y los filtros, dos controles sin rótulo visible (tienen nombre accesible).

### Recursos → Equipos (`#/recursos/equipos`, RES-02)

- Arranca **agrupado por familia**: cada grupo es un desplegable con su nombre, "N unidades propias · M alquiladas o tercerizadas (no suman)" y la posesión por mes de las propias. Si una propia está valuada en otra moneda sin tipo de cambio, el monto es "Subtotal parcial" y lo dice.
- Búsqueda y filtro por tenencia arriba; quedan en la dirección. "Plegar todo" / "Desplegar todo".
- Cada fila: equipo (interno, familia, capacidad o modelo y base), tenencia, posesión por mes con "Ver cálculo" (o la tarifa si es alquilado o tercerizado), operación ($/h sin combustible + L/h), "Usado en", Editar y Eliminar.
- En el celular, la explicación de posesión y operación queda plegada en una línea y los grupos aparecen en la primera pantalla.

### Resultado

La primera vista es una **ficha de siete renglones** (UXR, una lista de clave y valor): **Vendés** (qué y en qué unidad: "por hora-hombre", "precio total del trabajo"), **Tarifa** (la sugerida o la tuya, en grande, con la **piso** debajo), **Facturás**, **Te cuesta**, **Ganás** (con el margen y la misma palabra que el resumen en vivo: "cumple tu objetivo (10 %)"), **Actividad** (con la dotación: "880 horas-hombre por mes = 4 personas × 22 días × 10 h" y "Ocupás 22 de 30 días disponibles") y **Para no perder** (en la unidad de cobro: horas, horas-hombre, m³, llamados…; con el abono mensual, el máximo de días; con precio total, la piso). Arriba van BORRADOR / NO CONFIABLE, el aviso del redondeo y el de la tarifa bajo el piso. Debajo, la nota "Calculado con tus costos y tus supuestos: no es un precio de mercado.", **"La cuenta del mes"** (o **"del trabajo"** con precio total): cantidad facturable × tarifa = facturación − impuestos − costo = ganancia, con las cifras del motor, y las alertas críticas.

Todo lo demás está en **"Detalle del cálculo"**, cerrado por defecto y dibujado al abrirlo: **"¿Cómo se forma tu precio?"** (de cada $ 100 que facturás: costo, impuestos y ganancia; 100 % del precio), **"¿En qué se va el costo?"** (4 rubros + otros, y la estructura de costos completa; 100 % del costo), **reparto de la tarifa (apropiación) y total del contrato** (con precio total, sólo el reparto), tarifa según días trabajados (matriz; no aplica con precio total), escenarios y sensibilidad, reglas comerciales y descuentos (la tabla de tramos sólo si hay descuentos), margen vs markup, **base económica de la oferta** (bases por rubro, tipos de cambio y externos: costo económico vs salida de caja vs crédito fiscal), completitud y "Ver cálculo completo" (con **"Los números cierran"**).

Impresión: **"Imprimir resumen (1 hoja)"** (la ficha y la cuenta) o **"Imprimir análisis completo"** (la misma primera hoja y todo el detalle abierto desde la segunda). Las dos son documentos internos.

## 5. Copy

Español rioplatense, claro y profesional. Preguntas en segunda persona ("¿Cuánto querés ganar?"). El término técnico va entre paréntesis o como ayuda.

| En lugar de… | Decí… |
|---|---|
| Factor de utilización | ¿Cuántos días por mes esperás trabajar? |
| Working capital / capital de trabajo | ¿Cuánto tiempo tenés que financiar el servicio? · plata que tenés que adelantar hasta cobrar |
| Cost structure / EECC | ¿Qué parte del costo corresponde a cada rubro? · ¿En qué se va el costo? |
| Break-even | Días mínimos para no perder plata |
| Overhead / costos indirectos | Gastos de estructura |
| Contingencia | Imprevistos (contingencia) |
| Activación | Llamado / viaje |
| Sensibilidad | ¿Qué pasa si…? |
| Markup | Markup (recargo sobre el costo) — **nunca** "margen". Con impuestos sobre la facturación el recargo cubre impuestos y ganancia; la parte que queda se llama "Ganancia sobre el costo" |
| "No pago impuestos" (afirmación fiscal) | "No incluir impuestos sobre la facturación en esta cotización" (elección de cálculo) |

Reglas que no cambian: margen ≠ markup ([AGENTS.md §9](../AGENTS.md)); valores demo marcados **ILUSTRATIVO**; nunca `NaN`/`Infinity` en pantalla; las tarifas mínimas se muestran redondeadas hacia arriba.

## 6. Mobile

- Landing, ingreso y registro se diseñan también a 360 px: menú colapsable, botones táctiles ≥ 44 px, sin scroll horizontal.
- En la app mobile se puede: ver cotizaciones, ver el resultado, entender las tarifas e iniciar una cotización. Las tablas grandes se muestran como tarjetas o con scroll contenido, nunca forzando el ancho de la página. Las tablas editables del editor (otros costos, vehículos y, en pasos angostos, estructura y tramos) pasan a una tarjeta por fila.
- Los avisos emergentes salen arriba, debajo de la barra de la app: no tapan el resumen fijo del editor (con el menú abierto, abajo). Entre 761 y 1180 px, con el resumen fijo abajo, también salen arriba.
- El estado de guardado ("Guardado", "Sin conexión", "Conflicto"…) se ve en la barra de arriba, sin abrir el menú; en el riel (761 a 1100 px), con una palabra debajo del punto de color.

## 7. Accesibilidad

- Contraste WCAG AA (tokens de texto `--ink-2`, `--ink-3`, `--*-text`, o sus alias `--color-*` de [DESIGN.md](../DESIGN.md) §2); acción principal `--primary` (azul Neuquén profundo). Bordes de campos, también dentro de tablas, con `--color-border-control` (≥ 3:1).
- Raíz en % y ningún texto por debajo de 12 px (`--fs-xs`); "Ver cálculo" de 24 px o más (44 px en el celular); nada se distingue sólo por el color, tampoco en los gráficos.
- Foco visible siempre; al cambiar de pantalla se enfoca el título (h1).
- Campos: los obligatorios con `aria-required` además del asterisco; la ayuda, el error y los avisos del motor junto al campo, asociados con `aria-describedby`. Los montos llevan debajo su eco con separadores ("$ 2.600.000"); el texto del campo no se reformatea.
- Un `h1` por pantalla, jerarquía de headings sin saltos, labels reales en formularios, `aria-expanded` en menús, `<details>/<summary>` nativo para las secciones colapsables.
- Ayuda (i) (UX-UNITS): botón con nombre ("Más información: …") al lado del rótulo, nunca adentro; abre con mouse, toque, Enter o Espacio; se anuncia con `role="status"`; Esc la cierra y devuelve el foco. Sólo para lo secundario: un aviso crítico (NO CONFIABLE, ILUSTRATIVO, pérdida, unidad, guardado) va siempre a la vista.

## 8. Checklist por pantalla (test de carga cognitiva)

Antes de agregar algo a una pantalla, preguntate: **¿todo lo que estoy mostrando es necesario AHORA?** Si no:

- ocultarlo bajo detalle (`disclosure`),
- moverlo a una sección secundaria o pestaña,
- agruparlo o resumirlo,
- ofrecer "Ver más".

Y verificá: un CTA principal, contexto antes de cada input, estados vacíos con acción, "Ver cálculo" en cada resultado importante, mobile sin scroll horizontal.

**No perder lo cargado (UX-01):** un formulario nunca descarta lo cargado sin preguntar, y un valor que no se guardó siempre se dice:

- **Diálogos con formulario:** sin cierre por clic en el fondo; Esc, la X o "Cancelar" con cambios preguntan "¿Descartar los cambios?" ([Seguir editando] / [Descartar]). "Cambios" es lo que se guardaría distinto de lo que se abrió: marcar y desmarcar una casilla no lo es.
- **Un número, un mes o un texto obligatorio inválido** vuelve a su valor anterior al confirmarlo, y lo dice debajo del campo. Si eso pasa porque se sale de la pantalla, el aviso aparece en la siguiente (la pantalla, el campo, lo que se escribió y qué quedó) y queda hasta cerrarlo. En un diálogo que se cierra sin guardar, no hace falta.
- **Pantallas que guardan solas:** al salir, lo válido se guarda aunque otro campo esté (o haya estado) inválido; lo que ni así se puede guardar, se avisa. Lo que se guarda con un botón y no se guardó, se avisa.
- **Los avisos de error** quedan hasta cerrarlos.

## 9. Componentes de base (`js/ui/components.js`)

| Componente | Uso |
|---|---|
| `disclosure({ summary, hint, badge, open })` | Sección colapsable accesible (cerrada por defecto). Variante `className: 'disclosure-plain'` dentro de formularios ("Opciones avanzadas"). |
| `bigStat({ label, value, unit, hint, tone, trace, size })` | Número protagonista con su "Ver cálculo". |
| `pageIntro({ eyebrow, title, text, actions })` | Pregunta + por qué importa + acción. |
| `emptyState({ title, text, action, secondary, icon })` | Estado vacío con salida. |
| `linkButton(label, href, opts)` | Navegación con aspecto de botón (enlace real). |
| `stepIndicator({ current, total })` | "Paso 2 de 4" con barra. |
| `openDialog({ title, content, actions, isDirty })` | Diálogo modal. Con `isDirty` (un formulario): un clic en el fondo no lo cierra; Esc (también dos veces seguidas), la X y `requestClose()` (el "Cancelar") preguntan "¿Descartar los cambios?" si hay cambios. `close()` cierra sin preguntar (después de guardar). |
| `infoTip(text, { label })` + `addInfoTip(field, text)` | Ayuda (i) de lo secundario junto al rótulo de un campo (UX-UNITS). Una frase de ayuda visible por campo; lo demás, acá. Nunca un aviso crítico. |
| `toast(message, tone, { timeout })` | Aviso abajo a la derecha, con "Cerrar". Los de error (y `timeout: 0`) quedan hasta cerrarlos; como máximo 4 (se van primero los que se iban solos), y uno igual a otro a la vista no se repite. |
| `announceRestored(field, …)` + `installRestoreNotices({ notify })` | Un valor que no se guardó y volvió al anterior cuando su pantalla se fue se avisa en la siguiente (`app.notice`, sólo con la cuenta abierta). Si era de un diálogo que se cerró sin guardar, no. |

Formato abreviado para resúmenes: `formatMoneyCompact()` en `js/core/format.js` ("$ 15,8 M"; con `ceil: true` para tarifas, nunca muestra menos que el valor calculado).
