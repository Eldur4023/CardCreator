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

    canvasList.forEach(name => sizeCanvas(name));

    art.src       = '/img/blank.png';
    setSymbol.src = '/img/blank.png';
    watermark.src = '/img/blank.png';

    // Clear special canvases
    if (window.planeswalkerPreFrameContext)  planeswalkerPreFrameContext.clearRect(0, 0, planeswalkerPreFrameCanvas.width, planeswalkerPreFrameCanvas.height);
    if (window.planeswalkerPostFrameContext) planeswalkerPostFrameContext.clearRect(0, 0, planeswalkerPostFrameCanvas.width, planeswalkerPostFrameCanvas.height);
    if (window.sagaContext)                  sagaContext.clearRect(0, 0, sagaCanvas.width, sagaCanvas.height);
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
    document.querySelectorAll('.text-option-btn').forEach(b => {
        b.classList.toggle('active', b.textContent === (obj.name || key));
    });
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
    if (!card.artBounds) return;
    const b  = card.artBounds;
    const bw = b.width  * card.width;
    const bh = b.height * card.height;
    if (!art.naturalWidth) return;
    const scaleX = bw / art.naturalWidth;
    const scaleY = bh / art.naturalHeight;
    card.artZoom = Math.max(scaleX, scaleY);
    card.artX    = 0;
    card.artY    = 0;
    syncArtInputs();
    drawCard();
}

function uploadArt(src, extra) {
    art.src = src;
    if (extra === 'autoFit') {
        art.onload = () => { autoFitArt(); drawCard(); };
    } else {
        art.onload = () => drawCard();
    }
    card.artSource = src;
    drawCard();
}

// ── Set symbol editing ────────────────────────────────────────────────────────
function setSymbolEdited() {
    card.setSymbolX    = parseFloat(document.getElementById('setSymbol-x').value)    || 0;
    card.setSymbolY    = parseFloat(document.getElementById('setSymbol-y').value)    || 0;
    card.setSymbolZoom = (parseFloat(document.getElementById('setSymbol-zoom').value) || 100) / 100;
    drawCard();
}

