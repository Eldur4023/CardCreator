'use strict';

// ── Scaling ──────────────────────────────────────────────────────────────────
function scaleX(v)      { return Math.round((v + card.marginX) * card.width); }
function scaleY(v)      { return Math.round((v + card.marginY) * card.height); }
function scaleWidth(v)  { return Math.round(v * card.width); }
function scaleHeight(v) { return Math.round(v * card.height); }

// ── Canvas helpers ────────────────────────────────────────────────────────────
const canvasList = ['card', 'frame', 'frameMasking', 'frameCompositing',
                    'text', 'paragraph', 'line', 'watermark'];

function sizeCanvas(name, w, h) {
    const cw = w ?? Math.round(card.width  * (1 + 2 * card.marginX));
    const ch = h ?? Math.round(card.height * (1 + 2 * card.marginY));
    let el = document.getElementById(name + 'Canvas');
    if (!el) {
        el = document.createElement('canvas');
        el.id = name + 'Canvas';
        el.style.display = 'none';
        document.body.appendChild(el);
    }
    el.width  = cw;
    el.height = ch;
    window[name + 'Canvas']  = el;
    window[name + 'Context'] = el.getContext('2d');
}

// ── Card model ────────────────────────────────────────────────────────────────
var card = {
    width: 2010, height: 2814,
    marginX: 0,  marginY: 0,
    frames: [],
    artSource: '/img/blank.png',
    artX: 0, artY: 0, artZoom: 1, artRotate: 0,
    artBounds: null,
    setSymbolSource: '/img/blank.png',
    setSymbolX: 0, setSymbolY: 0, setSymbolZoom: 1,
    setSymbolBounds: null,
    watermarkSource: '/img/blank.png',
    watermarkX: 0, watermarkY: 0, watermarkZoom: 1,
    watermarkLeft: 'none', watermarkRight: 'none',
    watermarkOpacity: 0.4,
    watermarkBounds: null,
    text: null,
    version: '',
    manaSymbols: [],
    infoYear: new Date().getFullYear(),
};

// ── Core images ───────────────────────────────────────────────────────────────
const black = new Image(); black.crossOrigin = 'anonymous'; black.src = '/img/black.png';
const blank = new Image(); blank.crossOrigin = 'anonymous'; blank.src = '/img/blank.png';

const art       = new Image(); art.crossOrigin = 'anonymous';
const setSymbol = new Image(); setSymbol.crossOrigin = 'anonymous';
const watermark = new Image(); watermark.crossOrigin = 'anonymous';

art.src       = '/img/blank.png';
setSymbol.src = '/img/blank.png';
watermark.src = '/img/blank.png';

// Expose on window: library.js reads window.art / window.setSymbol /
// window.watermark when serializing and loading cards. Without this the
// saved entry stores an empty art field and loading never restores it.
window.art       = art;
window.setSymbol = setSymbol;
window.watermark = watermark;

art.onload       = () => drawCard();
setSymbol.onload = () => drawCard();
watermark.onload = () => drawCard();

art.onerror       = () => { if (!art.src.includes('blank')) art.src = '/img/blank.png'; };
setSymbol.onerror = () => { if (!setSymbol.src.includes('blank')) setSymbol.src = '/img/blank.png'; };
watermark.onerror = () => { if (!watermark.src.includes('blank')) watermark.src = '/img/blank.png'; };

// ── Canvases ──────────────────────────────────────────────────────────────────
var previewCanvas, previewContext;

function initCanvases() {
    previewCanvas  = document.getElementById('previewCanvas');
    previewContext = previewCanvas.getContext('2d');
    canvasList.forEach(name => sizeCanvas(name));
}

// ── Mana symbols ──────────────────────────────────────────────────────────────
const mana = new Map();

function loadManaSymbols(matchColor, paths, size) {
    if (typeof matchColor !== 'boolean') {
        size       = paths;
        paths      = matchColor;
        matchColor = false;
    }
    size = size || [1, 1];
    paths.forEach(item => {
        const name  = (typeof item === 'string' ? item : item[0]).split('.')[0].split('/').pop();
        const path  = typeof item === 'string' ? item : item[0];
        let imgPath = '/img/manaSymbols/' + path;
        if (!imgPath.includes('.png')) imgPath += '.svg';
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = imgPath;
        img.onload = () => drawCard();
        mana.set(name, { name, image: img, width: size[0], height: size[1], matchColor });
    });
}

function getManaSymbol(key) { return mana.get(key); }

loadManaSymbols(['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20',
                 'w','u','b','r','g','c','x','y','z','t','untap','s','oldtap','purple','inf','alchemy']);
loadManaSymbols(true, ['e', 'a']);
loadManaSymbols(['wu','wb','ub','ur','br','bg','rg','rw','gw','gu',
                 '2w','2u','2b','2r','2g',
                 'wp','up','bp','rp','gp','p',
                 'wup','wbp','ubp','urp','brp','bgp','rgp','rwp','gwp','gup'], [1.2, 1.2]);
loadManaSymbols(true, ['chaos'], [1.2, 1]);
loadManaSymbols(true, ['planeswalker'], [0.6, 1.2]);
loadManaSymbols(true, ['+1','+2','+3','+4','+5','+6','+7','+8','+9',
                        '-1','-2','-3','-4','-5','-6','-7','-8','-9','+0'], [1.6, 1]);

// Tracks version scripts already injected (frames/versionSaga.js, etc.).
// Declared here because resetCardIrregularities() and library.js both use it.
var loadedVersions = [];
function loadScript(src) {
    if (!src || loadedVersions.includes(src)) return;
    loadedVersions.push(src);
    const s = document.createElement('script');
    s.src = src;
    document.body.appendChild(s);
}

// ── Reset card state ──────────────────────────────────────────────────────────
async function resetCardIrregularities({ canvas } = {}) {
    if (canvas) {
        card.width   = canvas[0];
        card.height  = canvas[1];
        card.marginX = canvas[2] || 0;
        card.marginY = canvas[3] || 0;
    } else {
        card.width   = 2010;
        card.height  = 2814;
        card.marginX = 0;
        card.marginY = 0;
    }
    card.frames          = [];
    card.artBounds       = null;
    card.setSymbolBounds = null;
    card.watermarkBounds = null;
    card.text            = null;
    card.version         = '';
    card.onload          = null;
    card.planeswalker    = null;
    card.saga            = null;
    card.class           = null;

    canvasList.forEach(name => sizeCanvas(name));

    setSymbol.src = '/img/blank.png';
    watermark.src = '/img/blank.png';

    // Clear special canvases
    if (window.planeswalkerPreFrameContext)  planeswalkerPreFrameContext.clearRect(0, 0, planeswalkerPreFrameCanvas.width, planeswalkerPreFrameCanvas.height);
    if (window.planeswalkerPostFrameContext) planeswalkerPostFrameContext.clearRect(0, 0, planeswalkerPostFrameCanvas.width, planeswalkerPostFrameCanvas.height);
    if (window.sagaContext)                  sagaContext.clearRect(0, 0, sagaCanvas.width, sagaCanvas.height);
    if (window.classContext)                 classContext.clearRect(0, 0, classCanvas.width, classCanvas.height);
    // Reset version tracking so next load re-inits the editor
    loadedVersions = loadedVersions.filter(v =>
        v !== '/js/frames/versionPlaneswalker.js' && v !== '/js/frames/versionSaga.js'
    );

    document.getElementById('frame-list').innerHTML = '';
    document.getElementById('special-editor').innerHTML = '';

    drawCard();
    return Promise.resolve();
}

// ── Text options ──────────────────────────────────────────────────────────────
var selectedTextKey = null;

function loadBottomInfo(options) {
    // Bottom collector lines — merge into card.text with a 'bottom_' prefix
    if (!card.text) card.text = {};
    Object.entries(options).forEach(([k, v]) => {
        card.text['bottom_' + k] = v;
    });
    renderTextOptionButtons();
}

function resetWatermark() {
    card.watermarkX    = 0;
    card.watermarkY    = 0;
    card.watermarkZoom = 1;
    const xEl = document.getElementById('watermark-x');
    const yEl = document.getElementById('watermark-y');
    const zEl = document.getElementById('watermark-zoom');
    if (xEl) xEl.value = 0;
    if (yEl) yEl.value = 0;
    if (zEl) zEl.value = 100;
}

function loadTextOptions(options) {
    if (!card.text) card.text = {};
    Object.assign(card.text, options);
    renderTextOptionButtons();
    if (Object.keys(options).length > 0) {
        selectTextArea(Object.keys(options)[0]);
    }
}

function renderTextOptionButtons() {
    const container = document.getElementById('text-options');
    container.innerHTML = '';
    if (!card.text) return;
    Object.entries(card.text).forEach(([key, obj]) => {
        if (key.startsWith('bottom_')) return; // collector lines not user-editable
        const btn = document.createElement('button');
        btn.className  = 'text-option-btn' + (key === selectedTextKey ? ' active' : '');
        btn.textContent = obj.name || key;
        btn.onclick = () => selectTextArea(key);
        container.appendChild(btn);
    });
}

function selectTextArea(key) {
    selectedTextKey = key;
    const obj = card.text[key];
    if (!obj) return;
    const editor = document.getElementById('text-editor');
    editor.value = obj.text || '';
    document.getElementById('text-editor-font-size').value = obj.sizeOverride || 0;
    document.getElementById('text-x').value = obj.x != null ? Math.round(obj.x * 1000) : '';
    document.getElementById('text-y').value = obj.y != null ? Math.round(obj.y * 1000) : '';
    document.querySelectorAll('.text-option-btn').forEach(b => {
        b.classList.toggle('active', b.textContent === (obj.name || key));
    });
}

function textPositionEdited() {
    if (!selectedTextKey || !card.text[selectedTextKey]) return;
    const obj = card.text[selectedTextKey];
    const x = parseFloat(document.getElementById('text-x').value);
    const y = parseFloat(document.getElementById('text-y').value);
    if (!isNaN(x)) obj.x = x / 1000;
    if (!isNaN(y)) obj.y = y / 1000;
    drawCard();
}

function textEdited() {
    if (!selectedTextKey || !card.text[selectedTextKey]) return;
    card.text[selectedTextKey].text = document.getElementById('text-editor').value;
    drawCard();
}

function fontSizeEdited() {
    if (!selectedTextKey || !card.text[selectedTextKey]) return;
    card.text[selectedTextKey].sizeOverride = parseFloat(document.getElementById('text-editor-font-size').value) || 0;
    drawCard();
}

