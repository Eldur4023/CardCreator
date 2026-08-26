"""Headless card renderer for CardCreator.

Drives public/js/editor.js in a real browser (Playwright + Chromium), so the
output is byte-for-byte what the editor would download — same canvas pipeline,
same fonts, same masks. No second render implementation to keep in sync.

Usage
-----
    py render.py cards.json -o out/            # batch render
    py render.py --demo                        # one sample card

Card spec (JSON, one object or a list of them)
----------------------------------------------
    {
      "name":      "Truco de piromancia",
      "mana":      "{R}",                # drives frame colour automatically
      "type":      "Instantáneo — Piromancia",
      "rules":     "Truco de piromancia hace 3 de daño a un objetivo.",
      "pt":        "",                   # "3/4" for creatures
      "art":       "C:/ruta/arte.png",   # optional, local path or URL
      "legendary": false,
      "land":      false,
      "colors":    null                  # optional override, e.g. "BR"
    }

Colour rules (as specified):
  * only black  -> Borderless/Negro
  * only red    -> Borderless/Rojo
  * both        -> Negro full underneath, Rojo masked to the right half,
                   so black sits on the left and the app's gradient does
                   the transition.
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

ROOT = Path(__file__).resolve().parent
FRAMES = "/img/frames/Normal/Borderless"

# ── Frame pieces ─────────────────────────────────────────────────────────────
# Filenames differ between the two colour folders, so they are mapped here.
PIECES = {
    "R": {
        "frame":     f"{FRAMES}/Rojo/Marco.png",
        "frame_短":   f"{FRAMES}/Rojo/Marco Corto.png",
        "title":     f"{FRAMES}/Rojo/Titulo.png",
        "title_leg": f"{FRAMES}/Rojo/Titulo Legendario.png",
        "pt":        f"{FRAMES}/Rojo/poder.png",
        "land":      f"{FRAMES}/Rojo/Tierra.png",
    },
    "B": {
        "frame":     f"{FRAMES}/Negro/Marco.png",
        "frame_短":   f"{FRAMES}/Negro/Marco Corto.png",
        "title":     f"{FRAMES}/Negro/Negro.png",
        "title_leg": f"{FRAMES}/Negro/Negro Legendario.png",
        "pt":        f"{FRAMES}/Rojo/poder.png",   # Negro has no poder.png
        "land":      f"{FRAMES}/Negro/Tierra.png",
    },
}

MASK_RIGHT = {"src": "/img/maskRightHalf.png", "name": "Right Half"}

HSL0 = {"hue": 0, "saturation": 0, "lightness": 0}

# Unlike Borderless, each Class colour ships as a single precomposited frame
# (border + pinline + art window + text windows already baked in), including
# a ready-made bicolor variant — no left/right masking needed.
CLASS_FRAMES = {
    "R":  "/img/frames/Class/Rojo/Clase Roja.png",
    "B":  "/img/frames/Class/Negro/Clase Negra.png",
    "BR": "/img/frames/Class/Multicolor/Clase Multicolor.png",
}

# Same story for Saga and Planeswalker: one precomposited frame per colour
# (English single-letter suffixes here, not the Spanish folder names Class
# uses), plus small canvas overlays (chapter markers / loyalty badges) drawn
# from pure data — no DOM, so headless just needs the same numbers.
SAGA_FRAMES = {
    "R":  "/img/frames/Saga/Base/sagaFrameR.png",
    "B":  "/img/frames/Saga/Base/sagaFrameB.png",
    "BR": "/img/frames/Saga/Base/sagaFrameM.png",
}
PW_FRAMES = {
    "R":  "/img/frames/Planeswalker/Base/planeswalkerFrameR.png",
    "B":  "/img/frames/Planeswalker/Base/planeswalkerFrameB.png",
    "BR": "/img/frames/Planeswalker/Base/planeswalkerFrameM.png",
}
# [count-1] -> Y centers for loyalty badges (non-tall variant; matches
# PW_ABILITY_LAYOUT[0] in editor.js).
PW_ABILITY_LAYOUT = [
    [0.7467], [0.6953, 0.822], [0.6639, 0.7467, 0.8362], [0.6505, 0.72, 0.7905, 0.861],
]


def frame_obj(src: str, masks: list | None = None) -> dict:
    return {
        "name": Path(src).stem,
        "src": src,
        "masks": masks or [],
        "opacity": 100,
        "mode": "source-over",
        "preserveAlpha": False,
        "bounds": None,
        "hslAdjust": dict(HSL0),
        "colorOverlay": "#000000",
        "colorOverlayEnabled": False,
    }


def detect_colors(mana: str, override: str | None = None) -> str:
    """Return 'B', 'R' or 'BR' — black always listed first."""
    if override:
        up = override.upper()
        return "".join(c for c in "BR" if c in up) or "R"
    symbols = re.findall(r"\{([^}]+)\}", mana or "")
    found = set()
    for s in symbols:
        s = s.lower()
        if "b" in s:
            found.add("B")
        if "r" in s:
            found.add("R")
    if not found:
        return "R"
    return "".join(c for c in "BR" if c in found)  # B before R


def build_frames(colors: str, *, legendary: bool, land: bool, creature: bool) -> list:
    """Bottom-first frame stack. Black underneath, red masked to the right.

    Lands use the same layout as everything else: the dedicated `Tierra.png`
    piece is just two bare bars with no rules textbox, which leaves the text
    floating over the art.
    """
    frames: list[dict] = []
    title_key = "title_leg" if legendary else "title"

    if colors == "BR":
        base, top = "B", "R"
        # Black full underneath -> occupies the left; red masked to the right
        # half, so the gradient in maskRightHalf does the blending.
        frames.append(frame_obj(PIECES[base]["frame"]))
        frames.append(frame_obj(PIECES[top]["frame"], [dict(MASK_RIGHT)]))
        frames.append(frame_obj(PIECES[base][title_key]))
        frames.append(frame_obj(PIECES[top][title_key], [dict(MASK_RIGHT)]))
    else:
        c = colors
        frames.append(frame_obj(PIECES[c]["frame"]))
        frames.append(frame_obj(PIECES[c][title_key]))

    if creature:
        # P/T box always sits on top of everything
        frames.append(frame_obj(PIECES["R" if "R" in colors else "B"]["pt"]))

    return frames


def build_title_frames(colors: str, *, legendary: bool, stack: int = 8) -> list:
    """Just the title bar — used by recost mode to cover the old mana cost.

    The bar art is semi-transparent, so a single pass leaves the old cost and
    title ghosting through. Stacking compounds the alpha: what shows through is
    (1-a)^n, so eight passes wipe even a high-contrast white mana symbol. The
    bar's own colour is unchanged because it is already fully saturated.
    """
    key = "title_leg" if legendary else "title"
    out: list[dict] = []
    for _ in range(max(1, stack)):
        if colors == "BR":
            out.append(frame_obj(PIECES["B"][key]))
            out.append(frame_obj(PIECES["R"][key], [dict(MASK_RIGHT)]))
        else:
            out.append(frame_obj(PIECES[colors][key]))
    return out


def resolve_art(art: str, spec_name: str = "?") -> str:
    """Local path (with forgiving NN-* lookup) or URL -> data: URI or passthrough."""
    if art and not art.startswith(("http://", "https://", "data:", "/")):
        p = Path(art)
        if not p.is_file() and p.parent.is_dir():
            # Forgiving lookup: exact stem first, then just the "NN-" prefix, so
            # "arte/09-ahuecar" also matches "09-lo-que-sea.png".
            exts = (".jpg", ".jpeg", ".png", ".webp")
            patterns = [p.stem + ".*"]
            prefix = re.match(r"^(\d+)", p.stem)
            if prefix:
                patterns.append(prefix.group(1) + "-*")
                patterns.append(prefix.group(1) + ".*")
            for pat in patterns:
                hits = [m for m in sorted(p.parent.glob(pat))
                        if m.suffix.lower() in exts]
                if hits:
                    p = hits[0]
                    break
        if p.is_file():
            mime = "image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else "image/png"
            return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()
        print(f"  ! sin arte: {spec_name} (buscaba {art})")
        return ""
    return art


def build_class_layout(base_text: str, levels: list) -> tuple[dict, dict]:
    """Mirrors loadClassTextOptions()/classEdited() in editor.js.

    The base ability always sits in level0c with no header bar; `levels`
    holds up to 3 upgrades as {"cost", "name", "text"}, stacked below it with
    a header band per active level. The last active level's box stretches to
    fill whatever space remains, exactly like the editor does live.
    """
    ink = "black"  # Class frame's text boxes are light parchment, not dark
    text = {
        "level0c": {
            "name": "Level 1 - Text", "text": base_text, "x": 0.5093,
            "y": 0.1129, "width": 0.404, "height": 0.2096, "size": 0.0305,
            "font": "mplantin", "color": ink,
        },
    }
    y = 0.1129 + 0.2096 + 0.0481
    count = 0
    last_c_key = None
    for i in range(1, 4):
        lvl = levels[i - 1] if i - 1 < len(levels) else None
        ka, kb, kc = f"level{i}a", f"level{i}b", f"level{i}c"
        if lvl:
            count += 1
            text[ka] = {
                "name": f"Level {i + 1} - Cost", "text": lvl.get("cost", ""),
                "x": 0.5093, "y": y - 0.0361, "width": 0.3967, "height": 0.0277,
                "size": 0.0277, "oneLine": True, "manaCost": True, "manaSpacing": 0,
            }
            text[kb] = {
                "name": f"Level {i + 1} - Name", "text": lvl.get("name", ""),
                "x": 0.5093, "y": y - 0.0361, "width": 0.3967, "height": 0.0281,
                "size": 0.0281, "align": "right", "oneLine": True,
                "font": "belerenb", "color": ink,
            }
            text[kc] = {
                "name": f"Level {i + 1} - Text", "text": lvl.get("text", ""),
                "x": 0.5093, "y": y, "width": 0.404, "height": 0.2091,
                "size": 0.0305, "font": "mplantin", "color": ink,
            }
            last_c_key = kc
            y += 0.2091 + 0.0481
        else:
            text[ka] = {"text": "", "y": 2, "width": 0.3967, "height": 0.0277, "size": 0.0277}
            text[kb] = {"text": "", "y": 2, "width": 0.3967, "height": 0.0281, "size": 0.0281}
            text[kc] = {"text": "", "y": 2, "width": 0.404, "height": 0.2091, "size": 0.0305}

    if last_c_key:
        remaining = max(0.05, 0.8368 - text[last_c_key]["y"])
        text[last_c_key]["height"] = remaining

    return text, {"x": 0.5014, "width": 0.422, "count": count}


def build_class_card(spec: dict) -> dict:
    """Class layout ('Encantamiento — Clase'): art on the left half, level
    bands stacked on the right, title/type bars dark, level text on parchment.

    Spec adds two fields on top of the normal ones:
        "baseText": the always-on N1 ability (no header bar)
        "levels":   [{"cost": "{1}{R}", "name": "Nivel 2", "text": "..."}, ...]
    """
    mana = spec.get("mana", "") or ""
    type_line = spec.get("type") or "Encantamiento — Clase"
    colors = detect_colors(mana, spec.get("colors"))

    class_text, class_state = build_class_layout(spec.get("baseText", ""), spec.get("levels", []))

    text = {
        "mana": {
            "name": "Mana Cost", "text": mana, "y": 0.048, "width": 0.9292,
            "height": 71 / 2100, "oneLine": True, "size": 71 / 1638,
            "align": "right", "manaCost": True, "manaSpacing": 0,
        },
        "title": {
            "name": "Title", "text": spec.get("name", ""), "x": 0.0854,
            "y": 0.0522, "width": 0.8292, "height": 0.0543, "oneLine": True,
            "shrinkToFit": True, "font": "belerenb", "size": 0.0381, "color": "white",
        },
        "type": {
            "name": "Type", "text": type_line, "x": 0.0854, "y": 0.8481,
            "width": 0.8292, "height": 0.0543, "oneLine": True,
            "font": "belerenb", "size": 0.0324, "color": "white",
        },
        **class_text,
    }

    art = resolve_art(spec.get("art") or "", spec.get("name", "?"))

    return {
        "name": spec.get("name", "Untitled"),
        "card": {
            "width": 2010, "height": 2814, "marginX": 0, "marginY": 0,
            "version": "", "onload": None,
            "artBounds": {"x": 0.0767, "y": 0.1129, "width": 0.4247, "height": 0.3},
            "setSymbolBounds": {"x": 0.9213, "y": 0.5910, "width": 0.12,
                                "height": 0.0410, "horizontal": "right"},
            "watermarkBounds": {"x": 0.5, "y": 0.7762, "width": 0.75, "height": 0.2305},
            "text": text, "planeswalker": None, "saga": None, "class": class_state,
        },
        "frames": [frame_obj(CLASS_FRAMES[colors])],
        "art": art,
        "setSymbol": "",
        "watermark": "",
        "_colors": colors,
        "_art": {
            "zoom": spec.get("artZoom"), "x": spec.get("artX", 0), "y": spec.get("artY", 0),
        },
    }


def build_saga_layout(chapters: list) -> tuple[dict, dict]:
    """Mirrors sagaEdited() in editor.js. Each entry in `chapters` is one
    ability box ({"count": roman numerals it covers, "text": ...}); unlike
    Class, Saga doesn't stretch the last box to fill remaining space — it
    just uses each box's own default height, same as the live editor's
    defaults before anyone drags a height slider.
    """
    ink = "black"
    defaults = [(0.2896, 0.1786), (0.4682, 0.1786), (0.6468, 0.1786), (0.8254, 0)]
    text = {}
    abilities = [0, 0, 0, 0]
    count = 0
    for i in range(4):
        ch = chapters[i] if i < len(chapters) else None
        y0, h0 = defaults[i]
        key = f"ability{i}"
        if ch:
            count += 1
            abilities[i] = ch.get("count", 1)
            text[key] = {
                "name": f"Chapter {i + 1}", "text": ch.get("text", ""),
                "x": 0.248, "y": y0, "width": 0.666, "height": h0,
                "size": 0.0324, "font": "mplantin", "color": ink,
            }
        else:
            text[key] = {"text": "", "y": 2, "x": 0.248, "width": 0.666, "height": 0, "size": 0.0324}

    return text, {"abilities": abilities, "count": count, "x": 0.1, "width": 0.3947}


def build_saga_card(spec: dict) -> dict:
    """Saga layout ('Encantamiento — Saga'): chapter pips + text on the left,
    art on the right, title/type bars dark, chapter text on parchment.

    Spec adds two fields on top of the normal ones:
        "reminder": the italic saga-counter reminder line (e.g. with an
                    optional keyword like "Destello" before it, plain text)
        "chapters": [{"count": 1, "text": "..."}, ...] — up to 4 boxes
    """
    mana = spec.get("mana", "") or ""
    type_line = spec.get("type") or "Encantamiento — Saga"
    colors = detect_colors(mana, spec.get("colors"))

    saga_text, saga_state = build_saga_layout(spec.get("chapters", []))

    text = {
        "mana": {
            "name": "Mana Cost", "text": mana, "y": 0.048, "width": 0.9292,
            "height": 71 / 2100, "oneLine": True, "size": 71 / 1638,
            "align": "right", "manaCost": True, "manaSpacing": 0,
        },
        "title": {
            "name": "Title", "text": spec.get("name", ""), "x": 0.0854,
            "y": 0.0522, "width": 0.8292, "height": 0.0543, "oneLine": True,
            "shrinkToFit": True, "font": "belerenb", "size": 0.0381, "color": "white",
        },
        "type": {
            "name": "Type", "text": type_line, "x": 0.0854, "y": 0.855,
            "width": 0.8292, "height": 0.0543, "oneLine": True,
            "font": "belerenb", "size": 0.0324, "color": "white",
        },
        "reminder": {
            "name": "Reminder Text", "text": spec.get("reminder", ""), "x": 0.090,
            "y": 0.160, "width": 0.400, "height": 0.120, "size": 0.0267,
            "font": "mplantini", "color": "black",
        },
        **saga_text,
    }

    art = resolve_art(spec.get("art") or "", spec.get("name", "?"))

    return {
        "name": spec.get("name", "Untitled"),
        "card": {
            "width": 2010, "height": 2814, "marginX": 0, "marginY": 0,
            "version": "", "onload": None,
            "artBounds": {"x": 0.0767, "y": 0.1129, "width": 0.8476, "height": 0.4429},
            "setSymbolBounds": {"x": 0.9213, "y": 0.5910, "width": 0.12,
                                "height": 0.0410, "horizontal": "right"},
            "watermarkBounds": {"x": 0.5, "y": 0.7762, "width": 0.75, "height": 0.2305},
            "text": text, "planeswalker": None, "saga": saga_state, "class": None,
        },
        "frames": [frame_obj(SAGA_FRAMES[colors])],
        "art": art,
        "setSymbol": "",
        "watermark": "",
        "_colors": colors,
        "_art": {
            "zoom": spec.get("artZoom"), "x": spec.get("artX", 0), "y": spec.get("artY", 0),
        },
    }


def build_planeswalker_layout(abilities: list) -> tuple[dict, dict]:
    """Mirrors planeswalkerEdited() in editor.js. Up to 4 entries of
    {"cost": "+1"/"-2"/"0"/"", "text": "..."}; a blank cost is the static
    passive line — no badge icon, so its text box widens to compensate.
    """
    ink = "black"
    defaults_y = [0.6239, 0.6934, 0.7629, 0.8324]
    default_h = 0.0695
    base_x, base_w = 0.1581, 0.766
    wide_x, wide_w = base_x - 0.044, base_w + 0.044

    text = {}
    pw_abilities = ["", "", "", ""]
    count = 0
    y = defaults_y[0]
    for i in range(4):
        ab = abilities[i] if i < len(abilities) else None
        key = f"ability{i}"
        if ab:
            cost = ab.get("cost", "")
            pw_abilities[i] = cost
            count += 1
            x, w = (base_x, base_w) if cost else (wide_x, wide_w)
            # Vanilla planeswalker abilities are usually one-liners, hence the
            # small default box. Longer homebrew text needs an explicit
            # "height" (and optionally "size") per ability, or it overflows
            # into the next ability's band.
            height = ab.get("height", default_h)
            text[key] = {
                "name": f"Ability {i + 1}", "text": ab.get("text", ""),
                "x": x, "y": y, "width": w, "height": height,
                "size": ab.get("size", 0.0324), "font": "mplantin", "color": ink,
            }
            y += height
        else:
            text[key] = {"text": "", "y": 2, "x": base_x, "width": base_w, "height": 0, "size": 0.0324}

    pw_state = {
        "abilities": pw_abilities, "abilityAdjust": [0, 0, 0, 0],
        "count": count, "x": 0.1167, "width": 0.8094,
    }
    return text, pw_state


def build_planeswalker_card(spec: dict) -> dict:
    """Planeswalker layout: art on top, loyalty ability bands below with
    alternating light/dark stripes and +/-/neutral badge icons, loyalty
    number bottom-right in the same box a creature's P/T would use.

    Spec adds:
        "loyalty":   starting loyalty, e.g. "4"
        "abilities": [{"cost": "+1", "text": "..."}, ...] — up to 4, a blank
                     cost (or omitted "cost") makes a static passive line
    """
    mana = spec.get("mana", "") or ""
    type_line = spec.get("type") or "Planeswalker Legendario"
    colors = detect_colors(mana, spec.get("colors"))

    ability_text, pw_state = build_planeswalker_layout(spec.get("abilities", []))

    text = {
        "mana": {
            "name": "Mana Cost", "text": mana, "y": 0.048, "width": 0.9292,
            "height": 71 / 2100, "oneLine": True, "size": 71 / 1638,
            "align": "right", "manaCost": True, "manaSpacing": 0,
        },
        "title": {
            "name": "Title", "text": spec.get("name", ""), "x": 0.0854,
            "y": 0.0522, "width": 0.8292, "height": 0.0543, "oneLine": True,
            "shrinkToFit": True, "font": "belerenb", "size": 0.0381, "color": "white",
        },
        "type": {
            "name": "Type", "text": type_line, "x": 0.0854, "y": 0.574,
            "width": 0.8292, "height": 0.0543, "oneLine": True,
            "font": "belerenb", "size": 0.0324, "color": "white",
        },
        "loyalty": {
            "name": "Loyalty", "text": str(spec.get("loyalty", "")), "x": 0.7928,
            "y": 0.902, "width": 0.1367, "height": 0.0372, "size": 0.0372,
            "font": "belerenbsc", "oneLine": True, "align": "center", "color": "white",
        },
        **ability_text,
    }

    art = resolve_art(spec.get("art") or "", spec.get("name", "?"))

    return {
        "name": spec.get("name", "Untitled"),
        "card": {
            "width": 2010, "height": 2814, "marginX": 0, "marginY": 0,
            "version": "", "onload": None,
            "artBounds": {"x": 0.0767, "y": 0.1129, "width": 0.8476, "height": 0.4429},
            "setSymbolBounds": {"x": 0.9213, "y": 0.5910, "width": 0.12,
                                "height": 0.0410, "horizontal": "right"},
            "watermarkBounds": {"x": 0.5, "y": 0.7762, "width": 0.75, "height": 0.2305},
            "text": text, "planeswalker": pw_state, "saga": None, "class": None,
        },
        "frames": [frame_obj(PW_FRAMES[colors])],
        "art": art,
        "setSymbol": "",
        "watermark": "",
        "_colors": colors,
        "_art": {
            "zoom": spec.get("artZoom"), "x": spec.get("artX", 0), "y": spec.get("artY", 0),
        },
        "_pwLayout": PW_ABILITY_LAYOUT,
    }


def build_card(spec: dict) -> dict:
    """Turn a friendly spec into the editor's serialized-card format.

    `baseImage` switches to recost mode: an already-finished card PNG is used
    as the art at 1:1, and only the title bar plus the title and mana cost are
    repainted over it. That changes a card's cost without needing the original
    art, which is baked into the finished image and cannot be recovered.

    A spec with a `"levels"`, `"chapters"` or `"abilities"` key is a Class,
    Saga or Planeswalker card and is built entirely separately.
    """
    if "levels" in spec:
        return build_class_card(spec)
    if "chapters" in spec:
        return build_saga_card(spec)
    if "abilities" in spec:
        return build_planeswalker_card(spec)

    base_image = spec.get("baseImage")
    if base_image:
        spec = dict(spec)
        spec["art"] = base_image
        spec["artZoom"] = 1          # 2010x2814 base lines up exactly

    mana = spec.get("mana", "") or ""
    pt = (spec.get("pt") or "").strip()
    type_line = spec.get("type", "") or ""
    land = spec.get("land", "land" in type_line.lower() or "tierra" in type_line.lower())
    legendary = spec.get(
        "legendary", "legendar" in type_line.lower()
    )
    creature = bool(pt)

    colors = detect_colors(mana, spec.get("colors"))

    # Borderless frames are dark, so every text block is white by default.
    ink = spec.get("textColor", "white")

    text = {
        "mana": {
            "name": "Mana Cost", "text": mana, "y": 0.048, "width": 0.9292,
            "height": 71 / 2100, "oneLine": True, "size": 71 / 1638,
            "align": "right", "manaCost": True, "manaSpacing": 0,
        },
        # The title box spans the whole bar, including where the mana cost is
        # drawn, so reserve room for the symbols and let long names shrink.
        # y is 0.0040 below the editor's 0.0522 default: measured against the
        # existing cards, whose titles sit that much lower in the bar.
        "title": {
            "name": "Title", "text": spec.get("name", ""), "x": 0.0854,
            "y": spec.get("titleY", 0.0562),
            "width": max(0.35, 0.8292 - 0.052 * len(re.findall(r"\{[^}]+\}", mana))),
            "height": 0.0543, "oneLine": True, "shrinkToFit": True,
            "font": "belerenb", "size": 0.0381, "color": ink,
        },
        "type": {
            "name": "Type", "text": type_line, "x": 0.0854, "y": 0.574,
            "width": 0.8292, "height": 0.0543, "oneLine": True,
            "font": "belerenb", "size": 0.0324, "color": ink,
        },
        # Matches the existing cards: mplantin (the editor defaults to the
        # heavier plantinsemibold), flush left, but centred vertically in the
        # box instead of hanging from the top edge.
        "rules": {
            "name": "Rules Text", "text": spec.get("rules", ""), "x": 0.086,
            "y": 0.638, "width": 0.828, "height": 0.2875, "size": 0.0362,
            "color": ink,
            "font": spec.get("rulesFont", "mplantin"),
            "align": spec.get("rulesAlign", "left"),
            "verticalCenter": spec.get("rulesVerticalCenter", True),
        },
        "pt": {
            "name": "Power/Toughness", "text": pt, "x": 0.7928, "y": 0.902,
            "width": 0.1367, "height": 0.0372, "size": 0.0372,
            "font": "belerenbsc", "oneLine": True, "align": "center",
            "color": ink,
        },
    }

    art = resolve_art(spec.get("art") or "", spec.get("name", "?"))

    if base_image and spec.get("redrawBody"):
        # Rules text changes too: repaint the whole frame over the base image.
        # Stacked for the same opacity reason as the title bar.
        frames = []
        for _ in range(spec.get("titleStack", 8)):
            frames += build_frames(colors, legendary=legendary, land=land,
                                   creature=creature)
    elif base_image:
        # Everything below the title bar is already correct in the base image.
        for k in ("type", "rules", "pt"):
            text[k]["text"] = ""
        frames = build_title_frames(colors, legendary=legendary,
                                    stack=spec.get("titleStack", 8))
    else:
        frames = build_frames(colors, legendary=legendary, land=land,
                              creature=creature)

    return {
        "name": spec.get("name", "Untitled"),
        "card": {
            "width": 2010, "height": 2814, "marginX": 0, "marginY": 0,
            "version": "", "onload": None,
            "artBounds": {"x": 0.0767, "y": 0.1129, "width": 0.8476, "height": 0.4429},
            "setSymbolBounds": {"x": 0.9213, "y": 0.5910, "width": 0.12,
                                "height": 0.0410, "horizontal": "right"},
            "watermarkBounds": {"x": 0.5, "y": 0.7762, "width": 0.75, "height": 0.2305},
            "text": text, "planeswalker": None, "saga": None,
        },
        "frames": frames,
        "art": art,
        "setSymbol": "",
        "watermark": "",
        "_colors": colors,
        # Art placement. Default is "cover the whole card" (these frames are
        # full-art); override per card with artZoom / artX / artY.
        "_art": {
            "zoom": spec.get("artZoom"),
            "x": spec.get("artX", 0),
            "y": spec.get("artY", 0),
        },
    }


# ── Browser driving ──────────────────────────────────────────────────────────
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
   'class','saga','planeswalkerPreFrame','planeswalkerPostFrame']
      .forEach(n => sizeCanvas(n));

  await loadImg(window.art, entry.art);

  // Class cards: paint the level-header bands onto classCanvas the same way
  // classEdited() does live, but driven from entry data instead of DOM inputs
  // (there is no UI panel to read from in headless mode).
  if (card.class && card.class.count > 0) {
    const headerImg = new Image(); headerImg.crossOrigin = 'anonymous';
    await new Promise(res => { headerImg.onload = headerImg.onerror = res; headerImg.src = '/img/frames/Class/_ui/header.png'; });
    classContext.clearRect(0, 0, classCanvas.width, classCanvas.height);
    for (let i = 1; i <= card.class.count; i++) {
      const tc = card.text['level' + i + 'c'];
      if (!tc || tc.y >= 2) continue;
      classContext.drawImage(headerImg, scaleX(card.class.x), scaleY(tc.y) - scaleHeight(0.0481),
                              scaleWidth(card.class.width), scaleHeight(0.0481));
    }
  }

  // Saga cards: paint chapter pips + roman numerals, mirroring drawSagaChapters().
  if (card.saga && card.saga.count > 0) {
    const chapterImg = new Image(); chapterImg.crossOrigin = 'anonymous';
    const dividerImg = new Image(); dividerImg.crossOrigin = 'anonymous';
    await Promise.all([
      new Promise(res => { chapterImg.onload = chapterImg.onerror = res; chapterImg.src = '/img/frames/Saga/_ui/sagaChapter.png'; }),
      new Promise(res => { dividerImg.onload = dividerImg.onerror = res; dividerImg.src = '/img/frames/Saga/_ui/sagaDivider.png'; }),
    ]);
    const s = card.saga;
    sagaContext.clearRect(0, 0, sagaCanvas.width, sagaCanvas.height);
    sagaContext.font = 'normal normal 550 ' + scaleHeight(0.0324) + 'px plantinsemibold';
    sagaContext.textAlign = 'center';
    sagaContext.fillStyle = '#333';
    sagaContext.textBaseline = 'alphabetic';

    let sagaCount = 1;
    for (let i = 0; i < s.count; i++) {
      const obj = card.text['ability' + i];
      if (!obj) continue;
      const x = scaleX(s.x), y = scaleY(obj.y), w = scaleWidth(s.width), h = scaleHeight(obj.height);
      const chapters = s.abilities[i] || 1;

      if (dividerImg.naturalWidth)
        sagaContext.drawImage(dividerImg, x, y - scaleHeight(0.0029) / 2, w, scaleHeight(0.0029));

      if (chapterImg.naturalWidth) {
        const nW = scaleWidth(0.0787), nH = scaleHeight(0.0629);
        const nX = x - scaleWidth(0.0614);
        const nY = y + (h - nH) / 2;
        const nTX = nX + scaleWidth(0.0394);
        const nTY = nY + scaleHeight(0.0429);
        const sp  = scaleHeight(0.0358);

        if (chapters >= 3) {
          sagaContext.drawImage(chapterImg, nX, nY - 2 * sp, nW, nH);
          sagaContext.drawImage(chapterImg, nX, nY,          nW, nH);
          sagaContext.drawImage(chapterImg, nX, nY + 2 * sp, nW, nH);
          sagaContext.fillText(romanNumeral(sagaCount),     nTX, nTY - 2 * sp);
          sagaContext.fillText(romanNumeral(sagaCount + 1), nTX, nTY);
          sagaContext.fillText(romanNumeral(sagaCount + 2), nTX, nTY + 2 * sp);
          sagaCount += 3;
        } else if (chapters === 2) {
          sagaContext.drawImage(chapterImg, nX, nY - sp, nW, nH);
          sagaContext.drawImage(chapterImg, nX, nY + sp, nW, nH);
          sagaContext.fillText(romanNumeral(sagaCount),     nTX, nTY - sp);
          sagaContext.fillText(romanNumeral(sagaCount + 1), nTX, nTY + sp);
          sagaCount += 2;
        } else {
          sagaContext.drawImage(chapterImg, nX, nY, nW, nH);
          sagaContext.fillText(romanNumeral(sagaCount), nTX, nTY);
          sagaCount++;
        }
      }
    }
  }

  // Planeswalker cards: alternating ability-band stripes (preFrame) + loyalty
  // badge icons (postFrame), mirroring planeswalkerEdited() minus the DOM.
  if (card.planeswalker && card.planeswalker.count > 0) {
    const uiFolder = '/img/frames/Planeswalker/_ui';
    const plusIcon = new Image(), minusIcon = new Image(), neutralIcon = new Image();
    const lightToDark = new Image(), darkToLight = new Image(), textMask = new Image();
    [plusIcon, minusIcon, neutralIcon, lightToDark, darkToLight, textMask].forEach(i => i.crossOrigin = 'anonymous');
    await Promise.all([
      new Promise(res => { plusIcon.onload    = plusIcon.onerror    = res; plusIcon.src    = `${uiFolder}/planeswalkerPlus.png`; }),
      new Promise(res => { minusIcon.onload   = minusIcon.onerror   = res; minusIcon.src   = `${uiFolder}/planeswalkerMinus.png`; }),
      new Promise(res => { neutralIcon.onload = neutralIcon.onerror = res; neutralIcon.src = `${uiFolder}/planeswalkerNeutral.png`; }),
      new Promise(res => { lightToDark.onload = lightToDark.onerror = res; lightToDark.src = `${uiFolder}/abilityLineOdd.png`; }),
      new Promise(res => { darkToLight.onload = darkToLight.onerror = res; darkToLight.src = `${uiFolder}/abilityLineEven.png`; }),
      new Promise(res => { textMask.onload    = textMask.onerror    = res; textMask.src    = `${uiFolder}/text.svg`; }),
    ]);

    const pw = card.planeswalker;
    const preCtx = planeswalkerPreFrameContext;
    const transH = scaleHeight(0.0048);
    preCtx.clearRect(0, 0, planeswalkerPreFrameCanvas.width, planeswalkerPreFrameCanvas.height);
    preCtx.globalCompositeOperation = 'source-over';

    for (let i = 0; i < pw.count; i++) {
      const obj = card.text['ability' + i];
      if (!obj) continue;
      const x = scaleX(pw.x);
      let   y = scaleY(obj.y);
      const w = scaleWidth(pw.width);
      let   h = scaleHeight(obj.height);
      if (i === 0)            { y -= scaleHeight(0.1); h += scaleHeight(0.1); }
      if (i === pw.count - 1) { h += scaleHeight(0.5); }

      if (i % 2 === 0) {
        preCtx.fillStyle = 'white'; preCtx.globalAlpha = 0.608;
        preCtx.fillRect(x, y + transH, w, h - 2 * transH);
        preCtx.globalAlpha = 1;
        if (lightToDark.naturalWidth) preCtx.drawImage(lightToDark, x, y + h - transH, w, 2 * transH);
      } else {
        preCtx.fillStyle = '#a4a4a4'; preCtx.globalAlpha = 0.706;
        preCtx.fillRect(x, y + transH, w, h - 2 * transH);
        preCtx.globalAlpha = 1;
        if (darkToLight.naturalWidth) preCtx.drawImage(darkToLight, x, y + h - transH, w, 2 * transH);
      }
    }
    if (textMask.naturalWidth) {
      preCtx.globalCompositeOperation = 'destination-in';
      preCtx.drawImage(textMask, scaleX(0), scaleY(0), scaleWidth(1), scaleHeight(1));
      preCtx.globalCompositeOperation = 'source-over';
    }

    const postCtx = planeswalkerPostFrameContext;
    postCtx.clearRect(0, 0, planeswalkerPostFrameCanvas.width, planeswalkerPostFrameCanvas.height);
    postCtx.globalCompositeOperation = 'source-over';
    postCtx.fillStyle    = 'white';
    postCtx.font         = scaleHeight(0.0286) + 'px belerenbsc';
    postCtx.textAlign    = 'center';
    postCtx.textBaseline = 'alphabetic';

    const layout = entry._pwLayout[pw.count - 1] || entry._pwLayout[2];
    for (let i = 0; i < pw.count; i++) {
      const cost = pw.abilities[i];
      const py   = scaleY((layout[i] ?? 0.72) + (pw.abilityAdjust[i] || 0));
      if (cost.includes('+')) {
        if (plusIcon.naturalWidth) postCtx.drawImage(plusIcon, scaleX(0.0294), py - scaleHeight(0.0258), scaleWidth(0.14), scaleHeight(0.0724));
        postCtx.fillText(cost, scaleX(0.1027), py + scaleHeight(0.0172));
      } else if (cost.includes('-')) {
        if (minusIcon.naturalWidth) postCtx.drawImage(minusIcon, scaleX(0.028), py - scaleHeight(0.0153), scaleWidth(0.1414), scaleHeight(0.0705));
        postCtx.fillText(cost, scaleX(0.1027), py + scaleHeight(0.0181));
      } else if (cost !== '') {
        if (neutralIcon.naturalWidth) postCtx.drawImage(neutralIcon, scaleX(0.028), py - scaleHeight(0.0153), scaleWidth(0.1414), scaleHeight(0.061));
        postCtx.fillText(cost, scaleX(0.1027), py + scaleHeight(0.0191));
      }
    }
  }

  // Art placement: scale to cover the full card unless the spec says otherwise.
  const a = entry._art || {};
  if (window.art && window.art.naturalWidth && !window.art.src.includes('blank')) {
    card.artZoom = a.zoom != null ? a.zoom : Math.max(
      card.width  / window.art.naturalWidth,
      card.height / window.art.naturalHeight
    );
  } else {
    card.artZoom = 1;
  }
  card.artX = a.x || 0;
  card.artY = a.y || 0;
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

  // Every card font must be really loaded before measuring, or autoShrink
  // sizes the text against the fallback serif's metrics.
  if (window.ensureFontsLoaded) await window.ensureFontsLoaded();
  else if (document.fonts) await document.fonts.ready;

  drawCard();
  await new Promise(r => setTimeout(r, 120));
  drawCard();
  return cardCanvas.toDataURL('image/png');
}
"""


