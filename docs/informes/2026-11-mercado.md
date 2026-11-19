# RATEOS frente a los cotizadores del mercado (2026-11-19)

Pedido de Joaco: aprender cómo cotizan las apps que funcionaron (con respaldo), comparar front, dinámica y estructura, y aplicar lo mejor. Observación de partida: "el cotizador dice mucho texto y parece IA".

Fuentes completas (tablas, reseñas, URLs): `mercado-obra.md` y `mercado-servicios.md` en la carpeta `mercado/` de los archivos del proyecto.

## 1. A quiénes se miró y por qué valen

| Grupo | Apps | Respaldo |
|---|---|---|
| Servicios de campo | Jobber, Housecall Pro, ServiceTitan, Tradify, ServiceM8, FieldPulse, Workiz, Joist | Jobber +100.000 clientes y USD 183 M de inversión, Capterra 4,6 (1.500 reseñas). ServiceTitan salió a bolsa (dic-2024). Housecall Pro 4,7 (2.748). Tradify 4,7 en facilidad de uso. |
| Obra | Buildertrend (+CoConstruct), Procore Estimating, ProEst (Autodesk), Clear Estimates, STACK, PlanSwift, Sage | Buildertrend 23.000 clientes, 4,5 (2.490). Procore 4,5. ProEst 3,9 con queja de curva de aprendizaje. |
| LatAm | Presto, OPUS, Neodata, CYPE; Xubio/Colppy (presupuesto = factura borrador) | Modelo de análisis de precio unitario (APU), interfaces de escritorio viejas. No hay SaaS argentino de costeo con tracción comprobable ni ninguno que costee con convenio colectivo. |

## 2. Qué hacen igual todos los que funcionan

1. **Mismo núcleo que RATEOS**: catálogo de recursos → ítem compuesto (assembly / APU) → recargos → precio. RATEOS ya tiene ese modelo; el problema era la presentación.
2. **Interfaz seca**: rótulos, no oraciones. Pista corta entre paréntesis en el rótulo. Lo avanzado plegado ("más detalle (opcional)"). Nada de párrafos explicando la pantalla.
3. **El precio arriba, grande y en vivo**, con costo y margen chicos debajo.
4. **Las apps simples puntúan mejor en facilidad de uso** que las potentes (Simpro 2,8 en su módulo de cotización; ProEst 3,6).

## 3. RATEOS hoy (medido en 0.16.0)

Cotización de ejemplo (transporte por viaje), todos los pasos: unas 3.950 palabras en PC, ~2.750 de contenido propio del paso (sin menú ni resumen). Cada paso abría con antetítulo + pregunta + 2 o 3 líneas de explicación; cada opción tenía su párrafo; varias cajas repetían la cuenta en prosa.

Donde RATEOS ya está igual o mejor que el mercado: catálogo de recursos con convenio y cargas (nadie lo hace en LatAm), aumento por convenio con historial, actualizar tarifa, "Sí, ya tengo la tarifa" (precio objetivo → margen), "Ver cálculo" en cada número, PDF.

## 4. Auditoría de ideas (qué se adopta y qué no)

| Idea del mercado | Decisión | Por qué |
|---|---|---|
| Rótulos en vez de oraciones, sin párrafos de ayuda | **Adoptada (0.17.0)** | Es la causa de "parece IA". |
| Precio primero y grande en el resumen en vivo | **Adoptada (0.17.0)** | Jobber/Procore; es lo primero que se busca. |
| Explicación sólo de la opción elegida | **Descartada en la revisión UX** | En el celular no hay mouse: la otra opción quedaba sin explicar. Se acortaron las explicaciones a pocas palabras. |
| Mostrar sólo lo que falta (chips del proveedor) | **Adoptada (0.17.0)** | Completo = una línea. |
| Fórmula de una línea en el Resultado (Personal + Equipos + … = costo → margen → precio) | Después (0.18) | Necesita diseño del bloque; "¿Cómo se forma tu precio?" ya lo cubre plegado. |
| "¿Qué incluye?" con el monto de cada categoría | Después | Útil, pero requiere recalcular por categoría en el paso 1. |
| Ver como cliente (propuesta de una página, sin costos internos) | Después, a decidir | Las propuestas cortas ganan más (Proposify, 742.137 propuestas), pero hoy el PDF es el análisis interno. |
| Duplicar / cotizar similar | Ya existe | Regla de un ítem: la variante se hace duplicando. |
| Actualización masiva (paritaria +8 %, índices) | Ya existe | Aplicar aumento del convenio y Actualizar tarifa. |
| Precio objetivo → margen | Ya existe | "Sí, ya tengo la tarifa". |
| Factor de cargas visible (×1,87 tipo FASAR) | Ya existe en parte | Recursos muestra el costo por mes con cargas y la hora. |
| Good / better / best, varias opciones por cotización | **No** | Rompe "un solo ítem por cotización". |
| Firma / aprobación del cliente, seguimiento de "visto" | **No** | Es CRM, fuera del alcance (AGENTS §3). |
| Botones de IA para escribir textos | **No** | AGENTS §2: RATEOS no es IA. |
| Árbol de capítulos, takeoff sobre planos, bases de precios gigantes | **No** | Complejidad que las apps simples evitan y que RATEOS no necesita. |
| Dos costos por recurso (referencia y real) | **No** | Duplica la carga; la cotización ya guarda su copia con fecha. |
| Diagramas de rotación / cronogramas | **No** | Decisión de Joaco (2026-11-08). |

## 5. Qué cambió en 0.17.0 (sin cambio de fórmulas)

- Sin antetítulo "Etapa N de 6 · …" (lo dice la barra de etapas).
- Cada paso: la pregunta y, como mucho, una línea corta. Sin "Término técnico".
- "Montos sin IVA. Si un valor tiene IVA, descontalo." en vez de un párrafo.
- Opciones (tarjetas de elección): explicaciones de pocas palabras ("Horario normal.", "Todo fuera de horario (ej.: un domingo).").
- Resumen en vivo: primero el precio, más grande; debajo costo, mínimo y para no perder.
- Proveedor tercerizado: sólo los datos que faltan; completo = "✓ Datos del proveedor completos."
- Textos acortados en Personal, Equipos, Movilización, Cómo se cobra, Impuestos, Imprevistos, Gastos de estructura y Resultado.

Resultado medido (misma cotización): de ~3.950 a ~3.200 palabras en pantalla (−19 %; −27 % sin contar menú y resumen), y páginas más cortas (Cómo se cobra 2.197 → 2.003 px en PC).
