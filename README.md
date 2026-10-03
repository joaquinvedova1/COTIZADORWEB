# RATEOS

**Motor de costos y tarifas para servicios industriales.**

> Ayuda a una empresa a saber cuánto le cuesta realmente prestar un servicio y a qué precio debería cotizarlo para no perder dinero.

**Sitio:** <https://joaquinvedova1.github.io/COTIZADORWEB/>

> **Aviso — datos ILUSTRATIVOS.** RATEOS se abre con datos de demostración de una empresa ficticia (*Patagonia Servicios SRL*). Todos los valores demo (salarios, cargas, convenios, equipos, combustible, tarifas) son **ILUSTRATIVOS**: no son escalas salariales, cargas patronales, alícuotas, CCT, precios ni costos reales. Reemplazalos por valores propios vigentes antes de cotizar.

## Qué es RATEOS

RATEOS es un **motor determinístico** de estructuras de costos, pricing, rentabilidad, utilización, break-even y escenarios, pensado para PyMEs proveedoras de servicios industriales, inicialmente Oil & Gas de Neuquén / Vaca Muerta. Su objetivo es **evitar que una empresa gane una licitación pero pierda plata ejecutándola**.

Separa siempre cuatro conceptos:

| Concepto | Qué es |
|---|---|
| **Costo** | Lo que realmente cuesta prestar el servicio en el mes. |
| **Tarifa piso** | Precio mínimo para no perder dinero (margen 0). |
| **Precio objetivo** | Precio necesario para lograr el margen buscado. |
| **Precio comercial** | Precio finalmente ofrecido al cliente. |

**Margen y markup no son lo mismo:** con costo 100, un margen del 10 % da un precio de **111,11**; un markup del 10 % da **110**.

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
| 13 | Cost Completeness Score | Porcentaje de completitud y pendientes (plazo de pago, combustible, materiales, relevos, contingencia…) |
| 14 | Persistencia local | `localStorage` con `schemaVersion`; sobrevive recargas, cierres y nuevos deploys |
| 15 | Backup / import | Exportar e importar JSON con validación y confirmación |
| 16 | Tests | `npm test` (motores, golden cases, datos, servicios, arquitectura, build) |
| 17 | Deploy automático | GitHub Actions: test → build → deploy a GitHub Pages |

Además: dashboard, escenarios pesimista / base / optimista, comparador de modelos comerciales (sólo tarifa por día, disponibilidad + día, mínimo garantizado + día, paquete mensual + excedentes) y 12 plantillas de servicio.

## Flujo de cotización

```
NUEVA COTIZACIÓN
 1. Tipo de servicio            7. Costos indirectos
 2. Modalidad de cotización     8. Financiamiento
 3. Personal                    9. Riesgo / contingencia
 4. Equipos                    10. Margen y reglas comerciales
 5. Materiales                 11. Resultado
 6. Logística
```

Dos modos:

- **Conozco la tarifa:** ingresás la tarifa y RATEOS calcula días mínimos (break-even), resultado y margen esperados.
- **Conozco la actividad:** ingresás cuántos días del mes esperás trabajar y facturar, y RATEOS calcula la tarifa piso y las tarifas con margen 5 %, 10 % y 15 %.

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
| Tarifa piso (neta) | $ 1.972.000 por día |
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

