# Marca RATEOS

Guía corta de identidad. El análisis completo (mercado, público, nombre) lo tiene el dueño en el informe de marca de 2026-11-15.

## Nombre

**RATEOS**, siempre en mayúsculas en textos. Viene de *rate* (tarifa) y coincide con *prorrateo*: la app reparte los costos del mes en cada unidad que se cobra. El nombre solo no explica qué hace, así que hacia afuera va acompañado.

- Frase de marca: "Sabé cuánto te cuesta. Definí cuánto cobrar."
- Descriptor: "Costos y precios para servicios y productos".
- Evitar hacia afuera: "motor", "determinístico", "pricing", "break-even".

## Logo

Monograma R plano. El cuerpo azul marino es el costo; la pata naranja es el margen, la pieza que convierte el costo en precio. Logotipo en Archivo ExtraBold (Omnibus-Type, Argentina, licencia OFL) convertido a trazados: no depende de fuentes instaladas.

| Archivo | Uso |
| --- | --- |
| `assets/favicon.svg` | Ícono con fondo (pestaña del navegador, accesos directos) |
| `assets/brand/rateos-mark.svg` | Isotipo sin fondo, sobre claro |
| `assets/brand/rateos-wordmark.svg` | Logotipo solo |
| `assets/brand/rateos-logo.svg` | Isotipo + logotipo, horizontal |
| `*-white.svg` | Sobre fondos oscuros |
| `*-mono.svg` | Una tinta (sellos, fax, grabado) |

En la app se aplica por CSS (`.brand-mark`, `.brand-name`, `.pub-brand-mark`, `.pub-brand-name`, `.fatal-brand-name`); el texto del HTML queda para alto contraste.

## Colores

| Color | Valor | Uso |
| --- | --- | --- |
| Azul marino | `#003B73` | Color principal de marca y de la interfaz |
| Naranja de marca | `#E2711D` | **Sólo en el logo.** Nunca en la interfaz |
| Ámbar de avisos | `#E89B32` | Avisos de la interfaz. No es color de marca |

## Reglas

- Sin degradés, sombras, contornos ni bajada pegada al logo.
- No deformar ni recolorear. Espacio libre alrededor: el ancho del asta de la R.
- Tamaño mínimo del isotipo sin fondo: 18 px. Más chico, usar el ícono con fondo.
