# Estructura de costos de referencia

> **Qué es este documento.** Resume en forma conceptual cómo se construye una estructura de costos y precios profesional, como las planillas de apertura de precios que piden algunos pliegos de contratos de servicios, y qué decide RATEOS a partir de eso.
>
> **Confidencialidad.** La planilla que se usó como referencia es **privada**: no está en este repositorio y no se debe subir (las planillas están en `.gitignore` y un test impide versionarlas). Este documento no tiene montos, alícuotas, porcentajes, nombres ni datos que permitan reconstruirla. Los ejemplos numéricos son **sintéticos e ILUSTRATIVOS**.
>
> Reglas de cálculo vigentes: [CALCULATION_RULES.md](CALCULATION_RULES.md). Plan de implementación: PLAN-2026-002 en [.agent/PLANS.md](../.agent/PLANS.md).

## 1. Para qué sirve

No se busca copiar una planilla, sino entender su lógica y llevarla a RATEOS bajo un principio: **simple en la superficie, potente por debajo**. La planilla funciona como **motor conceptual**; RATEOS la convierte en una experiencia guiada, sin una pantalla por hoja.

> La potencia de una estructura de costos corporativa, sin la complejidad de la planilla corporativa.

## 2. Arquitectura conceptual

| Capa | Pregunta | En una planilla corporativa | En RATEOS |
|---|---|---|---|
| A. Recursos | ¿Qué necesito para prestar el servicio? | Hojas de carga: un renglón por persona, bien, insumo o equipo | Pasos Personal, Equipos, Materiales y Viajes, más la biblioteca de la empresa |
| B. Costo | ¿Cuánto cuesta realmente? | Costo mensual del renglón × afectación × cantidad, agrupado en rubros | `buildCostModel`: F (fijo mensual) y v (variable por día activo) en 8 categorías |
| C. Apropiación | ¿Cómo se reparte sobre una unidad vendible? | % de afectación por renglón y reparto manual de rubros entre ítems tarifarios | Costo(D) = F·factorMeses(D) + v·D repartido entre las unidades facturables (días, horas o abono) |
| D. Precio | ¿Qué tarifa necesito cobrar? | Cascada: estructura → beneficio → impuestos sobre el precio con gross-up | Margen sobre precio + impuestos sobre la facturación con gross-up exacto |
| E. Actualización | ¿Cómo cambia con el tiempo? | Índices por renglón y recálculo de la cascada | Hoy: sensibilidad y escenarios. Futuro: variación por rubro e índices |

## 3. Categorías de costo (rubros)

Una planilla corporativa suele consolidar pocos rubros, por ejemplo: bienes (inmuebles, equipos y vehículos), mano de obra, materiales e insumos, y consumos de los equipos (combustible, lubricantes, neumáticos, mantenimiento). La mano de obra puede abrirse, sólo como información, por naturaleza: remunerativo, no remunerativo, cargas y provisiones, y otros costos por persona.

RATEOS usa 8 categorías: Mano de obra, Equipos, Combustible, Materiales, Logística, Gastos de estructura, Financiero y Contingencia. Sus incidencias suman exactamente 100 % del **costo** (método del mayor resto).

## 4. Flujo de cálculo de una planilla corporativa (genérico)

1. **Recursos → costo mensual por renglón.** Cada renglón se multiplica por un % de afectación al contrato y por una cantidad, y pasa a total del contrato multiplicando por la duración. Los consumos (combustible, neumáticos, mantenimiento) suelen cargarse como magnitudes del período completo.
2. **Consolidación.** El costo antes de impuestos C es la suma de los rubros.
3. **Del costo al precio.** Es una cascada con **bases distintas**, cuyos porcentajes no se pueden sumar entre sí:
   - estructura (overhead) = o·C, sobre el costo;
   - beneficio = b·(C + estructura): un **markup** sobre costo + estructura, no un margen;
   - a veces, una provisión de Ganancias sumada como g × beneficio;
   - impuestos proporcionales al precio (Ingresos Brutos, impuesto a los débitos y créditos, Sellos) y a veces un costo financiero como % del precio, resueltos con **gross-up**: P = X / (1 − Σ alícuotas). No hay circularidad: el divisor resuelve el punto fijo y los importes de cada impuesto se calculan después, como alícuota × P.
