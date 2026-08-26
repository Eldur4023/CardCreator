# CardCreator

Editor de cartas tipo Magic. El motor es `public/js/editor.js` sobre canvas;
el backend (`server.py`) sirve la app y expone un render headless que conduce
ese mismo `editor.js` en Chromium, así que no hay un segundo renderer que
mantener sincronizado.

## Instalación

```
py -m pip install flask playwright
py -m playwright install chromium
```

`playwright` solo hace falta para el render; el servidor arranca sin él.

## Arrancar

```
run.bat        (Windows)   ·   ./run.sh   (Linux)   ·   py server.py
```

→ http://localhost:3000

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/frames` | Árbol de marcos de `assets/img/frames` |
| GET | `/api/library` | Cartas guardadas |
| POST | `/api/library` | Guarda una carta (al principio). Si no trae `id`, se genera |
| PATCH | `/api/library/<id>` | Renombra |
| DELETE | `/api/library/<id>` | Borra |
| GET | `/api/decks` | Mazos |
| POST | `/api/decks` | Crea mazo (`{"name": "..."}`) |
| DELETE | `/api/decks/<id>` | Borra mazo |
| PUT | `/api/decks/<id>/cards/<cardId>` | Añade carta al mazo |
| DELETE | `/api/decks/<id>/cards/<cardId>` | Quita carta del mazo |
| POST | `/api/render` | Spec de carta → PNG |

## Render

```
py render.py cartas.json -o salida/     # lote
py render.py --demo                     # tres cartas de muestra
```

O por HTTP:

```
curl -X POST localhost:3000/api/render -H "Content-Type: application/json" \
     -d '{"name":"Truco","mana":"{R}","type":"Instantáneo","rules":"Hace 3 de daño."}' \
     --output truco.png
```

Manda una lista en vez de un objeto y responde JSON con los PNG en base64.
Primera llamada ~1,4 s (arranca Chromium); las siguientes ~350 ms, porque el
navegador se queda caliente en un hilo propio.

### Spec

Solo `name` es obligatorio.

```json
{
  "name":      "Cremación Ritual",
  "mana":      "{B}{R}",
  "type":      "Instantáneo — Piromancia",
  "rules":     "Exilia la criatura objetivo.\nRoba una carta.",
  "pt":        "3/4",
  "art":       "C:/ruta/al/arte.jpg",
  "legendary": false,
  "colors":    "BR",
  "artZoom":   null, "artX": 0, "artY": 0,
  "textColor": "white",
  "rulesFont": "mplantin", "rulesAlign": "left", "rulesVerticalCenter": true
}
```

`legendary` se deduce de `type`; un `pt` no vacío marca criatura y añade la
caja de fuerza/resistencia. El texto de reglas sale en **mplantin, a la
izquierda y centrado verticalmente**, que es como están las cartas del mazo
(el editor usa `plantinsemibold` y lo cuelga del borde superior).

### Colores y marcos

El color sale del coste de maná, o de `colors` si lo fuerzas:

| Coste | Marcos |
|---|---|
| solo `{B}` | `Borderless/Negro` |
| solo `{R}` | `Borderless/Rojo` |
| ambos | Negro entero debajo + Rojo enmascarado con `maskRightHalf.png` |

El negro queda a la izquierda, el rojo a la derecha, y el degradado de la
máscara hace la transición. Se usa el negro como capa completa (en vez de
negro con `maskLeftHalf`) para que no quede una costura translúcida en el
centro si los dos degradados no suman exactamente 1.

El arte cubre la carta entera por defecto, que es lo que piden los marcos
Borderless (son full-art). Ajústalo con `artZoom` / `artX` / `artY`.

### Recostear una carta acabada

El arte de una carta acabada está incrustado en el PNG y no se recupera. Para
cambiarle solo el coste, `baseImage` la usa de fondo a escala 1:1 y repinta
únicamente la barra de título:

```json
{ "name": "Quelana de Izalith", "mana": "{1}{R}{R}", "colors": "R",
  "legendary": true, "baseImage": "Criaturas/Quelana de Izalith.png" }
```

Si además cambia el texto de reglas, añade `"redrawBody": true` y pasa `type`
y `rules`: repinta el marco entero.

La barra es semitransparente, así que una pasada dejaría el coste viejo
transparentándose. Se apila 8 veces — sobrevive `(1-a)^n` — sin alterar el
color de la barra, que ya está saturada. Ajustable con `titleStack`.

### Clase, Saga y Planeswalker

Cada uno usa un marco precompuesto por color (aquí sí hay bicolor listo:
`Multicolor` / `sagaFrameM` / `planeswalkerFrameM`) más una capa dibujada
encima. Se activan por la clave que traiga la spec:

**`"levels"` → Clase.** `baseText` es la habilidad de nivel 1, sin barra de
coste; hasta 3 niveles de `{cost, name, text}`. El texto del último se estira
para ocupar el espacio que sobre.

**`"chapters"` → Saga.** `reminder` es la línea en cursiva del contador;
cada capítulo es `{count, text}`, donde `count` es cuántos números romanos
cubre esa caja (1 casi siempre; 2 o 3 para condensar capítulos idénticos).
Cada caja usa su altura por defecto, sin estirarse.

**`"abilities"` → Planeswalker.** `loyalty` más hasta 4 de `{cost, text}`.
Un `cost` vacío es una línea estática: sin insignia, y la caja se ensancha
para compensar. Las plantillas reales asumen habilidades de una línea; con
texto más largo la caja por defecto (`0.0695` de alto) se derrama en la
siguiente franja — añade `"height"` (y un `"size"` algo menor) a esa
habilidad.

## Ficheros

| | |
|---|---|
| `server.py` | Backend Flask |
| `render.py` | Render headless: specs → carta serializada → Chromium |
| `public/js/editor.js` | Pipeline de canvas. La única implementación de layout |
| `ejemplo-cartas.json` | Spec de ejemplo con tres cartas |

Para pintar algo nuevo en el render, extrae una función pura de `editor.js`
(que no lea del DOM) y llámala desde el `INJECT` de `render.py`; no dupliques
lógica de dibujo en Python.
