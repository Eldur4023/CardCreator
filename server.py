"""CardCreator backend.

  GET    /api/frames                       -> frame browser tree
  GET    /api/library                      -> saved cards
  POST   /api/library                      -> save card (prepended)
  PATCH  /api/library/<id>                 -> rename card
  DELETE /api/library/<id>                 -> delete card
  GET    /api/decks                        -> deck list
  POST   /api/decks                        -> create deck
  DELETE /api/decks/<id>                   -> delete deck
  PUT    /api/decks/<id>/cards/<card_id>   -> add card to deck
  DELETE /api/decks/<id>/cards/<card_id>   -> remove card from deck
  POST   /api/render                       -> card spec to PNG
  static: /img/frames, /img/manaSymbols, /img, /fonts, / (public)

Run:  py server.py            (http://localhost:3000)
"""
from __future__ import annotations

import base64
import json
import random
import string
import threading
import time
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

PORT = 3000
ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
LIBRARY_PATH = DATA / "library.json"
DECKS_PATH = DATA / "decks.json"

IMG_EXTS = {".png", ".jpg", ".svg", ".webp"}

app = Flask(__name__, static_folder=None)


# ── CORS ─────────────────────────────────────────────────────────────────────
@app.after_request
def add_cors(res):
    res.headers["Access-Control-Allow-Origin"] = "*"
    res.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    res.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return res


# ── JSON file helpers ────────────────────────────────────────────────────────
def read_array(path: Path) -> list:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def write_array(path: Path, arr: list) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(arr, ensure_ascii=False), encoding="utf-8")


# ── Frame browser ────────────────────────────────────────────────────────────
def scan_dir(directory: Path) -> dict:
    result = {"frames": [], "subs": {}}

    meta = {}
    meta_path = directory / "frames.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            meta = {}

    for entry in sorted(directory.iterdir(), key=lambda p: p.name):
        name = entry.name
        if name.startswith("_"):
            continue
        if entry.is_dir():
            result["subs"][name] = scan_dir(entry)
        elif entry.is_file() and entry.suffix.lower() in IMG_EXTS:
            file_obj = {"file": name}
            if isinstance(meta.get(name), dict):
                file_obj.update(meta[name])
            result["frames"].append(file_obj)

    return result


@app.get("/api/frames")
def api_frames():
    base = ASSETS / "img" / "frames"
    root: dict = {}
    if base.is_dir():
        for cat in sorted(base.iterdir(), key=lambda p: p.name):
            if not cat.is_dir() or cat.name.startswith("_"):
                continue
            root[cat.name] = {}
            for sub in sorted(cat.iterdir(), key=lambda p: p.name):
                if not sub.is_dir() or sub.name.startswith("_"):
                    continue
                root[cat.name][sub.name] = scan_dir(sub)
    return jsonify(root)


# ── Library ──────────────────────────────────────────────────────────────────
@app.get("/api/library")
def library_list():
    return jsonify(read_array(LIBRARY_PATH))


@app.post("/api/library")
def library_save():
    entry = request.get_json(silent=True)
    if entry is None:
        return jsonify({"error": "invalid json"}), 400
    # Fill id/savedAt when missing, so cards can be posted programmatically.
    if isinstance(entry, dict):
        entry.setdefault(
            "id",
            f"{int(time.time() * 1000)}-"
            + "".join(random.choices(string.ascii_lowercase + string.digits, k=9)),
        )
        entry.setdefault("savedAt", int(time.time() * 1000))
    cards = read_array(LIBRARY_PATH)
    cards.insert(0, entry)
    write_array(LIBRARY_PATH, cards)
    return jsonify(entry)


@app.patch("/api/library/<card_id>")
def library_rename(card_id):
    patch = request.get_json(silent=True)
    if patch is None:
        return jsonify({"error": "invalid json"}), 400
    cards = read_array(LIBRARY_PATH)
    for c in cards:
        if isinstance(c, dict) and c.get("id", "") == card_id:
            if "name" in patch:
                c["name"] = patch["name"]
            write_array(LIBRARY_PATH, cards)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404


@app.delete("/api/library/<card_id>")
def library_delete(card_id):
    cards = read_array(LIBRARY_PATH)
    cards = [c for c in cards if not (isinstance(c, dict) and c.get("id", "") == card_id)]
    write_array(LIBRARY_PATH, cards)
    return jsonify({"ok": True})


