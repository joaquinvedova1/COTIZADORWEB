# Roles de agentes de desarrollo

> **Importante:** estos roles son una guía de trabajo para **asistentes de programación y revisores** del repositorio. **NO son funcionalidades de RATEOS**: no se crean agentes dentro del producto, no aparecen en la interfaz y RATEOS sigue sin IA, chatbot ni copilot.

Todo agente lee primero [AGENTS.md](../AGENTS.md) (constitución del proyecto). Un mismo agente puede asumir varios roles; en cambios importantes conviene revisar el trabajo desde cada perspectiva por separado.

## 1. Cuándo interviene cada rol

| Tipo de cambio | Product | Economics | QA | Security | Data | UX |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Nueva funcionalidad o pantalla | Sí | si calcula | Sí | si maneja datos | si persiste | Sí |
| Cambio en `js/engines/**` (fórmulas) | Sí | **Obligatorio** | **Obligatorio** | si valida inputs | — | si cambia lo que se muestra |
| Cambio de esquema, migraciones, backup | — | — | Sí | Sí | **Obligatorio** | si cambia mensajes |
| Dependencias, CSP, DOM, workflows | — | — | Sí | **Obligatorio** | — | — |
| Textos, formularios, navegación | Sí | si explica cálculos | Sí | — | — | **Obligatorio** |
| Supabase, auth, RLS (futuro) | Sí | — | Sí | **Obligatorio** | **Obligatorio** | Sí |

## 2. Product Agent

**Responsabilidad:** proteger el scope. RATEOS es un motor determinístico de costos, pricing, rentabilidad, utilización, break-even y escenarios. Foco: **COSTO → TARIFA → RENTABILIDAD → DECISIÓN COMERCIAL**.

Checklist:

- [ ] ¿La funcionalidad ayuda a saber cuánto cuesta prestar un servicio o a qué precio cotizarlo para no perder dinero?
- [ ] ¿Evita convertir RATEOS en ERP, payroll, CRM, marketplace, facturación o gestor documental?
- [ ] ¿No agrega IA, chatbot, copilot ni contenido generativo?
- [ ] ¿Respeta el flujo de 11 pasos (`QUOTE_STEPS`) y las dos modalidades (conozco la tarifa / conozco la actividad)?
- [ ] ¿Sirve a los perfiles reales (dueño PyME, gerente comercial, administrativo, ingeniero, presupuestista) de servicios de Oil & Gas en Neuquén / Vaca Muerta?
- [ ] ¿Es la versión más simple que resuelve el problema (sin sobreingeniería)?

## 3. Economics Agent

**Responsabilidad:** fórmulas, margen, markup, break-even, utilización, descuentos, financiero. **Nunca cambia una fórmula sin tests.**

Checklist:

- [ ] Identifiqué exactamente qué fórmula cambia y qué resultados se mueven (antes / después con un caso numérico).
- [ ] Margen (sobre precio) y markup (sobre costo) siguen diferenciados: costo 100 + margen 10 % = 111,11; + markup 10 % = 110.
- [ ] Golden cases intactos: fijos 30.000.000, variable 1.000.000/día, tarifa 4.000.000/día → break-even **10 días**.
- [ ] Unidades coherentes: $/día, $/hora, $/mes; por activación vs por día activo; mensual vs anual (÷ 12).
- [ ] Fijos vs variables bien clasificados (posesión vs operación; standby; estructura).
- [ ] Financiero: sólo costos en efectivo; amortización, costo de capital y contingencia no se financian.
- [ ] Descuentos multiplicativos; semáforo verde/naranja/rojo contra objetivo y piso; mínimo garantizado no se usa para tarifas necesarias.
- [ ] EECC: categorías correctas y suma 100,00 %.
- [ ] Casos extremos: 0 días, margen 0 y ≥ 100, utilización 100 % y casi 0, precio < costo, descuento que deja margen negativo, vacíos, negativos.
- [ ] Redondeo sólo al presentar (`roundMoney`, `roundRate`, `roundPercentage`); ningún `NaN`/`Infinity`.
- [ ] Ningún valor normativo inventado (escalas, cargas, CCT, impuestos): demo = ILUSTRATIVO.
- [ ] Actualicé [CALCULATION_RULES.md](CALCULATION_RULES.md) y el [CHANGELOG](../CHANGELOG.md).

## 4. QA Agent

**Responsabilidad:** encontrar regresiones, probar casos extremos, ejecutar tests y validar los flujos principales.

Checklist:

- [ ] `npm test` pasa completo antes y después del cambio (Node ≥ 20).
- [ ] Cada bug económico corregido agrega un test que impide que vuelva (los tests son contrato de negocio).
- [ ] Probé con `npm start` en `http://localhost:8080/COTIZADORWEB/` (sub-ruta, no raíz).
- [ ] Flujo completo: nueva cotización (en blanco y desde plantilla) → 11 pasos → resultado → "Ver cálculo".
- [ ] Demo "Hidrogrúa on-call — Añelo" y "Caso de referencia" muestran resultados coherentes (break-even 10 días en el de referencia).
- [ ] Persistencia: recargar conserva los cambios; export → import con resumen y confirmación; copias de recuperación.
- [ ] Ningún `NaN`, `Infinity`, `undefined` ni "[object Object]" en pantalla; consola sin errores.
- [ ] Responsive (desktop, tablet, móvil) e impresión del resultado.
- [ ] Casos de borde de inputs: vacío, 0, negativos, textos largos, decimales con coma.

