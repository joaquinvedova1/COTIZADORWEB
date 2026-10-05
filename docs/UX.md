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
#/login       Ingresar (preparado)             #/recursos/:tab   Personal · Equipos · Materiales · Ubicaciones
#/registro    Crear cuenta (preparado)         #/servicios       Plantillas de servicio
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

Flujos **preparados** para la futura autenticación (ver [AUTH_ARCHITECTURE.md §1.1](AUTH_ARCHITECTURE.md#11-pantallas-preparadas-sin-autenticación)). Hoy avisan que las cuentas no están habilitadas, nunca guardan email ni contraseña y ofrecen "Entrar sin cuenta".

### Demo guiada (`#/demo`)

Antes del resultado completo, cuatro pasos de una pregunta cada uno: el servicio → lo que cuesta prestarlo → el resultado (4 números) → "¿Y si te llaman menos días?". Termina en el análisis completo o en "Crear mi propia cotización".

### Inicio (`#/inicio`)

"Hola. ¿Qué querés cotizar hoy?" + [Crear nueva cotización]; luego "Continuar cotización" (último borrador); **máximo 3 indicadores** (cotizaciones activas, margen promedio, cotizaciones en riesgo) y "Tus cotizaciones" (servicio, cliente, estado, tarifa, margen). El resto, colapsado.

### Editor de cotización

Los 11 pasos internos siguen existiendo (y sus URLs), agrupados en **5 etapas**:

| Etapa | Pasos internos |
|---|---|
| 1. El servicio | Tipo de servicio, modalidad |
| 2. Los recursos | Personal, equipos, materiales, logística |
| 3. Costos y condiciones | Gastos de estructura, financiamiento, imprevistos |
| 4. El precio | Margen, impuestos sobre lo que facturás y reglas comerciales |
| 5. Resultado | Resultado |

Resumen en vivo con 4 números (costo del mes, tarifa piso, tarifa sugerida, días para no perder) y "Ver más". La tarifa piso dice si incluye los impuestos sobre lo que facturás (naranja si están sin definir).

**Convención de montos: sin IVA.** Es una convención explícita de cada cotización (`vatTreatment`), no un supuesto silencioso: la primera etapa lo dice al empezar ("Esta cotización usa costos, precios y tarifas sin IVA: si tenés un valor con IVA, descontalo antes de cargarlo"), cada etapa muestra la marca **"Montos sin IVA"**, los formularios de equipos, materiales y el precio del combustible lo repiten donde suele llegar un precio con IVA, y el resultado y la impresión lo rotulan.

**Impuestos sobre lo que facturás** (etapa "El precio", PLAN-2026-002): pregunta "¿Qué parte de lo que facturás se va en impuestos?", con **Un % total** (lo más simple) o **Detalle por impuesto** (Ingresos Brutos, débitos y créditos, sellos, otros cargos), excluyentes, y "No incluir impuestos sobre la facturación en esta cotización" (una elección de cálculo, no una afirmación fiscal sobre la empresa). La ayuda dice qué incluir y qué no (IVA, Ganancias, retenciones, costo financiero) y cómo evitar el doble conteo. "Usar los de mi empresa" / "Guardar como valor de mi empresa" conectan con Configuración → Parámetros económicos. RATEOS no trae alícuotas.

### Resultado

La primera vista responde **sólo cuatro preguntas**: **¿Cuánto me cuesta? ¿Cuánto tengo que cobrar? ¿Cuánto tengo que trabajar? ¿Cuánto margen queda?** (4 números con "Ver cálculo", la frase de los días, la nota "Montos sin IVA…" y las alertas críticas, como la de impuestos sobre lo que facturás sin definir). Aunque el motor sea más completo, nada más va arriba (progressive disclosure).

Todo lo demás está en **"Profundizá"**, cerrado por defecto y dibujado al abrirlo: **"¿Cómo se forma tu precio?"** (de cada $ 100 que facturás: costo, impuestos y ganancia; 100 % del precio), **"¿En qué se va el costo?"** (4 rubros + otros, y la estructura de costos completa; 100 % del costo), **reparto de la tarifa (apropiación) y total del contrato**, tarifa según días trabajados (matriz), escenarios y sensibilidad, reglas comerciales y descuentos, margen vs markup, completitud y "Ver cálculo completo" (con **"Los números cierran"**). Al imprimir se abren todas las secciones.

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
