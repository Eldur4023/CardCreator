# CardCreator — backend Python + render headless

Sustituye al backend C++ (`app/main.cpp`, framework Osodio), que solo compilaba
en Linux porque usa `io_uring`. El motor de cartas sigue siendo el mismo:
`public/js/editor.js` sobre canvas. Aquí no hay un segundo renderer que mantener.

## Instalación

```
py -m pip install flask playwright
py -m playwright install chromium
```

`playwright` solo hace falta para el render headless; el servidor arranca sin él.

## Arrancar

```
run.bat            (o: py server.py)
```

→ http://localhost:3000

## API

Idéntica a la del C++, más `/api/render`:

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/frames` | Árbol de marcos de `assets/img/frames` |
| GET | `/api/library` | Cartas guardadas |
| POST | `/api/library` | Guarda una carta (al principio de la lista) |
| PATCH | `/api/library/<id>` | Renombra |
| DELETE | `/api/library/<id>` | Borra |
| GET | `/api/decks` | Mazos |
| POST | `/api/decks` | Crea mazo (`{"name": "..."}`) |
| DELETE | `/api/decks/<id>` | Borra mazo |
| PUT | `/api/decks/<id>/cards/<cardId>` | Añade carta al mazo |
| DELETE | `/api/decks/<id>/cards/<cardId>` | Quita carta del mazo |
| **POST** | **`/api/render`** | **Spec de carta → PNG** |

Un cambio de comportamiento: si el POST a `/api/library` no trae `id`, el
servidor lo genera. Antes eso solo lo hacía el navegador, lo que impedía usar
la API mediante scripts.

## Render headless

```
py render.py cartas.json -o salida/     # lote
py render.py --demo                     # tres cartas de muestra
```

O por HTTP:

```
curl -X POST localhost:3000/api/render -H "Content-Type: application/json" ^
     -d "{\"name\":\"Truco\",\"mana\":\"{R}\",\"type\":\"Instantáneo — Piromancia\",\"rules\":\"Hace 3 de daño.\"}" ^
     --output truco.png