function resetSetSymbol() {
    card.setSymbolX    = 0;
    card.setSymbolY    = 0;
    card.setSymbolZoom = 1;
    document.getElementById('setSymbol-x').value    = 0;
    document.getElementById('setSymbol-y').value    = 0;
    document.getElementById('setSymbol-zoom').value = 100;
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

// ── Frame picker ──────────────────────────────────────────────────────────────
var availableFrames  = [];
var selectedFrame    = null;
var selectedMaskIndex = -1;
var replacementMasks = {};

function loadFramePacks(packs) {
    const select = document.getElementById('selectFramePack');
    select.innerHTML = '';
    packs.forEach(pack => {
        const opt = document.createElement('option');
        if (pack.disabled) {
            opt.disabled = true;
            opt.textContent = pack.name;
        } else {
            opt.value = pack.value;
            opt.textContent = pack.name;
        }
        select.appendChild(opt);
    });
    // auto-load first enabled pack
    const first = packs.find(p => !p.disabled);
    if (first) {
        select.value = first.value;
        loadScript('/js/frames/pack' + first.value + '.js').then(() => {
            // Auto-click Load Frame Version whenever a new group is selected
            // (not just on initial load when card.text is null)
            const btn = document.querySelector('#loadFrameVersion');
            if (btn && !btn.disabled) btn.click();
        });
    }
}

function loadFramePack() {
    const picker = document.getElementById('frame-picker');
    const mPicker = document.getElementById('mask-picker');
    picker.innerHTML  = '';
    mPicker.innerHTML = '';
    selectedFrame     = availableFrames[0] || null;
    selectedMaskIndex = -1;

    availableFrames.forEach((frame, i) => {
        const wrap  = document.createElement('div');
        wrap.className = 'frame-thumb-wrap';

        const img = document.createElement('img');
        img.className = 'frame-thumb' + (i === 0 ? ' selected' : '');
        img.src   = frame.src;
        img.title = frame.name;
        img.alt   = frame.name;
        img.onerror = () => { img.style.background = '#333'; };
        img.onclick = () => {
            selectedFrame = frame;
            picker.querySelectorAll('.frame-thumb').forEach(t => t.classList.remove('selected'));
            img.classList.add('selected');
            loadMaskPicker(frame);
            updateSelectedPreview();
        };
        img.ondblclick = () => { selectedFrame = frame; addFrame(); };

        const label = document.createElement('div');
        label.className   = 'frame-thumb-label';
        label.textContent = frame.name;

        wrap.appendChild(img);
        wrap.appendChild(label);
        picker.appendChild(wrap);
    });

    loadMaskPicker(selectedFrame);
    updateSelectedPreview();
}

function loadMaskPicker(frame) {
    const mPicker = document.getElementById('mask-picker');
    mPicker.innerHTML = '';
    selectedMaskIndex = -1;
    if (!frame || !frame.masks || !frame.masks.length) return;

    frame.masks.forEach((mask, i) => {
        const img = document.createElement('img');
        img.className = 'mask-thumb';
        img.src   = mask.src;
        img.title = mask.name;
        img.alt   = mask.name;
        img.onerror = () => { img.style.background = '#555'; img.style.border = '1px dashed #888'; };
        img.onclick = () => {
            selectedMaskIndex = i;
            mPicker.querySelectorAll('.mask-thumb').forEach(t => t.classList.remove('selected'));
            img.classList.add('selected');
            updateSelectedPreview();
        };
        img.ondblclick = () => { selectedMaskIndex = i; addFrame(); };
        mPicker.appendChild(img);
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
            const img = new Image(); img.crossOrigin = 'anonymous'; img.src = m.src;
            img.onload = () => drawCard();
            maskImages.push({ name: m.name, src: m.src, image: img });
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
        name: selectedFrame.name,
        src: selectedFrame.src,
        image: frameImage,
        masks: maskImages,
        opacity: 100,
        mode: 'source-over',
        preserveAlpha: false,
        bounds: selectedFrame.bounds || null,
        hslAdjust: { hue: 0, saturation: 0, lightness: 0 },
        colorOverlay: '#000000',
        colorOverlayEnabled: false,
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

        const opacity = document.createElement('input');
        opacity.type  = 'number'; opacity.min = 0; opacity.max = 100; opacity.step = 1;
        opacity.className = 'opacity-input';
        opacity.value = frame.opacity;
        opacity.oninput = () => { frame.opacity = parseFloat(opacity.value) || 0; drawCard(); };

        const del = document.createElement('button');
        del.className   = 'danger';
        del.textContent = '✕';
        del.onclick = () => { card.frames.splice(idx, 1); renderFrameList(); drawCard(); };

        item.appendChild(name);
        item.appendChild(opacity);
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
    drawCard();
    initArtDrag();

    // Load default frame (M15 Standard) so text areas are available immediately
    loadScript('/js/frames/groupStandard-3.js');
});

function toggleCollapse(el) {
    el.classList.toggle('open');
}

// ── Dynamic script loading ────────────────────────────────────────────────────
var loadingScript = false;

function loadScript(url) {
    // Intercept CardConjurer version scripts — handle natively
    if (url === '/js/frames/versionPlaneswalker.js') {
        if (!loadedVersions.includes(url)) loadedVersions.push(url);
        setTimeout(() => initPlaneswalkerEditor(), 0);
        return Promise.resolve();
    }
    if (url === '/js/frames/versionSaga.js') {
        if (!loadedVersions.includes(url)) loadedVersions.push(url);
        setTimeout(() => initSagaEditor(), 0);
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const existing = document.querySelector(`script[src="${url}"]`);
        if (existing) existing.remove();
        const s = document.createElement('script');
        s.src = url;
        s.onload  = () => resolve();
        s.onerror = () => resolve();
        document.body.appendChild(s);
    });
}

function handleAutoLoad() {
    // handled automatically in pack scripts via #loadFrameVersion.onclick
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
    if (!cardCanvas || !cardContext) return;

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

    // 7. Text
    drawAllText();

    // 8. Set symbol
    if (!setSymbol.src.includes('blank')) drawSetSymbol();

    // 6. Guidelines
    if (document.getElementById('show-guidelines')?.checked) drawGuidelines();

    // 7. Scale to preview
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(cardCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
}

// ── Art rendering ─────────────────────────────────────────────────────────────
function drawArt() {
    if (art.src.includes('blank') || !art.naturalWidth) return;

    const bounds = card.artBounds;
    let cx, cy, cw, ch;

    if (bounds) {
        cx = scaleX(bounds.x);
        cy = scaleY(bounds.y);
        cw = scaleWidth(bounds.width);
        ch = scaleHeight(bounds.height);
    } else {
        cx = 0; cy = 0; cw = card.width; ch = card.height;
    }

    cardContext.save();

    // clip to art area
    cardContext.beginPath();
    cardContext.rect(cx, cy, cw, ch);
    cardContext.clip();

    const zoom   = card.artZoom;
    const drawW  = art.naturalWidth  * zoom;
    const drawH  = art.naturalHeight * zoom;
    const drawX  = cx + (cw - drawW) / 2 + card.artX;
    const drawY  = cy + (ch - drawH) / 2 + card.artY;

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
            frameMaskingContext.drawImage(black, 0, 0);
            frameMaskingContext.globalCompositeOperation = 'source-in';
            frame.masks.forEach(mask => {
                if (mask.image && mask.image.complete && mask.image.naturalWidth) {
                    frameMaskingContext.drawImage(mask.image, fx, fy, fw, fh);
                }
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

    // Auto-shrink: binary search between minSize and fontSize
    if (!oneLine && fontSize > 12) {
        fontSize = autoShrink(spans, fontSize, 12, tw, th, baseFont, oneLine, align);
    }

    // Lay out into wrapped lines
    const wrappedLines = layoutLines(spans, tw, fontSize, baseFont, oneLine, align);

    // Draw into shared paragraph canvas (cleared once per drawAllText call)
    drawLines(paragraphContext, wrappedLines, tx, ty, tw, fontSize, {
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
function autoShrink(spans, maxSize, minSize, maxW, maxH, baseFont, oneLine, defaultAlign = 'left') {
    let lo = minSize, hi = maxSize;
    while (hi - lo > 1) {
        const mid   = (lo + hi) / 2;
        const lines = layoutLines(spans, maxW, mid, baseFont, oneLine, defaultAlign);
        const h     = calcHeight(lines, mid);
        if (h <= maxH) lo = mid; else hi = mid;
    }
    const lines = layoutLines(spans, maxW, lo, baseFont, oneLine, defaultAlign);
    return calcHeight(lines, lo) <= maxH ? lo : minSize;
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

// ── Version script compat layer ───────────────────────────────────────────────
var loadedVersions = [];
function setImageUrl(img, url) { img.crossOrigin = 'anonymous'; img.src = url; }
function drawTextBuffer() { drawCard(); }
function notify() {}                          // CardConjurer UI notification stub
function bottomInfoEdited() { drawCard(); }   // collector info changed
function classEdited() {}                     // Class card type (not implemented)
function drawNewGuidelines() {}               // alternate guidelines stub
function getStandardWidth()  { return card.width; }
function getStandardHeight() { return card.height; }

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
    const isTall      = card.version.includes('Tall') || card.version.includes('Compleated');
    const isSDCC      = card.version === 'planeswalkerSDCC15';
    const imgFolder   = isSDCC ? '/img/frames/planeswalker/sdcc15' : '/img/frames/planeswalker';
    const imgExt      = isSDCC ? 'svg' : 'png';

    console.log('[PW init] version=', card.version, 'isTall=', isTall, 'card.text=', card.text);

    _pwPlusIcon.src    = `${imgFolder}/planeswalkerPlus.${imgExt}`;
    _pwMinusIcon.src   = `${imgFolder}/planeswalkerMinus.${imgExt}`;
    _pwNeutralIcon.src = `${imgFolder}/planeswalkerNeutral.${imgExt}`;
    _pwLightToDark.src = `${imgFolder}/abilityLineOdd.${imgExt}`;
    _pwDarkToLight.src = `${imgFolder}/abilityLineEven.${imgExt}`;
    const maskSrc      = isTall
        ? '/img/frames/planeswalker/tall/planeswalkerTallMaskRules.png'
        : '/img/frames/planeswalker/text.svg';
    console.log('[PW init] maskSrc=', maskSrc, 'current=', _pwTextMask.src);
    _pwTextMask.src    = maskSrc;

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

    const isTall = card.version.includes('Tall') || card.version.includes('Compleated');
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

// ── Saga editor ───────────────────────────────────────────────────────────────
function initSagaEditor() {
    sizeCanvas('saga');

    if (!card.saga) {
        card.saga = { abilities: [1, 1, 1, 0], count: 3, x: 0.1, width: 0.3947 };
    }

    if (!window._sagaImagesLoaded) {
        window._sagaImagesLoaded = true;
        window.sagaChapterImg = new Image(); sagaChapterImg.crossOrigin = 'anonymous'; sagaChapterImg.onload = () => { drawSagaChapters(); drawCard(); };
        window.sagaDividerImg = new Image(); sagaDividerImg.crossOrigin = 'anonymous'; sagaDividerImg.onload = () => { drawSagaChapters(); drawCard(); };
        sagaChapterImg.src = '/img/frames/saga/sagaChapter.png';
        sagaDividerImg.src = '/img/frames/saga/sagaDivider.png';
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
