# VEREDICTO final — ronda de testeo RATEOS 2026-11-15

Tercera instancia. Entradas: 7 informes de tester (`(carpeta de trabajo de la sesión)/reports/`), 7 auditorías (`(carpeta de trabajo de la sesión)/audits/`), repo `el repo` (v0.8.1, sin tocar). Trabajo propio en `(carpeta de trabajo de la sesión)/eval/`: `e1.mjs` a `e6.mjs` (motor, sobre las cotizaciones que guardaron testers y auditores) y `ui1.mjs` (interfaz, con el arnés, cotización nueva tipeada).

Los 111 hallazgos de origen (95 de testers + 16 "NUEVO" de auditores) quedan en 69 ítems.

Cómo leer la columna "Verificación":
- **REPRODUCIDO-UI**: lo vi pasar en pantalla con mi propia corrida.
- **REPRODUCIDO-MOTOR**: recalculé con `computeQuote` y me dio el número.
- **LEÍDO-CÓDIGO**: abrí el archivo y la línea citada y hace lo que se dice; no lo corrí.
- **NO VERIFICADO**: no lo comprobé. Lo digo en cada caso.

---

## 1. Resumen para Joaco

**¿Se puede confiar en el número?** La cuenta sí: con los datos bien cargados, costo, piso y tarifa sugerida cierran al peso contra la cuenta a mano en los 7 informes, y lo volví a comprobar con el motor en 20 cotizaciones. No apareció ningún error de aritmética.

**El problema está en lo que la app da por contestado.** Hay cuatro lugares donde un cotizador llega a un precio equivocado sin que nada se lo marque:

1. **"¿Trabajan sólo para este servicio?" ya viene en "Sí".** Nadie lo eligió, pero se ve elegido. En un trabajo de pocos días el precio carga el mes entero de sueldos: +32 % en la obra de trailers ($ 50,8 M contra $ 38,6 M), +67 % en el trabajo de válvulas. El aviso que lo explica sale en otra pantalla. Además, hacer clic en "Sí" hoy no guarda nada.
2. **Cambiar la unidad de cobro deja los números viejos con otro significado.** 4.000 km pasan a ser 4.000 viajes; un mínimo de 4 horas pasa a 4 días; el insumo "por válvula" pasa a "por día". Ejemplo: de $/válvula a $/día la app sugiere $ 1.214.000 por día cuando lo correcto es $ 2.172.000. Cobrando eso se pierden $ 5,6 M por mes.
3. **Hay 10 horas por día que no se ven.** Cobrando por viaje, km, unidad u hora-hombre, el campo de horas no aparece en ningún lado y queda en 10. Con eso se calcula el uso de equipos y el % de dedicación: una cuadrilla por hora-hombre sale 7,9 % cara y un alquilado por hora 12 % caro. Y deja la cotización en "borrador" con un aviso que manda a sumar una persona.
4. **Seguro, patente y vianda están escondidos en "Opciones avanzadas".** Si quedan en 0 la app dice "100 %, cotización completa". Una pickup sin seguro ni patente da 10,7 % menos de precio; sin viandas, 8,4 % menos.

Hay dos más, menos frecuentes pero graves cuando ocurren:
- Un proveedor cargado como "Global (todo el contrato)" en un precio cerrado se divide por 12 meses que nadie cargó: la grúa de $ 5,6 M entra como $ 466.667 y el precio sale 20 % abajo, por debajo del costo.
- El desplegable de unidad se vuelve a abrir solo y tapa el campo de abajo. En mi prueba, el clic en ese campo cambió la unidad de hectárea a metro sin avisar.

**Qué se corrige.** 25 correcciones chicas, sin tocar ninguna fórmula salvo la del proveedor "Global", que hoy da mal. Ninguna otra cambia el número de una cotización guardada. Son avisos, campos que pasan a estar a la vista y cantidades que se limpian al cambiar la unidad. Además, 8 cambios de texto.

**Qué queda para vos.** 6 decisiones, porque cambian números ya guardados o una regla escrita. La más importante: cómo se cobra la hora fuera de horario cuando no se cobra por hora ni por día. Hoy, cobrando por viaje, la app publica una hora extra de $ 166.206 que un cotizador puede usar en lugar del viaje y perder $ 262.000 en un sábado. Por ahora se arregla con texto.

**Qué no pude comprobar:** celular, impresión y PDF, y el caso de la pickup con 15 km de distancia del informe de logística.

---

## 2. Tabla maestra

Severidad final: la que queda después de mi verificación. Esfuerzo: S (horas), M (un día), L (varios días).

### Corregir ya (25)

| V-ID | Título | IDs de origen | Verificación | Severidad | Esf. |
|---|---|---|---|---|---|
| V-01 | Dedicación "Sí" preseleccionada; aviso de costos fijos en otra pantalla | FLUJO-02, SEMI-06, TRAIL-02, FLUJO-NUEVO-A, SEMI-NUEVO-B, FLUJO-NUEVO-B | REPRODUCIDO-UI + MOTOR | alta | S |
| V-02 | Proveedor "Global" ÷ 12 en precio cerrado | TRAIL-01, TRAIL-NUEVO-C | REPRODUCIDO-MOTOR | alta | S |
| V-03 | Cambiar la unidad no limpia cantidades, mínimos ni insumos | LOGI-01, TRAIL-09, GUAR-04, UNID-01, UNID-NUEVO-A, LOGI-NUEVO-2 | REPRODUCIDO-UI + MOTOR | alta | M |
| V-04 | "Horas por día" en 10, oculto con unidades por cantidad | LOGI-07, LOGI-NUEVO-1, CUAD-03, CUAD-10, CUAD-NUEVO-A, CUAD-NUEVO-B, UNID-05, TRAIL-11, FLUJO-05, FLUJO-NUEVO-C | REPRODUCIDO-UI + MOTOR | alta | M |
| V-05 | Desplegable de unidad que se reabre; etiqueta de unidad vieja | CUAD-09, LOGI-10, UNID-09, SEMI-13, FLUJO-13, GUAR-09 (etiqueta) | REPRODUCIDO-UI (desplegable) · LEÍDO-CÓDIGO (etiqueta) | media-alta | S |
| V-06 | Seguro, patente y vianda en "Opciones avanzadas", en 0 sin aviso | LOGI-02, FLUJO-03, CUAD-07 | REPRODUCIDO-MOTOR + UI | alta | S |
| V-07 | Insumos "por unidad producida": rendimiento pedido dos veces; "1 por día" sin aviso | UNID-02, UNID-06, UNID-NUEVO-B | REPRODUCIDO-MOTOR | alta | S-M |
| V-08 | Aviso "cargá 1,33 días por llamado" recomienda un valor que da mal | TRAIL-05, TRAIL-NUEVO-A | REPRODUCIDO-MOTOR | media-alta | S |
| V-09 | Avisos de adicionales aparecen en la etapa 1 | SEMI-10, SEMI-NUEVO-A | REPRODUCIDO-UI | media | S |
| V-10 | "Días que lleva cada trabajo" vacío = 1 día, sin aviso | TRAIL-12 (primera parte) | REPRODUCIDO-MOTOR | media | S |
| V-11 | % de dedicación que queda viejo al cambiar los días | CUAD-04, TRAIL-10 (parte del %) | REPRODUCIDO-MOTOR | media | S |
| V-12 | "Tus tarifas" no lista mínimos ni adicionales | GUAR-07, UNID-04, TRAIL-07 (a), LOGI-08 | LEÍDO-CÓDIGO | media | S |
| V-13 | Mínimo por llamado en km: texto falso y borrador permanente | SEMI-03, SEMI-NUEVO-C | REPRODUCIDO-MOTOR | media | S |
| V-14 | "Sin contar adicionales" da más que la tarifa sugerida | CUAD-05 | REPRODUCIDO-MOTOR | baja-media | S |
| V-15 | Base de estructura mostrada sin los proveedores | TRAIL-14 | LEÍDO-CÓDIGO | baja | S |
| V-16 | "Lo que cuestan tus recursos" muestra sólo la parte fija | FLUJO-04, SEMI-11, TRAIL-13 | LEÍDO-CÓDIGO | baja-media | S |
| V-17 | Botones "Feriado" y "Llamado fuera de horario" conviven con la hora al 50 % y 100 % | SEMI-08 (primera parte), GUAR-09 (botón) | LEÍDO-CÓDIGO | baja-media | S |
| V-18 | Alquiler por mes: "Salida de caja $ 0 por día activo" | LOGI-11 | LEÍDO-CÓDIGO | baja | S |
| V-19 | Buscador de unidades: "m3" y "m2" | UNID-07 | LEÍDO-CÓDIGO | baja-media | S |
| V-20 | Sello ILUSTRATIVO por combustible cuando nadie usa combustible | UNID-10 | LEÍDO-CÓDIGO | baja | S |
| V-21 | Material nuevo sin proveedor elegido | FLUJO-09 (material) | LEÍDO-CÓDIGO | baja | S |
| V-22 | "¿Quién maneja?" deja un pendiente y no cambia nada | FLUJO-07 (primera parte) | LEÍDO-CÓDIGO | baja | S |
| V-23 | Alquilado con consumo por km: dos campos de L/100 km | LOGI-05 | LEÍDO-CÓDIGO | baja-media | S |
| V-24 | Unidad inicial distinta según el camino ($/día o $/hora) | LOGI-12, FLUJO-NUEVO-D | LEÍDO-CÓDIGO | baja | S |
| V-25 | Botón "Agregar" principal junto a una lista vacía | FLUJO-12 | LEÍDO-CÓDIGO | baja | S |