function wrapTextTag(tag) {
    const el  = document.getElementById('text-editor');
    const s   = el.selectionStart, e = el.selectionEnd;
    const val = el.value;
    el.value  = val.slice(0, s) + '{' + tag + '}' + val.slice(s, e) + '{/' + tag + '}' + val.slice(e);
    textEdited();
}

function insertText(str) {
    const el = document.getElementById('text-editor');
    const s  = el.selectionStart;
    el.value = el.value.slice(0, s) + str + el.value.slice(s);
    textEdited();
}

// ── Art editing ───────────────────────────────────────────────────────────────
function artEdited() {
    card.artX      = parseFloat(document.getElementById('art-x').value)      || 0;
    card.artY      = parseFloat(document.getElementById('art-y').value)      || 0;
    card.artZoom   = (parseFloat(document.getElementById('art-zoom').value)  || 100) / 100;
    card.artRotate = parseFloat(document.getElementById('art-rotate').value) || 0;
    drawCard();
}

function syncArtInputs() {
    document.getElementById('art-x').value      = card.artX;
    document.getElementById('art-y').value      = card.artY;
    document.getElementById('art-zoom').value   = Math.round(card.artZoom * 1000) / 10;
    document.getElementById('art-rotate').value = card.artRotate;
}

function autoFitArt() {
    if (!art.naturalWidth || art.src.includes('blank')) return;
    card.artZoom = card.width / art.naturalWidth;
    card.artX    = 0;
    card.artY    = 0;
    syncArtInputs();
    drawCard();
}

function uploadArt(src) {
    art.src = src;
    art.onload = () => { autoFitArt(); drawCard(); };
    card.artSource = src;
    drawCard();
}

// ── Set symbol editing ────────────────────────────────────────────────────────
function setSymbolEdited() {
    card.setSymbolX    = parseFloat(document.getElementById('setSymbol-x')?.value)    || 0;
    card.setSymbolY    = parseFloat(document.getElementById('setSymbol-y')?.value)    || 0;
    card.setSymbolZoom = (parseFloat(document.getElementById('setSymbol-zoom')?.value) || 100) / 100;
    drawCard();
}

function resetSetSymbol() {
    card.setSymbolX    = 0;
    card.setSymbolY    = 0;
    card.setSymbolZoom = 1;
    const xEl = document.getElementById('setSymbol-x');
    const yEl = document.getElementById('setSymbol-y');
    const zEl = document.getElementById('setSymbol-zoom');
    if (xEl) xEl.value = 0;
    if (yEl) yEl.value = 0;
    if (zEl) zEl.value = 100;
    drawCard();
}

function uploadSetSymbol(src) {
    setSymbol.src = src;
    card.setSymbolSource = src;
}

function fetchSetSymbol() {
    const code   = document.getElementById('set-symbol-code').value.toLowerCase();
    const rarity = document.getElementById('set-symbol-rarity').value.toLowerCase();
    const source = document.getElementById('set-symbol-source').value;
    if (!code) return;

    let url = '';
    if (source === 'cardconjurer') {
        url = `https://card-conjurer.storage.googleapis.com/img/setSymbols/${code}/${rarity || 'r'}.svg`;
    } else if (source === 'gatherer') {
        url = `https://gatherer.wizards.com/handlers/image.ashx?type=symbol&set=${code}&size=large&rarity=${rarity || 'R'}`;
    } else if (source === 'hexproof') {
        url = `https://hexproof.io/mtg/symbols/set/${code}/svg`;
    }
    if (url) uploadSetSymbol(url);
}

// ── Watermark editing ─────────────────────────────────────────────────────────
function watermarkEdited() {
    card.watermarkX       = parseFloat(document.getElementById('watermark-x').value)       || 0;
    card.watermarkY       = parseFloat(document.getElementById('watermark-y').value)       || 0;
    card.watermarkZoom    = (parseFloat(document.getElementById('watermark-zoom').value)   || 100) / 100;
    card.watermarkOpacity = (parseFloat(document.getElementById('watermark-opacity').value) || 40) / 100;
    drawCard();
}

function uploadWatermark(src) {
    watermark.src = src;
    card.watermarkSource = src;
}

// ── Collector info ────────────────────────────────────────────────────────────
function collectorEdited() { drawCard(); }

function artistEdited(value) {
    if (card.text && card.text.artist) card.text.artist.text = value;
    drawCard();
}

// ── Frame browser ─────────────────────────────────────────────────────────────
var _frameTree        = {};
var _activeCat        = null;
var _activePath       = [];   // path segments within the active category's tree
var selectedFrame     = null;
var selectedMaskIndex = -1;

// Returns the tree node at _activeCat + _activePath
function _activeNode() {
    if (!_activeCat || !_frameTree[_activeCat]) return null;
    const catNode = _frameTree[_activeCat];
    if (!_activePath.length) return null;
    // First segment indexes directly into the category object
    let node = catNode[_activePath[0]];
    if (!node) return null;
    // Remaining segments go through .subs
    for (let i = 1; i < _activePath.length; i++) {
        node = node?.subs?.[_activePath[i]];
        if (!node) return null;
    }
    return node;
}

function _activeSub() { return _activePath[0] || null; }

async function initFrameBrowser() {
    try {
        const res  = await fetch('/api/frames');
        _frameTree = await res.json();
    } catch(e) {
        _frameTree = {};
    }
    renderCategories();
}

function renderCategories() {
    const el = document.getElementById('frame-categories');
    el.innerHTML = '';
    const cats = Object.keys(_frameTree);
    if (!cats.length) {
        el.innerHTML = '<div class="dimtext" style="padding:4px">No hay frames. Crea carpetas en assets/img/frames/</div>';
        return;
    }
    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className   = 'secondary cat-btn' + (cat === _activeCat ? ' active-cat' : '');
        btn.textContent = cat;
        btn.onclick     = () => selectCategory(cat);
        el.appendChild(btn);
    });
    if (!_activeCat || !_frameTree[_activeCat]) selectCategory(cats[0]);
    else { renderCascade(); renderFramePicker(); }
}

function _cleanupSpecialEditors() {
    card.planeswalker = null;
    card.saga = null;
    card.class = null;
    card.text = null;
    if (window.planeswalkerPreFrameContext)
        planeswalkerPreFrameContext.clearRect(0, 0, planeswalkerPreFrameCanvas.width, planeswalkerPreFrameCanvas.height);
    if (window.planeswalkerPostFrameContext)
        planeswalkerPostFrameContext.clearRect(0, 0, planeswalkerPostFrameCanvas.width, planeswalkerPostFrameCanvas.height);
    if (window.sagaContext)
        sagaContext.clearRect(0, 0, sagaCanvas.width, sagaCanvas.height);
    if (window.classContext)
        classContext.clearRect(0, 0, classCanvas.width, classCanvas.height);
    document.getElementById('special-editor').innerHTML = '';
    document.getElementById('text-options').innerHTML = '';
}

function _initSpecialEditor() {
    if (_activeCat === 'Planeswalker') { loadDefaultTextOptions(); initPlaneswalkerEditor(); }
    else if (_activeCat === 'Saga')    { loadSagaTextOptions();    initSagaEditor(); }
    else if (_activeCat === 'Class')   { loadClassTextOptions();   initClassEditor(); }
    else if (_activeCat === 'Adventure') { loadAdventureTextOptions(); drawCard(); }
    else if (_activeCat === 'Prepared')  { loadPreparedTextOptions(); drawCard(); }
    else { loadDefaultTextOptions(); drawCard(); }
}

function selectCategory(cat) {
    _activeCat  = cat;
    _activePath = [];
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active-cat', b.textContent === cat));

    _cleanupSpecialEditors();

    // Auto-select first subcategory
    const firstSub = Object.keys(_frameTree[cat] || {})[0];
    if (firstSub) _activePath = [firstSub];

    renderCascade();
    renderFramePicker();
    _initSpecialEditor();
}

// Renders one row of buttons per active path level, cascading downward.
// Each row shows the siblings at that depth; selecting one truncates the
// path at that level and appends the new segment.
function renderCascade() {
    const el = document.getElementById('frame-subcategories');
    el.innerHTML = '';
    if (!_activeCat) return;

    // Level 0: direct children of the category
    let children = _frameTree[_activeCat] || {};   // { name: node }
    let isFirst = true;

    for (let depth = 0; ; depth++) {
        const keys = Object.keys(children);
        if (!keys.length) break;

        const selected = _activePath[depth] || null;

        const row = document.createElement('div');
        row.style.cssText = `display:flex;flex-wrap:wrap;gap:6px;${isFirst ? '' : 'margin-top:4px;'}`;
        isFirst = false;

        keys.forEach(key => {
            const btn = document.createElement('button');
            btn.className   = 'secondary sub-btn' + (key === selected ? ' active-sub' : '');
            btn.textContent = key;
            btn.onclick     = () => {
                if (key === selected && depth > 0) {
                    // deselect this level → go back to parent
                    _activePath = _activePath.slice(0, depth);
                } else {
                    _activePath = [..._activePath.slice(0, depth), key];
                }
                renderCascade();
                renderFramePicker();
                if (depth === 0) _initSpecialEditor();
            };
            row.appendChild(btn);
        });

        el.appendChild(row);

        // Descend into the selected node's subs for the next row
        if (!selected || !children[selected]) break;
        const nextSubs = children[selected].subs || {};
        if (!Object.keys(nextSubs).length) break;
        children = nextSubs;
    }
}

function renderFramePicker() {
    const picker = document.getElementById('frame-picker');
    picker.innerHTML = '';
    selectedFrame = null;
    updateSelectedPreview();
    if (!_activeCat) return;

    const node = _activeNode();
    if (!node) return;

    const basePath = [_activeCat, ..._activePath].join('/');

    // Frames
    (node.frames || []).forEach(entry => {
        const filename = entry.file;
        const src      = `/img/frames/${basePath}/${filename}`;
        const name     = entry.name || filename.replace(/\.[^.]+$/, '');
        const meta     = Object.assign({}, entry);

        const wrap = document.createElement('div');
        wrap.className = 'frame-thumb-wrap';

        const img = document.createElement('img');
        img.className = 'frame-thumb';
        img.src       = src;
        img.title     = name;
        img.alt       = name;
        img.onerror   = () => { img.style.background = '#333'; };
        img.onclick   = () => {
            selectedFrame = { name, src, masks: [], meta };
            picker.querySelectorAll('.frame-thumb').forEach(t => t.classList.remove('selected'));
            img.classList.add('selected');
            updateSelectedPreview();
        };
        img.ondblclick = () => { selectedFrame = { name, src, masks: [], meta }; addFrame(); };

        const label = document.createElement('div');
        label.className   = 'frame-thumb-label';
        label.textContent = name;

        wrap.appendChild(img);
        wrap.appendChild(label);
        picker.appendChild(wrap);
    });
}

