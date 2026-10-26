# RATEOS

**Sabé cuánto te cuesta. Definí cuánto cobrar.** Motor de costos y precios para servicios, contratos, productos, producción y comercio.

> Ayuda a una empresa a saber cuánto le cuesta realmente prestar un servicio o hacer un producto, y a qué precio debería venderlo para no perder dinero. "+ Nuevo cálculo" pregunta primero qué querés calcular: un **servicio** (cotización) o un **producto**.

**Sitio:** <https://joaquinvedova1.github.io/COTIZADORWEB/>

> **Aviso — datos ILUSTRATIVOS.** La **demo** pública (sin cuenta) usa una empresa ficticia (*Patagonia Servicios SRL*). Todos sus valores (salarios, cargas, convenios, equipos, combustible, tarifas) son **ILUSTRATIVOS**: no son escalas salariales, cargas patronales, alícuotas, CCT, precios ni costos reales. Las **cuentas** empiezan vacías, sin datos de ejemplo: cada empresa carga sus valores vigentes.

## Qué es RATEOS

RATEOS es un **motor determinístico** de estructuras de costos, pricing, rentabilidad, utilización, break-even y escenarios, pensado para PyMEs proveedoras de servicios industriales, inicialmente Oil & Gas de Neuquén / Vaca Muerta, y desde v0.5.0 también para PyMEs que **fabrican y venden productos** (panaderías, rotiserías, talleres, comercios). Su objetivo es **evitar que una empresa gane una licitación pero pierda plata ejecutándola**.

Separa siempre cuatro conceptos:

| Concepto | Qué es |
|---|---|
| **Costo** | Lo que realmente cuesta prestar el servicio en el mes. |
| **Tarifa piso** | Precio mínimo para no perder dinero (margen 0). |
| **Precio objetivo** | Precio necesario para lograr el margen buscado. |
| **Precio comercial** | Precio finalmente ofrecido al cliente. |

**Margen y markup no son lo mismo:** con costo 100, un margen del 10 % da un precio de **111,11**; un markup del 10 % da **110**.

**Impuestos sobre lo que facturás** (Ingresos Brutos, débitos y créditos, sellos): no son costo, se pagan sobre el precio. RATEOS los cubre junto con el margen con un gross-up exacto: costo 100, margen 10 % e impuestos 10 % → **125** (no 121). RATEOS **no trae alícuotas**: cada empresa carga las suyas; sin definir, la tarifa piso no los incluye y la app lo avisa. Todo se carga y se muestra **sin IVA**; el margen es antes de Ganancias.

**Qué NO es:** no es un ERP, ni un sistema de liquidación de sueldos (payroll), ni un CRM, ni un marketplace, ni un sistema de facturación, ni un gestor documental. **No usa IA**: no tiene chatbot ni copilot. El valor está en reglas, cálculos auditables, datos persistentes y escenarios. Todo resultado importante tiene un botón **"Ver cálculo"** con la fórmula, las entradas y el resultado.

## Funcionalidades del MVP (v0.1.0)

| # | Prioridad | Dónde está |
|---|---|---|
| 1 | Crear cotizaciones reales | Nueva cotización (en blanco o desde plantilla), editor de 11 pasos, guardado automático |
| 2 | Estructura de costos con monto e incidencia % | Resultado: 8 categorías (mano de obra, equipos, combustible, materiales, logística, estructura, financiero, contingencia) que suman 100 % |
| 3 | On-call | Activaciones, días por activación, call-out, movilización, standby, minimum call, fee de disponibilidad |
| 4 | Tarifa / utilización | Matriz tarifa × utilización (5, 8, 10, 15, 20 días + actividad estimada) |
| 5 | Break-even | Días activos mínimos para no perder dinero, días para el margen objetivo y problema inverso |
| 6 | Personal y convenios parametrizables | Bibliotecas → Personal y Convenios (Petroleros Privados, Petroleros Jerárquicos, Camioneros, UOCRA, Fuera de convenio, Personalizado) |
| 7 | Equipos | Costo de posesión vs operación; ficha $/hora, $/día, $/mes |
| 8 | Logística | Km, litros, costo por activación, mensual e incidencia % |
| 9 | Costo financiero | Plazo de cobro, días de pago, capital de trabajo, costo financiero e impacto en margen |
| 10 | Margen vs markup | Escalera de precios (piso, 5 %, 10 %, 15 %, personalizado) con markup equivalente |
| 11 | Sensibilidad | Salarios, combustible, materiales, utilización, plazo de pago y descuento comercial, con tarifa fija |
| 12 | Descuentos por días / volumen | Tramos 1, 2–7, 8–15, 16–30, +30 días con semáforo verde / naranja / rojo; descuento por continuidad |
| 13 | Cost Completeness Score | Porcentaje de completitud y pendientes (plazo de pago, combustible, materiales, relevos, contingencia…); verde ≥ 85 %, naranja ≥ 60 %, rojo < 60 %; los valores por defecto ILUSTRATIVOS no cuentan como definidos |
| 14 | Persistencia local | `localStorage` con `schemaVersion`; sobrevive recargas, cierres y nuevos deploys; funciona con varias pestañas abiertas |
| 15 | Backup / import | Exportar e importar JSON con validación (rechaza archivos que no son de RATEOS o con datos mal formados) y confirmación |
| 16 | Tests | `npm test` (motores, golden cases, datos, servicios, arquitectura, build) |
| 17 | Deploy automático | GitHub Actions: test → build → deploy a GitHub Pages |