### Por diseño: sólo texto o aviso (8)

| V-ID | Título | IDs de origen | Verificación | Severidad | Esf. |
|---|---|---|---|---|---|
| V-26 | Hora fuera de horario cuando no se cobra por hora ni por día | SEMI-01, SEMI-04, CUAD-01 (rótulo), CUAD-02, UNID-03, LOGI-03 | REPRODUCIDO-MOTOR | media-alta | S |
| V-27 | Horas fuera de horario: "además" de las normales; margen y equilibrio | GUAR-01, GUAR-02, GUAR-NUEVO-A | REPRODUCIDO-MOTOR (parcial, ver ficha) | media | S |
| V-28 | Guardia que cubre todo: tarifa "—" y textos genéricos | GUAR-05, GUAR-NUEVO-B | REPRODUCIDO-MOTOR | media | S |
| V-29 | Standby con días baja la tarifa principal | TRAIL-03, TRAIL-NUEVO-B | REPRODUCIDO-MOTOR | media | S |
| V-30 | "No usa combustible" en un vehículo que viaja | FLUJO-01 | REPRODUCIDO-MOTOR | media | S |
| V-31 | Peajes "por llamado" con varios viajes por día | LOGI-06 | REPRODUCIDO-MOTOR | media-baja | S |
| V-32 | "Guardia activa" con dos significados | GUAR-06, SEMI-09 | LEÍDO-CÓDIGO | baja-media | S |
| V-33 | Textos sueltos (7) | TRAIL-08 (texto), CUAD-06, GUAR-08, TRAIL-04 (ayuda), TRAIL-06 (total 12 meses), FLUJO-03 (rótulos), CUAD-12 (% vacío) | LEÍDO-CÓDIGO | baja | S |

### Decisión de Joaco (6)

| V-ID | Título | IDs de origen | Verificación | Severidad | Esf. |
|---|---|---|---|---|---|
| V-34 | Hora-hombre: hora normal = tarifa × personas | CUAD-01 | REPRODUCIDO-MOTOR | alta | S-M |
| V-35 | Viaje, km o unidad: publicar el recargo en vez de la hora completa | SEMI-01, UNID-03, LOGI-03 | REPRODUCIDO-MOTOR | media-alta | M |
| V-36 | Que las horas fuera de horario estimadas abaraten la tarifa principal | GUAR-01, GUAR-02 | REPRODUCIDO-MOTOR (parcial) | media | M |
| V-37 | Tarifa piso que no dependa del margen objetivo | SEMI-05 | REPRODUCIDO-MOTOR | baja | S-M |
| V-38 | Redondear las horas fuera de horario como la tarifa | FLUJO-14, GUAR-09 (redondeo) | LEÍDO-CÓDIGO | baja | S |
| V-39 | Jornada precargada en cotizaciones nuevas: 10 h, otra o vacía | FLUJO-05, CUAD-10, TRAIL-11 | REPRODUCIDO-MOTOR | media | S-M |

### Correcto, después (16)

| V-ID | Título | IDs de origen | Verificación | Severidad | Esf. |
|---|---|---|---|---|---|
| V-40 | Vehículo a disposición con km mensuales | LOGI-09 | NO VERIFICADO (ya conocido, B-5) | media | L |
| V-41 | Alquilado por día que se usa sólo algunos días | TRAIL-04 | REPRODUCIDO-MOTOR | media | S-M |
| V-42 | Lenguaje mensual en un trabajo único | TRAIL-15 | NO VERIFICADO | baja | S-M |
| V-43 | Guardia, plus y mínimo se editan en dos etapas | FLUJO-11, SEMI-08 (segunda parte) | LEÍDO-CÓDIGO | baja | S-M |
| V-44 | Las 12 casillas de la etapa 1 no se reflejan en los pasos | FLUJO-08, CUAD-08 | NO VERIFICADO | baja-media | M |
| V-45 | Contador de pendientes y fecha base | FLUJO-16 | NO VERIFICADO | baja | S-M |
| V-46 | Ficha de vehículo: orden y textos | SEMI-12, FLUJO-10 | NO VERIFICADO | baja | M |
| V-47 | Anticipo del cliente | TRAIL-08 (anticipo) | NO VERIFICADO | media-baja | M |
| V-48 | Costo por unidad en el Resultado | UNID-12, TRAIL-06 (costo por trailer) | NO VERIFICADO | baja | S |
| V-49 | Referencia para el monto de la guardia pasiva | GUAR-03 | NO VERIFICADO | baja-media | S |
| V-50 | Tasa de financiamiento a la vista | FLUJO-06 (tasa) | NO VERIFICADO | baja | S |
| V-51 | Alquilado: "faltan 8 datos" y aviso de vigencia | FLUJO-09 (alquilado) | NO VERIFICADO | baja-media | M |
| V-52 | "Otra / personalizada" pierde lo escrito; plantillas sin "fumigación" | UNID-08, UNID-11 | LEÍDO-CÓDIGO | baja | S |
| V-53 | Avisos de red: km facturados contra km de ruta; vehículo por hora y por km | LOGI-NUEVO-3, LOGI-04 | LEÍDO-CÓDIGO | baja | S |
| V-54 | Jornada entera fuera de horario cobrando por día | CUAD-11 | NO VERIFICADO | baja | S |
| V-55 | Horas de viaje cobrando por hora | FLUJO-07 (segunda parte) | NO VERIFICADO (ya conocido, H-15) | media | M |

### No hacer (7)

| V-ID | Título | IDs de origen | Verificación |
|---|---|---|---|
| V-56 | Con guardia la hora fuera de horario baja | SEMI-02 | REPRODUCIDO-MOTOR (GUAR pasiva 18 M) |
| V-57 | El recargo cuenta a todos los choferes | SEMI-07 | LEÍDO-CÓDIGO |
| V-58 | Cambiar el orden del asistente | FLUJO-15 | NO VERIFICADO |
| V-59 | Costo financiero en 0 sin plazo de cobro | FLUJO-06 | LEÍDO-CÓDIGO |
| V-60 | Preguntas nuevas propuestas por los testers | GUAR-01, CUAD-02, LOGI-04, TRAIL-06, SEMI-01 | — |
| V-61 | Residual, EPP y neumáticos a la vista | FLUJO-03 (resto) | REPRODUCIDO-MOTOR (seguro, vianda) |
| V-62 | Cambios de regla: peajes × viajes, standby que no baje la tarifa, % por días hábiles | LOGI-06, TRAIL-03, CUAD-06 | REPRODUCIDO-MOTOR |

### Incorrecto: error del tester (4)

| V-ID | Título | IDs de origen | Verificación |
|---|---|---|---|
| V-63 | "Valores rechazados sin mensaje" | TRAIL-12 (segunda parte), CUAD-12 ("0 sin mensaje") | LEÍDO-CÓDIGO |
| V-64 | "Doble conteo" de horas fuera de horario | GUAR-01 (diagnóstico) | REPRODUCIDO-MOTOR |
| V-65 | "La app no avisa" cuando sí avisa | LOGI-04, LOGI-05, TRAIL-05, SEMI-11 (vianda) | REPRODUCIDO-MOTOR (TRAIL-05) · LEÍDO-CÓDIGO (resto) |
| V-66 | "Las 10 h no cambian la tarifa" | CUAD-03 (impacto), FLUJO-05 (dimensión) | REPRODUCIDO-MOTOR |

### Sin veredicto: no verificado (3)

| V-ID | Título | IDs de origen |
|---|---|---|
| V-67 | Celular | TRAIL-16, SEMI-14 |
| V-68 | Materiales facturados aparte con recargo | TRAIL-17 |
| V-69 | Menores sin auditar | GUAR-09 (4 puntos), CUAD-12 (4 puntos) |