function updateSelectedPreview() {
    const el   = document.getElementById('selectedPreview');
    const fn   = selectedFrame ? selectedFrame.name : 'none';
    const masks = (selectedFrame && selectedMaskIndex >= 0 && selectedFrame.masks)
        ? selectedFrame.masks[selectedMaskIndex].name : 'No Mask';
    el.textContent = `(Selected: ${fn}, ${masks})`;
}

function addFrame(extraMasks) {
    if (!selectedFrame) return;

    const maskImages = [];
    if (extraMasks) {
        extraMasks.forEach(m => {
            if (m.image) {
                maskImages.push({ name: m.name, src: m.src, image: m.image });
            } else {
                const img = new Image(); img.crossOrigin = 'anonymous'; img.src = m.src;
                img.onload = () => drawCard();
                maskImages.push({ name: m.name, src: m.src, image: img });
            }
        });
    } else if (selectedMaskIndex >= 0 && selectedFrame.masks) {
        const m = selectedFrame.masks[selectedMaskIndex];
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = m.src;
        img.onload = () => drawCard();
        maskImages.push({ name: m.name, src: m.src, image: img });
    }

    const frameImage = new Image(); frameImage.crossOrigin = 'anonymous'; frameImage.src = selectedFrame.src;
    frameImage.onload = () => drawCard();

    const frameObj = {
        name:                selectedFrame.name,
        src:                 selectedFrame.src,
        image:               frameImage,
        masks:               maskImages,
        opacity:             100,
        mode:                'source-over',
        preserveAlpha:       false,
        bounds:              selectedFrame.bounds || null,
        hslAdjust:           { hue: 0, saturation: 0, lightness: 0 },
        colorOverlay:        '#000000',
        colorOverlayEnabled: false,
        meta:                selectedFrame.meta || {},
    };

    card.frames.push(frameObj);
    renderFrameList();
    drawCard();
}

function uploadFrameOption(src) {
    availableFrames.push({ name: 'Custom ' + (++customCount), src, masks: [] });
    loadFramePack();
}
var customCount = 0;

const HALF_MASKS = {
    right:  { src: '/img/maskRightHalf.png',  name: 'Right Half' },
    left:   { src: '/img/maskLeftHalf.png',   name: 'Left Half'  },
    middle: { src: '/img/maskMiddleThird.png', name: 'Mid Third' },
};

function addFrameWithMask(maskType, maskName) {
    if (!selectedFrame) return;
    const m = HALF_MASKS[maskType];
    const maskImg = new Image();
    maskImg.crossOrigin = 'anonymous';
    maskImg.onload = () => drawCard();
    maskImg.src = m.src;
    addFrame([{ src: m.src, name: maskName, image: maskImg }]);
}

// ── Frame list (applied) ──────────────────────────────────────────────────────
function renderFrameList() {
    const list = document.getElementById('frame-list');
    list.innerHTML = '';
    // Reverse: card renders bottom-up, list shows top-down (top = visually on top)
    [...card.frames].reverse().forEach((frame, revIdx) => {
        const idx  = card.frames.length - 1 - revIdx;
        const item = document.createElement('div');
        item.className   = 'frame-list-item';
        item.draggable   = true;

        item.ondragstart = e => { e.dataTransfer.setData('text/plain', idx); };
        item.ondragover  = e => e.preventDefault();
        item.ondrop      = e => {
            e.preventDefault();
            const from = parseInt(e.dataTransfer.getData('text/plain'));
            const realTo = card.frames.length - 1 - revIdx;
            if (from === realTo) return;
            const [moved] = card.frames.splice(from, 1);
            card.frames.splice(realTo, 0, moved);
            renderFrameList();
            drawCard();
        };

        const name = document.createElement('span');
        name.className   = 'frame-name';
        name.textContent = frame.name;

        const del = document.createElement('button');
        del.className   = 'danger';
        del.textContent = '✕';
        del.onclick = () => { card.frames.splice(idx, 1); renderFrameList(); drawCard(); };

        item.appendChild(name);
        item.appendChild(del);
        list.appendChild(item);
    });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
        };
    });

    document.querySelectorAll('.collapsible').forEach(el => {
        el.addEventListener('click', () => toggleCollapse(el));
    });

    initCanvases();
    loadDefaultTextOptions();
    initFrameBrowser();
    drawCard();
    initArtDrag();
    // Fonts arrive after this first paint; redraw once they are really in.
    ensureFontsLoaded().then(drawCard);
});

function loadDefaultTextOptions() {
    card.artBounds       = { x: 0.0767, y: 0.1129, width: 0.8476, height: 0.4429 };
    card.setSymbolBounds = { x: 0.9213, y: 0.5910, width: 0.12, height: 0.0410, horizontal: 'right' };
    card.watermarkBounds = { x: 0.5, y: 0.7762, width: 0.75, height: 0.2305 };
    loadTextOptions({
        mana:  { name: 'Mana Cost',        text: '', y: 0.048,  width: 0.9292, height: 71/2100, oneLine: true, size: 71/1638, align: 'right', manaCost: true, manaSpacing: 0 },
        title: { name: 'Title',             text: '', x: 0.0854, y: 0.0522, width: 0.8292, height: 0.0543, oneLine: true, font: 'belerenb', size: 0.0381 },
        type:  { name: 'Type',              text: '', x: 0.0854, y: 0.574,  width: 0.8292, height: 0.0543, oneLine: true, font: 'belerenb', size: 0.0324 },
        rules: { name: 'Rules Text',        text: '', x: 0.086,  y: 0.638,  width: 0.828,  height: 0.2875, size: 0.0362 },
        pt:    { name: 'Power/Toughness',   text: '', x: 0.7928, y: 0.902,  width: 0.1367, height: 0.0372, size: 0.0372, font: 'belerenbsc', oneLine: true, align: 'center' },
    });
}

function toggleCollapse(el) {
    el.classList.toggle('open');
}

// ── File upload helpers ───────────────────────────────────────────────────────
function uploadFiles(files, callback, extra) {
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = e => callback(e.target.result, extra);
        reader.readAsDataURL(file);
    });
}

function imageURL(url, callback, extra) {
    if (url) callback(url, extra);
}

// ── Scryfall integration ──────────────────────────────────────────────────────
var scryfallDebounce = null;
function debouncedScryfall(name) {
    clearTimeout(scryfallDebounce);
    scryfallDebounce = setTimeout(() => fetchScryfallArt(name), 600);
}

async function fetchScryfallArt(name) {
    if (!name) return;
    const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
    try {
        const res  = await fetch(url);
        const data = await res.json();
        if (data.image_uris) {
            uploadArt(data.image_uris.art_crop, document.getElementById('art-autofit').checked ? 'autoFit' : '');
        }
    } catch {}
}

// ── Transparencies toggle ─────────────────────────────────────────────────────
function toggleTransparencies(checked) {
    previewCanvas.style.background = checked ? 'repeating-conic-gradient(#444 0% 25%, #222 0% 50%) 0 0 / 20px 20px' : '';
}

// ── Draw pipeline ─────────────────────────────────────────────────────────────
var drawPending = false;

function drawCard() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(_drawCard);
}