Además: dashboard, escenarios pesimista / base / optimista, comparador de modelos comerciales (sólo tarifa por día, disponibilidad + día, mínimo garantizado + día, paquete mensual + excedentes) y 12 plantillas de servicio.

Después de v0.1.0 (ver [CHANGELOG](CHANGELOG.md), "Sin publicar"): rediseño de la experiencia (landing, demo guiada, editor en 5 etapas, resultado progresivo), **impuestos sobre lo que facturás** (esquema de datos 2, con migración), **"¿Cómo se forma tu precio?"** (de cada $ 100 que facturás: costo, impuestos y ganancia; apropiación por día y total del contrato, con controles "Los números cierran") y **cuentas reales** (ver abajo).

**v0.2.0 — Recursos con base económica** ([docs/RESOURCE_MODEL.md](docs/RESOURCE_MODEL.md), esquema de datos 3 con migración, mismos números para los datos existentes):

- Cada valor económico con su **base** ("Base: sep-26" / "Base no definida") y **base económica de la oferta** con avisos de bases distintas o viejas.
- **RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN**: cambiar un recurso nunca cambia una cotización hecha; la cotización avisa y vos elegís [Actualizar en esta cotización] o [Conservar valor original].
- **Mis equipos** (legajo por unidad) + **catálogo** de familias (sin precios) + modelos propios; **servicios externos**.
- Equipos **propios, alquilados o tercerizados**, con tarifa neta, mínimo y tratamiento fiscal (costo económico ≠ salida de caja ≠ crédito fiscal).
- **Movilización y viajes**: cómo llega cada equipo (por sus medios, transportado, con apoyo) separado de la logística auxiliar, sin contar dos veces al operador ni al vehículo.
- Moneda y tipo de cambio por cotización; versión visible ("v0.2.0 · build …") en el menú, la landing y Configuración → Acerca de.

