# RATEOS Test Lab

Infraestructura **interna** de QA, simulación y auditoría (PLAN-2026-013). No es una funcionalidad de RATEOS, no se publica en `dist/` y no agrega dependencias: es `node --test` + scripts de Node + (sólo en el navegador) Playwright instalado aparte.

Idea: RATEOS intenta romperse a sí mismo. Cada escenario se evalúa en **seis dimensiones que nunca se reemplazan entre sí**:

| Dimensión | Pregunta | Cómo |
|---|---|---|
| MATH | ¿El motor da el número correcto? | Oráculo económico **independiente** (`tests/lab/lib/oracle.js`) y valores de negocio esperados |
| DRIVERS | ¿Cada costo sigue a su driver? | Invariantes y relaciones metamórficas (`invariants.js`) + traza de drivers |
| INPUTS | ¿Dos datos describen realidades incompatibles? | Sondas de contradicción (`scenarios/probes.js`) |
| COMPLETITUD | ¿Falta algo que cambia el resultado (o se pide algo que no falta)? | Auditor UX determinístico (`ux-audit.js`) |
| UX | ¿El diseño puede inducir una cotización equivocada? | Auditor determinístico + auditoría en navegador (`e2e/ui-lab.mjs`) |
| MERCADO | ¿El resultado es plausible frente a referencias? | `market.js` + `market/references.json` (offline, sólo informativo) |

**El mercado no define la fórmula.** Una referencia distinta produce `MARKET: REVIEW` ("Math PASS… revisar inputs"), nunca un cambio de fórmula.

## Comandos

```bash
npm test                     # FAST GATE: toda la suite + tests/lab/lab.test.js (campaña estable)
npm run test:lab             # campaña ESTABLE → reports/lab/<run>/lab-report.{json,md} (falla si el gate falla)
npm run test:lab:extended    # + escenarios generados con seed (pairwise, 120 por defecto)
node scripts/run-lab.mjs --extended --seed=7 --count=300 --fail-on=P1   # otra seed / más escenarios / más estricto
npm run build && npm run test:lab:e2e   # auditoría en navegador (escritorio 1360 y celular 390)
```

`--fail-on`: `gate` (estable, por defecto), `P0` (extendida, por defecto), `P1` o `none` (sólo reporta). La auditoría en navegador busca Playwright en `PLAYWRIGHT_MODULE`, en una instalación global o en `/opt/node22`; nunca lo agrega a `package.json`.

## Estructura

```
tests/lab/
  lab.test.js                 FAST GATE (dentro de npm test)
  oracle-independence.test.js el oráculo no importa js/; sin Math.random ni fecha actual
  golden-lock.json            huellas SHA-256 de los golden aprobados
  known-findings.js           registro de hallazgos triados (fixed / human / accepted)
  market/references.json      referencias de mercado con fuente, fecha y confianza
  lib/
    oracle.js                 fórmulas de referencia cortas, escritas desde CALCULATION_RULES
    product-oracle.js         ídem para productos (sólo reutiliza helpers de oracle.js)
    compare.js                motor vs oráculo (27 indicadores + EECC + transporte + proveedores; productos con financiación)
    invariants.js             INV-01…31 (servicios) y PINV-01…10 (productos)
    ux-audit.js               auditor UX A–H + T (resolubles, cero silencioso, no aplica, terminología, 100 %)
    driver-trace.js           explicación de cada escenario en lenguaje de negocio
    market.js                 PLAUSIBLE / REVIEW / UNKNOWN
    coverage.js               lee los catálogos del proyecto y exige un escenario por valor
    golden-lock.js            candado de los golden
    rng.js                    PRNG con seed (mulberry32) + generador pairwise
    build.js                  constructores de cotizaciones y productos sintéticos
    lab.js                    campaña: corre todo, clasifica y arma el gate
    report.js                 JSON + Markdown, con control de secretos
  scenarios/
    services.js               SRV-01…39 + SRV-E01…E17 + SRV-D1…D8 (todos los tipos de servicio y unidades + extremos + decisiones del dueño)
    products.js               PRD-01…10 + PRD-E01…E02 (reventa, fabricado, con equipo, financiado, volumen…)
    probes.js                 PRB-01…21 + PRB-20b (contradicciones, redundantes, cero silencioso, no aplica)
    generate.js               escenarios generados (20 factores, pairwise, con seed)
  e2e/
    ui-lab.mjs                auditoría en navegador (dist/ + Supabase simulado)
    supabase-mock.mjs         GoTrue + PostgREST con RLS emulada (nunca toca la base real)
scripts/run-lab.mjs           runner de npm run test:lab
tests/engines/lab-findings.test.js   regresión de cada hallazgo corregido (falló antes del fix)
tests/engines/lab-decisions.test.js  decisiones del dueño LAB-D1…D8 (PLAN-2026-014; cada test falló antes)
.github/workflows/test-lab.yml       PR gate + Extended Lab
```

