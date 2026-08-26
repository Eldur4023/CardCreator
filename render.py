"""Headless card renderer for CardCreator.

Drives public/js/editor.js in a real browser (Playwright + Chromium), so the
output is exactly what the editor would download — same canvas pipeline, same
fonts, same masks. No second render implementation to keep in sync.

    py render.py cards.json -o out/     # batch
    py render.py --demo                 # three sample cards

A spec is one JSON object (or a list of them); only "name" is required:

    {
      "name":  "Truco de piromancia",
      "mana":  "{R}",                    # also picks the frame colour
      "type":  "Instantáneo — Piromancia",
      "rules": "Hace 3 de daño a un objetivo.",
      "pt":    "3/4",                    # non-empty marks it a creature
      "art":   "C:/ruta/arte.png"        # local path, URL or data: URI
    }

A "levels", "chapters" or "abilities" key makes it a Class, Saga or
Planeswalker card instead. See README.md for the full field list.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import threading
import time
from pathlib import Path

BORDERLESS = "/img/frames/Normal/Borderless"

# Filenames differ between the two colour folders, so they are mapped here.
PIECES = {
    "R": {
        "frame":     f"{BORDERLESS}/Rojo/Marco.png",
        "title":     f"{BORDERLESS}/Rojo/Titulo.png",
        "title_leg": f"{BORDERLESS}/Rojo/Titulo Legendario.png",
        "pt":        f"{BORDERLESS}/Rojo/poder.png",
    },
    "B": {
        "frame":     f"{BORDERLESS}/Negro/Marco.png",
        "title":     f"{BORDERLESS}/Negro/Negro.png",
        "title_leg": f"{BORDERLESS}/Negro/Negro Legendario.png",
        "pt":        f"{BORDERLESS}/Rojo/poder.png",   # Negro has no poder.png
    },
}

MASK_RIGHT = {"src": "/img/maskRightHalf.png", "name": "Right Half"}

# Unlike Borderless, Class/Saga/Planeswalker ship one precomposited frame per
# colour (border, pinline and windows already baked in), bicolor included, so
# no left/right masking is needed.
SPECIAL_FRAMES = {
    "class": {"R": "/img/frames/Class/Rojo/Clase Roja.png",
              "B": "/img/frames/Class/Negro/Clase Negra.png",
              "BR": "/img/frames/Class/Multicolor/Clase Multicolor.png"},
    "saga":  {"R": "/img/frames/Saga/Base/sagaFrameR.png",
              "B": "/img/frames/Saga/Base/sagaFrameB.png",
              "BR": "/img/frames/Saga/Base/sagaFrameM.png"},
    "pw":    {"R": "/img/frames/Planeswalker/Base/planeswalkerFrameR.png",
              "B": "/img/frames/Planeswalker/Base/planeswalkerFrameB.png",
              "BR": "/img/frames/Planeswalker/Base/planeswalkerFrameM.png"},
}

ART_BOUNDS = {"x": 0.0767, "y": 0.1129, "width": 0.8476, "height": 0.4429}


def frame_obj(src: str, masks: list | None = None) -> dict:
    return {
        "name": Path(src).stem, "src": src, "masks": masks or [],
        "opacity": 100, "mode": "source-over", "preserveAlpha": False,
        "bounds": None, "hslAdjust": {"hue": 0, "saturation": 0, "lightness": 0},
        "colorOverlay": "#000000", "colorOverlayEnabled": False,
    }


def detect_colors(mana: str, override: str | None = None) -> str:
    """Return 'B', 'R' or 'BR' — black always listed first."""
    source = override.upper() if override else (mana or "").upper()
    found = {c for c in "BR" if c in re.sub(r"[^A-Z]", "", source)}
    return "".join(c for c in "BR" if c in found) or "R"


def build_frames(colors: str, *, legendary: bool, creature: bool) -> list:
    """Bottom-first frame stack. Black underneath, red masked to the right half,
    so black sits on the left and the mask's gradient blends the two."""
    title = "title_leg" if legendary else "title"
    frames = []
    for piece in ("frame", title):
        if colors == "BR":
            frames.append(frame_obj(PIECES["B"][piece]))
            frames.append(frame_obj(PIECES["R"][piece], [dict(MASK_RIGHT)]))
        else:
            frames.append(frame_obj(PIECES[colors][piece]))
    if creature:
        frames.append(frame_obj(PIECES["R" if "R" in colors else "B"]["pt"]))
    return frames


