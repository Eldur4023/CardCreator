'use strict';

document.addEventListener('DOMContentLoaded', () => renderLibrary());

async function _libraryLoad() {
    try {
        const res = await fetch('/api/library');
        if (!res.ok) return [];
        return await res.json();
    } catch { return []; }
}

async function _librarySave(entry) {
    const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error('Save failed');
}

async function _libraryDelete(id) {
    await fetch('/api/library/' + encodeURIComponent(id), { method: 'DELETE' });
}

function _cardSerialize(name) {
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

async function saveCard() {
    const nameEl = document.getElementById('library-card-name');
    const name   = nameEl?.value?.trim() || 'Untitled';
    const entry  = _cardSerialize(name);
    try {
        await _librarySave(entry);
        renderLibrary();
    } catch (e) {
        alert('Error al guardar: ' + e.message);
    }
}

async function loadCard(id) {
    const cards = await _libraryLoad();
    const entry = cards.find(c => c.id === id);
    if (!entry) return;

    await resetCardIrregularities();
    Object.assign(card, entry.card);

    ['card','frame','frameMasking','frameCompositing','text','paragraph','line','watermark']
        .forEach(n => sizeCanvas(n));

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

    if (entry.card.onload) {
        const idx = loadedVersions.indexOf(entry.card.onload);
        if (idx !== -1) loadedVersions.splice(idx, 1);
        loadScript(entry.card.onload);
    }

    drawCard();
}

async function deleteCard(id) {
    await _libraryDelete(id);
    renderLibrary();
}

async function renderLibrary() {
    const container = document.getElementById('library-grid');
    if (!container) return;

    container.innerHTML = '<p class="dimtext" style="padding:12px">Cargando...</p>';
    const cards = await _libraryLoad();

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