def render(specs: list[dict], outdir: Path, base_url: str, quiet: bool = False) -> list[Path]:
    from playwright.sync_api import sync_playwright

    outdir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        page.goto(f"{base_url}/editor.html", wait_until="networkidle")
        page.wait_for_function("typeof drawCard === 'function' && typeof card === 'object'")

        for spec in specs:
            entry = build_card(spec)
            data_url = page.evaluate(INJECT, entry)
            png = base64.b64decode(data_url.split(",", 1)[1])
            safe = re.sub(r'[<>:"/\\|?*]', "_", entry["name"]).strip() or "carta"
            path = outdir / f"{safe}.png"
            path.write_bytes(png)
            written.append(path)
            if not quiet:
                print(f"  [{entry['_colors']:>2}] {path.name}  ({len(png)//1024} KB)")

        browser.close()

    return written


def resolve_art_paths(specs: list[dict], base: Path) -> list[dict]:
    """Make relative `art`/`baseImage` paths relative to the spec file, not CWD."""
    out = []
    for s in specs:
        s = dict(s)
        for key in ("art", "baseImage"):
            v = s.get(key) or ""
            if v and not v.startswith(("http://", "https://", "data:")) \
                    and not Path(v).is_absolute():
                s[key] = str((base / v).resolve())
        out.append(s)
    return out