---

## 3. Fichas de corrección, en orden de implementación

Regla común: cada ficha dice si cambia números guardados. Salvo V-02, ninguna los cambia.

Los tests del repo son `node --test` sobre funciones puras. Por eso, donde la corrección está en una pantalla, pido sacar la decisión a una función exportada y testear esa función, como ya hace `tests/ui/audit-ui.test.js`.

**Orden y choques de código.**
1. V-02 (motor, aislada).
2. V-03 y después V-04. Las dos tocan `modality.js` y V-04 se engancha en un campo que V-03 limpia.
3. V-01 y después V-11. Las dos tocan la tarjeta de dedicación.
4. V-05, V-06, V-07, V-08, V-09, V-10 (independientes entre sí).
5. V-12 antes que V-26, V-32 y V-38: todas tocan `tariffsBlock`.
6. El resto en cualquier orden.

`completeness-engine.js` recibe reglas nuevas en V-01, V-04, V-06, V-07, V-10, V-11 y V-13: conviene un solo commit por regla, porque cada una mueve el puntaje de completitud de algunas cotizaciones guardadas (nunca el precio).

---

### V-02 · Proveedor "Global" ÷ 12 en precio cerrado

**Qué pasa.** Grúa a $ 5.600.000 "Global (todo el contrato)" en un trabajo a precio cerrado: entra como $ 466.667 por mes. Costo $ 24.515.644 en vez de $ 30.847.816; sugerida $ 30.645.000 en vez de $ 38.560.000. Con duración 1 o vacía da bien. Completitud igual en los dos casos (96 %).

**Causa.** `js/engines/external-engine.js:138-139` divide por `contractMonths`; `js/engines/cost-engine.js:300` le pasa `quote.contractMonths`, que nace en 12 (`js/domain/quote-factory.js:223`).

**Corrección.**
- `cost-engine.js:300`: si `contractOf(quote).mode === 'closed'`, pasar además `globalJobs` = `quote.contractJobs` si es mayor que 0, si no 1. Importar `contractOf` de `../domain/contract.js`.
- `external-engine.js:138`: con `ctx.globalJobs`, tratar `global` como cobro por trabajo: `billedUnitsPerActivation = 1` y `netPerActivation = price × quantity ÷ globalJobs`. Sin `globalJobs`, igual que hoy.
- `js/ui/views/quote-steps/equipment.js:82`: en precio cerrado, ayuda "Monto por toda la obra." En los otros contratos queda como está.
- `js/domain/catalogs.js:353`: no cambiar el rótulo del catálogo; en precio cerrado mostrar "Global (toda la obra)" desde la pantalla.
- `service.js:374-376`: el texto "Con precio cerrado no multiplica el total del trabajo" pasa a ser cierto; no tocar.

**Por qué por trabajo y no "meses = 1".** Con un trabajo que dura dos meses (0,5 trabajos por mes), "meses = 1" cargaría la grúa entera cada mes. Por trabajo carga la mitad por mes y el total del trabajo da $ 5,6 M.

**Test.** `tests/engines/tanda-a-2026-11.test.js` (junto a A-1): externo global 5.600.000 en precio cerrado con `contractMonths: 12` da el mismo costo que `unit: 'activation'`; con `contractJobs: 2`, la mitad; en contrato mensual sigue dividiendo por los meses.

**Riesgo.** Bajo. **Cambia números guardados:** sí, las de precio cerrado con un externo "Global" y duración mayor que 1. Hoy están mal (precio por debajo del costo). Anotarlo en el CHANGELOG y en la tabla de externos de `CALCULATION_RULES.md`.

---

### V-03 · Cambiar la unidad no limpia cantidades, mínimos ni insumos

**Qué pasa (todo reproducido).**

| Cambio | Queda | Efecto |
|---|---|---|
| $/km (4.000 y 200) → $/viaje | 4.000 viajes, 200 por día | costo $ 1.026.925.252; sugerida $ 321.000 por viaje (correcta 804.000) |
| $ global → $/hito → $ global | 3 trabajos por mes | sugerida $ 31.741.000 (correcta 38.560.000) |
| $/hora con mínimo 4 h → $/llamado → $/día | mínimo 4 días | sugerida $ 387.000 por día; al volver a hora, mínimo 20 h y $ 77.300 |
| $/válvula → $/día | insumo "1 por día" | costo $ 12.837.158 (real 22.963.008); sugerida $ 1.214.000 (correcta 2.172.000) |
| ídem, con mínimo de 80 válvulas | "80 días" | margen mostrado 82,28 % |
| $/hectárea → $/m³ (mi corrida por interfaz) | 20 m³, 1 por día | ningún aviso |

**Causa.** `js/ui/views/quote-steps/modality.js:203-268` (`changeUnit`): las tres mutaciones (líneas 238, 251 y 260) sólo cambian `q.unit`, la tarifa y, en un caso, el mínimo por llamado. `service.js:250-263` (`applyContract`) hace lo mismo al cambiar la modalidad.

**Corrección: una sola función pura, usada en los cuatro lugares.** Crear `js/domain/unit-change.js` con `applyUnitChange(q, fromInfo, toInfo)` que muta la cotización y devuelve la lista de avisos. Reglas, sólo si `fromInfo.id !== toInfo.id`:

1. **Cantidades.** Si la unidad nueva es por cantidad o por evento, y la cotización tiene `activity.billableQuantityPerMonth`, `unitsPerActiveDay` o `unitsPerTrip` cargados: ponerlos en `null`. Aviso: `Cargá de nuevo la cantidad por mes en {plural}: la que había estaba en {plural anterior}.`
   Limpiar, no convertir. Convertir entre trabajo e hito, o entre viaje y km, son cuentas distintas para cada par y cada una puede fallar; limpiar es una regla sola y la completitud ya marca en rojo la cantidad que falta (`completeness-engine.js:244-253`).
2. **Mínimo por llamado** (`rules.minimumCallUnits` mayor que 0). Si se convirtió entre día y hora, queda como hoy. En cualquier otro caso (incluido pasar por $/llamado o por abono): poner 0. Aviso: `Se borró el mínimo por llamado (estaba en {unidad anterior}): cargalo de nuevo en "El precio".` Reemplaza los dos avisos de las líneas 230-234 que hoy dejan el número "sin convertir".
3. **Mínimo garantizado en unidades** (`rules.minimumGuaranteeBasis === 'units'` y `minimumGuaranteeUnits` mayor que 0): poner 0. Aviso: `Se borró el mínimo garantizado (estaba en {plural anterior}): cargalo de nuevo en "El precio".`
4. **Insumos "por unidad producida".** Sólo si la unidad anterior era por cantidad: en cada línea de `materials` y `otherCosts` con base `per_output`, sin `outputUnit` y sin `outputPerActiveDay`, escribir `outputUnit` = nombre singular de la unidad anterior y, si había, `outputPerActiveDay` = el `unitsPerActiveDay` anterior (leerlo antes del punto 1). Aviso: `{N} insumos siguen calculándose por {singular anterior} ({n} por día).` Si la unidad anterior era día u hora, no tocar nada: en el flujo nuevo los materiales se cargan antes de elegir la unidad y tienen que seguir a la que se elija.

Llamarla desde las tres mutaciones de `changeUnit` (reemplaza a `applyMinCall`) y desde `applyContract` cuando `nextUnit !== current`. Los avisos van en el mismo cartel que ya muestra `ctx.toast`, en tono de advertencia.

**Test.** `tests/domain/unit-change.test.js`: los seis casos de la tabla. Para el de válvula a día, comprobar con `computeQuote` que el costo no cambia (22.963.008 antes y después; lo simulé en `e1.mjs`).

**Riesgo.** Bajo-medio. Sólo actúa al cambiar la unidad; no toca cotizaciones guardadas. El usuario que cambia de unidad para probar pierde dos números y los tiene que volver a cargar: es el precio de no reinterpretarlos. Revisar los tests que hoy esperan el aviso "quedó en N sin convertir".

---

### V-04 · "Horas por día" en 10, oculto con unidades por cantidad

**Qué pasa (reproducido).**
- Por la interfaz, on call con $/hectárea: el campo `activity.hoursPerActiveDay` no existe en la pantalla, tampoco dentro de "Opciones avanzadas"; la cotización guarda 10.
- Hora-hombre, 378 HH y 27 HH por día (3 personas, 9 h): la propuesta de dedicación dice 140 h y 79,5 %; lo correcto es 126 h y 71,6 %. Sugerida $ 60.400 contra $ 56.000 por HH (+7,9 %).
- Equipo sin horas propias: hereda 10 h. Costo $ 24.459.734 contra $ 24.121.213 con 9 h.
- Minibús alquilado por hora, cobrando por viaje: $ 839.000 por viaje con las 10 h contra $ 747.000 con 8 h (+12,3 %).
- Queda el pendiente "Horas del día sin cubrir… sumá 1 persona", que es falso.

