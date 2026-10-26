---
# Tokens de RATEOS en formato DESIGN.md (frontmatter tipo Stitch). Los valores salen de css/styles.css
# (:root, alias --color-*); tests/ui/design-system.test.js verifica que coincidan. Versión alpha.
version: alpha
name: RATEOS
description: Estimador de costos y tarifas para pymes de servicios industriales (Neuquén, Vaca Muerta). Densidad media-alta; el número y su riesgo primero.
colors:
  text: "#15232D"
  text-secondary: "#3D4F5C"
  text-muted: "#566773"
  brand: "#003B73"
  brand-hover: "#0A4C8A"
  link: "#0A6E90"
  bg: "#F4F8FB"
  surface: "#FFFFFF"
  surface-2: "#F8FBFD"
  border: "#DCE5EC"
  border-control: "#7F8F9B"
  focus: "#087EA4"
  status-ok: "#157A50"
  status-ok-bg: "#E7F6EF"
  status-review: "#9A5F12"
  status-review-bg: "#FDF3E5"
  status-critical: "#B23B3B"
  status-critical-bg: "#FBECEC"
  status-info: "#0A6E90"
  status-info-bg: "#EAF5FB"
typography:
  family: "pila del sistema (Inter si está instalada; Inter autoalojada pendiente de decisión DD-3)"
  numeric: "tabular-nums"
  root: "93.75% (15 px de fábrica) en escritorio; 100% (16 px) en el celular"
  sizes-rem: [0.8, 0.875, 1, 1.125, 1.375, 1.75, 2.25]
  min-px: 12
rounded:
  control: 8px
  card: 12px
  dialog: 16px
  pill: 999px
