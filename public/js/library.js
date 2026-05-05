'use strict';

const LIBRARY_KEY = 'cardconjurer_library';

document.addEventListener('DOMContentLoaded', () => renderLibrary());

function _libraryLoad() {
    try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); }
    catch { return []; }
}

function _librarySave(cards) {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(cards));
}

function _cardSerialize(name) {
    // card object — strip Image instances, keep plain data
    const cardData = {
        width: card.width, height: card.height,
        marginX: card.marginX, marginY: card.marginY,
        version: card.version, onload: card.onload,
        artBounds: card.artBounds,
        setSymbolBounds: card.setSymbolBounds,
        watermarkBounds: card.watermarkBounds,
        text: card.text,
        planeswalker: card.planeswalker,
        saga: card.saga,
    };

    // frames — keep only serializable fields
    const framesData = (card.frames || []).map(f => ({
        name: f.name, src: f.src,
        masks: (f.masks || []).map(m => ({ name: m.name, src: m.src })),
        opacity: f.opacity, mode: f.mode,
        preserveAlpha: f.preserveAlpha,
        bounds: f.bounds,
        hslAdjust: f.hslAdjust,
        colorOverlay: f.colorOverlay,
        colorOverlayEnabled: f.colorOverlayEnabled,
    }));

    // thumbnail — small JPEG of the current rendered card
    const thumb = cardCanvas.toDataURL('image/jpeg', 0.25);

    return {
        id: Date.now() + '-' + Math.random().toString(36).slice(2),
        name: name || 'Untitled',
        savedAt: Date.now(),
        thumbnail: thumb,
        card: cardData,
        frames: framesData,
        art: window.art?.src || '',
        setSymbol: window.setSymbol?.src || '',
        watermark: window.watermark?.src || '',
    };
}

function saveCard() {
    const nameEl = document.getElementById('library-card-name');
    const name   = nameEl?.value?.trim() || 'Untitled';
    const entry  = _cardSerialize(name);
    const cards  = _libraryLoad();
    cards.unshift(entry);
    try {
        _librarySave(cards);
    } catch (e) {
        // localStorage full — remove oldest entries until it fits
        while (cards.length > 1) {
            cards.pop();
            try { _librarySave(cards); break; }
            catch { continue; }
        }
        alert('Biblioteca casi llena — se eliminaron cartas antiguas para hacer espacio.');
    }
    renderLibrary();
}

async function loadCard(id) {
    const cards = _libraryLoad();
    const entry = cards.find(c => c.id === id);
    if (!entry) return;

    await resetCardIrregularities();

    // restore plain card fields
    Object.assign(card, entry.card);

    // resize canvases to restored dimensions
    ['card','frame','frameMasking','frameCompositing','text','paragraph','line','watermark']
        .forEach(n => sizeCanvas(n));

    // restore art / setSymbol / watermark images
    const loadImg = (img, src) => new Promise(res => {
        if (!src || src.includes('/img/blank')) { res(); return; }
        img.onload = img.onerror = res;
        img.src = src;
    });
    await Promise.all([
        loadImg(window.art,       entry.art),
        loadImg(window.setSymbol, entry.setSymbol),
        loadImg(window.watermark, entry.watermark),
    ]);

    // restore frames
    card.frames = [];
    await Promise.all(entry.frames.map(f => new Promise(res => {
        const masks = [];
        let pending = f.masks.length + 1;
        const done = () => { if (--pending === 0) res(); };

        const frameImage = new Image(); frameImage.crossOrigin = 'anonymous';
        frameImage.onload = frameImage.onerror = done;
        frameImage.src = f.src;

        f.masks.forEach(m => {
            const img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = img.onerror = done;
            img.src = m.src;
            masks.push({ name: m.name, src: m.src, image: img });
        });

        card.frames.push({
            name: f.name, src: f.src, image: frameImage,
            masks, opacity: f.opacity, mode: f.mode,
            preserveAlpha: f.preserveAlpha, bounds: f.bounds,
            hslAdjust: f.hslAdjust,
            colorOverlay: f.colorOverlay,
            colorOverlayEnabled: f.colorOverlayEnabled,
        });
    })));


    renderFrameList();

    // trigger version script to rebuild special editors
    if (entry.card.onload) {
        // reset loadedVersions so init runs fresh
        const idx = loadedVersions.indexOf(entry.card.onload);
        if (idx !== -1) loadedVersions.splice(idx, 1);
        loadScript(entry.card.onload);
    }

    drawCard();
}

function deleteCard(id) {
    const cards = _libraryLoad().filter(c => c.id !== id);
    _librarySave(cards);
    renderLibrary();
}

function renderLibrary() {
    const container = document.getElementById('library-grid');
    if (!container) return;
    const cards = _libraryLoad();

    if (!cards.length) {
        container.innerHTML = '<p class="dimtext" style="padding:12px">No hay cartas guardadas.</p>';
        return;
    }

    container.innerHTML = '';
    cards.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'library-item';

        const thumb = document.createElement('img');
        thumb.src = entry.thumbnail;
        thumb.className = 'library-thumb';
        thumb.onclick = () => loadCard(entry.id);

        const info = document.createElement('div');
        info.className = 'library-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'library-name';
        nameEl.textContent = entry.name;

        const date = document.createElement('div');
        date.className = 'dimtext';
        date.style.fontSize = '10px';
        date.textContent = new Date(entry.savedAt).toLocaleDateString();

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '4px';
        btnRow.style.marginTop = '4px';

        const loadBtn = document.createElement('button');
        loadBtn.textContent = 'Cargar';
        loadBtn.style.flex = '1';
        loadBtn.onclick = () => loadCard(entry.id);

        const delBtn = document.createElement('button');
        delBtn.textContent = '✕';
        delBtn.style.background = '#a33';
        delBtn.onclick = () => { if (confirm('¿Eliminar "' + entry.name + '"?')) deleteCard(entry.id); };

        btnRow.append(loadBtn, delBtn);
        info.append(nameEl, date, btnRow);
        item.append(thumb, info);
        container.appendChild(item);
    });
}