def build_title_frames(colors: str, *, legendary: bool, stack: int = 8) -> list:
    """Just the title bar, used by recost mode to cover the old mana cost.

    The bar art is semi-transparent, so one pass leaves the old cost ghosting
    through. Stacking compounds the alpha — what survives is (1-a)^n — and the
    bar's own colour is unchanged because it is already fully saturated.
    """
    title = "title_leg" if legendary else "title"
    out = []
    for _ in range(max(1, stack)):
        if colors == "BR":
            out.append(frame_obj(PIECES["B"][title]))
            out.append(frame_obj(PIECES["R"][title], [dict(MASK_RIGHT)]))
        else:
            out.append(frame_obj(PIECES[colors][title]))
    return out


def resolve_art(art: str, name: str = "?") -> str:
    """Local path -> data: URI. URLs and data: URIs pass through untouched."""
    if not art or art.startswith(("http://", "https://", "data:", "/")):
        return art
    p = Path(art)
    exts = (".jpg", ".jpeg", ".png", ".webp")
    if not p.is_file() and p.parent.is_dir():
        # Forgiving lookup: exact stem first, then the "NN-" prefix alone, so
        # "arte/09-ahuecar" also matches "09-lo-que-sea.png".
        prefix = re.match(r"^(\d+)", p.stem)
        patterns = [p.stem + ".*"]
        if prefix:
            patterns += [prefix.group(1) + "-*", prefix.group(1) + ".*"]
        for pattern in patterns:
            hits = [m for m in sorted(p.parent.glob(pattern)) if m.suffix.lower() in exts]
            if hits:
                p = hits[0]
                break
    if not p.is_file():
        print(f"  ! sin arte: {name} (buscaba {art})")
        return ""
    mime = "image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


# ── Text boxes ───────────────────────────────────────────────────────────────
def mana_box(mana: str) -> dict:
    return {"name": "Mana Cost", "text": mana, "y": 0.048, "width": 0.9292,
            "height": 71 / 2100, "oneLine": True, "size": 71 / 1638,
            "align": "right", "manaCost": True, "manaSpacing": 0}


def title_box(name: str, color: str, *, y: float = 0.0522, width: float = 0.8292) -> dict:
    return {"name": "Title", "text": name, "x": 0.0854, "y": y, "width": width,
            "height": 0.0543, "oneLine": True, "shrinkToFit": True,
            "font": "belerenb", "size": 0.0381, "color": color}


def type_box(type_line: str, color: str, *, y: float = 0.574) -> dict:
    return {"name": "Type", "text": type_line, "x": 0.0854, "y": y,
            "width": 0.8292, "height": 0.0543, "oneLine": True,
            "font": "belerenb", "size": 0.0324, "color": color}


def body_box(name: str, text: str, x: float, y: float, w: float, h: float,
             size: float = 0.0324, color: str = "black") -> dict:
    return {"name": name, "text": text, "x": x, "y": y, "width": w,
            "height": h, "size": size, "font": "mplantin", "color": color}


def hidden_box(x: float, w: float, h: float, size: float) -> dict:
    """An inactive slot. y=2 parks it off-card, which is how the editor hides
    the levels/chapters/abilities a card does not use."""
    return {"text": "", "y": 2, "x": x, "width": w, "height": h, "size": size}


def entry(spec: dict, text: dict, frames: list, *, art_bounds: dict = None,
          **card_extra) -> dict:
    """Wrap the pieces in the editor's serialized-card format."""
    return {
        "name": spec.get("name", "Untitled"),
        "card": {
            "width": 2010, "height": 2814, "marginX": 0, "marginY": 0,
            "version": "", "onload": None,
            "artBounds": art_bounds or ART_BOUNDS,
            "setSymbolBounds": {"x": 0.9213, "y": 0.5910, "width": 0.12,
                                "height": 0.0410, "horizontal": "right"},
            "watermarkBounds": {"x": 0.5, "y": 0.7762, "width": 0.75, "height": 0.2305},
            "text": text, "planeswalker": None, "saga": None, "class": None,
            **card_extra,
        },
        "frames": frames,
        "art": resolve_art(spec.get("art") or "", spec.get("name", "?")),
        "setSymbol": "",
        "watermark": "",
        # Art placement. Default is "cover the whole card" (these frames are
        # full-art); override per card with artZoom / artX / artY.
        "_art": {"zoom": spec.get("artZoom"), "x": spec.get("artX", 0),
                 "y": spec.get("artY", 0)},
    }


