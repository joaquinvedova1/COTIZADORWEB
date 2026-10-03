<!--
Antes de abrir el PR: leé AGENTS.md. Cambios grandes (motor, margen, utilización,
backend, auth, multiempresa, migraciones) necesitan un plan en .agent/PLANS.md.
No incluyas datos reales de clientes, salarios ni costos en el PR.
-->

## Descripción

<!-- Qué cambia y por qué, en lenguaje simple. Enlazá el issue o el plan (.agent/PLANS.md) si existe. -->

## Tipo de cambio

- [ ] Corrección de bug
- [ ] Nueva funcionalidad
- [ ] Cambio en el motor económico (`js/engines/**`)
- [ ] Cambio de datos / esquema / migración (`js/data/**`, `SCHEMA_VERSION`)
- [ ] Interfaz / textos / estilos
- [ ] Documentación
- [ ] CI/CD, build o configuración
- [ ] Otro:

## Impacto en fórmulas

- [ ] Este PR **no** cambia ninguna fórmula económica.
- [ ] Este PR cambia fórmulas (completar):
  - Fórmula(s) y archivo(s):
  - Antes → después (caso numérico):
  - Tests agregados / actualizados:
  - Golden cases (`tests/golden-cases/`) siguen pasando: sí / no (justificar)
  - `docs/CALCULATION_RULES.md` y `CHANGELOG.md` actualizados: sí / no

## Checklist

- [ ] npm test pasa
- [ ] no cambié fórmulas sin tests
- [ ] no agregué secretos
- [ ] no rompí persistencia
- [ ] revisé responsive
- [ ] actualicé documentación cuando corresponde
- [ ] los valores demo siguen marcados como ilustrativos
- [ ] margen y markup siguen diferenciados
- [ ] build funciona bajo /COTIZADORWEB/

## Review multidisciplinario

<!-- Obligatorio para cambios importantes del motor económico (docs/AGENT_ROLES.md §8). -->

- **Economía** — ¿La fórmula es correcta?
- **QA** — ¿Qué pasa en los casos extremos (0 días, margen 0 / ≥ 100, utilización 100 % y ~0, precio < costo, vacíos, negativos)?
- **Seguridad** — ¿Se validan los inputs? ¿Hay secretos, `innerHTML` o datos sensibles expuestos?
- **UX** — ¿La persona usuaria entiende el resultado? ¿Tiene "Ver cálculo"?

## Cómo probarlo

<!-- Pasos para verificar con `npm start` en http://localhost:8080/COTIZADORWEB/ -->