class RenderWorker:
    """Persistent headless browser on its own thread.

    Playwright's sync API is not thread-safe, so every render is funnelled
    through a single owner thread via a queue. Keeps the browser warm, so a
    render costs ~0.3 s instead of the ~3 s a cold start would.
    """

    def __init__(self, base_url: str):
        import queue

        self.base_url = base_url
        self._jobs: "queue.Queue" = queue.Queue()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._started = threading.Event()
        self._thread.start()
        self._started.wait(timeout=60)

    def _loop(self):
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            page.goto(f"{self.base_url}/editor.html", wait_until="networkidle")
            page.wait_for_function(
                "typeof drawCard === 'function' && typeof card === 'object'"
            )
            self._started.set()

            while True:
                spec, box = self._jobs.get()
                if spec is None:
                    break
                try:
                    entry = build_card(spec)
                    data_url = page.evaluate(INJECT, entry)
                    box["png"] = base64.b64decode(data_url.split(",", 1)[1])
                    box["colors"] = entry["_colors"]
                except Exception as exc:  # noqa: BLE001 - surfaced to the caller
                    box["error"] = str(exc)
                finally:
                    box["done"].set()
            browser.close()

    def render_one(self, spec: dict, timeout: float = 60) -> bytes:
        box = {"done": threading.Event()}
        self._jobs.put((spec, box))
        if not box["done"].wait(timeout):
            raise TimeoutError("render timed out")
        if "error" in box:
            raise RuntimeError(box["error"])
        return box["png"]