# ── Card builders ────────────────────────────────────────────────────────────
def build_class_card(spec: dict) -> dict:
    """Art on the left half, level bands stacked on the right.

    Adds "baseText" (the always-on level 1 ability, no header bar) and
    "levels": [{"cost", "name", "text"}, ...] — up to 3 upgrades, each with a
    header band. The last active level stretches to fill the space left, the
    same thing classEdited() does live.
    """
    text = {"level0c": body_box("Level 1 - Text", spec.get("baseText", ""),
                                0.5093, 0.1129, 0.404, 0.2096, 0.0305)}
    y, count, last = 0.1129 + 0.2096 + 0.0481, 0, None

    for i in range(1, 4):
        level = spec.get("levels", [])[i - 1] if i - 1 < len(spec.get("levels", [])) else None
        if not level:
            text[f"level{i}a"] = hidden_box(0.5093, 0.3967, 0.0277, 0.0277)
            text[f"level{i}b"] = hidden_box(0.5093, 0.3967, 0.0281, 0.0281)
            text[f"level{i}c"] = hidden_box(0.5093, 0.404, 0.2091, 0.0305)
            continue
        count += 1
        text[f"level{i}a"] = {
            "name": f"Level {i + 1} - Cost", "text": level.get("cost", ""),
            "x": 0.5093, "y": y - 0.0361, "width": 0.3967, "height": 0.0277,
            "size": 0.0277, "oneLine": True, "manaCost": True, "manaSpacing": 0}
        text[f"level{i}b"] = {
            "name": f"Level {i + 1} - Name", "text": level.get("name", ""),
            "x": 0.5093, "y": y - 0.0361, "width": 0.3967, "height": 0.0281,
            "size": 0.0281, "align": "right", "oneLine": True,
            "font": "belerenb", "color": "black"}
        text[f"level{i}c"] = body_box(f"Level {i + 1} - Text", level.get("text", ""),
                                      0.5093, y, 0.404, 0.2091, 0.0305)
        last = f"level{i}c"
        y += 0.2091 + 0.0481

    if last:
        text[last]["height"] = max(0.05, 0.8368 - text[last]["y"])

    colors = detect_colors(spec.get("mana", ""), spec.get("colors"))
    text = {"mana": mana_box(spec.get("mana", "")),
            "title": title_box(spec.get("name", ""), "white"),
            "type": type_box(spec.get("type") or "Encantamiento — Clase", "white", y=0.8481),
            **text}

    return entry(spec, text, [frame_obj(SPECIAL_FRAMES["class"][colors])],
                 art_bounds={"x": 0.0767, "y": 0.1129, "width": 0.4247, "height": 0.3},
                 **{"class": {"x": 0.5014, "width": 0.422, "count": count}})


def build_saga_card(spec: dict) -> dict:
    """Chapter pips and text on the left, art on the right.

    Adds "reminder" (the italic saga-counter line) and "chapters":
    [{"count": roman numerals this box covers, "text": ...}, ...], up to 4.
    Unlike Class, boxes keep their default height instead of stretching.
    """
    defaults = [(0.2896, 0.1786), (0.4682, 0.1786), (0.6468, 0.1786), (0.8254, 0)]
    chapters = spec.get("chapters", [])
    text, abilities, count = {}, [0, 0, 0, 0], 0

    for i, (y, h) in enumerate(defaults):
        chapter = chapters[i] if i < len(chapters) else None
        if not chapter:
            text[f"ability{i}"] = hidden_box(0.248, 0.666, 0, 0.0324)
            continue
        count += 1
        abilities[i] = chapter.get("count", 1)
        text[f"ability{i}"] = body_box(f"Chapter {i + 1}", chapter.get("text", ""),
                                       0.248, y, 0.666, h)

    colors = detect_colors(spec.get("mana", ""), spec.get("colors"))
    text = {
        "mana": mana_box(spec.get("mana", "")),
        "title": title_box(spec.get("name", ""), "white"),
        "type": type_box(spec.get("type") or "Encantamiento — Saga", "white", y=0.855),
        "reminder": {"name": "Reminder Text", "text": spec.get("reminder", ""),
                     "x": 0.090, "y": 0.160, "width": 0.400, "height": 0.120,
                     "size": 0.0267, "font": "mplantini", "color": "black"},
        **text,
    }

    return entry(spec, text, [frame_obj(SPECIAL_FRAMES["saga"][colors])],
                 saga={"abilities": abilities, "count": count,
                       "x": 0.1, "width": 0.3947})