function _drawCard() {
    drawPending = false;
    if (!window.cardCanvas || !window.cardContext) return;

    cardContext.clearRect(0, 0, cardCanvas.width, cardCanvas.height);

    // 1. Art
    drawArt();

    // 2. Planeswalker ability bands — BEFORE frame so frame overlays on top
    if (window.planeswalkerPreFrameCanvas && card.planeswalker) {
        cardContext.drawImage(planeswalkerPreFrameCanvas, 0, 0);
    }

    // 3. Frames (composited, bottom-up)
    drawFrames();

    // 4. Planeswalker loyalty badges — AFTER frame, BEFORE text
    if (window.planeswalkerPostFrameCanvas && card.planeswalker) {
        cardContext.drawImage(planeswalkerPostFrameCanvas, 0, 0);
    }

    // 5. Watermark
    if (!watermark.src.includes('blank')) drawWatermark();

    // 6. Saga chapter markers — AFTER watermark, BEFORE text
    if (window.sagaCanvas && card.saga) {
        cardContext.drawImage(sagaCanvas, 0, 0);
    }

    // 6b. Class level headers — same layer as saga
    if (window.classCanvas && card.class) {
        cardContext.drawImage(classCanvas, 0, 0);
    }

    // 7. Text
    drawAllText();

    // 8. Set symbol
    if (!setSymbol.src.includes('blank')) drawSetSymbol();

    // 6. Guidelines
    if (document.getElementById('show-guidelines')?.checked) drawGuidelines();

    // 7. Round the corners
    roundCardCorners();

    // 8. Scale to preview
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(cardCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
}

// Full-art frames bleed to the edge, so nothing clips the card to its rounded
// silhouette and the exported PNG comes out square with opaque corners.
// Calibrated against the existing cards, which round at 64px on a 2010-wide
// canvas (they measure 59 with a >200-alpha probe; the arc's antialiasing
// accounts for the rest).
const CORNER_RADIUS = 64 / 2010;

function roundCardCorners() {
    const r = (card.cornerRadius ?? CORNER_RADIUS) * card.width;
    if (r <= 0) return;

    const x = scaleX(0), y = scaleY(0);
    const w = scaleWidth(1), h = scaleHeight(1);

    const mask = document.createElement('canvas');
    mask.width  = cardCanvas.width;
    mask.height = cardCanvas.height;
    const mc = mask.getContext('2d');
    mc.fillStyle = '#000';
    mc.beginPath();
    if (mc.roundRect) {
        mc.roundRect(x, y, w, h, r);
    } else {
        mc.moveTo(x + r, y);
        mc.arcTo(x + w, y,     x + w, y + h, r);
        mc.arcTo(x + w, y + h, x,     y + h, r);
        mc.arcTo(x,     y + h, x,     y,     r);
        mc.arcTo(x,     y,     x + w, y,     r);
        mc.closePath();
    }
    mc.fill();

    cardContext.globalCompositeOperation = 'destination-in';
    cardContext.drawImage(mask, 0, 0);
    cardContext.globalCompositeOperation = 'source-over';
}

// ── Art rendering ─────────────────────────────────────────────────────────────
function drawArt() {
    if (art.src.includes('blank') || !art.naturalWidth) return;

    const cx = 0, cy = 0, cw = card.width, ch = card.height;

    const zoom  = card.artZoom;
    const drawW = art.naturalWidth  * zoom;
    const drawH = art.naturalHeight * zoom;
    const drawX = cx + (cw - drawW) / 2 + card.artX;
    const drawY = cy + (ch - drawH) / 2 + card.artY;

    cardContext.save();

    if (card.artRotate) {
        cardContext.translate(cx + cw / 2, cy + ch / 2);
        cardContext.rotate(card.artRotate * Math.PI / 180);
        cardContext.translate(-(cx + cw / 2), -(cy + ch / 2));
    }

    if (document.getElementById('grayscale-art')?.checked) {
        cardContext.filter = 'grayscale(1)';
    }

    cardContext.drawImage(art, drawX, drawY, drawW, drawH);
    cardContext.filter = 'none';
    cardContext.restore();
}

// ── Frame rendering ───────────────────────────────────────────────────────────
function drawFrames() {
    frameContext.clearRect(0, 0, frameCanvas.width, frameCanvas.height);

    // Draw bottom frame first (card.frames[0] is bottom)
    [...card.frames].forEach(frame => {
        if (!frame.image || !frame.image.complete || !frame.image.naturalWidth) return;

        const bounds = frame.bounds || {};
        const fx = scaleX(bounds.x    || 0);
        const fy = scaleY(bounds.y    || 0);
        const fw = scaleWidth(bounds.width  || 1);
        const fh = scaleHeight(bounds.height || 1);

        if (frame.masks && frame.masks.length) {
            // Render to masking canvas
            frameMaskingContext.clearRect(0, 0, frameMaskingCanvas.width, frameMaskingCanvas.height);
            frameMaskingContext.globalCompositeOperation = 'source-over';
            frameMaskingContext.fillStyle = 'black';
            frameMaskingContext.fillRect(0, 0, frameMaskingCanvas.width, frameMaskingCanvas.height);
            frameMaskingContext.globalCompositeOperation = 'source-in';
            frame.masks.forEach(mask => {
                const img = mask.image;
                const ready = img && (
                    img instanceof HTMLCanvasElement
                        ? img.width > 0
                        : img.complete && img.naturalWidth > 0
                );
                if (ready) frameMaskingContext.drawImage(img, fx, fy, fw, fh);
            });

            // Apply HSL if needed
            let frameSrc = frame.image;
            if (frame.hslAdjust && (frame.hslAdjust.hue || frame.hslAdjust.saturation || frame.hslAdjust.lightness)) {
                frameSrc = applyHSL(frame.image, frame.hslAdjust);
            }

            frameCompositingContext.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
            frameCompositingContext.drawImage(frameSrc, fx, fy, fw, fh);

            // Mask the compositing result
            frameCompositingContext.globalCompositeOperation = 'destination-in';
            frameCompositingContext.drawImage(frameMaskingCanvas, 0, 0);
            frameCompositingContext.globalCompositeOperation = 'source-over';

            // Composite into frameCanvas
            frameContext.globalCompositeOperation = frame.mode || 'source-over';
            frameContext.globalAlpha = (frame.opacity ?? 100) / 100;
            frameContext.drawImage(frameCompositingCanvas, 0, 0);
        } else {
            frameContext.globalCompositeOperation = frame.mode || 'source-over';
            frameContext.globalAlpha = (frame.opacity ?? 100) / 100;

            let src = frame.image;
            if (frame.hslAdjust && (frame.hslAdjust.hue || frame.hslAdjust.saturation || frame.hslAdjust.lightness)) {
                src = applyHSL(src, frame.hslAdjust);
            }
            frameContext.drawImage(src, fx, fy, fw, fh);
        }

        frameContext.globalAlpha = 1;
        frameContext.globalCompositeOperation = 'source-over';
    });

    cardContext.drawImage(frameCanvas, 0, 0);
}

// HSL adjustment via offscreen canvas (simple approach)
function applyHSL(img, hsl) {
    const tmp = document.createElement('canvas');
    tmp.width  = frameCanvas.width;
    tmp.height = frameCanvas.height;
    const ctx  = tmp.getContext('2d');
    ctx.filter = `hue-rotate(${hsl.hue}deg) saturate(${100 + hsl.saturation}%) brightness(${100 + hsl.lightness}%)`;
    ctx.drawImage(img, 0, 0);
    return tmp;
}

// ── Watermark rendering ───────────────────────────────────────────────────────
function drawWatermark() {
    const b = card.watermarkBounds;
    if (!b || !watermark.naturalWidth) return;

    const bx = scaleX(b.x);
    const by = scaleY(b.y);
    const bw = scaleWidth(b.width);
    const bh = scaleHeight(b.height);

    const zoom  = card.watermarkZoom;
    const drawW = watermark.naturalWidth  * zoom * (bw / watermark.naturalWidth);
    const drawH = watermark.naturalHeight * zoom * (bh / watermark.naturalHeight);
    const drawX = bx + (bw - drawW) / 2 + card.watermarkX;
    const drawY = by + (bh - drawH) / 2 + card.watermarkY;

    cardContext.globalAlpha = card.watermarkOpacity;
    cardContext.drawImage(watermark, drawX, drawY, drawW, drawH);
    cardContext.globalAlpha = 1;
}

// ── Set symbol rendering ──────────────────────────────────────────────────────
function drawSetSymbol() {
    const b = card.setSymbolBounds;
    if (!setSymbol.naturalWidth) return;

    let bx, by, bw, bh;
    if (b) {
        bx = scaleX(b.x);
        by = scaleY(b.y);
        bw = scaleWidth(b.width);
        bh = scaleHeight(b.height);
    } else {
        bx = scaleX(0.85); by = scaleY(0.57);
        bw = scaleWidth(0.1); bh = scaleHeight(0.04);
    }

    const zoom  = card.setSymbolZoom;
    const ratio = setSymbol.naturalWidth / setSymbol.naturalHeight;
    let   dw    = bh * ratio * zoom;
    let   dh    = bh * zoom;
    const halign = b?.horizontal || 'right';
    let   dx;

    if (halign === 'right') dx = bx + bw - dw + card.setSymbolX * card.width;
    else                    dx = bx + card.setSymbolX * card.width;

    const dy = by + (bh - dh) / 2 + card.setSymbolY * card.height;

    cardContext.drawImage(setSymbol, dx, dy, dw, dh);
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
// Canvas fillText does NOT trigger @font-face fetching: the browser only loads
// a web font once the DOM uses it. Every family below is used exclusively
// inside the canvas, so without an explicit load they silently fall back to the
// default serif — wrong glyphs, and wrong metrics, which then throws off
// autoShrink and the line breaks. Must finish before the first real draw.
const CARD_FONTS = ['gothammedium', 'belerenb', 'belerenbsc',
                    'matrix', 'matrixb', 'matrixbsc',
                    'mplantin', 'mplantini', 'plantinsemibold',
                    'goudymedieval', 'phyrexian'];

async function ensureFontsLoaded() {
    if (!document.fonts) return;
    await Promise.all(CARD_FONTS.map(f =>
        document.fonts.load('100px ' + f).catch(() => {})));
    await document.fonts.ready;
}

// ── Text rendering ────────────────────────────────────────────────────────────

// Font map: base font → italic variant (MTG uses separate italic fonts)
const ITALIC_FONT = {
    'plantinsemibold':  'mplantini',
    'mplantin':         'mplantini',
    'belerenb':         'belerenb',   // no italic variant, keep same
    'gothammedium':     'gothammedium',
    'matrix':           'matrix',
};
function italicFont(base) { return ITALIC_FONT[base] || base; }

function drawAllText() {
    if (!card.text) return;
    paragraphContext.clearRect(0, 0, paragraphCanvas.width, paragraphCanvas.height);
    Object.entries(card.text).forEach(([key, obj]) => {
        if (obj && typeof obj.text === 'string') renderTextbox(key, obj);
    });
    cardContext.drawImage(paragraphCanvas, 0, 0);
}

function renderTextbox(key, obj) {
    if (obj.x === undefined && obj.y === undefined) return;

    const tx = scaleX(obj.x ?? 0);
    const ty = scaleY(obj.y ?? 0);
    const tw = scaleWidth(obj.width   || 0.8);
    const th = scaleHeight(obj.height || 0.1);

    const baseFont     = obj.font  || 'plantinsemibold';
    const color        = obj.color || 'black';
    const align        = obj.align || 'left';
    const outlineWidth = obj.outlineWidth ? scaleWidth(obj.outlineWidth) : 0;
    const oneLine      = obj.oneLine  || false;
    const isMana       = obj.manaCost || false;

    const sizeOverride = obj.sizeOverride || 0;
    let   fontSize     = sizeOverride > 0 ? sizeOverride : scaleHeight(obj.size || 0.03);

    const cardName = card.text?.title?.text?.replace(/\{[^}]+\}/g, '').trim() || 'Card';
    const artist   = document.getElementById('art-artist')?.value || '';
    const infoYear = document.getElementById('info-year')?.value || new Date().getFullYear();
    const infoSet  = document.getElementById('info-set')?.value  || '';
    const infoNum  = document.getElementById('info-number')?.value || '';
    const infoRar  = document.getElementById('info-rarity')?.value || 'C';
    const infoLang = document.getElementById('info-language')?.value || 'EN';
    let   rawText  = (obj.text || '')
        .replace(/\{cardname\}/gi, cardName)
        .replace(/~/g, cardName)
        .replace(/\{elemidinfo-artist\}/gi, artist)
        .replace(/\{elemidinfo-year\}/gi, infoYear)
        .replace(/\{elemidinfo-set\}/gi, infoSet)
        .replace(/\{elemidinfo-number\}/gi, infoNum)
        .replace(/\{elemidinfo-rarity\}/gi, infoRar)
        .replace(/\{elemidinfo-language\}/gi, infoLang)
        .replace(/\{conditionalcolor:[^}]+\}/gi, ''); // ignore conditional color tags

    const hideReminder = document.getElementById('hide-reminder-text')?.checked;

    // Tokenize the full text into a flat stream of spans
    const spans = tokenize(rawText, isMana, hideReminder);

    // Auto-shrink: binary search between minSize and fontSize.
    // One-line blocks (title, type) opt in via shrinkToFit — without it a long
    // card name simply overflows its box and collides with the mana cost.
    if (fontSize > 12 && (!oneLine || obj.shrinkToFit)) {
        fontSize = autoShrink(spans, fontSize, 12, tw, th, baseFont, oneLine, align);
    }

    // Lay out into wrapped lines
    const wrappedLines = layoutLines(spans, tw, fontSize, baseFont, oneLine, align);

    // Optional vertical centring inside the box (real cards centre short rules
    // text rather than hanging it from the top edge).
    let drawY = ty;
    if (obj.verticalCenter) {
        const used = calcHeight(wrappedLines, fontSize);
        drawY = ty + Math.max(0, (th - used) / 2);
    }

    // Draw into shared paragraph canvas (cleared once per drawAllText call)
    drawLines(paragraphContext, wrappedLines, tx, drawY, tw, fontSize, {
        color, baseFont, align, outlineWidth,
    });
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────
// Returns a flat array of span objects. Each span is one of:
//   { type:'word',  text, italic, bold, color }
//   { type:'space', italic, bold, color }         — explicit space between words
//   { type:'mana',  symbol, italic, bold }
//   { type:'newline' }                            — \n
//   { type:'divider' }                            — {divider}/{flavor}
//   { type:'alignChange', align }                 — {center}/{left}/{right}

function tokenize(text, isMana, hideReminder) {
    const spans = [];
    let italic = false, bold = false, color = null;
    let inReminder = false;

    // Split the full string into segments: either {code} or plain text runs
    const parts = text.split(/(\{[^}]+\}|\n)/);

    for (const part of parts) {
        if (!part) continue;

        if (part === '\n') {
            spans.push({ type: 'newline' });
            continue;
        }

        if (part.startsWith('{')) {
            const raw  = part.slice(1, -1);
            const code = raw.toLowerCase();

            // Style tags
            if (code === 'i')      { italic = true;  continue; }
            if (code === '/i')     { italic = false; continue; }
            if (code === 'bold')   { bold   = true;  continue; }
            if (code === '/bold')  { bold   = false; continue; }

            // Alignment
            if (code === 'center' || code === 'left' || code === 'right') {
                spans.push({ type: 'alignChange', align: code });
                continue;
            }

            // Em dash
            if (code === '-') {
                spans.push({ type: 'word', text: '—', italic, bold, color });
                continue;
            }

            // Color change
            if (code.startsWith('fontcolor')) {
                color = code.replace('fontcolor', '') || null;
                continue;
            }

            // Divider / flavor bar
            if (code === 'divider' || code === 'flavor') {
                spans.push({ type: 'divider' });
                if (code === 'flavor') italic = true;
                continue;
            }

            // Line-no-space
            if (code === 'lns') {
                spans.push({ type: 'newline' });
                continue;
            }

            // Mana symbol
            const sym = getManaSymbol(code) || getManaSymbol(code.split('').reverse().join(''));
            if (sym) {
                spans.push({ type: 'mana', symbol: sym, italic, bold });
                continue;
            }

            // Ignore unknown codes
            continue;
        }

        // Plain text — split into words, auto-italicize reminder text (parentheses)
        let buf = part;
        while (buf.length) {
            // Detect opening parenthesis (reminder text start)
            const parenOpen  = buf.indexOf('(');
            const parenClose = buf.indexOf(')');

            if (!inReminder && parenOpen !== -1) {
                // Text before the paren
                if (parenOpen > 0) pushWords(spans, buf.slice(0, parenOpen), italic, bold, color);
                inReminder = true;
                if (!hideReminder) {
                    pushWords(spans, '(', true, bold, color);
                }
                buf = buf.slice(parenOpen + 1);
                continue;
            }

            if (inReminder && parenClose !== -1) {
                const inside = buf.slice(0, parenClose);
                if (!hideReminder) {
                    pushWords(spans, inside, true, bold, color);
                    pushWords(spans, ')', true, bold, color);
                }
                inReminder = false;
                buf = buf.slice(parenClose + 1);
                continue;
            }

            // No parens in remaining buf
            pushWords(spans, buf, inReminder ? true : italic, bold, color);
            break;
        }
    }

    return spans;
}