4. **Incidencias.** Cada renglón / P suma 100 % del **precio**. El promedio mensual es P / meses.
5. **Apropiación a tarifas.** Cada rubro se reparte entre los ítems tarifarios y se aplica el mismo multiplicador κ = P / C. Tarifa del ítem = κ × costo apropiado / (meses × cantidad mensual estimada). Ese esquema trata todo el costo como variable con la cantidad: si se trabaja menos de lo estimado, los fijos no se cubren.
6. **Directos / indirectos.** Lo compartido se resuelve antes, con el % de afectación de cada renglón. Una etiqueta directo/indirecto, por sí sola, no cambia ningún número: los indirectos reciben el mismo recargo que los directos.
7. **Actualización.** Cada renglón se ajusta con un índice y se recalcula toda la cascada. Con un multiplicador precio/costo constante: **ΔP/P = Σ (peso del rubro en el costo × variación del rubro)**.

## 5. Cómo lo modela RATEOS

**Costo**

```
Costo(D) = F × factorMeses(D) + v × D
```

**Precio, con impuestos sobre la facturación** (todo sin IVA; t = Σ alícuotas sobre lo facturado; m = margen sobre el precio, antes de Ganancias)

```
Facturación necesaria   R* = Costo / (1 − m − t)          (válido si m + t < 100 %)
Tarifa neta             = (R* − otros ingresos) / unidades facturables
Tarifa de lista         = neta / [(1 − tramo)(1 − continuidad)(1 − comercial)]
Tarifa piso             = la misma cuenta con m = 0
Resultado               = Facturación × (1 − t) − Costo
Markup equivalente      = Resultado / Costo   (en el objetivo: m / (1 − m − t))
```

**Ejemplo sintético.** Costo 100, impuestos 10 %, margen 10 %:
- facturación necesaria = **125** (no 121, ni 122,22, ni 123,46);
- impuestos = 12,5 y resultado = 12,5 (10 % del precio);
- tarifa piso = 111,11.

**Equivalencia con una cascada «beneficio sobre costo» (sin Ganancias ni estructura):** m = b(1 − t)/(1 + b). El costo financiero **no** va dentro de t: RATEOS ya lo calcula por capital de trabajo (plazos de cobro y de pago). Para compararse con un pliego que lo pone como % del precio, hay que comparar contra el costo de RATEOS que ya lo incluye, nunca sumar los dos.

**Sellos.** En el MVP se modela proporcional a la facturación, como el resto de t. Es exacto para la tarifa piso y la objetivo a la actividad estimada; en break-even, matriz y escenarios con otra actividad es una aproximación (el impuesto de sellos real se paga sobre el valor del contrato al firmarlo y no baja si la actividad cae). Está documentado en la traza.

## 6. Gaps contra RATEOS y prioridades

| Concepto | Prioridad | Decisión |
|---|---|---|
| Impuestos sobre la facturación con gross-up | P0 | **Ahora**: alícuotas cargadas por el usuario, sin valores por defecto; modo "total" o "detalle", excluyentes |
| Convención «todo sin IVA» y «margen antes de Ganancias» | P0 | **Ahora**: un enunciado por etapa y rótulos en tarifas y resultado |
| Markup efectivo con impuestos y guardas (m + t < 100 %) | P1 | **Ahora**, junto con el P0 |
| ¿Cómo se forma tu precio? (100 % del precio), apropiación por unidad y total del contrato | P1 | **Ahora**: vista de sólo lectura |
| Controles de cuadre e invariantes | P1 | **Ahora**: tests + «los números cierran» en Ver cálculo |
| ¿Cuánto tiene que subir tu tarifa si suben tus costos? | P1 | Siguiente iteración |
| Recursos compartidos (dedicación %) y costos únicos del contrato | P1 | Siguiente iteración, con aprobación |
| Sumas no remunerativas y conversor de tasa de cargas compuesta | P1 | Siguiente iteración, con aprobación |
| Equipos alquilados (propio o alquilado) | P1 | Siguiente iteración, con aprobación |
| Unidad de venta genérica (viaje, km, m³) | P1 | Con plan propio |
| Ganancias neta | P2 | Opcional, nunca en la tarifa piso |
| Cuadro tarifario con varios ítems | P2 | Por drivers, nunca en $ a mano |
| Índices, fecha base, polinómica | P2 | Plan propio |
| Escalas salariales, alícuotas reales, nómina, herramientas del comitente | P3 | Fuera de scope |

## 7. Decisiones de diseño