spacing-rem: [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
---

# DESIGN.md · Sistema de diseño de RATEOS ("Ingeniería clara")

RATEOS es una herramienta para cotizar: alguien carga sus costos y decide un precio con plata real. Este documento fija **cómo se ve y cómo se lee** esa decisión. La dirección es "Ingeniería clara", aprobada por el dueño el 20/10/2026: una **evolución** de lo que ya existe, sin rediseños ni efectos.

- **Prioridad**, igual que en `AGENTS.md`: precisión de los números > seguridad > legibilidad operativa > estética. **Nunca se resigna claridad de una cotización por embellecerla.**
- **Fuente de verdad de los valores:** `css/styles.css` (`:root`). Este archivo los explica. `tests/ui/design-system.test.js` falla si los dos dejan de coincidir.
- **Nada de lo que dice este documento cambia una fórmula, un dato o un precio.**

## 1. Principios

1. **El número manda.** Costo del mes, tarifa piso, tarifa sugerida (u ofrecida) y margen se leen primero, con su unidad ("/ día", "/ m³") y "sin IVA".
2. **El riesgo va arriba del número que afecta.** BORRADOR, RESULTADO NO CONFIABLE, ILUSTRATIVO y "bajo piso" tienen texto, color e ícono, y se ven antes que el monto. Nada se comunica sólo con color.
3. **Densidad de herramienta, no de folleto.** Tablas compactas y legibles. La landing puede respirar; la cotización, no.
4. **Una sola forma de hacer cada cosa:** un componente por patrón (aviso, tabla, KPI, diálogo, grupo plegable), con su clase en `css/`.
5. **Accesible por defecto:** WCAG 2.2 AA, teclado completo, foco visible y nada tapado.
6. **Sin dependencias ni terceros.** Todo sale del mismo origen; la CSP no se relaja; no se cargan fuentes, íconos ni scripts de afuera.

## 2. Color

La paleta no cambia (`--navy-900`, `--blue-600`, `--ink`, verdes, naranjas y rojos con su variante para texto). Encima van **alias por función**: las reglas nuevas usan el alias, nunca un hex suelto ni un tono de la paleta "porque se parece".

| Alias (`:root`) | Apunta a | Uso | Contraste |
|---|---|---|---|
| `--color-text` | `--ink` | Texto principal | 15:1 sobre el fondo |
| `--color-text-secondary` | `--ink-2` | Texto de apoyo | 8,5:1 sobre blanco |
| `--color-text-muted` | `--ink-3` | Ayudas, rótulos chicos, unidades | 5,5:1 sobre el fondo: **el mínimo para texto** |
| `--color-brand` / `--color-brand-hover` | `--navy-900` / `--primary-hover` | Marca, botón primario, montos clave | 11:1 |
| `--color-link` | `--blue-text` | Enlaces y "Ver cálculo" | ≥ 5:1 |
| `--color-bg`, `--color-surface`, `--color-surface-2` | `--bg`, `--white`, `--surface-2` | Fondo de la app, tarjetas, filas alternas | — |
| `--color-border` | `--line` | Bordes **decorativos** (tarjetas, separadores) | 1,3:1: nunca para un control |
| `--color-border-control` | `--field-border` | Borde de campos, selectores y controles, también dentro de tablas | 3,3:1 (WCAG 1.4.11) |
| `--color-focus` | `--focus` | Anillo de foco de 3 px | ≥ 3:1 sobre blanco y fondo |
| `--color-status-ok` / `-bg` | `--green-text` / `--green-50` | Completo, guardado, margen ≥ objetivo | ≥ 4,5:1 |
| `--color-status-review` / `-bg` | `--orange-text` / `--orange-50` | BORRADOR, revisar, ILUSTRATIVO | ≥ 4,5:1 |
| `--color-status-critical` / `-bg` | `--red-text` / `--red-50` | NO CONFIABLE, bajo piso, error | ≥ 4,5:1 |
| `--color-status-info` / `-bg` | `--blue-text` / `--blue-50` | Informativo | ≥ 4,5:1 |

**Reglas:**
- `--orange`, `--blue-400`, `--green`, `--red` y `--line` **no son colores de texto**: sólo puntos, barras y bordes, siempre con una palabra al lado.
- Ningún estado se distingue sólo por el color: lleva palabra ("Revisar", "No confiable", "Guardado") y, si hay lugar, ícono.
- En los gráficos, cada serie tiene **trazo propio**: el objetivo va lleno, la tarifa piso punteada y la tarifa cotizada con guiones, y la leyenda los muestra igual. La estructura de costos usa siempre el mismo color para el mismo rubro.

## 3. Tipografía y números

- **Familia:** la pila del sistema (`--font`). Nombra "Inter" primero, pero la app no la carga: cada sistema muestra su letra. **Inter autoalojada (licencia OFL 1.1, mismo origen) es una propuesta pendiente de la decisión DD-3 del dueño**; hasta entonces no se agrega ninguna fuente.
- **Raíz en %:** `93.75 %` en escritorio (15 px con la letra de fábrica del navegador) y `100 %` en el celular (16 px). Si la persona agranda la letra del navegador, la app la sigue (WCAG 1.4.4). **Nunca se fija en px.**
- **Escala:** `--fs-xs` (0,8 rem) … `--fs-3xl` (2,25 rem). **Mínimo de la app: 12 px** (`--fs-xs`), incluidas las pastillas de riesgo, los subtítulos de tablas y los textos de los gráficos (que van en px reales porque el SVG se dibuja a su tamaño).
- **Números:** cifras tabulares (`font-variant-numeric: tabular-nums`) en todo monto, porcentaje y cantidad; ninguna regla las anula. Montos alineados a la derecha en tablas. La unidad, más chica y en `--color-text-muted`, junto al número: "$ 2.409.000 / día".
- **Pesos:** 400 texto, 600 rótulos, 700 títulos y montos clave. Los pesos intermedios que hay hoy (650, 720) se consolidan cuando haya decisión sobre la fuente.
- **Títulos:** en minúscula de oración (español). Un solo `h1` por pantalla.

## 4. Riesgo y estados

| Marca | Cuándo | Cómo se ve | Dónde |
|---|---|---|---|
| **RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA** | Un dato que vuelve el resultado no confiable (el motor de completitud lo marca) | Aviso crítico **antes** de los montos, y la marca en cada número que afecta | Resultado, resumen del editor, PDF (y, con el PR #29 en revisión, listas, Inicio y Escenarios) |
| **BORRADOR** | Faltan datos críticos | Aviso "revisar" arriba de los números | Resultado y PDF |
| **ILUSTRATIVO** | Valores de ejemplo | Pastilla de 12 px o más, naranja de texto sobre su fondo | Junto al valor, en el Resultado, en Configuración y en el encabezado del PDF |
| **Bajo piso / perdés plata** | La tarifa no cubre el costo | Tono crítico con texto ("Pierde plata") | Resultado y resumen |
| **Precio de referencia** | Siempre que se muestra un precio sugerido | "Calculado con tus costos y tus supuestos: no es un precio de mercado." | Junto a los montos del Resultado (servicios y productos); se imprime |
| **Estado de guardado** | Siempre que hay sesión | Punto de color **y palabra**: "Guardado", "Guardando…", "Sin conexión", "Conflicto"… | Pie del menú (texto completo), riel de 761 a 1100 px (palabra corta) y barra del celular (palabra corta) |

## 5. Componentes

| Componente | Reglas |
|---|---|
| **Ficha del Resultado** | Lista de clave y valor (`<dl>`) de siete renglones, en este orden: Vendés (qué y en qué unidad) → Tarifa (sugerida u ofrecida, la cifra más grande, con la piso debajo) → Facturás → Te cuesta → Ganás (con el margen y su palabra: "cumple tu objetivo", "debajo de tu objetivo", el mismo criterio que el resumen en vivo) → Actividad (con la dotación: "880 horas-hombre = 4 personas × 22 días × 10 h") → Para no perder (en la unidad de cobro). Cada monto con su unidad y "Ver cálculo". Con precio total del trabajo, "en todo el trabajo" en vez de "por mes" |
| **KPI de resultado** | Rótulo chico, monto grande tabular con su unidad, una línea de explicación y "Ver cálculo". Va en el detalle ("Ver cálculo completo"): costo → tarifa piso → tarifa sugerida u ofrecida → margen |
| **Resumen en vivo del editor** | Panel (más de 1180 px): costo, piso, tarifa cobrada, margen esperado, "Para no perder" y resultado esperado, en la lista principal; "Ver más" deja el precio para tu margen y la completitud. Si no entra en la altura de la pantalla, el panel se desplaza. Barra compacta (1180 px o menos): costo, piso, **tarifa cobrada destacada** (fondo y cifra más fuerte) y margen con su palabra ("cumple", "debajo", "pierde", "no confiable"); el resto, en "Ver detalle" |
| **"Ver cálculo"** | Botón con nombre accesible "Ver cálculo: <rótulo>". La traza **termina en el mismo número** que se ve. Mide 24 px de alto o más en escritorio y 44 px en el celular (WCAG 2.5.8) |
| **Aviso** | Tres niveles: info, revisar y crítico. Título, causa y acción ("Ir al campo"). El crítico va antes de los KPI y se imprime |
| **Pastilla** | `nowrap`, 12 px o más, texto + color de estado. "No confiable" (crítico), "Borrador" e "ILUSTRATIVO" (revisar) |
| **Tabla** | `th` con `scope`, números a la derecha y tabulares. En el celular pasa a tarjetas con rótulo por celda. Los campos dentro de tablas llevan `--color-border-control` |
| **Campo numérico** | Formato argentino ("2.600.000,50"), teclado decimal, unidad dentro del campo y error en línea con cómo arreglarlo. Un valor inválido no se pierde en silencio: se avisa |
| **Eco de montos** | Debajo de todo campo de plata, desde 10.000: el monto con separadores en la moneda del campo ("$ 2.600.000", "US$ 15.000"), leído con el mismo intérprete que el campo. Con una unidad que no dice una moneda, sin eco: nunca se adivina. Si aparece mientras se escribe con el campo en el borde de abajo (el pie de un diálogo, la barra del resumen), se desplaza lo justo para verse. **El texto del campo no se reformatea** al entrar ni al salir: cambiarlo al tomar el foco borra la selección y, con Tab, lo tipeado se sumaría al número anterior en vez de reemplazarlo |
| **Campo obligatorio** | Asterisco visible y `aria-required="true"`. La ayuda, el error y los avisos del motor junto al campo se asocian con `aria-describedby` |
| **Diálogo** | `<dialog>` nativo, foco adentro y de vuelta al botón que lo abrió. Con cambios, pregunta "¿Descartar los cambios?"; un clic afuera no cierra un formulario |
| **Grupo plegable** | `<details>`/`<summary>` con conteos y monto a la derecha (Recursos por convenio y por familia). Enter o Espacio lo abren |
| **Botón** | Uno primario por vista; secundario y "enlace". Sólo con ícono: `aria-label` siempre |
| **Aviso emergente (toast)** | Para confirmaciones sin acción ("Guardado"). Los errores quedan hasta cerrarlos y se anuncian. Con el resumen del editor fijo abajo (1180 px o menos) salen arriba, y en el celular debajo de la barra de la app: nunca tapan el resumen. Con el menú del celular abierto, abajo |
| **Gráfico** | Dibujado al ancho real (1 unidad = 1 px), con tabla alternativa y descripción para lectores; trazos distintos por serie (§2) y rótulos de 12 px |

## 6. Celular

- **Cortes:** ≤ 760 px celular; 761 a 1100 px riel (menú con íconos y palabras cortas); ≤ 1180 px el resumen del editor pasa a una barra fija abajo.
- **Sin scroll horizontal** en ninguna pantalla: las tablas editables pasan a tarjetas (`qe-stack-table`; estructura y tramos con `qe-stack-narrow`, sólo cuando el paso mide 680 px o menos, porque en escritorio entran como tabla) y las notas largas se parten. Se prueba a 390, 360 y 320 px.
- **Los avisos emergentes salen arriba**, debajo de la barra de la app.
- **Objetivos táctiles de 44 px** o más.
- **El estado de guardado se ve sin abrir el menú**, en la barra de arriba.
- Lo primero que importa entra en la primera pantalla (en Recursos, el primer grupo; en el Resultado, los montos). Lo secundario se pliega, sin perder desgloses.
- Las capturas antes y después de cada PR se toman a 1440 y a 390 px.

## 7. Impresión

- Dos salidas, A4 vertical con márgenes de 12 mm: **"Imprimir resumen (1 hoja)"** (la ficha y la cuenta del mes o del trabajo) e **"Imprimir análisis completo"** (la misma primera hoja y, desde la segunda, todas las secciones abiertas). Sin controles. Las dos dicen "Uso interno": no son la oferta para el cliente.
- **NO CONFIABLE, BORRADOR e ILUSTRATIVO salen impresos, con su color, antes de los números.**
- **Encabezado:** empresa y cotización; cliente; "Oferta del dd/mm/aaaa · impreso el dd/mm/aaaa"; "Montos sin IVA". Si la cotización no tiene fecha de oferta, sólo la de impresión: nunca se inventa una.
- La nota de precio de referencia sale junto a los montos.

## 8. Voz y textos

- Español rioplatense, segunda persona ("Cargá", "Revisá"), voz activa, frases cortas.
- **Cada aviso dice qué pasa y qué hacer.** Los botones dicen verbo y objeto ("Guardar sueldo", no "Aceptar").
- **Nombres fijos:** costo ≠ tarifa piso ≠ precio objetivo ≠ tarifa sugerida; margen ≠ markup (`AGENTS.md`); perfil ≠ persona; llamado / salida / intervención según la cotización (la "intervención" es sólo la activación de los servicios permanentes).
- **Números:** siempre con `js/core/format.js` (`Intl` es-AR): "$ 1.234.567", "12,5 %"; la tarifa piso se muestra redondeada hacia arriba; un dato que falta es "—", nunca 0 ni NaN.
- Un solo carácter de puntos suspensivos ("Guardando…"). Sin jerga, sin emojis y sin signos de exclamación en los avisos.

## 9. Accesibilidad

Checklist de cada PR que toca la interfaz:
- [ ] Un `h1` por pantalla y títulos en orden.
- [ ] Todo campo con `label`; los botones sólo con ícono, con `aria-label`.
- [ ] Obligatorios con `aria-required`; ayuda, error y avisos del motor asociados al campo con `aria-describedby`.
- [ ] Foco visible en todo control, sin nada encima (ni la barra de resumen ni la de arriba) (WCAG 2.4.7 y 2.4.11).
- [ ] Texto ≥ 4,5:1; bordes de controles, foco e íconos con significado ≥ 3:1 (WCAG 1.4.3 y 1.4.11).
- [ ] Nada sólo con color (WCAG 1.4.1).
- [ ] Texto de 12 px o más y raíz en % (WCAG 1.4.4).
- [ ] Objetivos de 24 px o más; 44 px en el celular (WCAG 2.5.8).
- [ ] Teclado: Tab, Enter, Espacio y Escape en tablas, grupos, pasos y diálogos, con una prueba sólo con teclado en el `ui-lab`.
- [ ] Avisos dinámicos con `role="status"` o `role="alert"` según su gravedad.
- [ ] `prefers-reduced-motion` respetado; sin animaciones nuevas.

## 10. Estados de pantalla

| Estado | Cómo se ve |
|---|---|
| **Cargando** | "Abriendo tu cuenta…" desde el primer instante; sin saltos de diseño |
| **Vacío** | Conserva el marco y el título, y dice qué hacer ("Todavía no cargaste personal. Agregá un puesto…") |
| **Error** | Dentro del bloque que falló: qué pasó, qué hacer y, si se puede, "Reintentar". El resto de la pantalla sigue |
| **Sin sincronizar** | "Sin sincronizar: guardado sólo en este navegador" (o la palabra corta en el riel y el celular), con su punto de color |
| **Resultado no confiable** | Aviso crítico arriba, la marca en cada número afectado y "Marcar como enviada" frenado con el motivo |
| **Datos de ejemplo** | ILUSTRATIVO en cada valor y en el encabezado del PDF |

## 11. Guía para agentes

1. Usá los alias de §2 y los tamaños de §3. Si falta uno, proponelo en el PR; no escribas un hex ni un tamaño suelto.
2. No toques `js/engines/**` ni `js/domain/**` desde un cambio de diseño: este documento es de presentación.
3. Cada PR de interfaz lleva capturas antes y después (1440 y 390 px), una prueba sólo con teclado, el checklist de §9 y la suite completa con el golden y el Test Lab sin cambios.
4. Ante la duda entre "más lindo" y "más claro para la plata", gana lo claro.
5. No agregues dependencias, CDN ni fuentes externas. No cambies el logo ni el favicon.

## 12. Decisiones pendientes y fuera de alcance

- **Logo (DD-2):** el concepto C es una propuesta; el logo y el favicon actuales no cambian hasta que el dueño lo apruebe (y después de una búsqueda de marca).
- **Tipografía (DD-3):** Inter autoalojada o la letra del sistema.
- **Primer uso:** una lista "Dejemos lista tu empresa" para las cuentas nuevas.
- **Landing y registro:** el glosario único y los textos públicos van después del registro con confirmación de email (PR #28).
- **Modo oscuro:** fuera de alcance.
- **Íconos:** falta el inventario del set actual.

## Historial

- **alpha (2026-10-20, DESIGN-02 · PLAN-2026-025):**
  - primera versión;
  - alias por función, raíz en %, mínimo de 12 px y cifras tabulares;
  - "Ver cálculo" de 24 px, trazos distintos en el gráfico y bordes de campos en tablas;
  - estado de guardado con palabra, nota de precio de referencia y fecha de la oferta en el PDF.
- **alpha.2 (2026-10-20, DESIGN-02 2/2 · PLAN-2026-026):**
  - resumen en vivo con el resultado y el margen a la vista, y barra compacta con la tarifa cobrada destacada y el margen con su palabra;
  - eco de montos en todo campo de plata, sin reformatear el texto del campo;
  - avisos arriba en el celular, y tablas de estructura y de tramos apiladas en pasos angostos;
  - `aria-required` y `aria-describedby` en los campos y en los avisos del motor.