// Split a plain string into word + space spans
function pushWords(spans, text, italic, bold, color) {
    // Split on spaces, preserving them as explicit space tokens
    const words = text.split(' ');
    words.forEach((w, i) => {
        if (w) spans.push({ type: 'word', text: w, italic, bold, color });
        if (i < words.length - 1) spans.push({ type: 'space', italic, bold, color });
    });
}

// ── Layout: wrap spans into visual lines ──────────────────────────────────────
// Returns array of { tokens, align, type } where type is 'text'|'divider'|'blank'

function layoutLines(spans, maxW, fontSize, baseFont, oneLine, defaultAlign = 'left') {
    const lines   = [];
    let   curLine = [];
    let   lineW   = 0;
    let   align   = defaultAlign;

    function commitLine(isLast) {
        lines.push({ tokens: curLine, align, last: isLast });
        curLine = [];
        lineW   = 0;
    }

    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];

        if (span.type === 'newline') {
            commitLine(true);
            continue;
        }

        if (span.type === 'divider') {
            if (curLine.length) commitLine(true);
            lines.push({ type: 'divider' });
            continue;
        }

        if (span.type === 'alignChange') {
            align = span.align;
            continue;
        }

        const w = measureSpan(span, fontSize, baseFont);

        // Space at start of line → skip
        if (span.type === 'space' && lineW === 0) continue;

        if (!oneLine && lineW + w > maxW && lineW > 0) {
            // Before breaking, remove trailing space on current line
            while (curLine.length && curLine[curLine.length - 1].type === 'space') curLine.pop();
            commitLine(false);
            // Skip leading space on new line
            if (span.type === 'space') continue;
        }

        curLine.push(span);
        lineW += w;
    }

    if (curLine.length) commitLine(true);
    return lines;
}

function measureSpan(span, fontSize, baseFont) {
    if (span.type === 'mana') {
        const sym = span.symbol;
        return sym.width * fontSize * 0.82 + fontSize * 0.1;
    }
    if (span.type === 'space') {
        const f = resolveFont(span, baseFont, fontSize);
        _measureCtx.font = f;
        return _measureCtx.measureText(' ').width;
    }
    if (span.type === 'word') {
        const f = resolveFont(span, baseFont, fontSize);
        _measureCtx.font = f;
        return _measureCtx.measureText(span.text).width;
    }
    return 0;
}

// Tiny offscreen canvas just for measurement
const _measureCanvas  = document.createElement('canvas');
_measureCanvas.width  = 1;
_measureCanvas.height = 1;
const _measureCtx     = _measureCanvas.getContext('2d');

function resolveFont(span, base, size) {
    const useItalic = span.italic;
    const useBold   = span.bold;
    const family    = useItalic ? italicFont(base) : base;
    // Bold handled via weight prefix (only if the family supports it)
    const weight    = useBold && !useItalic ? 'bold ' : '';
    return `${weight}${size}px ${family}`;
}

// ── Auto-shrink via binary search ─────────────────────────────────────────────
function lineWidth(line, fontSize, baseFont) {
    if (!line.tokens) return 0;
    return line.tokens.reduce((w, t) => w + measureSpan(t, fontSize, baseFont), 0);
}

function autoShrink(spans, maxSize, minSize, maxW, maxH, baseFont, oneLine, defaultAlign = 'left') {
    // One-line blocks never wrap, so their height always fits and only the
    // width can overflow. Wrapping blocks are the opposite. Check both.
    const fits = size => {
        const lines = layoutLines(spans, maxW, size, baseFont, oneLine, defaultAlign);
        if (calcHeight(lines, size) > maxH) return false;
        if (oneLine && lines.some(l => lineWidth(l, size, baseFont) > maxW)) return false;
        return true;
    };

    let lo = minSize, hi = maxSize;
    while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid; else hi = mid;
    }
    return fits(lo) ? lo : minSize;
}

function calcHeight(lines, fontSize) {
    const lineH = fontSize * 1.28;
    let h = 0;
    lines.forEach(l => {
        if (l.type === 'divider') { h += lineH * 0.7; return; }
        h += lineH;
    });
    return h;
}

// ── Draw lines ────────────────────────────────────────────────────────────────
function drawLines(ctx, lines, x, y, maxW, fontSize, { color, baseFont, align: defaultAlign, outlineWidth }) {
    const lineH = fontSize * 1.28;
    let   curY  = y;

    ctx.textBaseline = 'alphabetic';

    lines.forEach((line, li) => {
        if (line.type === 'divider') {
            const barY = curY + lineH * 0.25;
            ctx.fillStyle = color;
            ctx.fillRect(x + maxW * 0.04, barY, maxW * 0.92, Math.max(1, Math.round(fontSize * 0.055)));
            curY += lineH * 0.7;
            return;
        }

        const lineAlign = line.align ?? defaultAlign;
        const tokens    = line.tokens;

        // Measure total line width for alignment
        let totalW = 0;
        tokens.forEach(t => { totalW += measureSpan(t, fontSize, baseFont); });

        let curX = x;
        if (lineAlign === 'center') curX = x + (maxW - totalW) / 2;
        if (lineAlign === 'right')  curX = x + maxW - totalW;

        const baseline = curY + fontSize * 0.88;

        tokens.forEach(tok => {
            if (tok.type === 'mana') {
                const sym     = tok.symbol;
                const sw      = sym.width  * fontSize * 0.82;
                const sh      = sym.height * fontSize * 0.82;
                const spacing = fontSize * 0.05;
                const sy      = baseline - sh * 0.78;
                if (sym.image.complete && sym.image.naturalWidth) {
                    ctx.drawImage(sym.image, curX + spacing, sy, sw, sh);
                }
                curX += sw + spacing * 2;
                return;
            }

            if (tok.type === 'word' || tok.type === 'space') {
                const font  = resolveFont(tok, baseFont, fontSize);
                const clr   = tok.color || color;
                ctx.font    = font;

                const tw = ctx.measureText(tok.text ?? ' ').width;

                if (outlineWidth > 0) {
                    ctx.strokeStyle = clr === 'black' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
                    ctx.lineWidth   = outlineWidth;
                    ctx.lineJoin    = 'round';
                    ctx.strokeText(tok.text ?? ' ', curX, baseline);
                }

                ctx.fillStyle = clr;
                ctx.fillText(tok.text ?? ' ', curX, baseline);
                curX += tw;
            }
        });

        curY += lineH;
    });
}

// ── Guidelines ────────────────────────────────────────────────────────────────
function drawGuidelines() {
    const g = cardContext;
    g.save();
    g.strokeStyle = 'rgba(0,200,255,0.5)';
    g.lineWidth   = 2;

    const draw = b => {
        if (!b) return;
        g.strokeRect(scaleX(b.x), scaleY(b.y), scaleWidth(b.width), scaleHeight(b.height));
    };

    draw(card.artBounds);
    draw(card.setSymbolBounds);
    draw(card.watermarkBounds);

    Object.values(card.text || {}).forEach(obj => {
        if (obj && obj.x !== undefined) draw(obj);
    });

    g.restore();
}