Se reutiliza lo que ya existía: el harness de golden cases (`tests/golden-cases/harness.js`, extraído de `golden-cases.test.js`), los fixtures (`tests/fixtures/cot-0010.js`), las fábricas del dominio (`createEmptyQuote`, `createEmptyProduct`), el servidor de `scripts/serve.mjs` y los rótulos y catálogos reales del proyecto.

## Golden cases: sagrados

`tests/lab/golden-lock.json` guarda una huella de `{ engine, inputs, expected, tolerance }` de cada golden aprobado (COT-0009, COT-0010, COT-0011 y sus variantes de v0.7.2 incluidos). Si un golden cambia, desaparece o aparece sin aprobar, el lab **falla con la explicación**. Test Lab nunca actualiza un golden ni el candado: cambiar uno es un cambio de regla de negocio que se discute y se aprueba en un PR (AGENTS.md §10), y recién ahí se actualiza la huella a mano.

## Oráculo independiente

No se verifica el motor llamándolo dos veces. `oracle.js` no importa nada de `js/` (lo verifica `oracle-independence.test.js`) y recalcula desde las reglas escritas: actividad, unidades físicas, personal, equipos propios, externos (unidades, mínimos, fiscal), ruta y km, combustible, materiales, estructura, financiación por grupo de pago y por proveedor, contingencia, impuestos sobre la facturación, piso, objetivo, sugerida, resultado, margen y equilibrio. Donde la documentación no dice algo, el oráculo lo deja escrito en `DOC_GAPS` (aparece en el reporte y como decisión del dueño), nunca lo inventa. Desde PLAN-2026-014 (LAB-D6) `DOC_GAPS` está vacío: los tres huecos (IVA "Parcial" sin %, categoría "external" en otros costos, horas por línea sin tope) se documentaron como reglas reales en CALCULATION_RULES y el oráculo los cita en `CONFIRMED_RULES`. El oráculo de productos calcula la financiación (§23.1) por su cuenta.

## Escenarios y cobertura

- **Campaña estable** (IDs fijos, corre en cada PR): 65 escenarios de servicios (incluidos los 9 `SRV-D*` de las decisiones del dueño) + 12 de productos (PRD-04 financiado) + 22 sondas + auditoría de terminología.
- **Cobertura automática** (`coverage.js`): lee `SERVICE_TYPES`, `BILLING_UNITS`, `EXTERNAL_UNITS`, obtención, IVA, movilización, mantenimiento, neumáticos, materiales, estructura, impuestos, asignación, unidades de productos… Si mañana se agrega una unidad o modalidad sin escenario, **el test de cobertura falla**. Un valor opcional tiene que decir por qué (p. ej. EUR usa la misma regla que USD).
- **Generador** (`generate.js`): 20 factores (los de PLAN-2026-014: equipo propio que no usa combustible y menos de una salida por mes; tipo de servicio, unidad, días, horas, intervención, viajes, km, propio/alquilado/tercerizado, combustible incluido o no, IVA, plazos, margen, impuestos, estructura, contingencia, materiales, compartido, mínimos…) combinados por **pairwise** con un PRNG con seed. La misma seed da los mismos escenarios en cualquier máquina; cada escenario guarda su seed y su combinación.

## Invariantes