**v0.5.0 — Productos** (esquema de datos 5 con migración; las cotizaciones no cambian): sección **Productos** con un editor de 7 pasos (el producto y su tanda → ingredientes y materiales → personal con su convenio → máquinas con uso y amortización → gastos fijos con el % para el producto → precio y margen → resultado). Calcula costo por unidad, precio piso, precio sugerido con el margen que querés (margen ≠ markup), IVA opcional, equilibrio en unidades por mes y si tu precio de hoy cubre los costos. Fórmulas en [docs/CALCULATION_RULES.md §23](docs/CALCULATION_RULES.md#23-productos-costo-por-unidad-y-precio-plan-2026-008).

**v0.6.0 — Unidades de facturación según el tipo de servicio** (esquema de datos 6, sin cambios de datos; $/día, $/hora y $/mes calculan igual): cada tipo de servicio ofrece sus unidades ($/m³, $/viaje, $/tonelada, $/km, $/llamado, $/turno, $ global por trabajo, $/hito… y una propia como "$/pozo"); la actividad se carga en esa unidad y el equilibrio se lee en ella ("6.000 m³ para no perder"). Los costos se siguen calculando por días de trabajo (unidad de costo ≠ unidad de venta). Fórmulas en [docs/CALCULATION_RULES.md §12.1](docs/CALCULATION_RULES.md#121-unidad-de-facturación-según-el-tipo-de-servicio-plan-2026-009).

**v0.7.0 — Auditoría y pulido desde una cotización real (COT-0009)** (esquema de datos 7, sin cambios de datos): los números de COT-0009 quedan como golden case; se corrige la financiación de externos con IVA (se financia la salida de caja; sin IVA cargado nada cambia); BORRADOR arriba del resultado con pendientes críticos / para revisar / informativos; externos incompletos nombrados con [Completar] [Quitar] e impacto incremental en "Ver cálculo"; horas extra por tramos (HE 50 % / 100 % / otro, facturables aparte); estructura desglosada por rubro con política de la empresa; comparador de modelos en $/m³, $/viaje, $/unidad; EECC con fijo del mes y variable por día; fecha base con "usar el mes de la oferta" (confirmado). Plan PLAN-2026-010.

**v0.7.1 — Salidas completas y plazo por proveedor** (esquema de datos 8, sin cambios de datos; todo opcional): "Cada salida / intervención se cuenta completa" costea con salidas enteras sólo los costos por salida (movilización, viajes, cargos por llamado) sin tocar producción, facturación ni sueldos; cada externo puede tener su propio plazo de pago, que cambia sólo el capital de trabajo y el costo financiero. Plan PLAN-2026-011.

**v0.7.2 — Pulido desde casos reales de transporte (COT-0010 / COT-0011)** (esquema de datos 9, sin cambios de datos): con la unidad "viaje" los viajes físicos se derivan de los viajes por día (bug: antes se podían costear 6 viajes para 12 facturados); resumen "Viajes y km del mes" y la actividad del proveedor separada de la movilización propia; tarifa por viaje ligada a la ruta con su equivalente por km; combustible de un externo por km (L/100 km o km/L); la completitud sólo pide consumo a lo que consume combustible a tu cargo y sus botones llevan al campo exacto; proveedor por km sin ruta = crítico; equilibrio sin costos fijos explicado; recursos compartidos con % explícito de los costos fijos y "Usado en" en Recursos. Plan PLAN-2026-012.

**v0.8.0 — Decisiones del dueño LAB-D1…D8 y RATEOS Test Lab v1** (esquema de datos 10, sin cambios de datos; ninguna cotización ni producto existente cambia sus números): financiación opcional de productos con el mismo cálculo que las cotizaciones (estimación sobre costos netos: el IVA de compras no se incluye); "No usa combustible" explícito en equipos propios; aviso de horas de cobertura del personal (control mensual, sin inventar horas extra ni turnos); aviso con salidas promedio, costeadas y efecto del redondeo cuando hay menos de una por mes; km facturables y km de ruta por separado; el combustible ILUSTRATIVO se confirma en cada cotización real nueva; un nombre por cotización para la activación (llamado, salida, trabajo o intervención). Test Lab: oráculo independiente, candado de golden, escenarios con seed, invariantes y auditoría de UX y terminología en CI. Planes PLAN-2026-013 y PLAN-2026-014.

**v0.8.1 — Beta Readiness v1: parche de seguridad y de pérdida de datos** (esquema de datos 10, sin cambios de datos ni de base; ninguna cotización ni producto cambia sus números): datos de la nube que la versión no puede leer se abren en sólo lectura y nunca se reemplazan solos por un espacio vacío o "reparado"; una copia de cambios sin subir por pestaña (un guardado en una pestaña ya no borra lo pendiente de otra); al cerrar o cambiar de cuenta no queda nada de la sesión anterior; datos del modo local ya importados no se ofrecen a otra cuenta; el `organizationId` del cliente nunca decide; Beta Security Gate y tests de negación entre empresas en la base. **Todavía no hay beta con empresas externas**: antes de habilitar usuarios reales son obligatorios un dominio propio, un staging separado de producción (o `/preview/` deshabilitado) y el registro cerrado o por invitación ([docs/BETA_SECURITY.md](docs/BETA_SECURITY.md) §6).

**Beta Perimeter v1 (PLAN-2026-016, sin versión nueva todavía; esquema de datos 10, sin cambios de datos ni de base):** el deploy publica **sólo producción** (sin `/preview/` en el mismo sitio: el build lo rechaza y, después de publicar, el workflow verifica que `/preview/` dé 404); la app pasa a **beta por invitación** (no ofrece ni llama al registro); y queda preparado el paso a un **dominio propio**. Lo que tiene que configurar el dueño (registro apagado en Supabase, SMTP propio, dominio) y la prueba A/B real: [docs/BETA_PERIMETER.md](docs/BETA_PERIMETER.md).

**v0.9.0 — beta gratuita y UX-UNITS (sin publicar, PLAN-2026-027 a PLAN-2026-030; un solo deploy en la URL actual)** (esquema de datos 10; lo guardado conserva sus cifras; una migración de Supabase sólo para el feedback, `20261022120000`): **beta gratuita y sin límites**, con "Reportar un problema" y "Sugerir una mejora" y su cola en RATEOS ADMIN ([docs/BETA_FEEDBACK.md](docs/BETA_FEEDBACK.md)); **beta abierta**: el **registro público** con confirmación de email encendido (cualquiera crea su cuenta y su propia empresa; requiere SMTP propio en Supabase); validaciones de datos imposibles antes de mandar una cotización (más días que los del mes, tarifa sin cantidad, plazo de cobro vacío, cobertura de personal muy por debajo: con un pendiente crítico no se marca como enviada); un resultado NO CONFIABLE marcado en todas partes y que no se puede marcar como enviado; redondeo de la sugerida proporcional a la tarifa (a lo sumo 1 % sobre la objetivo, en las cotizaciones nuevas) con el margen objetivo y el real a la vista; avisos para el abono con más días que los disponibles, el vehículo de apoyo sin su costo de tenerlo y el operador contado dos veces; formularios que no pierden cambios sin avisar; Recursos agrupados por convenio y por familia; `DESIGN.md` con un editor más claro en el celular; y **UX-UNITS**: la unidad de cobro como «ARS / [unidad]», el rendimiento en la forma en que se conoce («2 m³ por hora», «20 m³ por viaje»), cambios de unidad que nunca reinterpretan cantidades y «La cuenta del mes» en el Resultado. Detalle en [CHANGELOG.md](CHANGELOG.md).

## Visitante, demo y cuenta

| | Qué ve | Datos |
|---|---|---|
| **Visitante** | Landing `#/`, crear cuenta (con confirmación de email), ingreso y recuperar contraseña | Ninguno |
| **Demo** (`#/demo`, sin cuenta) | La cotización de ejemplo "Hidrogrúa on-call — Añelo" y su análisis completo | ILUSTRATIVOS, en memoria: no se guarda nada y nunca pasa a una cuenta |
| **Cuenta** (`#/inicio` y toda la app) | Tus cotizaciones, recursos, servicios, escenarios y configuración | Los de **tu empresa**, en Supabase, protegidos con Row Level Security: nadie de otra empresa puede verlos ni modificarlos |

- **Registro público** (decisión del dueño, 2026-10-20): **Crear cuenta** pide nombre, empresa, email y contraseña; llega un correo para **confirmar el email** (el enlace se abre en el mismo navegador) y recién ahí se puede ingresar. Cada cuenta nace con **su propia empresa**, vacía: "Hola, <nombre>" → [Crear mi primera cotización] [Configurar mi empresa]. La respuesta no revela si un email ya tenía cuenta. **Requiere un SMTP propio** en Supabase: con el de por defecto, nadie de afuera recibe la confirmación. Procedimiento en [docs/BETA_PERIMETER.md](docs/BETA_PERIMETER.md) §2. `FEATURES.publicSignup = false` (`js/config.js`) vuelve a la beta por invitación.
- **Guardado en la nube:** "Guardado" significa guardado en tu cuenta. Sin conexión, el cambio queda en este navegador ("No pudimos sincronizar tus cambios.") y se sube solo al volver. Si otro dispositivo guardó antes: "Tus datos cambiaron en otro dispositivo." con [Recargar] [Conservar una copia]: nunca se pisa nada en silencio.
- **Datos de antes:** si usaste RATEOS sin cuenta en este navegador, al ingresar aparece "Encontramos datos guardados en este navegador." con [Importarlos a mi cuenta] [Empezar en limpio]. La demo y los datos ILUSTRATIVOS nunca se importan, se guarda una copia antes y los datos locales no se borran.
- Detalle: [docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md) (sesión, roles, enlaces de email), [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md) (tablas, RLS, sincronización).

## Flujo de cotización

```
NUEVA COTIZACIÓN
 1. Tipo de servicio            7. Costos indirectos
 2. Modalidad de cotización     8. Financiamiento
 3. Personal                    9. Riesgo / contingencia
 4. Equipos                    10. Margen y reglas comerciales
 5. Materiales                 11. Resultado
 6. Movilización y viajes
```

Dos modos:

- **Conozco la tarifa:** ingresás la tarifa y RATEOS calcula días mínimos (break-even), resultado y margen esperados.
- **Conozco la actividad:** ingresás cuántos días del mes esperás trabajar y facturar, y RATEOS calcula la tarifa piso y las tarifas con margen 5 %, 10 % y 15 %.

Los montos se escriben como en Argentina: punto para miles y coma para decimales (`1.800.000`, `1.800.000,50`, `8,5`). Si un valor no es válido, el campo lo marca y, al salir del campo, vuelve al valor anterior: nunca se guarda un número a medio escribir. Las tarifas mínimas (piso, objetivo, sugerida) se muestran redondeadas **hacia arriba**, para que cobrar la cifra que ves nunca te deje debajo del mínimo.

## Caso demo: Hidrogrúa on-call — Añelo

Todos los valores son **ILUSTRATIVOS**.

| Dato | Valor |
|---|---|
| Empresa | Patagonia Servicios SRL (ficticia) |
| Base → destino | Neuquén Capital → Añelo, 110 km, ida y vuelta |
| Modalidad | On-call 24/7, respuesta 4 h, "Conozco la actividad" |
| Unidad | $/día |
| Actividad estimada | 8 días/mes, 2 días por activación (4 llamados), 10 h por día activo |
| Recursos | 1 operador, 1 hidrogrúa, 1 vehículo de apoyo |
| Plazo de pago | 90 días (facturación a 15 días, tasa 3 % mensual) |
| Estructura / contingencia | 12 % sobre costo directo / 5 % |
| Margen objetivo | 10 % (personalizado 20 %), redondeo a $ 1.000 |
| Descuentos por tramo | 3 % (8–15 días), 5 % (16–30), 8 % (+30) |

Resultado aproximado calculado por el motor v0.1.0 (cambia si cambian los datos demo o el motor):

| Indicador | Valor ≈ |
|---|---:|
| Costo total del mes | $ 15.776.000 |
| Costos fijos / variable por día activo | $ 9.031.000 / $ 843.000 |
| Tarifa piso | $ 2.033.000 por día de lista ($ 1.972.000 neta, después del 3 % del tramo 8–15 días) |
| Tarifa comercial sugerida (margen 10 %) | $ 2.259.000 por día de lista |
| Facturación / resultado del mes | $ 17.530.000 / $ 1.753.000 |
| Margen / markup | 10,0 % / 11,1 % |
| Break-even | 6,4 días → 7 días activos |
| Cost Completeness Score | 95 % (pendientes: relevos para 24/7 y standby) |

## Caso de referencia: break-even 10 días

También incluido como cotización demo ("Caso de referencia on-call") y como golden case de los tests:

```
Costos fijos            = 30.000.000 por mes
Costo variable por día  =  1.000.000
Tarifa por día          =  4.000.000
Contribución por día    =  3.000.000
Break-even              = 30.000.000 / 3.000.000 = 10 días
```

Problema inverso: si estimás trabajar 6 días por mes, la tarifa mínima es 30.000.000 / 6 + 1.000.000 = **6.000.000 por día**.

| Días activos | Tarifa piso | Tarifa con margen 10 % |
|---:|---:|---:|
| 5 | 7.000.000 | 7.777.778 |
| 8 | 4.750.000 | 5.277.778 |
| 10 | 4.000.000 | 4.444.444 |
| 15 | 3.000.000 | 3.333.333 |
| 20 | 2.500.000 | 2.777.778 |

A mayor utilización, menor tarifa necesaria. Fórmulas completas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md).

## Cómo ejecutar

Requisitos: **Node ≥ 20** (sólo para el servidor local, los tests y el build). No hay dependencias que instalar.

```bash
git clone https://github.com/joaquinvedova1/COTIZADORWEB.git
cd COTIZADORWEB
npm start
```

Abrí <http://localhost:8080/COTIZADORWEB/> (simula la sub-ruta de GitHub Pages). Opciones: `PORT=9000 npm start` para otro puerto; `npm run build && npm start -- --dist` para probar exactamente lo que se publica.

La landing y la demo funcionan sin conexión a Supabase. Para ingresar en local, la URL `http://localhost:8080/COTIZADORWEB/**` tiene que estar en las Redirect URLs del proyecto (ver "Supabase" más abajo).

También funciona con cualquier servidor estático desde la raíz del repo (por ejemplo `python3 -m http.server 8080` → <http://localhost:8080/>). **No funciona abriendo `index.html` con `file://`**: los ES modules del navegador necesitan HTTP.

## Cómo testear

```bash
npm test
```

Usa el test runner nativo de Node (`node --test`), sin dependencias. Cubre motores económicos (`tests/engines/`), golden cases (`tests/golden-cases/`, un `.json` por regla de negocio), core (`tests/core/`), datos, migraciones y backup (`tests/data/`), servicios (`tests/services/`, incluidos sesión, rutas protegidas e importación local), cuentas con un Supabase falso (`tests/helpers/fake-supabase.js`: aislamiento entre cuentas, conflictos, sin conexión, sesión vencida), migraciones SQL (`tests/supabase/`), reglas de arquitectura y seguridad (`tests/architecture.test.js`), build (`tests/build.test.js`) y sitio estático bajo `/COTIZADORWEB/` (`tests/static-site.test.js`). Los tests del motor son parte de la especificación del negocio: si un cambio los rompe, el cambio está mal o la regla debe revisarse explícitamente.

**RATEOS Test Lab** (QA interno, [docs/TEST_LAB.md](docs/TEST_LAB.md)): RATEOS intenta romperse a sí mismo con un oráculo económico independiente, escenarios de todos los tipos de servicio y unidades, sondas de contradicción, invariantes y un auditor de consistencia UX. La campaña estable corre dentro de `npm test`; además:

```bash
npm run test:lab            # campaña estable → reports/lab/ (JSON + Markdown)
npm run test:lab:extended   # + escenarios generados con seed (pairwise)
npm run build && npm run test:lab:e2e   # auditoría en navegador, escritorio y celular (requiere Playwright)
```

**Row Level Security** (contra la base real): `supabase/tests/rls_test.sql` (40 controles: usuarios A/B, anon, escalada de rol…), `rls_admin_test.sql` (32, RATEOS ADMIN) y `beta_security_test.sql` (132: negación A→B y B→A con IDs conocidos, roles, miembro quitado, admin sin contenido, anon y catálogo en vivo). Ninguno deja nada en la base. Se corren **a mano** con el plugin/MCP de Supabase o `psql`, después de cada migración y antes de cada release: **no corren en CI** (CI no tiene credenciales de la base, a propósito; ahí sólo se verifica que los archivos existan, cubran lo previsto y siempre deshagan). Ver [supabase/README.md](supabase/README.md).

**Beta Security Gate** (PLAN-2026-015, [docs/BETA_SECURITY.md](docs/BETA_SECURITY.md)): controles de seguridad, tenancy, sesión, privacidad y recuperación sin red ni base (también corre dentro de `npm test` y en CI):

```bash
npm run test:security       # → reports/security/latest/beta-security-gate.md
```

## Cómo desplegar

`main` es producción. El flujo es **rama → tests → Pull Request → main → deploy**:

1. Trabajá en una rama y corré `npm test`.
2. Abrí un Pull Request hacia `main` (el workflow de CI corre tests y build).
3. Al mergear, el workflow **"Deploy RATEOS a GitHub Pages"** ejecuta test → build → deploy. Si fallan los tests, no se despliega.
4. Verificá en **Configuración → Acerca de** que se ve `RATEOS · v0.1.0 · build <commit>`.

Requisito único: en GitHub → **Settings → Pages → Build and deployment → Source** elegir **"GitHub Actions"**. Detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Cómo hacer rollback

- **Preferido:** `git revert` del commit problemático en una rama → Pull Request → `main` → deploy automático.
- **Rápido:** Actions → "Deploy RATEOS a GitHub Pages" → **Run workflow** (branch `main`) → `ref` = tag (por ejemplo `v0.1.0`) o SHA de un commit **que ya está en `main`**. El workflow rechaza cualquier `ref` que apunte a un commit que no está en `main`, como una rama sin mergear (nunca publica código sin PR). Se despliega esa versión sin cambiar `main`; el próximo push a `main` vuelve a desplegar `main`, así que después hay que hacer el revert.

Nunca force push a `main`. Paso a paso en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#5-rollback).

## Supabase

- Proyecto `dltlnizvnvnefgbzfftu`. En el frontend sólo hay **URL + publishable key** (`js/config.js`); nunca `service_role`, secret keys, contraseña de la base ni connection strings.
- **Migraciones** versionadas en `supabase/migrations/` y aplicadas con el plugin/MCP de Supabase (nunca cambios manuales que no estén en una migración). Tests de RLS en `supabase/tests/`.
- **Configuración de Auth** (Dashboard → Authentication → URL Configuration): Site URL `https://joaquinvedova1.github.io/COTIZADORWEB/`; Redirect URLs `https://joaquinvedova1.github.io/COTIZADORWEB/**` (y `http://localhost:8080/COTIZADORWEB/**` sólo mientras se prueba en local). Confirmación de email **activada**.
- **Antes de invitar a la primera empresa:** registro apagado en Supabase ("Allow new users to sign up"), un **SMTP propio** (el de Supabase sólo entrega a miembros del equipo del proyecto: sin él, una persona invitada no recibe el correo para elegir su contraseña) y un **dominio propio**. Checklist en [docs/BETA_PERIMETER.md §5](docs/BETA_PERIMETER.md#5-checklist-del-dueño); `node scripts/check-auth-perimeter.mjs` verifica lo que la configuración pública de Auth deja ver.

## Persistencia y backup

- **Con cuenta**, los datos viven en Supabase (una fila por empresa, mismo formato versionado que el backup) y en el navegador sólo queda la sesión y, mientras haya cambios sin subir, una copia recuperable (una por pestaña: una pestaña nunca borra los cambios sin subir de otra). Si los datos de la nube no se pueden leer con tu versión, se abren en sólo lectura: nunca se reemplazan solos. El resto de esta sección describe el formato y las garantías comunes (migraciones, backup, copias de recuperación).
- En el **modo local** anterior (sin cuenta, hasta v0.1.0) los datos se guardaban en este navegador (`localStorage`, clave `rateos.state`) con `schemaVersion`; nunca se borran y se ofrecen para importar a la cuenta.
- Si una versión nueva cambia el formato, RATEOS **migra** tus datos al abrir y guarda antes una **copia de recuperación**. Nunca borra datos por un cambio de estructura.
- **Varias pestañas:** podés tener RATEOS abierto en más de una pestaña. Antes de leer o guardar, cada pestaña toma los cambios que hizo otra, así ninguna borra lo que guardó la otra y los códigos `COT-NNNN` no se repiten (se numeran con un contador que nunca reutiliza el código de una cotización eliminada). La pantalla se actualiza sola con el aviso "Los datos se actualizaron desde otra pestaña." (ver la limitación sobre editar la misma cotización en dos pestañas, más abajo).
- **Configuración → Backup:** exportá un archivo JSON versionado y volvé a importarlo en otro navegador o equipo. Antes de importar se valida el archivo (tamaño, que sea un backup de RATEOS, tipos de cada colección y forma de cada cotización), se muestra un resumen y se pide confirmación para sobrescribir; el estado anterior queda como copia de recuperación.
- **Copias de recuperación:** se conservan las 3 más recientes y, aparte, las 3 más recientes de datos dañados (así una importación posterior nunca borra la única copia del original). Desde Configuración podés descargarlas o **eliminarlas** para liberar espacio; una importación que falla por falta de espacio no deja copias de más.
- **Almacenamiento lleno:** si un guardado falla, el editor conserva tus cambios como borrador (aunque salgas y vuelvas a entrar), te avisa antes de cerrar la pestaña y ofrece **"Descargar backup con estos cambios"**. Si al abrir RATEOS el navegador no deja escribir pero hay datos guardados, no se muestra la demo: aparece la pantalla de recuperación.
- Si RATEOS no puede abrir tus datos (dañados sin espacio para una copia, almacenamiento bloqueado, cambios ilegibles de otra pestaña), muestra una pantalla de recuperación para descargarlos tal cual están guardados, junto con las copias de recuperación.
- Si el navegador no permite guardar (modo privado estricto), la app avisa que los cambios no se conservan y el editor muestra "Sólo en esta sesión (no se guarda)".

Formato del backup y modelo de datos en [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

## Estructura del proyecto

```
index.html                 documento único (CSP estricta, rutas relativas)
version.json · .nojekyll   versión de desarrollo · sin Jekyll en Pages
assets/                    favicon.svg
css/                       styles.css (sistema de diseño), views.css, quote.css, result.css
js/
  app.js                   bootstrap: contexto, layout, router, errores globales
  config.js                configuración central y feature flags (sin secretos)
  core/                    money, format, validation, ids, logger, events, trace, object
  domain/                  catálogos, fábricas de entidades, datos demo ILUSTRATIVOS
  engines/                 motores económicos puros (costos, pricing, break-even, utilización,
                           financiero, reglas comerciales, escenarios, completitud, cotización)
  data/                    StorageRepository, LocalStorageRepository, esquema, migraciones
  services/                casos de uso: cotizaciones, recursos, backup, configuración, recuperación
  ui/                      dom, components, router, layout
    views/                 dashboard, cotizaciones, editor, resultado, bibliotecas, plantillas,
                           configuración, no encontrado
      quote-steps/         un módulo por paso del editor
tests/                     core/, data/, services/, engines/, golden-cases/,
                           architecture.test.js, build.test.js, static-site.test.js
  lab/                     RATEOS Test Lab: oráculo, escenarios, invariantes, auditor UX, navegador
scripts/                   build.mjs (dist/ + version.json), serve.mjs (servidor local), run-lab.mjs (Test Lab)
docs/                      documentación técnica
.agent/PLANS.md            planes de ejecución para cambios grandes
.github/                   workflows (deploy-pages, ci, test-lab), dependabot, plantilla de PR
```

## Limitaciones conocidas (v0.1.0)

- Unidades de tarifa de venta: $/día, $/hora y $/mes (abono). Otras (por viaje, km, m³, tonelada, intervención, precio global) todavía no. (Las tarifas de **proveedores** externos sí aceptan hora, día, mes, viaje, km, llamado y global.)
- **Recursos (v0.2.0):** no hay todavía "Actualizar costos de esta oferta a valores actuales" de una sola vez ni índices de actualización (la estructura queda preparada); el IVA recuperable de los externos se informa aparte pero no entra en el capital de trabajo; los tipos de cambio los carga la empresa (RATEOS no los consulta); sueldos sólo en la moneda de la empresa.
- Todos los tipos de servicio usan el mismo modelo económico (costos fijos mensuales + costos variables por día activo).
- **Cuentas:** una empresa por cuenta y una persona por empresa (todavía no hay invitaciones ni Google). Los datos de cada empresa se guardan como un único documento (máximo 5 MB): si dos dispositivos o pestañas guardan a la vez, el segundo ve "Tus datos cambiaron en otro dispositivo." y elige [Recargar] o [Conservar una copia] (nunca se pisa nada en silencio, pero tampoco se fusionan cambios).
- **Enlaces de email** (confirmación, recuperación): funcionan en el mismo navegador donde se pidieron (PKCE). En otro navegador, la cuenta igual queda confirmada y se ingresa con email y contraseña.
- **Emails de Auth:** con el SMTP por defecto de Supabase sólo llegan a miembros del equipo del proyecto y con un límite bajo por hora (hace falta SMTP propio para usuarios reales).
- Costo financiero con interés simple y mes de 30 días; el comparador de modelos comerciales usa una facturación simplificada.
- **Montos sin IVA**: es la única convención soportada (explícita en cada cotización). No hay carga de montos con IVA ni conversión automática.
- **Impuestos sobre la facturación**: RATEOS no trae alícuotas (las carga cada empresa); sellos se modela proporcional a la facturación; no se modela el costo financiero de pagar esos impuestos antes de cobrar; el margen es antes del impuesto a las Ganancias.
- Escenarios y sensibilidad se calculan pero no se guardan. "Estimado vs real" está diseñado ([docs/DATA_MODEL.md](docs/DATA_MODEL.md#6-estimado-vs-real)) pero no implementado.
- Mientras GitHub Pages siga en "Deploy from a branch", el sitio se publica sin pasar por los tests (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Documentación

| Documento | Contenido |
|---|---|
| [AGENTS.md](AGENTS.md) | Constitución del proyecto: reglas para cualquier agente o persona que modifique RATEOS |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Capas, módulos, reglas de dependencia, flujo de datos, routing, CSP, decisiones |
| [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) | Todas las fórmulas con ejemplos numéricos |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Formato actual (schemaVersion 3), dónde se guarda (cuenta / demo / modo local) y modelo relacional futuro |
| [docs/RESOURCE_MODEL.md](docs/RESOURCE_MODEL.md) | Recurso maestro ≠ snapshot de cotización, base económica, propio / alquilado / tercerizado, fiscal de externos, movilización y doble conteo |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | CI/CD, GitHub Pages, verificación, rollback, tags, troubleshooting |
| [docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md) | Visitante / demo / cuenta, Supabase Auth, enlaces de email con GitHub Pages, sesión, roles, riesgos |
| [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md) | Tablas, RLS, sincronización por revisión, migración desde el modo local y fases siguientes |
| [supabase/README.md](supabase/README.md) | Cómo aplicar migraciones y correr los tests de RLS |
| [docs/BETA_SECURITY.md](docs/BETA_SECURITY.md) | Beta cerrada: frontera de tenant, inventario de la base, pruebas A/B, hallazgos, decisiones del dueño y Beta Security Gate |
| [docs/BETA_PERIMETER.md](docs/BETA_PERIMETER.md) | Perímetro de la beta: sin staging en producción, registro público con confirmación (con SMTP propio), dominio propio, prueba A/B real y checklist del dueño |
| [docs/TEST_LAB.md](docs/TEST_LAB.md) | RATEOS Test Lab: oráculo independiente, escenarios, invariantes, auditor UX, mercado, reportes y CI |
| [docs/AGENT_ROLES.md](docs/AGENT_ROLES.md) | Roles de revisión para el desarrollo (no son funciones del producto) |
| [.agent/PLANS.md](.agent/PLANS.md) | Plantilla y registro de planes de ejecución |
| [CHANGELOG.md](CHANGELOG.md) | Historial de versiones |

## Seguridad y privacidad

- **Sin servidor propio, sin analytics, sin IA:** todo se calcula en tu navegador. Los datos de una cuenta se guardan en Supabase y la base sólo se los muestra a las personas de esa empresa (**Row Level Security**, probado con usuarios A/B); la demo no guarda nada.
- RATEOS **no guarda contraseñas** (las administra Supabase Auth) y nunca muestra errores técnicos, tokens ni ids internos.
- El repositorio y el sitio son públicos: no contienen secretos, claves, tokens ni datos reales de clientes o costos. Todo el JavaScript del frontend es público.
- Content Security Policy estricta (sólo recursos propios, sin scripts inline ni terceros; la única conexión externa es el proyecto de Supabase); el DOM se construye sin `innerHTML`, `eval` ni `new Function`. RATEOS no funciona dentro de un iframe (anti-clickjacking).
- Inputs validados; nunca se muestran `NaN` ni `Infinity`.
- Los backups se validan antes de importarse (un JSON que no es de RATEOS, una colección con tipo incorrecto o una cotización mal formada se rechazan) y nunca se sobrescribe sin confirmación. Aunque llegue un dato inválido, una cotización mala no rompe el dashboard ni el listado.
- Los eventos internos de producto (sin envío a terceros) sólo aceptan valores de una lista blanca: nunca montos ni nombres.
- Al cerrar sesión o entrar con otra cuenta en la misma pestaña no queda nada de la empresa anterior en pantalla (ni en el menú oculto ni en borradores). El `organizationId` que mande el navegador o un backup nunca decide de qué empresa es un dato. Resumen y decisiones pendientes para la beta en [docs/BETA_SECURITY.md](docs/BETA_SECURITY.md).
- El deploy usa permisos mínimos por job, publica sólo producción (ningún staging comparte el sitio ni la base) y el rollback manual sólo publica commits o tags que ya están en `main`.
- No subas a issues, PRs ni al repositorio estructuras de costos reales ni datos de clientes.

## Cómo contribuir

1. Leé [AGENTS.md](AGENTS.md) (reglas del proyecto) antes de cualquier cambio importante.
2. Para cambios grandes (motor, margen, utilización, backend, auth, multiempresa, migraciones) escribí primero un plan en [.agent/PLANS.md](.agent/PLANS.md).
3. Trabajá en una rama, nunca directo en `main`.
4. Si cambiás una fórmula: tests + [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) + [CHANGELOG.md](CHANGELOG.md).
5. Abrí un Pull Request completando la [plantilla](.github/pull_request_template.md) y su checklist (incluye el review de Economía, QA, Seguridad y UX).

---

`package.json` declara la licencia como `UNLICENSED` (proyecto privado, sin licencia de uso pública).