// ── Download ──────────────────────────────────────────────────────────────────
function downloadCard() {
    const name = card.text?.title?.text?.replace(/\{[^}]+\}/g, '') || 'card';
    const link = document.createElement('a');
    link.download = name + '.png';
    link.href     = cardCanvas.toDataURL('image/png');
    link.click();
}


// ── Planeswalker editor ───────────────────────────────────────────────────────
// Layout table: [tall][count-1][abilityIndex] — Y centers for loyalty badges
const PW_ABILITY_LAYOUT = [
    [[0.7467], [0.6953, 0.822], [0.6639, 0.7467, 0.8362], [0.6505, 0.72, 0.7905, 0.861]],
    [[0.72],   [0.6391, 0.801], [0.5986, 0.72,   0.8415], [0.5986, 0.6796, 0.7605, 0.8415]],
];

// Module-scoped PW images (created once)
var _pwPlusIcon, _pwMinusIcon, _pwNeutralIcon, _pwLightToDark, _pwDarkToLight, _pwTextMask;
var _pwLightColor = 'white', _pwDarkColor = '#a4a4a4';

function initPlaneswalkerEditor() {
    sizeCanvas('planeswalkerPreFrame');
    sizeCanvas('planeswalkerPostFrame');

    if (!card.planeswalker) {
        card.planeswalker = {
            abilities:     ['', '+1', '0', '-7'],
            abilityAdjust: [0, 0, 0, 0],
            count: 3, x: 0.1167, width: 0.8094,
        };
    }

    if (!_pwPlusIcon) {
        _pwPlusIcon    = new Image(); _pwPlusIcon.crossOrigin    = 'anonymous';
        _pwMinusIcon   = new Image(); _pwMinusIcon.crossOrigin   = 'anonymous';
        _pwNeutralIcon = new Image(); _pwNeutralIcon.crossOrigin = 'anonymous';
        _pwLightToDark = new Image(); _pwLightToDark.crossOrigin = 'anonymous';
        _pwDarkToLight = new Image(); _pwDarkToLight.crossOrigin = 'anonymous';
        _pwTextMask    = new Image(); _pwTextMask.crossOrigin    = 'anonymous';
        _pwDarkToLight.onload = () => planeswalkerEdited();
        _pwTextMask.onload    = () => { _syncPlaneswalkerInputs(); planeswalkerEdited(); };
    }
    const isTall      = _activeSub() && (_activeSub().toLowerCase().includes('tall') || _activeSub().toLowerCase().includes('compleated'));
    const uiFolder    = '/img/frames/Planeswalker/_ui';

    _pwPlusIcon.src    = `${uiFolder}/planeswalkerPlus.png`;
    _pwMinusIcon.src   = `${uiFolder}/planeswalkerMinus.png`;
    _pwNeutralIcon.src = `${uiFolder}/planeswalkerNeutral.png`;
    _pwLightToDark.src = `${uiFolder}/abilityLineOdd.png`;
    _pwDarkToLight.src = `${uiFolder}/abilityLineEven.png`;
    const maskSrc      = isTall
        ? `${uiFolder}/planeswalkerTallMaskRules.png`
        : `${uiFolder}/text.svg`;
    _pwTextMask.src    = maskSrc;

    // Load planeswalker text areas (ability slots + loyalty)
    loadTextOptions({
        mana:     { name:'Mana Cost',  text:'', y:0.048,  width:0.9292, height:71/2100, oneLine:true, size:71/1638, align:'right', manaCost:true, manaSpacing:0 },
        title:    { name:'Title',      text:'', x:0.0854, y:0.0522, width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0381 },
        type:     { name:'Type',       text:'', x:0.0854, y:0.574,  width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0324 },
        loyalty:  { name:'Loyalty',    text:'', x:0.7928, y:0.902,  width:0.1367, height:0.0372, size:0.0372, font:'belerenbsc', oneLine:true, align:'center' },
        ability0: { name:'Ability 1',  text:'', x:0.1581, y:0.6239, width:0.766,  height:0.0695, size:0.0324 },
        ability1: { name:'Ability 2',  text:'', x:0.1581, y:0.6934, width:0.766,  height:0.0695, size:0.0324 },
        ability2: { name:'Ability 3',  text:'', x:0.1581, y:0.7629, width:0.766,  height:0.0695, size:0.0324 },
        ability3: { name:'Ability 4',  text:'', x:0.1581, y:0.8324, width:0.766,  height:0.0695, size:0.0324 },
    });

    _buildPlaneswalkerUI();
    _syncPlaneswalkerInputs();
    console.log('[PW init] pw.count after sync=', card.planeswalker?.count, 'heights=',
        [0,1,2,3].map(i => document.getElementById('planeswalker-height-'+i)?.value));
    planeswalkerEdited();
}

function _buildPlaneswalkerUI() {
    document.getElementById('special-editor').innerHTML = `
    <div class="card-section">
        <div class="section-title">Planeswalker Abilities</div>
        ${[0,1,2,3].map(i => `
        <div class="pw-ability-row">
            <span class="dimtext" style="min-width:54px">Ability ${i+1}</span>
            <input type="text"   id="planeswalker-cost-${i}"   placeholder="+1/0/-X" oninput="planeswalkerEdited()" style="max-width:64px">
            <input type="number" id="planeswalker-height-${i}" placeholder="Height" min="0" oninput="planeswalkerEdited()">
            <input type="number" id="planeswalker-shift-${i}"  placeholder="Shift"  oninput="planeswalkerEdited()" style="max-width:52px">
        </div>`).join('')}
        <label><input type="checkbox" id="planeswalker-invert" onchange="invertPlaneswalkerColors()"> Invert colors</label>
    </div>`;
}

function _syncPlaneswalkerInputs() {
    const pw = card.planeswalker;
    if (!pw) return;
    for (let i = 0; i < 4; i++) {
        const obj = card.text?.['ability' + i];
        const hEl = document.getElementById('planeswalker-height-' + i);
        const cEl = document.getElementById('planeswalker-cost-'   + i);
        const sEl = document.getElementById('planeswalker-shift-'  + i);
        if (hEl) hEl.value = Math.round(scaleHeight(obj?.height ?? 0));
        if (cEl) cEl.value = pw.abilities[i] ?? '';
        if (sEl) sEl.value = Math.round(scaleHeight(pw.abilityAdjust?.[i] ?? 0));
    }
}

function planeswalkerEdited() {
    if (!card.planeswalker || !window.planeswalkerPreFrameCanvas) return;
    const pw = card.planeswalker;

    pw.x     = 0.1167;
    pw.width = 0.8094;

    for (let i = 0; i < 4; i++) {
        pw.abilities[i]     = document.getElementById('planeswalker-cost-'  + i)?.value ?? pw.abilities[i];
        pw.abilityAdjust[i] = (parseFloat(document.getElementById('planeswalker-shift-' + i)?.value) || 0) / card.height;
    }

    pw.count = 0;
    let lastY = card.text?.ability0?.y ?? 0.6239;
    console.log('[PW edit] card.text=', !!card.text, 'ability0.y=', card.text?.ability0?.y, 'ability0.height=', card.text?.ability0?.height);

    for (let i = 0; i < 4; i++) {
        const obj = card.text?.['ability' + i];
        if (!obj) continue;
        obj.y = lastY;
        const heightPx = parseInt(document.getElementById('planeswalker-height-' + i)?.value) || 0;
        const height   = parseFloat((heightPx / card.height).toFixed(4));
        if (height > 0) pw.count++;

        if (pw.abilities[i]) {
            if (!pw.orig_ability_textbox_x) {
                pw.orig_ability_textbox_x     = obj.x;
                pw.orig_ability_textbox_width = obj.width;
            }
            obj.x     = pw.orig_ability_textbox_x;
            obj.width = pw.orig_ability_textbox_width;
        } else if (pw.orig_ability_textbox_x) {
            obj.x     = pw.orig_ability_textbox_x - 0.044;
            obj.width = pw.orig_ability_textbox_width + 0.044;
        }

        obj.height = height;
        lastY += height;
    }

    // ── Draw ability bands (preFrame) ─────────────────────────────────────────
    const preCtx = planeswalkerPreFrameContext;
    const transH = scaleHeight(0.0048);
    preCtx.clearRect(0, 0, planeswalkerPreFrameCanvas.width, planeswalkerPreFrameCanvas.height);
    preCtx.globalCompositeOperation = 'source-over';

    for (let i = 0; i < pw.count; i++) {
        const obj = card.text?.['ability' + i];
        if (!obj) continue;
        const x = scaleX(pw.x);
        let   y = scaleY(obj.y);
        const w = scaleWidth(pw.width);
        let   h = scaleHeight(obj.height);

        if (i === 0)            { y -= scaleHeight(0.1); h += scaleHeight(0.1); }
        if (i === pw.count - 1) { h += scaleHeight(0.5); }

        if (i % 2 === 0) {
            preCtx.fillStyle   = _pwLightColor;
            preCtx.globalAlpha = 0.608;
            preCtx.fillRect(x, y + transH, w, h - 2 * transH);
            preCtx.globalAlpha = 1;
            if (_pwLightToDark.complete && _pwLightToDark.naturalWidth)
                preCtx.drawImage(_pwLightToDark, x, y + h - transH, w, 2 * transH);
        } else {
            preCtx.fillStyle   = _pwDarkColor;
            preCtx.globalAlpha = 0.706;
            preCtx.fillRect(x, y + transH, w, h - 2 * transH);
            preCtx.globalAlpha = 1;
            if (_pwDarkToLight.complete && _pwDarkToLight.naturalWidth)
                preCtx.drawImage(_pwDarkToLight, x, y + h - transH, w, 2 * transH);
        }
    }

    if (_pwTextMask.complete && _pwTextMask.naturalWidth) {
        preCtx.globalCompositeOperation = 'destination-in';
        preCtx.drawImage(_pwTextMask, scaleX(0), scaleY(0), scaleWidth(1), scaleHeight(1));
        preCtx.globalCompositeOperation = 'source-over';
    }

    // ── Draw loyalty badges (postFrame) ───────────────────────────────────────
    const postCtx = planeswalkerPostFrameContext;
    postCtx.clearRect(0, 0, planeswalkerPostFrameCanvas.width, planeswalkerPostFrameCanvas.height);
    postCtx.globalCompositeOperation = 'source-over';
    postCtx.fillStyle    = 'white';
    postCtx.font         = scaleHeight(0.0286) + 'px belerenbsc';
    postCtx.textAlign    = 'center';
    postCtx.textBaseline = 'alphabetic';

    const isTall = _activeSub() && (_activeSub().toLowerCase().includes('tall') || _activeSub().toLowerCase().includes('compleated'));
    const layout = (PW_ABILITY_LAYOUT[isTall ? 1 : 0][pw.count - 1]) ?? PW_ABILITY_LAYOUT[0][2];
    console.log('[PW edit] pw.count=', pw.count, 'isTall=', isTall, 'layout=', layout,
        'mask complete=', _pwTextMask.complete, 'mask naturalW=', _pwTextMask.naturalWidth, 'mask src=', _pwTextMask.src);

    for (let i = 0; i < pw.count; i++) {
        const cost = pw.abilities[i];
        const py   = scaleY((layout[i] ?? 0.72) + (pw.abilityAdjust[i] ?? 0));
        console.log('[PW badge]', i, 'cost=', cost, 'py=', py, 'plusComplete=', _pwPlusIcon.complete);

        if (cost.includes('+')) {
            if (_pwPlusIcon.complete && _pwPlusIcon.naturalWidth)
                postCtx.drawImage(_pwPlusIcon, scaleX(0.0294), py - scaleHeight(0.0258), scaleWidth(0.14), scaleHeight(0.0724));
            postCtx.fillText(cost, scaleX(0.1027), py + scaleHeight(0.0172));
        } else if (cost.includes('-')) {
            if (_pwMinusIcon.complete && _pwMinusIcon.naturalWidth)
                postCtx.drawImage(_pwMinusIcon, scaleX(0.028), py - scaleHeight(0.0153), scaleWidth(0.1414), scaleHeight(0.0705));
            postCtx.fillText(cost, scaleX(0.1027), py + scaleHeight(0.0181));
        } else if (cost !== '') {
            if (_pwNeutralIcon.complete && _pwNeutralIcon.naturalWidth)
                postCtx.drawImage(_pwNeutralIcon, scaleX(0.028), py - scaleHeight(0.0153), scaleWidth(0.1414), scaleHeight(0.061));
            postCtx.fillText(cost, scaleX(0.1027), py + scaleHeight(0.0191));
        }
    }

    drawCard();
}