## 5. Security Agent

**Responsabilidad:** exposición de secretos, XSS, dependencias, manejo de datos y configuración futura de Supabase/RLS.

Checklist:

- [ ] Sin secretos, tokens, passwords, `.env` ni datos reales de clientes o costos en el repo (todo JS frontend es público).
- [ ] Sin `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` ni `setTimeout`/`setInterval` con string; texto con `textContent` / `h()`.
- [ ] Inputs validados (`validateNumber`, `sanitizeText`); `setPath` sin claves `__proto__`/`constructor`/`prototype`.
- [ ] Backups: límite de tamaño, validación y migración antes de aplicar, confirmación, copia de recuperación.
- [ ] CSP de `index.html` sin relajar (`script-src 'self'`, sin inline, sin CDNs ni terceros).
- [ ] Sin dependencias nuevas; si fueran inevitables, justificadas y cubiertas por Dependabot.
- [ ] Logger de producción sin contexto sensible; eventos sólo de la lista blanca y sin montos.
- [ ] Workflows con permisos mínimos; nada de force push a `main`.
- [ ] Futuro: RLS en todas las tablas, `SUPABASE_SERVICE_ROLE_KEY` nunca en el frontend (ver [SUPABASE_PLAN.md](SUPABASE_PLAN.md)).

## 6. Data Agent

**Responsabilidad:** esquemas, migraciones, compatibilidad localStorage/Supabase y backups.

Checklist:

- [ ] Toda persistencia pasa por `StorageRepository`; nada fuera de `js/data/` usa `localStorage`.
- [ ] Si cambia el formato: `SCHEMA_VERSION` + `migrateV{N}ToV{N+1}` registrada en `MIGRATIONS` + tests con datos reales de la versión anterior (incluido el backup demo).
- [ ] Ninguna migración pierde datos; claves desconocidas se preservan; nunca `localStorage.clear()`.
- [ ] Datos de una versión más nueva → modo sólo lectura (no se pisan).
- [ ] Entidades nuevas con `id` UUID, `organizationId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`.
- [ ] El backup sigue siendo importable por la versión nueva y el formato sigue mapeando a las tablas de [DATA_MODEL.md](DATA_MODEL.md).
- [ ] Los datos del usuario sobreviven a un nuevo deploy (la clave `rateos.state` no cambia).

## 7. UX Agent

**Responsabilidad:** lenguaje simple, que una PyME pueda usar RATEOS sin capacitación, sin jerga innecesaria.

Checklist:

- [ ] Preguntas en lenguaje de la persona usuaria: "¿Cuántos días del mes esperás que el equipo esté trabajando y facturando?" en lugar de "factor de utilización".
- [ ] Español rioplatense, consistente (vos), sin anglicismos innecesarios (o explicados: standby, minimum call, call-out).
- [ ] Todo resultado importante tiene "Ver cálculo" con fórmula, entradas y resultado.
- [ ] Valores demo marcados como ILUSTRATIVOS en pantalla.
- [ ] Margen y markup explicados y nunca intercambiados en textos.
- [ ] Errores y avisos que dicen qué pasó y qué hacer; los datos del usuario "no se perdieron" cuando es verdad.
- [ ] Estados vacíos con una acción clara; confirmación antes de acciones destructivas.
- [ ] Accesibilidad básica: etiquetas en campos, foco visible, contraste, navegación con teclado.
- [ ] Desktop first, pero usable en tablet y móvil.

## 8. Review multidisciplinario

Para cambios importantes del motor económico se revisa desde **cuatro perspectivas** (y se deja constancia en el Pull Request, ver [plantilla de PR](../.github/pull_request_template.md)):

1. **Economía** — ¿La fórmula es correcta?
2. **QA** — ¿Qué pasa en los casos extremos?
3. **Seguridad** — ¿Se validan los inputs?
4. **UX** — ¿La persona usuaria entiende el resultado?

### Ejemplo: nueva lógica para servicio on-call

| Perspectiva | Pregunta | Respuesta esperada en RATEOS |
|---|---|---|
| Economía | ¿La fórmula es correcta? | Costo(D) = F × factorMeses + v × D; activaciones = días activos / días por activación; costos y fees por activación se convierten con esa relación; break-even = menor D desde el cual el resultado ya no es negativo. Golden case: 30M / 1M / 4M → 10 días. |
| QA | ¿Qué pasa con 0 días? | Costo = F; tarifa por día "—" (no hay unidades); break-even calculado o "inalcanzable" con motivo; nunca `NaN`. También: días > disponibles, días por activación 0, minimum call mayor que la activación. |
| Seguridad | ¿Se valida el input? | `validateNumber` con reglas `days`, `availableDays`, `positiveDays`; los motores sanean negativos con `nonNegative`; textos con `sanitizeText`; nada se inserta como HTML. |
| UX | ¿El usuario entiende el resultado? | "Días activos para no perder dinero: 10 días" con "Ver cálculo" (fijos, tarifa, variable, contribución, fórmula); matriz tarifa × utilización para ver cómo cambia la tarifa con más o menos días. |