**Causa.** `modality.js:393`: `hoursInMain = hourly || monthlyContract || asksAvailability`. En on call es verdadero, así que el campo se saca de "Opciones avanzadas" (línea 709); pero con unidad por cantidad el formulario principal es `quantityFields()` (línea 400), que no lo tiene.

**Advertencia sobre la propuesta del tester ("que nazca vacío").** No hacerla ahora. Con las horas vacías el motor deja de sumar el uso de los equipos y, cobrando por cantidad, no avisa. Lo comprobé: hora-hombre con horas vacías y camión sin horas propias da costo $ 21.074.518 contra $ 24.121.213, con completitud 100 %.

**Corrección.**
1. `modality.js`, `quantityFields()`: agregar `hoursField()` como último campo de las dos grillas (por evento y por cantidad), y poner `hoursInMain = hourly || monthlyContract || asksAvailability || byQuantity` para que no se repita en avanzadas. Así el campo está siempre a la vista en "Cómo se cobra", con cualquier unidad. Con 4 campos, grilla de 2 columnas.
   Texto de ayuda cuando la unidad es por cantidad o por evento: `Las horas que se trabaja cada día. Se usan para el combustible y el uso de los equipos, y para calcular qué parte del mes les ocupa este servicio.`
2. Hora-hombre (`info.id === 'manhour'`): en el `onValue` de `activity.unitsPerActiveDay` (línea 447), si hay personas cargadas, guardar `hoursPerActiveDay = HH por día ÷ personas`, sólo si el resultado está entre 1 y 24. La cuenta va en una función pura (`js/domain/unit-change.js` o `utilization-engine.js`), no en la pantalla. Personas = suma de `positions` de Personal. El campo queda visible con el resultado y se puede corregir.
3. `completeness-engine.js`, regla nueva `equipment_hours` (paso `modality`, estado "falta"): si `hoursPerActiveDay` es 0 o vacío y hay algún equipo propio con costo por hora y sin horas propias, o un externo por hora. Mensaje: `Faltan las horas de trabajo por día: sin ese dato no se suma el uso de {nombre del equipo}.` Foco en `activity.hoursPerActiveDay`. Es la red que hoy no existe.
4. `completeness-engine.js:434-436` (`labor_day_gap`) y `:409-410` (`labor_hours`): agregar al final del mensaje `Si el servicio no pide {H} h por día, corregilo en "Cómo se cobra".` Hoy sólo propone sumar gente.
5. Botones `[8 h] [9 h] [10 h] [12 h]` debajo del campo también en on call y en precio cerrado, reutilizando `shortcut` (`modality.js:157-170`). Hacen que el 10 se vea como una opción entre otras y no como algo ya contestado.

**Test.** `tests/engines/utilization-engine.test.js`: horas derivadas de 27 HH y 3 personas = 9; propuesta 71,6 %. `tests/engines/completeness-engine.test.js`: la regla `equipment_hours` salta con horas vacías y equipo por hora, y no salta si el equipo tiene horas propias.

**Riesgo.** Bajo. No cambia números guardados: el 10 guardado sigue en 10, ahora visible. La regla nueva baja la completitud de cotizaciones guardadas con horas vacías y equipos por hora, que hoy tienen costo de menos.

**Depende de:** V-03 (el punto 1 de V-03 limpia `unitsPerActiveDay`; el punto 2 de acá reacciona cuando se vuelve a cargar).

---

### V-01 · Dedicación "Sí" preseleccionada

**Qué pasa (reproducido por interfaz).** Cotización nueva, una persona y un camión, etapa "Cómo se cobra": el radio "Sí, sólo para este servicio" está marcado y `assignment` es `undefined` en las dos líneas. "Para revisar en este paso": nada. Hice clic en "Sí": sigue `undefined`.

Corrijo a los auditores en un punto: `applyDedicated` (`modality.js:829-836`) sólo cambia las líneas que estaban en "compartido". En una cotización nueva, elegir "Sí" no guarda nada. Por eso no alcanza con cambiar qué radio se muestra marcado.

**Impacto (motor).** Obra de trailers: $ 50.812.000 al 100 % contra $ 38.560.000 compartido. Válvulas: $ 29.885.000 contra $ 17.940.000.

**Corrección.**
1. `modality.js:810-811`. Contar las líneas con respuesta explícita y mostrar "Sí" sólo si hay alguna:
   - `explicitCount` = líneas con `assignment` de texto, no vacío y distinto de `'shared'`.
   - `dedicationValue` = `'no'` si todas están compartidas; `'yes'` si ninguna está compartida y `explicitCount > 0`; si no, `null` (ningún radio marcado).
   Exportar la cuenta como función pura (`dedicationChoiceOf(lines)`) para poder testearla.
2. `applyDedicated` (`:829-836`): escribir la respuesta en todas las líneas, no sólo en las compartidas. Personal: `'dedicated'`, salvo las que ya dicen `'hired'`. Equipos propios: `'reserved'`. No cambia ningún número: sin dato ya era 100 %.
3. Dentro de la tarjeta, debajo de las opciones, mientras `dedicationValue === null` y no haya líneas compartidas, un renglón de advertencia (`qe-note is-warning`) con el monto que ya calcula el aviso `fixed_costs_absorbed`:
   `Todavía no elegiste. Mientras tanto, este servicio paga todo el mes de tu gente y tus equipos: $ 10.124.827.`
   Sin monto disponible, la misma frase sin los dos puntos y el importe.
4. `js/engines/completeness-engine.js:1276`, final del mensaje `fixed_costs_absorbed`. Reemplazar "Si esta gente o estos equipos trabajan en otras obras, asignales un % compartido. RATEOS no lo aplica solo." por:
   `Si también hacen otros trabajos, elegí "No, también hacen otros trabajos" en "Cómo se cobra".`
5. Mismo aviso, FLUJO-NUEVO-B: no emitirlo cuando el contrato no es precio cerrado y la propuesta de dedicación da 100 % para todas las líneas (cuadrilla de lunes a viernes, 8 h). Hoy le dice "trabajás 20 de 30 días, asignales un % compartido" a quien trabaja el mes completo. Usar `serviceTimeSharePct`; si importarla desde `completeness-engine.js` arma un ciclo de imports, moverla a `js/domain/assignment.js`.

No hago las otras dos propuestas de los auditores: mostrar el aviso también en la lista "Para revisar" de la etapa 3 (el renglón del punto 3 ya lo dice donde se decide) y cambiar los rótulos de las opciones en precio cerrado.

**Test.** `tests/engines/plan-2026-025-recursos-primero.test.js`: `dedicationChoiceOf` con líneas sin dato da `null`; con una `'dedicated'`, `'yes'`; `computeQuote` da el mismo costo con `assignment` sin dato y con `'dedicated'`; el aviso no sale con 22 días × 8 h y sí con 12 días.

**Riesgo.** Bajo. Las cotizaciones guardadas sin elección pasan a verse "sin elegir", con el mismo precio. Una línea agregada después de contestar "Sí" no vuelve a preguntar (alcanza con que una línea tenga respuesta).

---

### V-11 · % de dedicación que queda viejo

**Qué pasa (motor).** Con 71,6 % cargado, pasar a 22 días × 8 h deja el 71,6: sugerida $ 1.157.000 contra $ 1.428.000 al 100 % (−19 %). La única señal es una nota gris con el botón "Usar 100 %".

**Causa.** `modality.js:861-875`: el desajuste sólo agrega el botón; la nota conserva la clase neutra. Que no se recalcule solo es regla (AGENTS §5.1) y no se toca.

**Corrección.**
- `modality.js:870`: cuando el % cargado difiere del propuesto en más de 5 puntos, la nota lleva `is-warning` y empieza con: `El % cargado ({cargado}) ya no coincide con los días y horas de ahora ({propuesto}).`
- `completeness-engine.js`: regla nueva `dedication_stale` (paso `modality`, estado "revisar"), con la misma condición y el mismo texto. Foco en el primer campo de %.

No incluyo el aviso de noches de alojamiento de TRAIL-10: no verifiqué que `logistics.lodgingDetail` guarde lo que dice el auditor.

**Test.** `completeness-engine.test.js`: salta con 71,6 cargado y 100 propuesto; no salta con 71,6 y 71,6.

**Riesgo.** Bajo. Baja la completitud de cotizaciones guardadas con ese desajuste. **Depende de:** V-01 (misma tarjeta) y V-04 (el % propuesto usa las horas por día).

