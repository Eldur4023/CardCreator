# Contexto del proyecto

Editor de cartas tipo Magic, réplica del editor de `cardconjurer/` (solo el
editor: landing, navegación y demás features son irrelevantes).

## Arquitectura

- `server.py` — backend Flask: biblioteca, mazos, catálogo de marcos, estáticos
  y `POST /api/render`.
- `render.py` — render headless. Conduce `public/js/editor.js` en Chromium
  (Playwright) y devuelve el PNG.
- `public/` — la app: `editor.js` es el pipeline de canvas y **la única
  implementación de layout que existe**.
- `assets/` — marcos, símbolos de maná y fuentes.

El backend C++ (framework Osodio) se retiró; está en el historial de git si
alguna vez hace falta.

## Reglas

- No dupliques lógica de dibujo en Python. Si el render headless necesita
  pintar algo, extrae una función pura en `editor.js` (que no lea del DOM) y
  llámala desde el `INJECT` de `render.py`.
- Cualquier cambio en el pipeline de dibujo se valida renderizando las cuatro
  variantes (normal, Clase, Saga, Planeswalker) y comparando los PNG contra los
  de antes del cambio.
- Prioriza poco código y limpieza por encima de features.