También funciona con cualquier servidor estático desde la raíz del repo (por ejemplo `python3 -m http.server 8080` → <http://localhost:8080/>). **No funciona abriendo `index.html` con `file://`**: los ES modules del navegador necesitan HTTP.

## Cómo testear

```bash
npm test
```

Usa el test runner nativo de Node (`node --test`), sin dependencias. Cubre motores económicos (`tests/engines/`), golden cases (`tests/golden-cases/`, un `.json` por regla de negocio), core (`tests/core/`), datos, migraciones y backup (`tests/data/`), servicios (`tests/services/`), reglas de arquitectura y seguridad (`tests/architecture.test.js`), build (`tests/build.test.js`) y sitio estático bajo `/COTIZADORWEB/` (`tests/static-site.test.js`). Los tests del motor son parte de la especificación del negocio: si un cambio los rompe, el cambio está mal o la regla debe revisarse explícitamente.

## Cómo desplegar

`main` es producción. El flujo es **rama → tests → Pull Request → main → deploy**:

1. Trabajá en una rama y corré `npm test`.
2. Abrí un Pull Request hacia `main` (el workflow de CI corre tests y build).
3. Al mergear, el workflow **"Deploy RATEOS a GitHub Pages"** ejecuta test → build → deploy. Si fallan los tests, no se despliega.
4. Verificá en **Configuración → Acerca de** que se ve `RATEOS · v0.1.0 · build <commit>`.

Requisito único: en GitHub → **Settings → Pages → Build and deployment → Source** elegir **"GitHub Actions"**. Detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Cómo hacer rollback

- **Preferido:** `git revert` del commit problemático en una rama → Pull Request → `main` → deploy automático.
- **Rápido:** Actions → "Deploy RATEOS a GitHub Pages" → **Run workflow** (branch `main`) → `ref` = tag (por ejemplo `v0.1.0`) o SHA anterior. Se despliega esa versión sin cambiar `main`; el próximo push a `main` vuelve a desplegar `main`.

Nunca force push a `main`. Paso a paso en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#5-rollback).

## Persistencia y backup

- Los datos se guardan **sólo en tu navegador** (`localStorage`, clave `rateos.state`) con `schemaVersion`. Sobreviven recargas, cierres del navegador y nuevos deploys.
- Si una versión nueva cambia el formato, RATEOS **migra** tus datos al abrir y guarda antes una **copia de recuperación**. Nunca borra datos por un cambio de estructura.
- **Configuración → Backup:** exportá un archivo JSON versionado y volvé a importarlo en otro navegador o equipo. Antes de importar se valida el archivo, se muestra un resumen y se pide confirmación para sobrescribir; el estado anterior queda como copia de recuperación.
- Si RATEOS no puede abrir tus datos, muestra una pantalla de recuperación para descargarlos tal cual están guardados.
- Si el navegador no permite guardar (modo privado estricto), la app avisa que los cambios no se conservan.

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
scripts/                   build.mjs (dist/ + version.json), serve.mjs (servidor local)
docs/                      documentación técnica
.agent/PLANS.md            planes de ejecución para cambios grandes
.github/                   workflows (deploy-pages, ci), dependabot, plantilla de PR
```

## Limitaciones conocidas (v0.1.0)

- Unidades de tarifa: $/día, $/hora y $/mes (abono). Otras (por viaje, km, m³, tonelada, intervención, precio global) todavía no.
- Todos los tipos de servicio usan el mismo modelo económico (costos fijos mensuales + costos variables por día activo).
- Los datos viven sólo en el navegador: no se sincronizan entre equipos (usar backup JSON). No hay login ni multiusuario.
- Costo financiero con interés simple y mes de 30 días; el comparador de modelos comerciales usa una facturación simplificada.
- Escenarios y sensibilidad se calculan pero no se guardan. "Estimado vs real" está diseñado ([docs/DATA_MODEL.md](docs/DATA_MODEL.md#6-estimado-vs-real)) pero no implementado.
- Mientras GitHub Pages siga en "Deploy from a branch", el sitio se publica sin pasar por los tests (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Documentación

| Documento | Contenido |
|---|---|
| [AGENTS.md](AGENTS.md) | Constitución del proyecto: reglas para cualquier agente o persona que modifique RATEOS |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Capas, módulos, reglas de dependencia, flujo de datos, routing, CSP, decisiones |
| [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) | Todas las fórmulas con ejemplos numéricos |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Formato actual (schemaVersion 1) y modelo relacional futuro |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | CI/CD, GitHub Pages, verificación, rollback, tags, troubleshooting |
| [docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md) | Autenticación y roles futuros (no implementados) |
| [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md) | Plan de migración a Supabase con RLS (no implementado) |
| [docs/AGENT_ROLES.md](docs/AGENT_ROLES.md) | Roles de revisión para el desarrollo (no son funciones del producto) |
| [.agent/PLANS.md](.agent/PLANS.md) | Plantilla y registro de planes de ejecución |
| [CHANGELOG.md](CHANGELOG.md) | Historial de versiones |

## Seguridad y privacidad

- **Sin backend, sin analytics, sin IA:** todo se calcula en tu navegador y tus datos no salen de tu dispositivo, salvo que exportes un backup.
- El repositorio y el sitio son públicos: no contienen secretos, claves, tokens ni datos reales de clientes o costos. Todo el JavaScript del frontend es público.
- Content Security Policy estricta (sólo recursos propios, sin scripts inline ni terceros); el DOM se construye sin `innerHTML`, `eval` ni `new Function`.
- Inputs validados; nunca se muestran `NaN` ni `Infinity`.
- Los backups se validan antes de importarse y nunca se sobrescribe sin confirmación.
- No subas a issues, PRs ni al repositorio estructuras de costos reales ni datos de clientes.

## Cómo contribuir

1. Leé [AGENTS.md](AGENTS.md) (reglas del proyecto) antes de cualquier cambio importante.
2. Para cambios grandes (motor, margen, utilización, backend, auth, multiempresa, migraciones) escribí primero un plan en [.agent/PLANS.md](.agent/PLANS.md).
3. Trabajá en una rama, nunca directo en `main`.
4. Si cambiás una fórmula: tests + [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) + [CHANGELOG.md](CHANGELOG.md).
5. Abrí un Pull Request completando la [plantilla](.github/pull_request_template.md) y su checklist (incluye el review de Economía, QA, Seguridad y UX).

---

`package.json` declara la licencia como `UNLICENSED` (proyecto privado, sin licencia de uso pública).