---

### V-05 · Desplegable que se reabre; etiqueta de unidad vieja

**Qué pasa (reproducido por interfaz).** Elegí "$/hectárea": el campo quedó con foco, `aria-expanded="true"` y 30 opciones abiertas encima de "Hectáreas a facturar por mes". Hice un clic real del mouse en el centro de ese campo: la unidad guardada pasó a `meter`.

**Causa.** `js/ui/views/quote-editor.js:2750-2765` (`restoreFocusAnchor`) devuelve el foco al campo después de redibujar; `js/ui/components.js:523-528` abre la lista en todo foco; `components.js:491` elige con `mousedown`.

**Corrección.**
- `quote-editor.js`, `restoreFocusAnchor`, antes del `el.focus(...)`: `if (el.getAttribute('role') === 'combobox') return;`
- Etiqueta: `quote-editor.js:2148` calcula `unitLabel` una sola vez. Guardar la referencia al `span` y, en `refreshAll`, hacer `span.textContent = billingUnitOf(state.quote).label`.

**Test.** No hay tests de DOM en el repo. Agregar el caso a `tests/lab/e2e/ui-lab.mjs`: elegir una unidad y comprobar `aria-expanded="false"` y el texto de la etiqueta.

**Riesgo.** Bajo. Con teclado, después de elegir una unidad el foco no vuelve al selector. Probar Tab y flechas.

---

### V-06 · Seguro, patente y vianda escondidos

**Qué pasa.** Pickup con seguro, patente, otros y certificaciones en 0: costo $ 6.938.516 contra $ 7.743.601, sugerida $ 8.382.000 contra $ 9.388.000 (−10,7 %), completitud 100 % sin pendientes (motor). Sin viandas en una cuadrilla: −$ 1.874.471 de costo (−8,4 %). Por interfaz: el campo de seguro no se ve sin abrir "Opciones avanzadas" y el paso Equipos no avisa.

**Causa.** Campos en `js/ui/views/quote-steps/equipment.js:731-733` y `labor.js:465`, dentro de `kit.advanced`. `completeness-engine.js` (regla `equipment_cost`) sólo pide valor de reposición y vida útil.

**Corrección.**
1. `equipment.js`: sacar "Seguro anual" y "Patente anual" de `kit.advanced` a la grilla principal del equipo propio, después de "Vida útil". El resumen del desplegable (líneas 713-714) deja de nombrarlos.
2. `labor.js:465`: sacar "Vianda o comidas por día activo" a la grilla principal del puesto. Rótulo nuevo: `Vianda o comidas por día`.
3. `completeness-engine.js`, regla nueva `equipment_insurance` (paso `equipment`, estado "revisar"): equipo propio que "se traslada por sus propios medios" (`mobilization.mode === 'self'`), con valor de reposición mayor que 0 y con seguro y patente en 0. Mensaje: `"{nombre}" no tiene seguro ni patente cargados. Si los pagás, cargalos: son costo aunque no trabaje.` Foco en `equipment.N.insuranceAnnual`.
   Sólo para vehículos que circulan: un generador o una herramienta sin seguro es normal y no hay casilla "no aplica" que agregar.
4. Sin regla para la vianda: puede darla el cliente. Alcanza con que el campo se vea.

**Test.** `completeness-engine.test.js`: salta para un vehículo `self` con los dos en 0; no salta con uno cargado ni para un equipo que no circula.

**Riesgo.** Bajo. No cambia precios. Baja la completitud de cotizaciones guardadas con un vehículo sin seguro ni patente. Revisar tests que busquen esos campos dentro de `details`.

---

### V-07 · Insumos "por unidad producida"

**Qué pasa (motor).**
- Herbicida con "4 hectáreas por día" en la línea y 6 por día en "Cómo se cobra": costo $ 10.870.189 y sugerida $ 191.000 por hectárea. Con un solo número (6): $ 12.943.295 y $ 229.000. Sin aviso.
- Cobrando por día, insumo "por unidad producida" sin unidad escrita: cuenta 1 por día. Costo $ 7.760.531 contra $ 10.870.189 con 4 hectáreas por día. Completitud igual (98 %), sin pendiente.

**Causa.** `js/engines/materials-engine.js:71-75`: la producción de la línea gana. `cost-engine.js:85-95`: día = 1, hora = horas por día. `completeness-engine.js:599-609`: el pendiente "Producción por día" lleva siempre al campo de la línea.

**Corrección (sólo avisos; no cambia el motor).**
1. `completeness-engine.js`, junto a `materials_output`, regla `materials_output_mismatch` (paso `materials`, "revisar"): línea con `outputPerActiveDay` propio, cuya unidad es la de cobro (`outputMatchesBilling`), unidad de cobro por cantidad, y valor distinto de `activity.unitsPerActiveDay`. Mensaje: `"{material}" usa {a} {plural} por día y en "Cómo se cobra" cargaste {b}. Dejá un solo número: borrá el de acá para que siga al otro.` Foco en el campo de la línea.
2. Regla `materials_output_unit` (paso `materials`, "revisar"): línea `per_output` a cargo propio, con costo y cantidad, sin `outputUnit` ni `outputPerActiveDay`, y unidad de cobro día u hora. Mensaje: `"{material}" está por unidad producida y cobrás por {día|hora}: se cuenta {n} por día. Si es por hectárea, válvula o metro, escribí la unidad y cuántas hacés por día.` Foco en `materials.N.outputUnit`.
3. `completeness-engine.js:606`: si la unidad de la línea es la de cobro, el foco del pendiente "Producción por día" pasa a `activity.unitsPerActiveDay` y el mensaje termina en `cargalo en "Cómo se cobra".`
4. `js/ui/views/quote-steps/materials.js:251-253` y `:258`: cuando la unidad de cobro es día u hora y la línea no tiene unidad, no mostrar "día/día"; el texto de ayuda pasa a `Escribí qué producís (hectárea, válvula, m²). Si después cobrás en esa unidad, el rendimiento se carga una sola vez, en "Cómo se cobra".`

**Test.** `materials-engine.test.js` o `completeness-engine.test.js`: los dos avisos con los casos de arriba, y que no salten con la línea vacía cobrando por hectárea.

**Riesgo.** Bajo. No cambia precios. Baja la completitud de las guardadas con esos dos estados. **Relación con V-03:** el punto 4 de V-03 escribe unidad y rendimiento en la línea; si el usuario vuelve a la unidad original y cambia el rendimiento, la regla 1 de acá lo avisa.

---

### V-08 · El aviso recomienda "1,33 días por llamado"

**Qué pasa (motor).** 6 trailers, 0,75 por día, 1 día por llamado: $ 22.119.000 por trailer. Con 8 días por llamado (una sola ida): $ 6.427.000. Con el 1,33 que recomienda el aviso: $ 17.669.000.

**Causa.** `js/engines/quote-engine.js:222`.

**Corrección.** Reemplazar el final del mensaje ("Si cada … es un llamado, cargá … días por llamado.") por:
`Si es una sola ida para {cantidad} {plural}, cargá {cantidad ÷ por día} días {por llamado}. Si cada {singular} es una salida distinta, cargá {1 ÷ por día}.`
Los dos valores salen de datos ya cargados. Además, `modality.js:710-720`: mostrar "¿Cómo son los llamados?" fuera de "Opciones avanzadas" cuando la unidad es por cantidad y salta este aviso.

**Test.** `quote-engine.test.js`: el mensaje contiene "8 días" y "1,33" para el caso de los trailers.

**Riesgo.** Nulo en números.

---

### V-09 · Avisos de adicionales en la etapa 1

**Qué pasa (reproducido por interfaz).** Hora al 50 % con precio a mano $ 5.000 y 10 h: en "Cómo se cobra" no aparece nada; en "El servicio" aparece "PARA REVISAR EN ESTE PASO: … se cobra por debajo de su costo".

**Causa.** `js/ui/field-links.js:36-68` (`stepOfPath`) no conoce el prefijo `extras` y devuelve `'service'`.

**Corrección.**
- `field-links.js`: agregar `case 'extras': return 'modality';`.
- `js/ui/views/quote-result.js:1147-1153`: los avisos con ruta `extras.*` no van bajo "Los cálculos reemplazan los valores inválidos por 0…", que para ellos es falso. Listarlos aparte con el encabezado `Adicionales para revisar:`.
- `modality.js` (fila de la hora, bajo "Tu precio por hora"): si el precio a mano es menor que la hora normal de referencia, `Queda más barata que tu hora normal ({hora normal}).`

**Test.** `tests/ui/`: `stepOfPath('extras.0.price') === 'modality'`.