Subir el margen nunca baja la tarifa objetivo · subir un costo nunca baja el total · los fijos no desaparecen al bajar la actividad · los variables escalan con su driver · externo $/km, $/viaje, $/día, $/hora siguen a km, tramos, días y horas físicos y $/mes conserva su componente · cambiar viajes por día no cambia los km si los viajes físicos son los mismos · combustible incluido / del cliente · IVA recuperable no es costo (sí caja) · más plazo de cobro nunca reduce el financiamiento y más plazo de pago nunca lo aumenta · margen ≥ 100 % inválido · el piso recupera el costo con impuestos · el objetivo logra el margen · facturación = costo + impuestos + resultado · descuentos coherentes · compartido reduce sólo fijos · nunca NaN/Infinity · EECC = 100 % · cada número central tiene "Ver cálculo" que termina en él · el equilibrio es una raíz · sugerida ≥ objetivo ≥ piso · más impuestos nunca bajan el piso · más redondeo nunca baja la sugerida · "cada salida completa" suma exactamente (⌈A⌉ − A) × costo indivisible, también con A < 1 (INV-29) · "No usa combustible" nunca encarece y deja el combustible en 0 (INV-30) · el aviso de horas nunca agrega horas extra ni personas (INV-31). Productos: margen, volumen, % de fijos, pérdida, cierre del mes (con financiación), precio bajo el piso, sin NaN, cobrar más tarde nunca baja la financiación, pagar más tarde nunca la sube y con tasa 0 es 0 (PINV-08…10).

## Auditor UX

| | Qué busca | Dónde |
|---|---|---|
| A | Contradicciones: RATEOS deriva, avisa o marca crítico; nunca acepta en silencio | `probes.js` |
| B | Cada pendiente con botón lleva a un campo que lo resuelve (con un valor plausible el pendiente cambia) | `ux-audit.js` + navegador |
| C | Cero silencioso: un costo con tarifa que da $ 0 está marcado | `ux-audit.js`, sondas |
| D | No aplica: nunca pedir datos de algo incluido o provisto por el cliente | `ux-audit.js`, sondas |
| E | Campos redundantes (viajes por llamado vs viajes por día, km facturados vs ruta…) | sondas |
| F | Terminología: magnitudes distintas con nombres distintos (km facturables ≠ km de ruta, viajes facturables ≠ físicos…); todo rótulo citado en un aviso existe en la interfaz (también los que se arman con el nombre de la activación) | `auditTerminology`, `ux-audit.js`, navegador |
| T | Activación (PLAN-2026-014, LAB-D8): una magnitud = un nombre por cotización (llamado / salida / trabajo / intervención; un servicio permanente usa "intervención", nunca "cambio de turno" sin un dato que lo diga). Estático: ningún texto del código la nombra a mano fuera de `ACTIVATION_WORDS_ALLOWED` (cada entrada con su motivo) → `UX-TERM-HARDCODED`. Dinámico, en cada escenario: pendientes, avisos, "Ver cálculo" y el texto de "cada salida completa" usan sólo el nombre de esa cotización → `UX-TERM-FOREIGN` (P1 UX) | `auditTerminology`, `auditActivationTerms`, navegador |
| K | Horas del personal (PLAN-2026-014, LAB-D2): el control es de cobertura **mensual** (días × horas por día contra horas normales por mes y horas extra) y RATEOS no tiene un dato de jornada diaria, así que ningún texto habla de "jornada". Estático: ningún literal del código → `UX-TERM-JORNADA`; dinámico: nada de lo que muestra el motor en cada escenario (P1 UX) | `auditTerminology`, `auditJornadaWording` |
| L | Financiación de productos (PLAN-2026-014, LAB-D3): con financiación cargada, "Ver cálculo" aclara que es una estimación sobre costos netos y que el IVA de compras no está incluido (no es una simulación completa de caja) → `UX-PRODUCT-FINANCE-SCOPE` (P1 UX); en el navegador, también la tarjeta "Financiación" y el resultado del mes | `auditProductFinanceScope`, navegador |
| G | 100 % de completitud = sin críticos, errores ni ceros silenciosos | `ux-audit.js` |
| H | Pendientes en un paso real, con texto | `ux-audit.js` |
| I | Mismas cifras en resumen en vivo, "Ver cálculo", Resultado y PDF | navegador |
| J | Escritorio y celular: foco visible y sin nada encima, sin scroll horizontal, sin NaN | navegador |

## Clasificación de hallazgos

| Clase | Significado | ¿Frena el gate? |
|---|---|---|
| P0 ECONOMIC | Resultado económico incorrecto (motor ≠ oráculo, invariante rota, NaN) | Sí |
| P0 CONSISTENCY | Contradicción silenciosa que altera la economía (o el mismo número distinto entre pantallas) | Sí |
| P1 COMPLETENESS | Permite completar con faltantes relevantes, o marca faltantes inexistentes | Sí |
| P1 UX | Diseño, copy o input capaz de inducir error | Sí |
| P2 PRESENTATION | Visual o copy sin impacto económico | No |
| MARKET REVIEW | Matemática correcta, plausibilidad a revisar | No |
| HUMAN DECISION REQUIRED | Más de una interpretación válida o política comercial: no se inventa la regla | No (queda en el reporte) |

