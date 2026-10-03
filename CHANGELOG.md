# Changelog

Todos los cambios relevantes de RATEOS se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/). Los tags `v0.x.x` se crean sólo para hitos (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-tags-y-versiones)).

Reglas para este archivo:

- Todo cambio de fórmula económica se anota aquí **y** en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md), indicando qué resultados cambian.
- Todo cambio de `SCHEMA_VERSION` se anota con la migración correspondiente.
- Secciones: Agregado, Cambiado, Obsoleto, Eliminado, Corregido, Seguridad.

## [Unreleased]

_Sin cambios todavía._

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
- Workflow "Deploy RATEOS a GitHub Pages" (push a `main` y `workflow_dispatch` con `ref` para rollback): test → build → deploy; no despliega si fallan los tests.
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

[Unreleased]: https://github.com/joaquinvedova1/COTIZADORWEB/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joaquinvedova1/COTIZADORWEB/releases/tag/v0.1.0