def build_planeswalker_card(spec: dict) -> dict:
    """Art on top, loyalty ability bands below, loyalty number bottom-right.

    Adds "loyalty" and "abilities": [{"cost": "+1", "text": ...}, ...], up to
    4. A blank cost is a static passive line: no badge, so its text box widens
    to compensate. Vanilla abilities are one-liners, hence the small default
    box — longer homebrew text needs an explicit "height" (and maybe "size").
    """
    base_x, base_w = 0.1581, 0.766
    abilities = spec.get("abilities", [])
    text, costs, count, y = {}, ["", "", "", ""], 0, 0.6239

    for i in range(4):
        ability = abilities[i] if i < len(abilities) else None
        if not ability:
            text[f"ability{i}"] = hidden_box(base_x, base_w, 0, 0.0324)
            continue
        count += 1
        costs[i] = ability.get("cost", "")
        height = ability.get("height", 0.0695)
        x, w = (base_x, base_w) if costs[i] else (base_x - 0.044, base_w + 0.044)
        text[f"ability{i}"] = body_box(f"Ability {i + 1}", ability.get("text", ""),
                                       x, y, w, height, ability.get("size", 0.0324))
        y += height

    colors = detect_colors(spec.get("mana", ""), spec.get("colors"))
    text = {
        "mana": mana_box(spec.get("mana", "")),
        "title": title_box(spec.get("name", ""), "white"),
        "type": type_box(spec.get("type") or "Planeswalker Legendario", "white"),
        "loyalty": {"name": "Loyalty", "text": str(spec.get("loyalty", "")),
                    "x": 0.7928, "y": 0.902, "width": 0.1367, "height": 0.0372,
                    "size": 0.0372, "font": "belerenbsc", "oneLine": True,
                    "align": "center", "color": "white"},
        **text,
    }

    return entry(spec, text, [frame_obj(SPECIAL_FRAMES["pw"][colors])],
                 planeswalker={"abilities": costs, "abilityAdjust": [0, 0, 0, 0],
                               "count": count, "x": 0.1167, "width": 0.8094})


def build_normal_card(spec: dict) -> dict:
    """The regular full-art Borderless layout.

    "baseImage" switches to recost mode: an already-finished card PNG becomes
    the art at 1:1 and only the title bar, title and mana cost are repainted
    over it, which changes a card's cost without needing the original art
    (baked into the finished image and unrecoverable). "redrawBody" repaints
    the whole frame instead, for when the rules text changes too.
    """
    base_image = spec.get("baseImage")
    if base_image:
        spec = {**spec, "art": base_image, "artZoom": 1}   # 2010x2814 lines up

    mana = spec.get("mana", "") or ""
    type_line = spec.get("type", "") or ""
    pt = (spec.get("pt") or "").strip()
    legendary = spec.get("legendary", "legendar" in type_line.lower())
    colors = detect_colors(mana, spec.get("colors"))
    ink = spec.get("textColor", "white")   # Borderless frames are dark

    text = {
        "mana": mana_box(mana),
        # The title box spans the whole bar, mana cost included, so reserve
        # room for the symbols and let long names shrink. y sits 0.0040 below
        # the editor's default: measured against the existing cards.
        "title": title_box(spec.get("name", ""), ink, y=spec.get("titleY", 0.0562),
                           width=max(0.35, 0.8292 - 0.052 * len(re.findall(r"\{[^}]+\}", mana)))),
        "type": type_box(type_line, ink),
        # Matches the existing cards: mplantin (the editor defaults to the
        # heavier plantinsemibold), flush left, centred vertically in the box
        # instead of hanging from the top edge.
        "rules": {"name": "Rules Text", "text": spec.get("rules", ""), "x": 0.086,
                  "y": 0.638, "width": 0.828, "height": 0.2875, "size": 0.0362,
                  "color": ink, "font": spec.get("rulesFont", "mplantin"),
                  "align": spec.get("rulesAlign", "left"),
                  "verticalCenter": spec.get("rulesVerticalCenter", True)},
        "pt": {"name": "Power/Toughness", "text": pt, "x": 0.7928, "y": 0.902,
               "width": 0.1367, "height": 0.0372, "size": 0.0372,
               "font": "belerenbsc", "oneLine": True, "align": "center",
               "color": ink},
    }

    stack = spec.get("titleStack", 8)
    if base_image and spec.get("redrawBody"):
        # Stacked for the same opacity reason as the title bar.
        frames = build_frames(colors, legendary=legendary, creature=bool(pt)) * stack
    elif base_image:
        # Everything below the title bar is already right in the base image.
        for key in ("type", "rules", "pt"):
            text[key]["text"] = ""
        frames = build_title_frames(colors, legendary=legendary, stack=stack)
    else:
        frames = build_frames(colors, legendary=legendary, creature=bool(pt))

    return entry(spec, text, frames)


