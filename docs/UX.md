# UX de RATEOS — "Simple en la superficie, potente por debajo"

Guía permanente de experiencia de usuario. Complementa [AGENTS.md](../AGENTS.md) (§17 UX) y [ARCHITECTURE.md](ARCHITECTURE.md). Si una pantalla nueva contradice esta guía, se discute antes de mergear.

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

El mockup del hero muestra **producto** (la demo "Hidrogrúa por día — Añelo" calculada en vivo por el motor, marcada como ejemplo ilustrativo). La landing no muestra KPIs, alertas, EECC ni configuraciones.

### Ingresar / Crear cuenta / Bienvenida

Cuentas reales con Supabase Auth (ver [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md)): registro con nombre, empresa, email y contraseña; confirmación por email ("Revisá tu email"); ingreso; recuperación de contraseña. Mensajes humanos, nunca técnicos; la contraseña nunca se guarda ni queda en pantalla. "Probar la demo sin cuenta" siempre a mano.

### Demo guiada (`#/demo`)

Antes del resultado completo, cuatro pasos de una pregunta cada uno: el servicio → lo que cuesta prestarlo → el resultado (4 números) → "¿Y si te llaman menos días?". Termina en el análisis completo o en "Crear mi propia cotización".

### Inicio (`#/inicio`)

"Hola, <nombre>. ¿Qué querés cotizar hoy?" + [Crear nueva cotización]; luego "Continuar cotización" (último borrador); **máximo 3 indicadores** (cotizaciones activas, margen promedio, cotizaciones en riesgo) y "Tus cotizaciones" (servicio, cliente, estado, tarifa, margen). El resto, colapsado.

**Cuenta nueva (vacía):** "Hola, <nombre>. ¿Qué querés hacer primero?" con [Crear mi primera cotización] [Configurar mi empresa] y un enlace opcional a la demo ("está aparte y no toca tus datos"). Sin botones repetidos, sin datos de ejemplo. El menú lateral muestra la empresa real, la cuenta ("Mi cuenta", "Cerrar sesión") y el estado de sincronización ("Guardado en la nube", "Cambios sin sincronizar", "Sin conexión…", "Conflicto…").

### Editor de cotización

Los pasos internos (10 desde la 0.24.0, con sus URLs) se agrupan en **5 etapas**, con los recursos antes que el precio (PLAN-2026-025). En la 0.24.0 (PLAN-2026-028) la etapa "Cómo se cobra" se disolvió: el ritmo de trabajo va en "El servicio", "Horas extra del trabajo" al final de "Personal", "¿Cómo viaja el personal a la locación?" en "Movilización y viajes" y el precio a mano, la hora fuera de horario, la guardia y los adicionales cargados antes en "El precio" (bloque "Cargado antes"). Una URL vieja `…/modality` abre "El precio".

| Etapa | Pasos internos |
|---|---|
| 1. El servicio | Qué servicio es, qué incluye, unidad de cobro y ritmo de trabajo |
| 2. Los recursos | Personal (con su costo por mes, hora normal, hora extra 50 % y 100 % y, al final, las horas extra del trabajo), equipos (amortización y mantenimiento a la vista), insumos y materiales, movilización y viajes |
| 3. Otros gastos | Gastos de estructura, financiamiento, imprevistos |
| 4. El precio | Margen, "¿Ya tenés un precio? (opcional, sin IVA)", impuestos sobre lo que facturás, reglas comerciales y lo cargado antes (fuera de horario, guardia, adicionales) |
| 5. Resultado | Resultado (con "Tus tarifas": horario normal, fuera de horario y guardia) |

**Precio a mano: un solo campo** (0.24.0, P-12): "¿Ya tenés un precio? (opcional, sin IVA)", a la vista debajo del margen ("Vacío = RATEOS te sugiere el precio con tu margen"). Escribe en `pricing.knownRate` si la cotización es "ya tengo la tarifa" y en `pricing.offeredRateOverride` si no; los dos dan los mismos números (INV-33). En una "ya tengo la tarifa", "Borrar mi precio y usar el sugerido" (con confirmación) la pasa a calcular la tarifa. La pantalla ya no ofrece elegir el modo.

Resumen en vivo: a la vista sólo el precio; costo del mes, tarifa mínima y días para no perder en "Ver más". La tarifa mínima dice si incluye los impuestos sobre lo que facturás (naranja si están sin definir).

**Datos de tu empresa** (0.24.0, W-10): mientras la Configuración sea de ejemplo, Inicio y "Nuevo servicio" muestran la tarjeta "Datos de tu empresa" (combustible, plazo de cobro, tasa mensual, imprevistos, margen y condición frente al IVA; los valores de ejemplo como texto de muestra). "Guardar" los deja como propios y la cotización siguiente nace sin "ILUSTRATIVO"; "Ahora no" deja todo como estaba. Con una empresa responsable inscripta y el IVA completo, la cotización nueva no pregunta por el IVA: una línea dice "Facturás con IVA … (tu empresa) · Cambiar sólo acá".