## Protocolo de corrección

Detectar → reproducir → causa raíz → **test que falla antes del fix** (`tests/engines/lab-findings.test.js`) → fix → escenario → golden → suite → Test Lab de nuevo → documentar (CHANGELOG, CALCULATION_RULES si cambia una regla). Cada hallazgo queda en `known-findings.js`: `fixed` (si vuelve a aparecer, el gate falla y el reporte dice "VOLVIÓ A APARECER"), `human` (decisión del dueño, no frena) o `accepted`. Las decisiones LAB-D1…D8 se cerraron en PLAN-2026-014: D1–D6 y D8 quedan `fixed` (con su test en `lab-decisions.test.js`) y D7 `accepted` (el mercado puede seguir avisando sobre el combustible de los escenarios; nunca cambia el valor). Nunca se corrige solo: una regla ambigua, política comercial, una fórmula porque el mercado difiere o un caso con dos modelos válidos.

## Mercado

`market/references.json`: concepto, región, fecha, rango (y rango comparable, p. ej. sin IVA), unidad, fuentes con URL, confianza, comparabilidad y observaciones. Se prioriza fuente oficial, cámaras, proveedores y documentación sectorial. Sin buena evidencia el concepto queda en `withoutEvidence` y el escenario da `MARKET: UNKNOWN`. `npm test` no usa internet: las referencias se actualizan a mano (o con un agente con acceso web) y se revisan en un PR.

## Reportes

`reports/lab/<run>/lab-report.json` (estructurado) y `lab-report.md` (para personas), más una copia en `reports/lab/latest/`. `reports/` está en `.gitignore`: en CI son artefactos. El resumen sigue el formato `RATEOS TEST LAB / Run / Scenarios / PASS / P0… / Golden / Coverage`; por escenario: ID, nombre, servicio o producto, unidad, inputs, esperado (oráculo) vs real (motor), deltas, drivers, invariantes, completitud, UX, mercado, estado y causa raíz / fix si existe. Antes de escribir, `assertSafeReport` frena cualquier cosa con forma de JWT, clave secreta, service_role, contraseña, email o connection string.

## CI

| Etapa | Dónde | Qué corre |
|---|---|---|
| FAST GATE | `ci.yml` (`npm test`, cada push y PR) | unit, golden + candado, oráculo, invariantes, cobertura, auditor determinístico |
| PR GATE | `test-lab.yml` › `pr-gate` (cada PR) | `npm run test:lab`, build y auditoría en navegador escritorio + celular; reportes como artefacto |
| EXTENDED LAB | `test-lab.yml` › `extended` (sólo manual: Actions → Test Lab → Run workflow) | seed y cantidad elegidas, capturas de pantalla, reportes de 30 días |

El Extended Lab nunca corre en un PR (no lo vuelve frágil). Para correrlo antes de una release, se lanza a mano con la seed que se quiera; para correrlo por schedule, agregar en `on:` un `schedule: - cron: '…'` (con `inputs` vacíos usa seed 20261016, 120 escenarios y falla sólo con P0). Ningún job del Test Lab tiene permisos de escritura ni despliega.

## Seguridad y privacidad

Sólo datos sintéticos, golden ya aprobados y fixtures anonimizados. La auditoría en navegador crea una cuenta simulada con contraseña aleatoria por corrida; todo pedido a Supabase lo responde el simulador y cualquier otro pedido externo es una falla. Los reportes no guardan credenciales, tokens, claves, contraseñas, PII ni información comercial privada.

## Agregar casos

- **Escenario**: un objeto en `scenarios/services.js` o `products.js` con `id`, `title`, `family`, `build()` y, si corresponde, `expect` (valores de negocio), `ux` (lo que la completitud tiene que decir) y `market` (conceptos a comparar).
- **Sonda**: en `scenarios/probes.js`, con `expect` (`derive` | `warn` | `critical`), la clasificación si RATEOS responde en silencio y `respond(q, r)`.
- **Invariante**: en `lib/invariants.js`, una función que compara el motor consigo mismo ante un cambio controlado del input (relación metamórfica), con `na` cuando no aplica.
- **Unidad o modalidad nueva**: el test de cobertura va a fallar hasta que exista un escenario que la use (y el oráculo la conozca).