**Riesgo.** Bajo. Verificar que los adicionales comunes (no de fuera de horario) también se editan en "Cómo se cobra"; si su pantalla es otra, apuntar a esa.

---

### V-10 · Días por trabajo vacíos = 1 día

**Qué pasa (motor).** Con `daysPerActivation` vacío: 1 día, costo $ 29.093.693, sugerida $ 36.368.000 (−5,7 %), completitud 96 % igual que antes.

**Causa.** `cost-engine.js:119-120` toma 1; `completeness-engine.js:244-253` sólo exige la cantidad por mes.

**Corrección.** `completeness-engine.js:245-251`: para unidades por evento, exigir `daysPerActivation` mayor que 0. Estado "falta". Mensaje: `Faltan los días que lleva cada {trabajo|llamado}: se está calculando con 1 día.` Foco en `activity.daysPerActivation`.

**Test.** `completeness-engine.test.js`.

**Riesgo.** Bajo. Las cotizaciones nuevas nacen con 1 (`quote-factory.js:229`), así que sólo afecta a quien borró el campo.

---

### V-12 · "Tus tarifas" incompleto

**Causa.** `quote-result.js:1840-1859` (`tariffsBlock`): sólo aparece si hay horas fuera de horario, guardia o plus, y no lista nada más.

**Corrección.**
- Mostrar el bloque también cuando hay mínimo por llamado, mínimo garantizado o adicionales con precio.
- Filas nuevas, con datos que ya están en `rules` y `r.extras.lines`:
  - `Mínimo por llamado` → `{n} {horas|días|unidad} por llamado`
  - `Mínimo garantizado por mes` → `{n} {plural}` o el monto
  - Una fila por cada adicional no derivado con precio: `{nombre}` → `{precio} por {unidad}`
- Subtítulo del margen cuando el ajuste al mínimo es mayor que 0: `Incluye {monto} del mínimo garantizado (estimás {a}, se facturan {b}).`

**Test.** Exportar la lista de filas como función pura y testearla en `tests/ui/result-text.test.js`.

**Riesgo.** Nulo en números. **Hacer antes que** V-26, V-32 y V-38.

---

### V-13 · Mínimo por llamado en km

**Qué pasa (motor).** $/km, 240 km por día, mínimo 300: con 2.880 km y con 3.600 km queda el pendiente `route_consistency` y la cotización en borrador (98 %); sin mínimo, 100 %.

**Corrección.**
- `js/ui/views/quote-steps/margin.js:464`. Con unidad por cantidad, en lugar de "Se está aplicando: suma unidades facturables.": `Se está aplicando: cada llamado factura {mínimo} {plural} aunque haga {reales}. Tus {cantidad} {plural} por mes son {llamados} llamados.`
- `completeness-engine.js:826`: cuando rige el mínimo por llamado, comparar los km de la ruta contra los km trabajados (llamados × días por llamado × km por día), no contra los facturados.

**Test.** `completeness-engine.test.js`: sin pendiente con 3.600 km y mínimo 300.

**Riesgo.** Bajo. Sube la completitud de las guardadas afectadas (98 → 100).

---

### V-14 · "Sin contar adicionales" mayor que la sugerida

**Qué pasa (motor).** Piso $ 1.230.717; "sin contar adicionales" $ 1.791.777 por día; sugerida $ 1.565.000.

**Causa.** `js/engines/commercial-rules-engine.js:362-370`: quita los otros ingresos pero deja el costo de las horas fuera de horario ($ 6.323.147 con carga).

**Corrección.** `floorWithoutOtherRevenue(rates, { extrasLoadedCost })`: restar ese costo de `totalCost`. En `quote-result.js:470`, pasar la suma de `loadedCost` de `r.extras.lines`. Da $ 1.318.842, que coincide con quitar las líneas.

**Test.** `commercial-rules-engine.test.js`.

**Riesgo.** Bajo. Es un dato informativo; no entra en ninguna tarifa.

---

### V-15 a V-25 · Limpieza (todas S, ninguna cambia números)

| V-ID | Archivo y línea | Cambio | Test |
|---|---|---|---|
| V-15 | `js/ui/views/quote-steps/indirect.js:69` | Agregar `'external'` a `DIRECT_CATEGORIES`. En la ayuda (`:292`), sumar "y proveedores" | Exportar la base y compararla con la del modelo |
| V-16 | `modality.js:777-780` | Con fijo y variable: `{fijo} por mes + {variable} por día`. Hoy muestra uno solo | Función pura de texto en `tests/ui/` |
| V-17 | `js/ui/views/quote-steps/extras.js:20-24` | Con fuera de horario activo, no ofrecer "Feriado o fin de semana" ni "Llamado fuera de horario". Texto: `Feriados y fuera de horario ya se cotizan arriba, con la hora al 50 % y al 100 %.` | Función que devuelve los botones |
| V-18 | `equipment.js:1059` | Con tarifa fija mensual, usar `cashFixedMonthly`: `Salida de caja con impuestos: {monto} por mes` | Texto en `tests/ui/audit-ui.test.js` |
| V-19 | `js/domain/billing-units.js:130` | En `fold`, reemplazar ² por 2 y ³ por 3. Palabras clave: `m3` "metro cubico volumen tanque"; `m2` "metro cuadrado superficie" | `tests/engines/billing-units.test.js`: "m3" trae `$/m³` primero; "m2" trae `$/m²` |
| V-20 | `js/domain/quote-factory.js:576` | `fuel` sólo si algún equipo o vehículo consume combustible a cargo propio (la condición que ya usa la completitud) | Test de `illustrativeInfo` |
| V-21 | `quote-factory.js:452` | Sólo en la línea en blanco nueva: `providedBy: 'contractor'`. No tocar la normalización de líneas guardadas | Test de la fábrica |
| V-22 | `js/engines/mobilization-engine.js:90` | No agregar el aviso `driver` cuando no se eligió. El campo queda, opcional. Actualizar la línea 538 de `CALCULATION_RULES.md` | `completeness-engine.test.js`: sin pendiente con conductor sin definir |
| V-23 | `js/ui/views/quote-steps/logistics.js:216-218` | Equipo externo con consumo por km: no mostrar "Consumo en ruta". Texto: `El combustible de la ruta ya está en el consumo del alquiler.` | — |
| V-24 | `service.js:258` | Al pasar a "Por servicio prestado" sin unidad que encaje, usar `'day'` (como la cotización en blanco) en vez de la primera de la lista | Test de la unidad elegida |
| V-25 | `labor.js:194`, `equipment.js:473`, `materials.js:379` | Sin recursos cargados, ocultar el selector y su botón "Agregar"; el botón principal pasa a ser "Agregar … en blanco" | — |

V-22: no encontré ningún cálculo que use el conductor elegido (`mobilization-engine.js:88-90` sólo lo guarda y avisa). No busqué en todo el repo si otro control lo lee; hacerlo antes de tocar.

---

### Sólo texto o aviso

#### V-26 · Hora fuera de horario cuando no se cobra por hora ni por día

**Qué pasa (motor).** Misma cotización:

| Unidad | Hora normal de referencia | Hora al 50 % | Hora al 100 % |
|---|---:|---:|---:|
| $/hora | 228.000 (de la tarifa) | 266.724 | 305.448 |
| $/viaje y $/km | 88.758 (de los recursos) | 127.482 | 166.206 |
| Cuadrilla $/día | 173.889 | 227.747 | 281.605 |
| Cuadrilla $/hora-hombre | 138.976 | 192.834 | 246.692 |
| $/hectárea | 60.392 | 83.551 | 106.710 |

Es la regla escrita en `CALCULATION_RULES.md` §24 ("abono, cerrado, por unidad"). El defecto es que la pantalla no dice para qué sirve esa hora, y con hora-hombre mezcla "por hora-hombre" con "por hora de toda la cuadrilla".

**Corrección (sin tocar el motor).**
- `modality.js:936-941`, nota de la tarjeta, cuando `normalHourSource === 'resources'`. Reemplazar el final "Se cobra aparte de la tarifa." por:
  `Es el precio de cada hora que trabajás fuera de horario además de {los viajes|las unidades|el abono} que cotizaste. No reemplaza {al viaje|a la unidad}: si un {viaje|trabajo} entero cae fuera de horario, cobrá {el viaje|la unidad} más el recargo de {recargo} por hora.`
  El recargo ya viene calculado (`surchargePrice`).