```

Manda una lista en vez de un objeto y devuelve JSON con los PNG en base64.

Primera llamada ~1,4 s (arranca Chromium); las siguientes ~350 ms, porque el
navegador se queda caliente en un hilo propio.

### Formato de la spec

```json
{
  "name":      "Cremación Ritual",
  "mana":      "{B}{R}",
  "type":      "Instantáneo — Piromancia",
  "rules":     "Exilia la criatura objetivo.\nRoba una carta.",
  "pt":        "3/4",
  "art":       "C:/ruta/al/arte.jpg",
  "legendary": false,
  "land":      false,
  "colors":    "BR",
  "artZoom":   null,
  "artX":      0,
  "artY":      0,
  "textColor": "white",
  "rulesFont": "mplantin",
  "rulesAlign": "center",
  "rulesVerticalCenter": true
}
```

El texto de reglas sale por defecto en **mplantin, pegado a la izquierda y
centrado verticalmente** en la caja, que es como están las cartas del mazo. El
editor usa `plantinsemibold`, que es más gruesa, y cuelga el texto del borde
superior en vez de centrarlo. La alineación horizontal sí coincide con el
editor: va a la izquierda.

Solo `name` es obligatorio. `legendary` y `land` se deducen de `type` si no se
indican; `pt` no vacío marca la carta como criatura y añade la caja de fuerza y
resistencia.

### Recostear una carta ya terminada

El arte de una carta acabada está incrustado en el PNG y no se puede recuperar.
Para cambiarle solo el coste de maná, `baseImage` usa la carta existente como
fondo a escala 1:1 y **repinta únicamente la barra de título**:

```json
{
  "name": "Quelana de Izalith",
  "mana": "{1}{R}{R}",
  "colors": "R",
  "legendary": true,
  "baseImage": "../1 - MAZO ACTUAL/Criaturas/Quelana de Izalith.png"
}
```

Si además cambia el texto de reglas, añade `"redrawBody": true` y pasa `type` y
`rules`; entonces repinta el marco entero.

La barra es semitransparente, así que una sola pasada dejaría el coste viejo
transparentándose por debajo. Se apila 8 veces: lo que sobrevive es `(1-a)^n`,
suficiente para borrar un símbolo blanco sobre fondo oscuro sin alterar el color
de la barra. Ajustable con `titleStack`.

### Colores y marcos

El color sale del coste de maná (o de `colors` si lo fuerzas):

| Coste | Marcos usados |
|---|---|
| solo `{B}` | `Borderless/Negro` |
| solo `{R}` | `Borderless/Rojo` |
| ambos | Negro entero debajo + Rojo enmascarado con `maskRightHalf.png` |

Con lo cual el negro queda a la izquierda, el rojo a la derecha y el degradado
de la máscara hace la transición. Negro va siempre primero, en el coste de maná
y en las capas.

Se usa el negro como capa completa (en vez de negro con `maskLeftHalf`) para
que no pueda quedar una costura translúcida en el centro si los dos degradados
no suman exactamente 1.

El arte se escala por defecto para cubrir la carta entera, que es lo que piden
los marcos Borderless (son full-art). Ajústalo con `artZoom` / `artX` / `artY`.

### Clase, Saga y Planeswalker

El editor ya soportaba estos tres tipos — no hubo que escribir ningún layout
nuevo, solo darle a `render.py` los mismos datos que un humano metería en el
panel de la UI. Cada uno usa un marco precompuesto por color (a diferencia de
Borderless, aquí sí hay una versión bicolor lista: `Multicolor`/`sagaFrameM`/
`planeswalkerFrameM`), más una capa dibujada por encima con datos puros
(cabeceras de nivel, numerales de saga, franjas y emblemas de lealtad) — nada
depende del DOM, así que se reprodujo tal cual sin tocar el pipeline visual.

**Clase** — una clave `"levels"` en la spec activa este modo:

```json
{
  "name": "Clase: Piromántico",
  "mana": "{1}{R}",
  "type": "Encantamiento — Clase",
  "baseText": "Todas tus criaturas son pirománticos además de sus otros tipos.",
  "levels": [
    { "cost": "{1}{R}", "name": "Nivel 2", "text": "..." },
    { "cost": "{1}{R}", "name": "Nivel 3", "text": "..." }
  ]
}
```

`baseText` es la habilidad de nivel 1, sin barra de coste. Hasta 3 niveles en
`levels`; el texto del último se estira para ocupar el espacio que sobre,
igual que hace `classEdited()` en vivo.

**Saga** — una clave `"chapters"`:

```json
{
  "name": "Castigo a los chamanes",
  "mana": "{2}{B}{R}",
  "type": "Encantamiento — Saga",
  "reminder": "{i}(Cuando esta saga entra y al final de tu turno, añade un contador de sabiduría. Sacrifícala después de II.){/i}",
  "chapters": [
    { "count": 1, "text": "Exilia la criatura objetivo..." },
    { "count": 1, "text": "Cada oponente sacrifica..." }
  ]
}
```

`count` es cuántos números romanos cubre esa caja de texto (1 casi siempre;
2 o 3 si quieres condensar varios capítulos idénticos en una sola caja, como
hacían las sagas originales de 3 capítulos). A diferencia de Clase, aquí no
hay auto-estiramiento: cada caja usa su altura por defecto tal cual.

**Planeswalker** — una clave `"abilities"`:

```json
{
  "name": "Izalith, Madre del Caos",
  "mana": "{2}{R}{R}",
  "type": "Planeswalker Legendario — Bruja de Izalith",
  "loyalty": "4",
  "abilities": [
    { "cost": "", "text": "Habilidad estática, sin insignia..." },
    { "cost": "+1", "text": "..." },
    { "cost": "-2", "text": "..." },
    { "cost": "-8", "text": "..." }
  ]
}
```

Un `cost` vacío es una línea estática (sin insignia +/−/neutral, caja más
ancha para compensar). Las plantillas de planeswalker reales asumen
habilidades de una sola línea; con texto de más de una línea la caja por
defecto (`0.0695` de alto) se queda corta y el texto se derrama en la
siguiente franja. Si eso pasa, añade `"height"` (y de paso `"size"` un poco
menor) a cada habilidad — es la misma cuenta que haría una persona ajustando
los campos «Height»/«Shift» en el editor en vivo, solo que a mano una vez en
vez de por prueba y error en el navegador.

## Bugs del editor corregidos de paso

Los tres impedían el render headless, pero también estaban rompiendo la app:

1. **`loadedVersions` no estaba declarada en ningún sitio.**
   `resetCardIrregularities()` la usa, así que lanzaba `ReferenceError` siempre.
   Como `loadCard()` la llama de primero, **cargar una carta de la biblioteca
   estaba roto**. Añadida la declaración y la función `loadScript()` que
   `library.js` también esperaba.

2. **`art`, `setSymbol` y `watermark` eran `const` de módulo**, así que no
   estaban en `window` — pero `library.js` los lee como `window.art`. Resultado:
   **guardar una carta perdía el arte** (`art: ""`) y cargarla nunca lo
   restauraba. Ahora se exponen en `window`.

3. **Las fuentes del canvas no se cargaban.** `fillText` no dispara la descarga
   de una `@font-face`: el navegador solo carga una fuente web cuando el DOM la
   usa. De las 11 familias declaradas en `style.css`, solo `gothammedium` y
   `belerenb` llegaban a cargarse (porque el `body` y el `<h1>` las usan); las
   otras 9 caían en silencio a la serif por defecto, con métricas distintas que
   además descuadraban `autoShrink`. Añadido `ensureFontsLoaded()`, que se llama
   al iniciar y vuelve a dibujar cuando terminan.

4. **`renderTextbox` no sabía centrar verticalmente.** Añadida la opción
   `verticalCenter`, que es como están maquetadas las cartas del mazo.

5. **Las esquinas salían cuadradas y opacas.** No había ningún paso que
   recortara la carta a su silueta redondeada: con marcos a sangre el arte
   llegaba hasta el borde y el PNG exportado tenía las cuatro esquinas con
   alfa 255. Añadida `roundCardCorners()`, que enmascara el canvas con un
   `roundRect` de 64 px sobre 2010 de ancho, calibrado contra las cartas
   existentes. Ajustable con `card.cornerRadius`.

6. **`autoShrink` solo medía la altura.** Para bloques de una línea (título,
   línea de tipo) el texto nunca salta de línea, así que la altura siempre cabe
   y el ancho no se comprobaba nunca: un nombre largo se salía de su caja y se
   comía el coste de maná. Ahora comprueba también el ancho, y los bloques de
   una línea se acogen con `shrinkToFit`.

7. **`resetCardIrregularities()` no limpiaba `card.class`.** Reseteaba
   `planeswalker` y `saga` pero se dejó fuera `class` (soporte añadido más
   tarde que los otros dos). En el render headless, que llama a esta función
   antes de cada carta, una Clase dejaría su banda de nivel filtrándose en la
   siguiente carta de la misma sesión de navegador. Añadido `card.class = null`
   y la limpieza de `classContext` junto a las de saga/planeswalker.

8. `Negro/` no tiene `poder.png`; se usa el de `Rojo/` para las criaturas
   mono-negras. Si quieres una caja de fuerza/resistencia negra, añade
   `assets/img/frames/Normal/Borderless/Negro/poder.png` y cambia `PIECES`
   en `render.py`.

## Ficheros

| Fichero | |
|---|---|
| `server.py` | El backend Flask |
| `render.py` | Motor de render headless + `RenderWorker` |
| `run.bat` | Lanzador para Windows |
| `ejemplo-cartas.json` | Spec de ejemplo con tres cartas |
| `rendered/` | Salida por defecto |

El backend C++ (`app/`, `src/`, `include/`, `third_party/`, `CMakeLists.txt`)
se deja intacto por si quieres volver a él.