def _serve_in_background(port: int):
    """Start server.py in-process so render.py works standalone."""
    import server

    t = threading.Thread(
        target=lambda: server.app.run(host="127.0.0.1", port=port, debug=False,
                                      use_reloader=False),
        daemon=True,
    )
    t.start()
    time.sleep(1.2)


DEMO = [
    {"name": "Truco de piromancia", "mana": "{R}", "type": "Instantáneo — Piromancia",
     "rules": "Truco de piromancia hace 3 de daño a un objetivo."},
    {"name": "Ritual del Abismo", "mana": "{B}", "type": "Instantáneo",
     "rules": "Añade {B}{B}{B}."},
    {"name": "Bruja del Caos Quelaag", "mana": "{2}{B}{R}",
     "type": "Criatura Legendaria — Horror Piromántico", "pt": "3/4",
     "rules": "Cuando lanzas una piromancia, puedes perder 2 vidas. Si lo haces, roba una carta y cada oponente pierde 1 vida."},
]


def main():
    ap = argparse.ArgumentParser(description="Render MTG cards headlessly.")
    ap.add_argument("input", nargs="?", help="JSON file with one card or a list")
    ap.add_argument("-o", "--out", default="rendered", help="output directory")
    ap.add_argument("--demo", action="store_true", help="render three sample cards")
    ap.add_argument("--url", default=None, help="use an already-running server")
    ap.add_argument("--port", type=int, default=3001, help="port for the bundled server")
    args = ap.parse_args()

    if args.demo:
        specs = DEMO
    elif args.input:
        src = Path(args.input).resolve()
        data = json.loads(src.read_text(encoding="utf-8"))
        specs = data if isinstance(data, list) else [data]
        specs = resolve_art_paths(specs, src.parent)
    else:
        ap.error("give an input JSON file or --demo")

    base_url = args.url
    if not base_url:
        _serve_in_background(args.port)
        base_url = f"http://127.0.0.1:{args.port}"

    print(f"Renderizando {len(specs)} carta(s) -> {args.out}/")
    written = render(specs, Path(args.out), base_url)
    print(f"Listo: {len(written)} PNG.")


if __name__ == "__main__":
    sys.exit(main())