- Con hora-hombre, en `modality.js` y en `quote-result.js:1853`: `por hora de toda la cuadrilla ({n} personas)` en lugar de `/ hora`.
- `modality.js:903-908`: el rótulo "Te cuesta por hora (gente + equipos)" pasa a "Te cuesta por hora (gente)" cuando `equipmentPerHour` es 0. Si algún equipo propio se traslada por sus medios, agregar a la ayuda: `No incluye combustible ni desgaste en ruta: si en esas horas se viaja, cobralos como km o como viaje.`
- Debajo de "Horas estimadas por mes" (CUAD-02): `Si son jornadas enteras en días que no ibas a trabajar, la vianda y el viaje de ese día no se suman solos.`

**Test.** Función pura del texto de la nota. **Riesgo:** nulo. **Después de** V-12.

#### V-27 · Horas fuera de horario "además" de las normales

**Lo que verifiqué.** El caso A del auditor me da igual: $ 309.000, margen 24,87 %, equilibrio 2,01 días. Sus casos B1 y B2 no me dan los mismos números ($ 387.000 contra $ 604.000 y $ 378.000) porque la cotización que dejó guardada ya tiene mínimo de 4 h; no los doy por reproducidos. La regla ("las horas estimadas no abaratan la tarifa principal") sí está escrita en §24.

**Corrección.**
- `modality.js:923`, ayuda de "Horas estimadas por mes": agregar `Son horas además de las {n} horas normales por mes que cargaste arriba.`
- `quote-result.js`, bajo el margen, cuando hay horas fuera de horario estimadas: `Incluye {monto} de ganancia de las horas fuera de horario, si ocurren.`
- `quote-result.js`, bloque del equilibrio: `Cuenta {monto} de horas fuera de horario como si se facturaran aunque trabajes menos días.`

GUAR-NUEVO-A (el mínimo por llamado sólo mira las horas normales): lo leí en `commercial-rules-engine.js:150-151` y es así. No propongo cambio: queda cubierto por la primera frase.

#### V-28 · Guardia que cubre todo

**Qué pasa (motor).** Guardia pasiva de $ 25.000.000: piso $ 0, sugerida vacía, margen vacío; el motor calcula facturación $ 28.614.663 y resultado $ 9.738.388. Con $ 18.000.000 la hora normal sugerida es $ 8.940.

**Corrección.** `quote-result.js:1639`, `:1652` y `:1691`: cuando `ratesAtEstimate.floorCoveredByOtherRevenue` es verdadero, en lugar de "aparece cuando haya costos y días activos cargados" y "Definí una tarifa…":
`La guardia y los adicionales ya cubren tu costo y tu margen: la tarifa por {unidad} puede ser la que acuerdes.`
Y mostrar el margen del mes desde `r.estimate` (ya calculado). Mismo texto como advertencia cuando la sugerida queda por debajo del costo por hora de los recursos.

#### V-29 · Standby con días

**Qué pasa (motor).** 1 día en espera a $ 1.850.000 baja la sugerida de $ 38.560.000 a $ 36.908.000 y deja el piso ($ 30.788.287) por debajo del costo ($ 31.006.373). Con 0 días y sólo la tarifa, no cambia nada. Es la regla escrita (§3 y §12).

**Corrección.** `margin.js:490-492`, agregar a la línea de salida cuando los días son mayores que 0:
`Estos días se cuentan como ingreso seguro y bajan tu tarifa principal. Si la espera es eventual, dejá los días en 0 y cargá sólo la tarifa.`
En precio cerrado, no mostrar "Equipo en espera" cuando está vacío. `completeness-engine.js:1009` (pendiente de standby): agregar la segunda frase al mensaje.

#### V-30 · "No usa combustible" en un vehículo que viaja

**Qué pasa (motor).** Marcar la casilla en la camioneta baja el costo de $ 22.351.803 a $ 21.309.184 (−4,7 %). Es regla (INV-30, LAB-D5).

**Corrección.**
- `equipment.js:684-687`: ayuda sin marcar: `Acoplado, eléctrico o herramienta. Si es un vehículo con motor, no lo marques: poné 0 en el consumo en la locación.` Sacar "estacionario".
- `logistics.js:216`: cuando el equipo es propio, viaja por sus medios y tiene la marca, mostrar en lugar del campo: `Marcaste "No usa combustible": el viaje no suma gasoil. Si es un vehículo con motor, desmarcalo.`
- `completeness-engine.js`: aviso informativo (no resta puntaje) con la misma frase, en Equipos y en el Resultado.

#### V-31 · Peajes por llamado

**Qué pasa (motor).** De 1 a 2 viajes por día: sugerida $ 776.000 contra $ 804.000, porque los peajes siguen al llamado y no al viaje. Regla escrita (§6).

**Corrección.** `logistics.js`, bajo "Peajes por llamado", con unidad "viaje" y más de 1 viaje por llamado: `Son los peajes de los {n} viajes del llamado.`

#### V-32 · "Guardia activa" con dos significados

**Corrección.** Un nombre para cada cosa, en las tres pantallas (`modality.js:963` y `:970`, `margin.js:422-433`, `quote-result.js:1854-1855` y `:3404-3425`):
- `Fijo por mes por estar de guardia`
- `Plus por cada salida`

"Activa" y "pasiva" quedan sólo para "Tipo de guardia". Actualizar la línea de §24 que cita los rótulos. **Riesgo:** tests que comparan textos.

#### V-33 · Textos sueltos

| Origen | Archivo y línea | Texto nuevo |
|---|---|---|
| TRAIL-08 | `finance.js:135` | `Capital de trabajo: {monto} (lo que pagás antes de cobrar, por los meses que esperás)` en lugar de "Adelantás … hasta cobrar" |
| CUAD-06 | `modality.js:871` | `…les ocupa {h} h por mes: el {pct} de sus {normales} h normales.` |
| GUAR-08 | `modality.js:387-388` | `(de 8 a 17 con una hora de almuerzo = 8 h)` |
| TRAIL-04 | `equipment.js`, ayuda de "Por día" | Agregar: `Si lo usás menos días que los del trabajo, elegí "Por trabajo" y cargá el total.` |
| TRAIL-06 | `quote-result.js:2113-2118` | Junto a "Total del contrato (12 meses)": `Si es un trabajo único, poné 1 mes en "El servicio".` |
| FLUJO-03 | `equipment.js:734-735` | `Otros por año (RTO, GPS, habilitaciones)` y `Certificaciones por año` |
| CUAD-12 | Campo de % de dedicación | Ayuda: `Vacío = 100 %.` |

---

## 4. Decisiones para Joaco

### V-34 · Hora-hombre: ¿la hora normal sale de la tarifa?

**Pregunta.** Cobrando por hora-hombre, ¿la hora fuera de horario parte de la tarifa (× personas), como cuando se cobra por hora?

**Opciones.** (a) Sí: hora normal de cuadrilla = tarifa por HH × personas. (b) Dejar como está y sólo aclarar el rótulo (V-26).

**Impacto.** Cuadrilla de 3 a $ 58.000 por HH: la hora al 50 % pasa de $ 192.834 a $ 227.858 por hora de cuadrilla, igual que la misma cuadrilla cobrada por hora. Con 36 h por mes son $ 1.260.000 de facturación. La tarifa principal no cambia.

**Por qué es decisión.** Sube el precio sugerido de fuera de horario en cotizaciones guardadas por hora-hombre y cambia el alcance de §24.

**Recomendación: (a).** La regla de §24 excluye las unidades que no se pueden pasar a horas; la hora-hombre sí se puede. Hoy la misma cuadrilla tiene dos precios de hora extra según cómo se cobre. La función tiene pocos días de publicada.

### V-35 · Viaje, km o unidad: ¿qué se publica fuera de horario?

**Pregunta.** Cobrando por viaje, km o unidad producida, ¿se publica una "hora fuera de horario" completa o sólo el recargo por hora?

**Opciones.** (a) Dejar la hora completa y explicar con texto (V-26). (b) Publicar el recargo: "recargo por hora fuera de horario $ 38.724; los viajes hechos en esas horas se cobran igual". (c) Calcular la hora normal desde la tarifa (tarifa × unidades por día ÷ horas por día).

**Impacto.** Semirremolque por viaje, sábado de 9 h con un viaje: si el cotizador cobra sólo 9 h al 100 % ($ 1.495.857) pierde $ 262.051; si cobra el viaje más 9 recargos, gana $ 928.469, igual que la misma cotización por hora (cuentas del auditor; yo reproduje las tarifas, no el sábado completo). Cobrando por hectárea y produciendo en esas horas, cada hora cobra $ 83.551 y no incluye el herbicida.

**Por qué es decisión.** (b) y (c) cambian la tarifa principal de cotizaciones guardadas con horas estimadas, y cambian §24.

**Recomendación: (a) ahora, (b) en la tanda siguiente.** (b) es la única lectura que nunca pierde plata. (c) no: depende de las horas por día, que hoy vienen en 10 (V-04), y en unidades con materiales infla la hora.