**Campos que no mueven números** (0.24.0, P-14): se ocultan o se pliegan, pero nunca se borran, y si tienen un valor guardado se siguen viendo. "Tiempo máximo de respuesta" está sólo en "Detalle de la guardia"; "Categoría" del puesto, sólo si tiene texto (en Recursos, en "Más detalle"); "Valor actual", "Velocidad estimada" y "Combustible" del modelo, sólo con valor; interno, modelo, año, dominio y capacidad del equipo en "Datos de la unidad (opcional)". "¿Quién lo provee?" ofrece "Lo pago yo" y "Lo pone el cliente" ("Tercero contratado por nosotros" sólo donde ya estaba elegida).

**Convención de montos: sin IVA.** Es una convención explícita de cada cotización (`vatTreatment`), no un supuesto silencioso: la primera etapa lo dice al empezar ("Esta cotización usa costos, precios y tarifas sin IVA: si tenés un valor con IVA, descontalo antes de cargarlo"), cada etapa muestra la marca **"Montos sin IVA"**, los formularios de equipos, materiales y el precio del combustible lo repiten donde suele llegar un precio con IVA, y el resultado y la impresión lo rotulan.

**Impuestos sobre lo que facturás** (etapa "El precio", PLAN-2026-002): pregunta "¿Qué parte de lo que facturás se va en impuestos?", con **Un % total** (lo más simple) o **Detalle por impuesto** (Ingresos Brutos, débitos y créditos, sellos, otros cargos), excluyentes, y "No incluir impuestos sobre la facturación en esta cotización" (una elección de cálculo, no una afirmación fiscal sobre la empresa). La ayuda dice qué incluir y qué no (IVA, Ganancias, retenciones, costo financiero) y cómo evitar el doble conteo. "Usar los de mi empresa" / "Guardar como valor de mi empresa" conectan con Configuración → Parámetros económicos. RATEOS no trae alícuotas.

**Recursos y snapshots** (PLAN-2026-005, [RESOURCE_MODEL.md](RESOURCE_MODEL.md)):

- Cada línea dice de dónde viene ("De Recursos · copiado el 05/10/26 14:30" o "Cargado en esta cotización") y de qué mes es su valor (**"Base: sep-26"** / **"Base no definida"**, en naranja).
- Si el recurso cambió en Recursos, la línea lo avisa con el valor utilizado y el actual (con sus bases) y dos botones: **[Actualizar en esta cotización] [Conservar valor original]**. Nunca se actualiza sola; el aviso no bloquea.
- La fecha base y la moneda de cada línea están en "Fecha base y moneda" (cerrado): cambian sólo esa cotización.
- **Equipos**: "¿Cómo lo obtenés?" (Propio / Alquilado / Tercerizado) cambia la ficha: un propio muestra valor de reposición, vida útil y consumo (lo demás en "Opciones avanzadas"); un externo muestra proveedor, tarifa neta, unidad, mínimo, vigencia y "¿Qué incluye la tarifa?"; el tratamiento fiscal queda en un desplegable con su resumen ("IVA 21 % · sí, lo recupero"). "Operador (de Personal)" vincula el puesto que lo opera.
- **Movilización y viajes**: primero "¿Cómo llega cada equipo al lugar del servicio?" (una fila por equipo, con km, litros y $ por llamado y "Ver cálculo"); después "Logística auxiliar: vehículos de apoyo y de personal", con la advertencia de no cargar dos veces un equipo que ya se moviliza solo.
- **Tipo de servicio**: "Base económica de la oferta" con la fecha de la oferta, la base por rubro, las advertencias y los tipos de cambio de la cotización.

**Insumos y materiales** (0.22.0, PLAN-2026-027): una sola lista, sin secciones. Cada línea tiene un **Tipo** junto a "¿Qué es?" (Material que queda en la obra, Insumo o consumible, Herramienta menor, EPP especial, Otro gasto) que viene de Recursos; si no coincide con el de Recursos, la línea lo dice y ofrece "Usar el de Recursos" o "Guardar este tipo en Recursos". Arriba: "Desde tus recursos" + Agregar (nace con la cantidad vacía y "Por válvula" / "Por mes" según la unidad de cobro) y "Tipo" + "Agregar en blanco" (empieza en "Insumo o consumible" y recuerda el último de la sesión). Debajo, el subtotal por tipo. Los otros costos guardados con versiones anteriores se ven sólo si existen, en **"Gastos cargados antes"**, con "Suma en: …" y, los que suman en este renglón, el botón "Pasar a la lista". Ya no hay "Va a" ni "Categoría". "¿Qué incluye?" (paso 1) tiene 4 casillas: Personal, Equipos y vehículos, Insumos y materiales y Viajes. La ropa de trabajo y el EPP básico de cada persona siguen en su puesto (Personal).