def build_card(spec: dict) -> dict:
    """Turn a friendly spec into the editor's serialized-card format."""
    for key, builder in (("levels", build_class_card), ("chapters", build_saga_card),
                         ("abilities", build_planeswalker_card)):
        if key in spec:
            return builder(spec)
    return build_normal_card(spec)


# ── Browser driving ──────────────────────────────────────────────────────────
# Everything below the art placement is editor.js's own code: the entry is fed
# to the same functions the UI calls, so there is one layout implementation.
INJECT = r"""
async (entry) => {
  const loadImg = (img, src) => new Promise(res => {
    if (!src || src.includes('/img/blank')) { res(); return; }
    img.onload = img.onerror = res;
    img.src = src;
  });

  await resetCardIrregularities();
  Object.assign(card, entry.card);
  ['card','frame','frameMasking','frameCompositing','text','paragraph','line','watermark',
   'class','saga','planeswalkerPreFrame','planeswalkerPostFrame'].forEach(n => sizeCanvas(n));

  await loadImg(window.art, entry.art);

  // Art placement: cover the whole card unless the spec says otherwise.
  const art = entry._art || {};
  const loaded = window.art && window.art.naturalWidth && !window.art.src.includes('blank');
  card.artZoom = art.zoom != null ? art.zoom
    : loaded ? Math.max(card.width / window.art.naturalWidth,
                        card.height / window.art.naturalHeight)
    : 1;
  card.artX = art.x || 0;
  card.artY = art.y || 0;
  card.artRotate = 0;

  card.frames = [];
  await Promise.all(entry.frames.map(f => new Promise(res => {
    const masks = [];
    let pending = (f.masks ? f.masks.length : 0) + 1;
    const done = () => { if (--pending === 0) res(); };

    const frameImage = new Image(); frameImage.crossOrigin = 'anonymous';
    frameImage.onload = frameImage.onerror = done;
    frameImage.src = f.src;

    (f.masks || []).forEach(m => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = img.onerror = done;
      img.src = m.src;
      masks.push({ name: m.name, src: m.src, image: img });
    });

    card.frames.push({ ...f, image: frameImage, masks });
  })));

  // Overlay layers the editor normally paints from its side panels.
  if (card.class?.count) {
    await ensureOverlayImages('classHeader');
    drawClassHeaders();
  }
  if (card.saga?.count) {
    await ensureOverlayImages('sagaChapter', 'sagaDivider');
    drawSagaChapters();
  }
  if (card.planeswalker?.count) {
    await ensureOverlayImages(...planeswalkerImageKeys());
    drawPlaneswalkerLayers();
  }

  // Every card font must really be loaded before measuring, or autoShrink
  // sizes the text against the fallback serif's metrics.
  await ensureFontsLoaded();

  drawCard();
  await new Promise(r => setTimeout(r, 120));   // let the rAF pass land
  drawCard();
  return cardCanvas.toDataURL('image/png');
}
"""