function invertPlaneswalkerColors() {
    const invert = document.getElementById('planeswalker-invert')?.checked;
    if (invert) {
        _pwDarkColor  = '#5b5b5b';
        _pwLightColor = 'black';
        _pwLightToDark.src = '/img/frames/planeswalker/abilityLineOddDarkened.png';
        _pwDarkToLight.src = '/img/frames/planeswalker/abilityLineEvenDarkened.png';
    } else {
        _pwDarkColor  = '#a4a4a4';
        _pwLightColor = 'white';
        _pwLightToDark.src = '/img/frames/planeswalker/abilityLineOdd.png';
        _pwDarkToLight.src = '/img/frames/planeswalker/abilityLineEven.png';
    }
    planeswalkerEdited();
}

// ── Adventure card text options ───────────────────────────────────────────────

function loadAdventureTextOptions() {
    card.artBounds = { x:0.0767, y:0.1129, width:0.8486, height:0.4431 };
    loadTextOptions({
        // ── Main card (full width) ──
        mana:    { name:'Mana Cost',       text:'', y:0.048,  width:0.9292, height:71/2100, oneLine:true, size:71/1638,  align:'right', manaCost:true, manaSpacing:0 },
        title:   { name:'Title',           text:'', x:0.0854, y:0.0522,  width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0381 },
        type:    { name:'Type',            text:'', x:0.085,  y:0.572,   width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0324 },
        // ── Creature side (right column) ──
        rules:   { name:'Rules Text',      text:'', x:0.513,  y:0.638,   width:0.418,  height:0.245,  size:0.0324 },
        pt:      { name:'Power/Toughness', text:'', x:0.800,  y:0.905,   width:0.137,  height:0.0372, oneLine:true, font:'belerenbsc', size:0.0372, align:'center' },
        // ── Adventure spell (left column) ──
        title2:  { name:'Adv. Title',      text:'', x:0.063,  y:0.637,   width:0.350,  height:0.032,  oneLine:true, font:'belerenb', size:0.0296 },
        mana2:   { name:'Adv. Mana Cost',  text:'', x:0.063,  y:0.630,   width:0.369,  height:71/2100, oneLine:true, size:0.0296, align:'right', manaCost:true, manaSpacing:0 },
        type2:   { name:'Adv. Type',       text:'', x:0.081,  y:0.680,   width:0.417,  height:0.032,  oneLine:true, font:'belerenb', size:0.0296 },
        rules2:  { name:'Adv. Rules Text', text:'', x:0.063,  y:0.706,   width:0.405,  height:0.185,  size:0.0296 },
    });
}

// ── Prepared card text options ────────────────────────────────────────────────

function loadPreparedTextOptions() {
    card.artBounds = { x:0.0767, y:0.1129, width:0.8486, height:0.4131 };
    loadTextOptions({
        mana:    { name:'Mana Cost',        text:'', x:-0.030,  y:0.075,   width:0.9292, height:71/2100,  oneLine:true, size:71/1638,  align:'right', manaCost:true, manaSpacing:0 },
        title:   { name:'Title',            text:'', x:0.100,   y:0.085,   width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0381 },
        type:    { name:'Type',             text:'', x:0.100,   y:0.575,   width:0.8292, height:0.0400, oneLine:true, font:'belerenb', size:0.0324 },
        rules:   { name:'Rules Text',       text:'', x:0.100,   y:0.674,   width:0.3800, height:0.2800, size:0.0324 },
        pt:      { name:'Power/Toughness',  text:'', x:0.766,   y:0.884,   width:0.1367, height:0.0372, oneLine:true, font:'belerenbsc', size:0.0372, align:'center' },
        title2:  { name:'Spell Name',       text:'', x:0.510,   y:0.635,   width:0.4000, height:0.0350, oneLine:true, font:'belerenb', size:0.0296 },
        mana2:   { name:'Spell Mana Cost',  text:'', x:0.445,   y:0.633,   width:0.4500, height:71/2100, oneLine:true, size:0.0296, align:'right', manaCost:true, manaSpacing:0 },
        type2:   { name:'Spell Type',       text:'', x:0.510,   y:0.680,   width:0.4500, height:0.0320, oneLine:true, font:'belerenb', size:0.0296 },
        rules2:  { name:'Spell Rules Text', text:'', x:0.510,   y:0.725,   width:0.4500, height:0.2000, size:0.0324 },
    });
}

// ── Saga editor ───────────────────────────────────────────────────────────────
function loadSagaTextOptions() {
    card.artBounds = { x: 0.0767, y: 0.1129, width: 0.8476, height: 0.4429 };
    loadTextOptions({
        mana:     { name:'Mana Cost',    text:'', y:0.048,  width:0.9292, height:71/2100, oneLine:true, size:71/1638, align:'right', manaCost:true, manaSpacing:0 },
        title:    { name:'Title',        text:'', x:0.0854, y:0.0522, width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0381 },
        type:     { name:'Type',         text:'', x:0.0854, y:0.855,  width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0324 },
        reminder: { name:'Reminder Text',text:'{i}(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.){/i}', x:0.090,  y:0.160,  width:0.400,  height:0.120, size:0.0267, font:'mplantini' },
        ability0: { name:'Chapter 1',    text:'', x:0.248,  y:0.2896, width:0.666,  height:0.1786, size:0.0324 },
        ability1: { name:'Chapter 2',    text:'', x:0.248,  y:0.4682, width:0.666,  height:0.1786, size:0.0324 },
        ability2: { name:'Chapter 3',    text:'', x:0.248,  y:0.6468, width:0.666,  height:0.1786, size:0.0324 },
        ability3: { name:'Chapter 4',    text:'', x:0.248,  y:0.8254, width:0.666,  height:0,      size:0.0324 },
    });
}

function initSagaEditor() {
    sizeCanvas('saga');

    if (!card.saga) {
        card.saga = { abilities: [1, 1, 1, 0], count: 3, x: 0.1, width: 0.3947 };
    }

    if (!window._sagaImagesLoaded) {
        window._sagaImagesLoaded = true;
        window.sagaChapterImg = new Image(); sagaChapterImg.crossOrigin = 'anonymous'; sagaChapterImg.onload = () => { drawSagaChapters(); drawCard(); };
        window.sagaDividerImg = new Image(); sagaDividerImg.crossOrigin = 'anonymous'; sagaDividerImg.onload = () => { drawSagaChapters(); drawCard(); };
        sagaChapterImg.src = '/img/frames/Saga/_ui/sagaChapter.png';
        sagaDividerImg.src = '/img/frames/Saga/_ui/sagaDivider.png';
    }

    _buildSagaUI();
    sagaEdited();
}

function _buildSagaUI() {
    const s = card.saga;
    const defaultHeights = [
        Math.round(scaleHeight(card.text?.ability0?.height || 0.1786)),
        Math.round(scaleHeight(card.text?.ability1?.height || 0.1786)),
        Math.round(scaleHeight(card.text?.ability2?.height || 0.1786)),
        Math.round(scaleHeight(card.text?.ability3?.height || 0)),
    ];

    document.getElementById('special-editor').innerHTML = `
    <div class="card-section">
        <div class="section-title">Saga Chapters</div>
        ${[0,1,2,3].map(i => `
        <div class="saga-ability-row">
            <span class="dimtext" style="min-width:60px">Ability ${i+1}</span>
            <input type="number" id="saga-chapters-${i}" placeholder="Chapters" min="0" max="3" value="${s.abilities[i] ?? (i < 3 ? 1 : 0)}" oninput="sagaEdited()" style="max-width:60px">
            <input type="number" id="saga-height-${i}"   placeholder="Height px" min="0" value="${defaultHeights[i]}" oninput="sagaEdited()">
        </div>`).join('')}
    </div>`;
}

function sagaEdited() {
    if (!card.saga || !window.sagaCanvas) return;
    const s = card.saga;

    let lastY = card.text?.ability0?.y ?? 0.2896;
    s.count   = 0;

    for (let i = 0; i < 4; i++) {
        const chEl     = document.getElementById('saga-chapters-' + i);
        const heightEl = document.getElementById('saga-height-'   + i);
        s.abilities[i] = parseInt(chEl?.value)    || 0;
        const heightPx = parseInt(heightEl?.value) || 0;

        const obj = card.text?.['ability' + i];
        if (!obj) continue;
        obj.y      = lastY;
        obj.height = heightPx / card.height;
        if (heightPx > 0) s.count++;
        lastY += obj.height;
    }

    drawSagaChapters();
    drawCard();
}