# ── Decks ────────────────────────────────────────────────────────────────────
@app.get("/api/decks")
def decks_list():
    return jsonify(read_array(DECKS_PATH))


@app.post("/api/decks")
def decks_create():
    body = request.get_json(silent=True)
    if body is None:
        return jsonify({"error": "invalid json"}), 400
    name = body.get("name", "") if isinstance(body, dict) else ""
    if not name:
        return jsonify({"error": "name required"}), 400
    now = int(time.time() * 1000)
    deck = {"id": str(now), "name": name, "createdAt": now, "cards": []}
    decks = read_array(DECKS_PATH)
    decks.append(deck)
    write_array(DECKS_PATH, decks)
    return jsonify(deck)


@app.delete("/api/decks/<deck_id>")
def decks_delete(deck_id):
    decks = read_array(DECKS_PATH)
    decks = [d for d in decks if not (isinstance(d, dict) and d.get("id", "") == deck_id)]
    write_array(DECKS_PATH, decks)
    return jsonify({"ok": True})


@app.put("/api/decks/<deck_id>/cards/<card_id>")
def deck_add_card(deck_id, card_id):
    decks = read_array(DECKS_PATH)
    for d in decks:
        if isinstance(d, dict) and d.get("id", "") == deck_id:
            cards = d.setdefault("cards", [])
            if card_id not in cards:
                cards.append(card_id)
            write_array(DECKS_PATH, decks)
            return jsonify({"ok": True})
    return jsonify({"error": "deck not found"}), 404


@app.delete("/api/decks/<deck_id>/cards/<card_id>")
def deck_remove_card(deck_id, card_id):
    decks = read_array(DECKS_PATH)
    for d in decks:
        if isinstance(d, dict) and d.get("id", "") == deck_id:
            d["cards"] = [c for c in d.get("cards", []) if c != card_id]
            write_array(DECKS_PATH, decks)
            return jsonify({"ok": True})
    return jsonify({"error": "deck not found"}), 404


# ── Static files ─────────────────────────────────────────────────────────────
@app.get("/img/frames/<path:filename>")
def static_frames(filename):
    return send_from_directory(ASSETS / "img" / "frames", filename)


@app.get("/img/manaSymbols/<path:filename>")
def static_mana(filename):
    return send_from_directory(ASSETS / "img" / "manaSymbols", filename)


@app.get("/img/<path:filename>")
def static_img(filename):
    # public/img first (black.png / blank.png live there), then assets/img
    if (PUBLIC / "img" / filename).is_file():
        return send_from_directory(PUBLIC / "img", filename)
    return send_from_directory(ASSETS / "img", filename)


@app.get("/fonts/<path:filename>")
def static_fonts(filename):
    return send_from_directory(ASSETS / "fonts", filename)


# ── Headless render (see render.py) ───────────────────────────────────────────
_renderer = None
_renderer_lock = threading.Lock()


def get_renderer():
    """Start the browser on first use, so plain server use stays lightweight."""
    global _renderer
    with _renderer_lock:
        if _renderer is None:
            import render

            _renderer = render.Renderer(f"http://127.0.0.1:{PORT}")
    return _renderer


@app.post("/api/render")
def api_render():
    """POST a card spec -> PNG. A list of specs -> JSON of base64 PNGs.

    curl -X POST localhost:3000/api/render -H "Content-Type: application/json" \
         -d '{"name":"Truco","mana":"{R}","type":"Instantáneo — Piromancia",
              "rules":"Hace 3 de daño a un objetivo."}' --output truco.png
    """
    spec = request.get_json(silent=True)
    if spec is None:
        return jsonify({"error": "invalid json"}), 400
    try:
        renderer = get_renderer()
    except Exception as exc:  # playwright missing, browser not installed, ...
        return jsonify({"error": f"renderer unavailable: {exc}"}), 503

    try:
        if isinstance(spec, list):
            return jsonify([
                {"name": one.get("name", "Untitled"),
                 "png": base64.b64encode(renderer.render(one)).decode()}
                for one in spec
            ])
        return Response(renderer.render(spec), mimetype="image/png")
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.get("/")
def index():
    return send_from_directory(PUBLIC, "index.html")


@app.get("/<path:filename>")
def static_public(filename):
    target = PUBLIC / filename
    if target.is_file():
        return send_from_directory(PUBLIC, filename)
    # SPA fallback
    return send_from_directory(PUBLIC, "index.html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