class Renderer:
    """Persistent headless browser on its own thread.

    Playwright's sync API is not thread-safe, so every render is funnelled
    through a single owner thread via a queue. Keeping the browser warm makes
    a render cost ~0.3 s instead of the ~1.5 s a cold start would.
    """

    def __init__(self, base_url: str):
        import queue

        self.base_url = base_url
        self._jobs: queue.Queue = queue.Queue()
        self._ready = threading.Event()
        self._error: str | None = None
        threading.Thread(target=self._loop, daemon=True).start()
        self._ready.wait(timeout=60)
        if self._error:
            raise RuntimeError(self._error)

    def _loop(self):
        from playwright.sync_api import sync_playwright

        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                page = browser.new_page(viewport={"width": 1400, "height": 1000})
                page.goto(f"{self.base_url}/editor.html", wait_until="networkidle")
                page.wait_for_function("typeof drawCard === 'function' && typeof card === 'object'")
                self._ready.set()

                while True:
                    spec, box = self._jobs.get()
                    if spec is None:
                        break
                    try:
                        data_url = page.evaluate(INJECT, build_card(spec))
                        box["png"] = base64.b64decode(data_url.split(",", 1)[1])
                    except Exception as exc:  # noqa: BLE001 - surfaced to the caller
                        box["error"] = str(exc)
                    finally:
                        box["done"].set()
                browser.close()
        except Exception as exc:  # noqa: BLE001 - browser never came up
            self._error = str(exc)
            self._ready.set()

    def render(self, spec: dict, timeout: float = 60) -> bytes:
        box = {"done": threading.Event()}
        self._jobs.put((spec, box))
        if not box["done"].wait(timeout):
            raise TimeoutError("render timed out")
        if "error" in box:
            raise RuntimeError(box["error"])
        return box["png"]


def render_to_dir(specs: list[dict], outdir: Path, base_url: str) -> list[Path]:
    outdir.mkdir(parents=True, exist_ok=True)
    renderer = Renderer(base_url)
    written = []
    for spec in specs:
        png = renderer.render(spec)
        name = re.sub(r'[<>:"/\\|?*]', "_", spec.get("name", "carta")).strip() or "carta"
        path = outdir / f"{name}.png"
        path.write_bytes(png)
        written.append(path)
        print(f"  {path.name}  ({len(png) // 1024} KB)")
    return written


# ── CLI ──────────────────────────────────────────────────────────────────────
def absolutize_art(specs: list[dict], base: Path) -> list[dict]:
    """Make relative art paths relative to the spec file, not the CWD."""
    out = []
    for spec in specs:
        spec = dict(spec)
        for key in ("art", "baseImage"):
            value = spec.get(key) or ""
            if value and not value.startswith(("http://", "https://", "data:")) \
                    and not Path(value).is_absolute():
                spec[key] = str((base / value).resolve())
        out.append(spec)
    return out


DEMO = [
    {"name": "Truco de piromancia", "mana": "{R}", "type": "Instantáneo — Piromancia",
     "rules": "Truco de piromancia hace 3 de daño a un objetivo."},
    {"name": "Ritual del Abismo", "mana": "{B}", "type": "Instantáneo",
     "rules": "Añade {B}{B}{B}."},
    {"name": "Bruja del Caos Quelaag", "mana": "{2}{B}{R}",
     "type": "Criatura Legendaria — Horror Piromántico", "pt": "3/4",
     "rules": "Cuando lanzas una piromancia, puedes perder 2 vidas. Si lo haces, "
              "roba una carta y cada oponente pierde 1 vida."},
]


def main():
    ap = argparse.ArgumentParser(description="Render MTG cards headlessly.")
    ap.add_argument("input", nargs="?", help="JSON file with one card or a list")
    ap.add_argument("-o", "--out", default="rendered", help="output directory")
    ap.add_argument("--demo", action="store_true", help="render three sample cards")
    ap.add_argument("--url", help="use an already-running server")
    ap.add_argument("--port", type=int, default=3001, help="port for the bundled server")
    args = ap.parse_args()

    if args.demo:
        specs = DEMO
    elif args.input:
        source = Path(args.input).resolve()
        data = json.loads(source.read_text(encoding="utf-8"))
        specs = absolutize_art(data if isinstance(data, list) else [data], source.parent)
    else:
        ap.error("give an input JSON file or --demo")

    base_url = args.url
    if not base_url:
        import server
        threading.Thread(
            target=lambda: server.app.run(host="127.0.0.1", port=args.port,
                                          debug=False, use_reloader=False),
            daemon=True).start()
        time.sleep(1.2)
        base_url = f"http://127.0.0.1:{args.port}"

    print(f"Renderizando {len(specs)} carta(s) -> {args.out}/")
    written = render_to_dir(specs, Path(args.out), base_url)
    print(f"Listo: {len(written)} PNG.")


if __name__ == "__main__":
    sys.exit(main())