- **D1. Impuestos dentro del divisor.** Los impuestos sobre la facturación se suman dentro del divisor (1 − m − t). Nunca en forma multiplicativa (1 − m)(1 − t), nunca sobre el costo y nunca sobre la tarifa de lista.
- **D2. Base de los impuestos.** Es la facturación **neta total** del mes sin IVA: tarifa neta × unidades + otros ingresos + ajuste por mínimo garantizado.
- **D3. Impuestos fuera del costo.** No entran en el costo ni en la estructura de costos, y tampoco en la base de contingencia ni de financiero. Se muestran como una fila propia en la formación del precio.
- **D4. Sin alícuotas precargadas.** RATEOS no trae alícuotas: las carga cada empresa (con su contador). La demo queda «sin definir» y la interfaz avisa que la tarifa piso no incluye esos impuestos.
- **D5. Qué no va en t.** IVA, Ganancias, retenciones y percepciones (son pagos a cuenta) y costo financiero (RATEOS lo calcula por plazos) no se cargan como impuestos sobre la facturación.
- **D6. Ganancias.** Nunca entra en el costo ni en la tarifa piso. El margen se rotula «antes de Ganancias».
- **D7. Margen vs. markup.** El margen sobre precio sigue siendo la variable interna del precio. El markup se muestra siempre rotulado como «recargo sobre el costo».
- **D8. Lo compartido.** Se modela por su **efecto en el cálculo** (dedicado, compartido con dedicación % sobre el fijo, estructura con su método de absorción). No se agregan etiquetas directo/indirecto decorativas.
- **D9. Costo y precio, siempre separados.** La estructura de costos suma 100 % del costo; la formación del precio suma 100 % del precio. Nunca van en la misma tabla. Con pérdida no se fuerza el 100 %.
- **D10. Una sola fuente por parámetro.** No hay constantes dentro de las fórmulas, la duración del contrato está en un único lugar y nunca se toma un vacío como 0 en silencio.
- **D11. Actualización.** Cuando exista, el factor será siempre I(t)/I(base), aplicado una sola vez, y «sin ajuste» será un factor 1 explícito.
- **D12. Fijo vs. variable.** Se mantiene la separación fijo/variable, con break-even: una tarifa calculada con una cantidad estimada no protege si se trabaja menos.
- **D13. Formato de datos.** Todo cambio de formato sube `SCHEMA_VERSION`, con migración y tests.

## 8. Qué RATEOS no incorpora

- Liquidación de sueldos por persona (todo es por **puesto tipo**, nunca por empleado).
- Escalas salariales y alícuotas reales precargadas.
- Datos personales.
- Herramientas de revisión del comprador: comparar lo cotizado contra lo aprobado, certificación y circuitos de aprobación.
- Códigos de sistemas de clientes.
- Descarga automática de índices.
- Hojas protegidas e índices de hipervínculos.

Son nómina, ERP, normativa o problemas propios de una planilla (ver [AGENTS.md](../AGENTS.md) §3 y §7).

## 9. Trampas de planilla que RATEOS evita por diseño

| Trampa | Cómo la evita RATEOS |
|---|---|
| Constantes económicas escritas dentro de las fórmulas y parámetros duplicados sin vínculo | Parámetros únicos y editables, con traza |
| Clasificar por texto libre puede dejar sumas en 0 sin aviso | Ids de catálogo |
| Rangos que incluyen filas de totales y listas copiadas por valor | Agregación por línea con clave única y recursos definidos una sola vez |
| Índices no asignados o con huecos que valen 0 sin aviso; encadenamientos que aplican dos veces una variación | Factor neutro explícito, error visible y siempre desde la base |
| «Beneficio %» que es un markup presentado como incidencia sobre el precio | Margen ≠ markup, rotulados |
| Ganancias sumada como g × beneficio, que deja un neto menor al buscado | Fuera de la tarifa piso; si se modela, gross-up de la utilidad |
| Costo financiero como % del precio, sin plazo ni tasa | Capital de trabajo por plazos |
| Controles de cuadre manuales, tautológicos o con signos opuestos | Invariantes verificados en tests |
| Fórmulas desbloqueadas que se pueden pisar | Resultados recalculados, nunca editados ni persistidos |
| Dependencia del programa que abre el archivo | Motores puros y determinísticos |

## 10. Referencias

- Fórmulas vigentes: [CALCULATION_RULES.md](CALCULATION_RULES.md).
- Modelo de datos: [DATA_MODEL.md](DATA_MODEL.md).
- UX: [UX.md](UX.md).
- Plan de cambios del motor: PLAN-2026-002 en [.agent/PLANS.md](../.agent/PLANS.md).