### V-36 · ¿Las horas fuera de horario estimadas abaratan la tarifa principal?

**Pregunta.** Si estimás horas fuera de horario, ¿la tarifa normal baja porque esas horas dejan ganancia?

**Opciones.** (a) No, como hoy (§24): cuentan sólo por lo que cubre su costo. (b) Sí: resolver todo junto para llegar justo al margen objetivo.

**Impacto.** Guardia cargada con 30 h normales y 15 fuera de horario: hoy sugiere $ 309.000 la hora normal y el mes cierra en 24,87 % en vez del 15 % pedido (reproducido). Con (b), según la cuenta del auditor, la hora normal quedaría cerca de $ 355.000 si las horas se cargan como pide el rótulo, y el mes cerraría justo en 15 %. Esa segunda cifra no la reproduje.

**Recomendación: (a), no cambiar.** La regla protege al que estima horas que después no ocurren. Con los textos de V-27 el usuario ve de dónde sale el margen de más.

### V-37 · ¿La tarifa piso depende del margen objetivo?

**Pregunta.** ¿El "precio mínimo para no perder" tiene que ser el mismo con cualquier margen objetivo?

**Impacto (motor).** Con adicionales de precio sugerido, el piso es $ 191.958 con margen 0 %, $ 188.198 con 15 %, $ 182.702 con 30 % y $ 169.675 con 50 %. Sin adicionales no se mueve.

**Opciones.** (a) Dejar. (b) Para el piso, valuar los adicionales sugeridos sin margen: el piso queda en $ 191.958 siempre (+2 % sobre hoy).

**Recomendación: (b), sin apuro.** Nadie pierde plata hoy (el equilibrio real está en $ 164.690), pero el concepto está torcido. Sube un poco el piso de cotizaciones guardadas: una tarifa a mano pegada al piso puede pasar a verse "bajo piso".

### V-38 · ¿Se redondean las horas fuera de horario?

**Pregunta.** La hora normal sale redondeada ($ 309.000) y las de fuera de horario no ($ 354.822). ¿Se redondean igual?

**Impacto.** Hasta un paso de redondeo (menos de $ 1.000 por hora) en la cifra publicada de cotizaciones guardadas. No cambia el costo.

**Recomendación: sí,** hacia arriba, sólo al mostrar y sólo cuando el precio es el sugerido. Avisar en el CHANGELOG.

### V-39 · ¿Con cuántas horas nace una cotización nueva?

**Pregunta.** Hoy toda cotización nace con 10 horas por día. ¿Se deja, se cambia o nace vacía?

**Impacto (motor, `e5.mjs`).** Servicio cobrado por hora, misma cotización: con las 10 h precargadas la sugerida es $ 114.000 por hora; con la jornada real de 9 h, $ 121.000 (el 10 cotiza 5,8 % de menos); con 8 h, $ 130.000 (12,3 % de menos). En este caso el campo está a la vista, pero ya viene lleno y se pasa de largo.

**Opciones.** (a) Dejar 10 y hacerlo visible con botones (V-04). (b) Que nazca vacía con un pendiente en rojo. (c) Otro número.

**Recomendación: (a) ahora; (b) después de V-04.** (b) sólo es segura cuando exista la regla `equipment_hours`; hoy, con horas vacías, el uso de equipos desaparece sin aviso. (c) no: cualquier número es inventar la jornada. No cambia cotizaciones guardadas en ningún caso.

---

## 5. Descartados y no verificados

### No hacer

| V-ID | Qué pedía | Motivo |
|---|---|---|
| V-56 | Que la guardia no baje la hora fuera de horario (SEMI-02) | Es la regla: hora normal de la lista más recargo. Nunca queda bajo costo. Lo que pide el tester daría "hora normal $ 181.000, hora al 50 % $ 266.724", más difícil de defender ante el cliente |
| V-57 | Preguntar cuántas personas salen fuera de horario (SEMI-07) | Pregunta nueva por $ 19.000 por hora, y roza los relevos (fuera de alcance). La salida existe: precio a mano |
| V-58 | Llevar unidad, días y horario a la etapa 1 (FLUJO-15) | Contradice el diseño "recursos primero" (PLAN-2026-025) u obliga a preguntar dos veces |
| V-59 | Costo financiero 0 mientras no haya plazo (FLUJO-06) | Contradice §9, baja precios guardados y la pantalla ya lo avisa arriba de todo |
| V-60 | Preguntas nuevas: "¿cuántas de las horas son fuera de horario?", "¿son jornadas enteras?", "¿cómo medís su uso?", "¿trabajo único o se repite?", "horas por viaje" | Cada una agrega un dato y una rama de cálculo. Los textos de V-26, V-27 y V-33 resuelven lo mismo |
| V-61 | Residual, EPP y neumáticos a la vista (FLUJO-03) | Residual en 0 encarece (+2,1 %): error del lado seguro. EPP es 1 % del costo. Alargan la ficha |
| V-62 | Multiplicar peajes por viajes; que el standby no baje la tarifa; % de dedicación por días hábiles | Cambian reglas escritas y números guardados sin que el resultado sea más correcto en todos los casos. Se cubren con V-31, V-29 y V-33 |

### Incorrecto (error del tester)

| V-ID | Qué decía | Qué es |
|---|---|---|
| V-63 | Días 0, margen 100 o % 150 se rechazan sin mensaje (TRAIL-12, CUAD-12) | Hay mensaje en rojo bajo el campo: "…Se restauró el valor anterior." (`js/ui/components.js:352-359`). Lo leí en el código; no lo corrí. Queda sin verificar la parte de CUAD-12 que dice que 150 y −5 dejan el campo vacío |
| V-64 | Las horas fuera de horario se cuentan dos veces (GUAR-01) | El tester cargó las 5 h del llamado como normales y además 15 h fuera de horario: son 45 h trabajadas y 45 cobradas. El rótulo dice "horario normal". Lo que sí vale está en V-27 y V-36 |
| V-65 | "La app no avisa" | LOGI-04: hay aviso en la tarjeta del equipo (`logistics.js:241-250`). LOGI-05: hay pendiente en rojo con foco en el campo. TRAIL-05: hay aviso (lo vi con el motor), aunque recomienda mal (V-08). SEMI-11: la vianda está en la ayuda del dato |
| V-66 | Las 10 h ocultas "no cambian la tarifa" (CUAD-03) y mueven 1,9 % (FLUJO-05) | Cambian el costo: +7,9 % con dedicación compartida, +12,3 % con un alquilado por hora |

### Sin veredicto

| V-ID | Qué | Por qué |
|---|---|---|
| V-67 | Celular (TRAIL-16, SEMI-14) | No corrí nada en celular. Ningún auditor lo reprodujo tampoco |
| V-68 | Materiales facturados aparte con recargo (TRAIL-17) | No reproducido por nadie más que el tester |
| V-69 | GUAR-09: material al 100 % con gente al 17 %; plus con $/llamado; uso de la pickup como "Mano de obra"; aviso de distancia que sobra. CUAD-12: camión con hidrogrúa; tramo "+30 días con 31" | Ni el auditor ni yo los revisamos |

### Otras cosas que no verifiqué

- Impresión, PDF, duplicar y reabrir.
- El caso de LOGI-09 con 15 km de distancia (100 % de completitud y −22,6 %).
- Los conteos de clics y de campos del informe FLUJO.
- Que `logistics.lodgingDetail` guarde personas y noches (base del aviso de alojamiento de TRAIL-10).
- La etiqueta de unidad vieja en pantalla: mi script no la capturó en el momento del cambio; la causa está leída en `quote-editor.js:2148`.
- LOGI-03 por motor: no logré activar las horas fuera de horario sobre el estado guardado del tester; la misma raíz quedó reproducida con SEMI-01, CUAD-01 y UNID-03.
- Los números de línea de `completeness-engine.js` que cito con rango amplio pueden correrse unas líneas.

---

## 6. Conteo

| Veredicto | Ítems |
|---|---:|
| Correcto: corregir ya | 25 |
| Por diseño: sólo texto o aviso | 8 |
| Correcto: decisión de Joaco | 6 |
| Correcto: después | 16 |
| No hacer | 7 |
| Incorrecto (error del tester) | 4 |
| Sin veredicto (no verificado) | 3 |
| **Total** | **69** |

Verificación de los 39 ítems que generan trabajo o decisión (V-01 a V-39): 24 reproducidos por mí (6 con una corrida propia por la interfaz, el resto con el motor) y 15 sólo leídos en el código. De esos 15, uno es de severidad media (V-12) y los demás, baja o baja-media. Todos los de severidad alta o media-alta están reproducidos.