### Glosario (0.24.0)

- **Precio mínimo** (Productos, antes "Precio piso"): el precio que no gana ni pierde. En las cotizaciones se sigue llamando **tarifa mínima**, distinta de la **tarifa sugerida** (par del auditor `UX-TERM-DISTINCT`). El control `UX-TERM-FLOOR` impide que vuelva "precio piso". Pasar toda la app de "tarifa" a "precio" queda para una versión aparte (decisión D4).
- **"Cómo se cobra"** ya no es un paso: ningún texto lo cita (`UX-TERM-STEP`).
- **Aportes del trabajador (% del remunerativo)**: se calculan sólo sobre el remunerativo y sólo dan el neto; no cambian el costo.
- **Horas asignadas a este trabajo**: las horas de un equipo o recurso que paga esta cotización (antes "Horas asignado a esta cotización").

### Resultado

La primera vista responde **sólo cuatro preguntas**: **¿Cuánto me cuesta? ¿Cuánto tengo que cobrar? ¿Cuánto tengo que trabajar? ¿Cuánto margen queda?** (4 números con "Ver cálculo", la frase de los días, la nota "Montos sin IVA…" y las alertas críticas, como la de impuestos sobre lo que facturás sin definir). Aunque el motor sea más completo, nada más va arriba (progressive disclosure).

**Un solo precio** (0.24.0, W-01): arriba hay una sola cifra grande, el precio que se cobra ("Precio sugerido" o "Tu precio", según de dónde sale), y debajo una línea "Te cuesta $ X · ganás $ Y (Z %)". La tarifa mínima pasa a un renglón "¿Hasta cuánto puedo bajar?" con su "Ver cálculo"; las tarjetas de costo, ganancia, margen y mínima quedan en "Todos los indicadores". El margen se muestra como lo pidió la persona; la diferencia por redondeo queda en "Ver cálculo".

Todo lo demás está en **"Profundizá"**, cerrado por defecto y dibujado al abrirlo: **"¿Cómo se forma tu precio?"** (de cada $ 100 que facturás: costo, impuestos y ganancia; 100 % del precio), **"¿En qué se va el costo?"** (4 rubros + otros, y la estructura de costos completa; 100 % del costo), **reparto de la tarifa (apropiación) y total del contrato**, tarifa según días trabajados (matriz), escenarios y sensibilidad, reglas comerciales y descuentos, margen vs markup, **base económica de la oferta** (bases por rubro, tipos de cambio y externos: costo económico vs salida de caja vs crédito fiscal), completitud y "Ver cálculo completo" (con **"Los números cierran"**). Al imprimir se abren todas las secciones.

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
- En la app mobile se puede: ver cotizaciones, ver el resultado, entender las tarifas e iniciar una cotización. Las tablas grandes se muestran como tarjetas o con scroll contenido, nunca forzando el ancho de la página.

## 7. Accesibilidad

- Contraste WCAG AA (tokens de texto `--ink-2`, `--ink-3`, `--*-text`); acción principal `--primary` (azul Neuquén profundo).
- Foco visible siempre; al cambiar de pantalla se enfoca el título (h1).
- Un `h1` por pantalla, jerarquía de headings sin saltos, labels reales en formularios, `aria-expanded` en menús, `<details>/<summary>` nativo para las secciones colapsables.

## 8. Checklist por pantalla (test de carga cognitiva)

Antes de agregar algo a una pantalla, preguntate: **¿todo lo que estoy mostrando es necesario AHORA?** Si no:

- ocultarlo bajo detalle (`disclosure`),
- moverlo a una sección secundaria o pestaña,
- agruparlo o resumirlo,
- ofrecer "Ver más".

Y verificá: un CTA principal, contexto antes de cada input, estados vacíos con acción, "Ver cálculo" en cada resultado importante, mobile sin scroll horizontal.

## 9. Componentes de base (`js/ui/components.js`)

| Componente | Uso |
|---|---|
| `disclosure({ summary, hint, badge, open })` | Sección colapsable accesible (cerrada por defecto). Variante `className: 'disclosure-plain'` dentro de formularios ("Opciones avanzadas"). |
| `bigStat({ label, value, unit, hint, tone, trace, size })` | Número protagonista con su "Ver cálculo". |
| `pageIntro({ eyebrow, title, text, actions })` | Pregunta + por qué importa + acción. |
| `emptyState({ title, text, action, secondary, icon })` | Estado vacío con salida. |
| `linkButton(label, href, opts)` | Navegación con aspecto de botón (enlace real). |
| `stepIndicator({ current, total })` | "Paso 2 de 4" con barra. |

Formato abreviado para resúmenes: `formatMoneyCompact()` en `js/core/format.js` ("$ 15,8 M"; con `ceil: true` para tarifas, nunca muestra menos que el valor calculado).