function drawSagaChapters() {
    if (!card.saga || !window.sagaCanvas) return;
    const s   = card.saga;
    const ctx = sagaContext;
    ctx.clearRect(0, 0, sagaCanvas.width, sagaCanvas.height);
    ctx.font         = 'normal normal 550 ' + scaleHeight(0.0324) + 'px plantinsemibold';
    ctx.textAlign    = 'center';
    ctx.fillStyle    = '#333';
    ctx.textBaseline = 'alphabetic';

    let sagaCount = 1;
    for (let i = 0; i < s.count; i++) {
        const obj = card.text?.['ability' + i];
        if (!obj) continue;
        const x = scaleX(s.x);
        const y = scaleY(obj.y);
        const w = scaleWidth(s.width);
        const h = scaleHeight(obj.height);
        const chapters = s.abilities[i] || 1;

        if (sagaDividerImg?.complete && sagaDividerImg.naturalWidth)
            ctx.drawImage(sagaDividerImg, x, y - scaleHeight(0.0029) / 2, w, scaleHeight(0.0029));

        if (sagaChapterImg?.complete && sagaChapterImg.naturalWidth) {
            const nW = scaleWidth(0.0787), nH = scaleHeight(0.0629);
            const nX = x - scaleWidth(0.0614);
            const nY = y + (h - nH) / 2;
            const nTX = nX + scaleWidth(0.0394);
            const nTY = nY + scaleHeight(0.0429);
            const sp  = scaleHeight(0.0358);

            if (chapters >= 3) {
                ctx.drawImage(sagaChapterImg, nX, nY - 2*sp, nW, nH);
                ctx.drawImage(sagaChapterImg, nX, nY,        nW, nH);
                ctx.drawImage(sagaChapterImg, nX, nY + 2*sp, nW, nH);
                ctx.fillText(romanNumeral(sagaCount),     nTX, nTY - 2*sp);
                ctx.fillText(romanNumeral(sagaCount + 1), nTX, nTY);
                ctx.fillText(romanNumeral(sagaCount + 2), nTX, nTY + 2*sp);
                sagaCount += 3;
            } else if (chapters === 2) {
                ctx.drawImage(sagaChapterImg, nX, nY - sp, nW, nH);
                ctx.drawImage(sagaChapterImg, nX, nY + sp, nW, nH);
                ctx.fillText(romanNumeral(sagaCount),     nTX, nTY - sp);
                ctx.fillText(romanNumeral(sagaCount + 1), nTX, nTY + sp);
                sagaCount += 2;
            } else {
                ctx.drawImage(sagaChapterImg, nX, nY, nW, nH);
                ctx.fillText(romanNumeral(sagaCount), nTX, nTY);
                sagaCount++;
            }
        }
    }
}

function romanNumeral(n) {
    return ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] ?? n;
}

// ── Class card editor ─────────────────────────────────────────────────────────

var _classHeaderImg = null;

function loadClassTextOptions() {
    card.artBounds = { x: 0.0767, y: 0.1129, width: 0.4247, height: 0.3 };
    loadTextOptions({
        mana:    { name:'Mana Cost', text:'', y:0.048, width:0.9292, height:71/2100, oneLine:true, size:71/1638, align:'right', manaCost:true, manaSpacing:0 },
        title:   { name:'Title',     text:'', x:0.0854, y:0.0522, width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0381 },
        type:    { name:'Type',      text:'', x:0.0854, y:0.8481, width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0324 },
        level0c: { name:'Level 1 - Text', text:'{i}(Gain the next level as a sorcery to add its ability.){/i}', x:0.5093, y:0.1129, width:0.404, height:0.2096, size:0.0305 },
        level1a: { name:'Level 2 - Cost', text:'', x:0.5093, y:2, width:0.3967, height:0.0277, size:0.0277 },
        level1b: { name:'Level 2 - Name', text:'', x:0.5093, y:2, width:0.3967, height:0.0281, size:0.0281, align:'right' },
        level1c: { name:'Level 2 - Text', text:'', x:0.5093, y:2, width:0.404,  height:0.2091, size:0.0305 },
        level2a: { name:'Level 3 - Cost', text:'', x:0.5093, y:2, width:0.3967, height:0.0277, size:0.0277 },
        level2b: { name:'Level 3 - Name', text:'', x:0.5093, y:2, width:0.3967, height:0.0281, size:0.0281, align:'right' },
        level2c: { name:'Level 3 - Text', text:'', x:0.5093, y:2, width:0.404,  height:0.2091, size:0.0305 },
        level3a: { name:'Level 4 - Cost', text:'', x:0.5093, y:2, width:0.3967, height:0.0277, size:0.0277 },
        level3b: { name:'Level 4 - Name', text:'', x:0.5093, y:2, width:0.3967, height:0.0281, size:0.0281, align:'right' },
        level3c: { name:'Level 4 - Text', text:'', x:0.5093, y:2, width:0.404,  height:0.2091, size:0.0305 },
    });
}

const CLASS_OVERLAY_LAYERS = [
    { name: 'Pinline',     src: '/img/frames/Class/_ui/pinline.svg'     },
    { name: 'Title Mask',  src: '/img/frames/Class/_ui/m15MaskTitle.png'},
    { name: 'Type Mask',   src: '/img/frames/Saga/_ui/sagaMaskType.png' },
    { name: 'Frame',       src: '/img/frames/Class/_ui/frame.svg'       },
    { name: 'Text Left',   src: '/img/frames/Class/_ui/text.svg'        },
    { name: 'Text Right',  src: '/img/frames/Class/_ui/textRight.png'   },
    { name: 'Border',      src: '/img/frames/Class/_ui/border.svg'      },
];

function initClassEditor() {
    sizeCanvas('class');

    if (!card.class) {
        card.class = { x: 0.5014, width: 0.422, count: 0 };
    }

    if (!_classHeaderImg) {
        _classHeaderImg = new Image();
        _classHeaderImg.crossOrigin = 'anonymous';
        _classHeaderImg.onload = () => { classEdited(); drawCard(); };
        _classHeaderImg.src = '/img/frames/Class/_ui/header.png';
    }

    _buildClassUI();
    classEdited();
}

function _buildClassUI() {
    const defaultHeights = [
        Math.round(scaleHeight(card.text?.level0c?.height || 0.2096)),
        Math.round(scaleHeight(card.text?.level1c?.height || 0.2091)),
        Math.round(scaleHeight(card.text?.level2c?.height || 0.2091)),
        0,
    ];

    document.getElementById('special-editor').innerHTML = `
    <div class="card-section">
        <div class="section-title">Class Levels</div>
        ${[0,1,2,3].map(i => `
        <div class="pw-ability-row">
            <span class="dimtext" style="min-width:60px">Level ${i+1}</span>
            <input type="number" id="class-height-${i}" placeholder="Height px" min="0" value="${defaultHeights[i]}" oninput="classEdited()" style="flex:1">
        </div>`).join('')}
    </div>`;
}

function classEdited() {
    if (!card.class || !window.classCanvas) return;
    const c = card.class;
    c.count = 0;

    let lastY = card.text?.level0c?.y ?? 0.1129;
    const heightPx0 = parseInt(document.getElementById('class-height-0')?.value) || 0;
    if (card.text?.level0c) card.text.level0c.height = heightPx0 / card.height;
    lastY += (heightPx0 / card.height) + 0.0481;

    for (let i = 1; i < 4; i++) {
        const heightPx = parseInt(document.getElementById('class-height-' + i)?.value) || 0;
        const height   = heightPx / card.height;
        const ta = card.text?.['level' + i + 'a'];
        const tb = card.text?.['level' + i + 'b'];
        const tc = card.text?.['level' + i + 'c'];
        if (!ta || !tb || !tc) continue;

        if (height > 0) {
            c.count++;
            ta.y = lastY - 0.0361;
            tb.y = lastY - 0.0361;
            tc.y = lastY;
            tc.height = height;
            lastY += height + 0.0481;
        } else {
            ta.y = 2; tb.y = 2; tc.y = 2;
        }
    }

    // Last active level fills remaining space
    for (let i = 3; i >= 1; i--) {
        const tc = card.text?.['level' + i + 'c'];
        if (!tc || tc.y >= 2) continue;
        const remaining = 0.8368 - tc.y;
        tc.height = Math.max(0.05, remaining);
        break;
    }

    const ctx = classContext;
    ctx.clearRect(0, 0, classCanvas.width, classCanvas.height);

    if (_classHeaderImg?.complete && _classHeaderImg.naturalWidth) {
        for (let i = 1; i <= c.count; i++) {
            const tc = card.text?.['level' + i + 'c'];
            if (!tc || tc.y >= 2) continue;
            ctx.drawImage(
                _classHeaderImg,
                scaleX(c.x),
                scaleY(tc.y) - scaleHeight(0.0481),
                scaleWidth(c.width),
                scaleHeight(0.0481)
            );
        }
    }

    drawCard();
}

// ── Drag to reposition art ────────────────────────────────────────────────────
function initArtDrag() {
    let dragging = false, startX = 0, startY = 0, startArtX = 0, startArtY = 0;
    let startZoom = 1, startRotate = 0, startDist = 0;

    function canvasCoords(e) {
        const rect  = previewCanvas.getBoundingClientRect();
        const scale = previewCanvas.width / rect.width;
        return {
            x: (e.clientX - rect.left) * scale,
            y: (e.clientY - rect.top)  * scale,
        };
    }

    previewCanvas.addEventListener('mousedown', e => {
        dragging   = true;
        const pos  = canvasCoords(e);
        startX     = pos.x; startY = pos.y;
        startArtX  = card.artX;
        startArtY  = card.artY;
        startZoom  = card.artZoom;
        startRotate = card.artRotate;
    });

    previewCanvas.addEventListener('mousemove', e => {
        if (!dragging) return;
        const pos = canvasCoords(e);
        const dx  = pos.x - startX;
        const dy  = pos.y - startY;

        if (e.shiftKey) {
            const dist  = Math.sqrt(dx * dx + dy * dy);
            const sign  = dy < 0 ? -1 : 1;
            card.artZoom = Math.max(0.01, startZoom + sign * dist / previewCanvas.width * 4);
        } else if (e.ctrlKey || e.metaKey) {
            card.artRotate = startRotate + dx / 3;
        } else {
            // scale dx/dy from preview coords to card coords
            const scale = card.width / previewCanvas.width;
            card.artX = startArtX + dx * scale;
            card.artY = startArtY + dy * scale;
        }
        syncArtInputs();
        drawCard();
    });

    window.addEventListener('mouseup', () => { dragging = false; });
}
