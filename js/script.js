let isYouTube = false, subtitles = [], activeIndices = new Set();
let autoScrollEnabled = true;
let history = [], redoStack = [];
const video = document.getElementById('video-player');
const subInput = document.getElementById('subtitle-input');
let confirmCallback = null;

function niceConfirm(msg, callback) {
    document.getElementById('confirm-msg').innerText = msg;
    document.getElementById('custom-confirm').style.display = 'flex';
    confirmCallback = callback;
}
function closeConfirm(result) {
    document.getElementById('custom-confirm').style.display = 'none';
    if(confirmCallback) confirmCallback(result);
}

function saveHistory() {
    const snapshot = JSON.stringify(subtitles);
    history.push(snapshot);
    if (history.length > 50) history.shift();
    redoStack = [];
    updateUndoButtons();
    localStorage.setItem('web_sub_draft_v2', snapshot);
}

function undo() {
    if (history.length <= 1) return;
    redoStack.push(history.pop());
    subtitles = JSON.parse(history[history.length - 1]);
    renderEditor(subtitles, false);
}

function redo() {
    if (redoStack.length === 0) return;
    const snapshot = redoStack.pop();
    history.push(snapshot);
    subtitles = JSON.parse(snapshot);
    renderEditor(subtitles, false);
}

function updateUndoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if(undoBtn) undoBtn.disabled = history.length <= 1;
    if(redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function clearDraft() {
    niceConfirm("Hapus semua draft dan reset editor?", (ok) => { 
        if(ok) { 
            localStorage.removeItem('web_sub_draft_v2'); 
            location.reload(); 
        } 
    });
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600), 
          m = Math.floor((seconds % 3600) / 60), 
          s = Math.floor(seconds % 60), 
          ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`;
}

function timeToSec(str) {
    if (!str) return 0;
    const parts = str.replace(',', '.').split(':');
    if (parts.length === 3) return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
    if (parts.length === 2) return (+parts[0]) * 60 + (+parts[1]);
    return +parts[0] || 0;
}

function setMarkerAt(index, type) {
    if (!video.src) return alert("Pilih video terlebih dahulu!");
    saveHistory();
    
    let now = video.currentTime;
    const sub = subtitles[index];

    if (type === 'start') {
        sub.start = Math.max(0, now - 0.2); 
    } else {
        if (now < sub.start) {
            alert("Waktu selesai tidak boleh kurang dari waktu mulai!");
            history.pop();
            updateUndoButtons();
            return;
        }
        sub.end = now;
    }

    const sStr = formatTime(sub.start).replace('.', ',');
    const eStr = formatTime(sub.end).replace('.', ',');
    sub.timeLine = `${sStr} --> ${eStr}`;

    const allInputs = document.querySelectorAll('.timestamp-input');
    if (allInputs[index]) {
        allInputs[index].value = sub.timeLine;
    }
    localStorage.setItem('web_sub_draft_v2', JSON.stringify(subtitles));
}

function applyMusicFormat(index) {
    saveHistory();
    let sub = subtitles[index];
    let text = sub.rawText.trim();
    if (text.includes('<b><i>')) {
        sub.rawText = text.replace(/\{\\an[1-9]\}/g, '').replace(/<b><i>/g, '').replace(/<\/i><\/b>/g, '').trim();
    } else {
        sub.rawText = `{\\an8}<b><i>${text}</i></b>`;
    }
    localStorage.setItem('web_sub_draft_v2', JSON.stringify(subtitles));
    // Cukup update textarea baris ini doang, nggak perlu render ulang semuanya
    const rowEl = document.getElementById('cue-container').children[index];
    const textarea = rowEl && rowEl.querySelector('.edit-area');
    if (textarea) textarea.value = sub.rawText;
}

/**
 * Bikin satu elemen DOM baris subtitle. Dipisah jadi fungsi sendiri biar
 * bisa dipakai ulang baik pas render penuh (import/undo/redo) MAUPUN pas
 * nyisipin satu baris baru doang (addNewCue) tanpa perlu render ulang
 * semuanya.
 *
 * PENTING: tombol-tombolnya nggak lagi pake inline onclick yang nge-bake
 * index ke dalam string HTML (`onclick="deleteCue(${i})"`). Itu penyebab
 * utama kenapa hapus 1 baris jadi lag di file subtitle panjang - soalnya
 * satu-satunya cara "benerin" index yang kegeser di baris-baris setelahnya
 * adalah render ulang SEMUA baris dari nol (innerHTML='' + rebuild total).
 * Sekarang tombol cuma punya `data-action`, dan baris punya `data-index`
 * yang di-update langsung (lightweight) pas ada baris dihapus/disisipkan -
 * event listener-nya baca data-index ini secara live lewat event delegation
 * di container (lihat setupCueContainerEvents), jadi nggak perlu bongkar
 * pasang DOM buat reindex.
 */
function createCueElement(sub, i) {
    const div = document.createElement('div');
    div.className = 'subtitle-cue';
    div.dataset.index = i;
    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span class="cue-index-label" style="font-weight:bold; color:var(--primary-color); min-width:25px;">#${i+1}</span>
                <input class="timestamp-input" style="flex:1;">
            </div>
            <div style="display:flex; gap:5px; margin-left:10px;">
                <button class="btn-small" data-action="play"><i class="fas fa-play"></i></button>
                <button class="btn-small" data-action="add"><i class="fas fa-plus"></i></button>
                <button class="btn-small btn-del" data-action="delete"><i class="fas fa-trash"></i></button>
            </div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr 50px; gap:8px; margin-bottom:8px;">
            <button class="btn-sync-touch btn-start" data-action="start">START</button>
            <button class="btn-sync-touch btn-end" data-action="end">END</button>
            <button class="btn-sync-touch btn-music" data-action="music"><i class="fas fa-music"></i></button>
        </div>
        <textarea class="edit-area" rows="2"></textarea>
    `;
    // di-set lewat .value, bukan interpolasi ke innerHTML - biar aman kalau
    // rawText mengandung karakter yang bisa disalahartikan sebagai markup HTML
    div.querySelector('.timestamp-input').value = sub.timeLine;
    div.querySelector('.edit-area').value = sub.rawText;
    return div;
}

// Event delegation: SATU listener buat semua baris (bukan onclick per baris).
// Ini yang bikin reindex pas delete/insert jadi murah - kita tinggal update
// atribut data-index & label teksnya, event listener-nya otomatis "ngikut"
// karena baca data-index secara live pas diklik, bukan pas dibuat.
function setupCueContainerEvents() {
    const container = document.getElementById('cue-container');

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const row = btn.closest('.subtitle-cue');
        const i = parseInt(row.dataset.index, 10);
        switch (btn.dataset.action) {
            case 'play': seekTo(subtitles[i].start); break;
            case 'add': addNewCue(i + 1); break;
            case 'delete': deleteCue(i); break;
            case 'start': setMarkerAt(i, 'start'); break;
            case 'end': setMarkerAt(i, 'end'); break;
            case 'music': applyMusicFormat(i); break;
        }
    });

    container.addEventListener('input', (e) => {
        if (!e.target.classList.contains('edit-area')) return;
        const row = e.target.closest('.subtitle-cue');
        liveUpdateText(parseInt(row.dataset.index, 10), e.target.value);
    });

    container.addEventListener('change', (e) => {
        const row = e.target.closest('.subtitle-cue');
        if (!row) return;
        const i = parseInt(row.dataset.index, 10);
        if (e.target.classList.contains('timestamp-input')) updateTimestamp(i, e.target.value);
        else if (e.target.classList.contains('edit-area')) saveHistoryText();
    });
}

// Update data-index & label nomor "#N" pada rentang baris tertentu, TANPA
// bikin ulang elemen-elemennya. Dipanggil abis delete/insert buat "geser"
// nomor baris yang ada di belakangnya.
function reindexRowsFrom(container, startIdx) {
    for (let idx = startIdx; idx < subtitles.length; idx++) {
        const rowEl = container.children[idx];
        if (!rowEl) continue;
        rowEl.dataset.index = idx;
        const label = rowEl.querySelector('.cue-index-label');
        if (label) label.textContent = '#' + (idx + 1);
    }
}

function renderEditor(data, recordHistory = true) {
    subtitles = data;
    if (recordHistory) saveHistory();
    const container = document.getElementById('cue-container');
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    subtitles.forEach((sub, i) => fragment.appendChild(createCueElement(sub, i)));
    container.appendChild(fragment);
    updateUndoButtons();
}

function liveUpdateText(i, val) {
    subtitles[i].rawText = val;
    localStorage.setItem('web_sub_draft_v2', JSON.stringify(subtitles));
}

function saveHistoryText() {
    saveHistory();
}

function updateTimestamp(i, val) {
    saveHistory();
    subtitles[i].timeLine = val;
    const pts = val.split('-->');
    if(pts.length === 2) {
        subtitles[i].start = timeToSec(pts[0].trim());
        subtitles[i].end = timeToSec(pts[1].trim());
    }
    localStorage.setItem('web_sub_draft_v2', JSON.stringify(subtitles));
}

function addNewCue(index) {
    saveHistory();
    let startTime = "00:00:00.000", endTime = "00:00:03.000";
    if (index > 0 && subtitles[index-1]) {
        const prevEnd = subtitles[index-1].end + 0.1;
        startTime = formatTime(prevEnd).replace('.', ',');
        endTime = formatTime(prevEnd + 3).replace('.', ',');
    }
    const newSub = { start: timeToSec(startTime), end: timeToSec(endTime), timeLine: `${startTime} --> ${endTime}`, rawText: "" };
    subtitles.splice(index, 0, newSub);
    localStorage.setItem('web_sub_draft_v2', JSON.stringify(subtitles));

    // Sisipin cuma 1 elemen DOM baru di posisi yang bener, sisanya nggak disentuh
    const container = document.getElementById('cue-container');
    const newEl = createCueElement(newSub, index);
    container.insertBefore(newEl, container.children[index] || null);
    reindexRowsFrom(container, index + 1);
    updateUndoButtons();
}

function deleteCue(i) {
    niceConfirm("Hapus baris ini?", (ok) => { 
        if (!ok) return;
        saveHistory();
        subtitles.splice(i, 1);
        localStorage.setItem('web_sub_draft_v2', JSON.stringify(subtitles));

        // Hapus cuma 1 elemen DOM yang bersangkutan, sisanya nggak disentuh -
        // ini fix utama buat lag yang kerasa pas hapus baris di file panjang
        const container = document.getElementById('cue-container');
        const rowEl = container.children[i];
        if (rowEl) rowEl.remove();
        reindexRowsFrom(container, i);
        updateUndoButtons();
    });
}

function parseSRT(data) {
    const subs = [];
    const blocks = data.trim().split(/\r?\n\s*\r?\n/);
    blocks.forEach(block => {
        const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
        const timeLine = lines.find(l => l.includes('-->'));
        if (timeLine) {
            const [startStr, endStr] = timeLine.split('-->').map(t => t.trim());
            const text = lines.slice(lines.indexOf(timeLine) + 1).join('\n');
            subs.push({ start: timeToSec(startStr), end: timeToSec(endStr), timeLine, rawText: text });
        }
    });
    return subs;
}

function saveSubtitle() {
    if(subtitles.length === 0) return;
    let output = "";
    subtitles.forEach((s, i) => { 
        output += `${i + 1}\n${s.timeLine.replace('.', ',')}\n${s.rawText}\n\n`; 
    });
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = "subtitle_edited.srt"; a.click();
}

function getCurrentTime() { return video.currentTime; }
function seekTo(t) { video.currentTime = t; }
let subtitleScaleFactor = 1;

function updateScaleFactor() {
    const viewport = document.getElementById('video-viewport');
    if (!viewport) return;
    const containerW = viewport.clientWidth;
    const containerH = viewport.clientHeight;
    if (!containerW || !containerH) return;

    let videoW = video.videoWidth, videoH = video.videoHeight;
    if (!videoW || !videoH) { videoW = 1920; videoH = 1080; }

    const videoAspect = videoW / videoH;
    const containerAspect = containerW / containerH;
    let renderedH;
    if (videoAspect > containerAspect) {
        renderedH = containerW / videoAspect;
    } else {
        renderedH = containerH;
    }
    subtitleScaleFactor = renderedH / videoH;
}

window.addEventListener('resize', updateScaleFactor);
window.addEventListener('orientationchange', () => setTimeout(updateScaleFactor, 300));
video.addEventListener('loadedmetadata', updateScaleFactor);

function applyStyles(el) {
    const fs = document.getElementById('font-size').value;
    const sw = document.getElementById('stroke-width').value;
    const globalColor = document.getElementById('text-color').value;
    const scaledFs = fs * subtitleScaleFactor;
    const scaledSw = sw * subtitleScaleFactor;
    const padV = Math.max(2, 6 * subtitleScaleFactor);
    const padH = Math.max(4, 12 * subtitleScaleFactor);
    el.style.fontSize = scaledFs + 'px';
    el.style.padding = `${padV}px ${padH}px`;
    if (!el.innerHTML.includes('color=')) el.style.color = globalColor;
    el.style.textShadow = scaledSw > 0 ? `-${scaledSw}px -${scaledSw}px 0 #000, ${scaledSw}px -${scaledSw}px 0 #000, -${scaledSw}px ${scaledSw}px 0 #000, ${scaledSw}px ${scaledSw}px 0 #000` : "none";
}

function updateLoop() {
    const now = getCurrentTime();
    const timeDisplay = document.getElementById('current-time-display');
    if(timeDisplay) timeDisplay.textContent = formatTime(now);
    
    const topOverlay = document.getElementById('overlay-top');
    const middleOverlay = document.getElementById('overlay-middle');
    const bottomOverlay = document.getElementById('overlay-bottom');
    
    if (topOverlay && middleOverlay && bottomOverlay) {
        topOverlay.innerHTML = '';
        middleOverlay.innerHTML = '';
        bottomOverlay.innerHTML = '';
        bottomOverlay.style.bottom = document.getElementById('y-pos').value + '%';

        const activeSubs = subtitles.filter(sub => now >= sub.start && now < sub.end);
        activeSubs.forEach(sub => {
            const span = document.createElement('span'); 
            span.className = 'subtitle-text';
            let displayText = sub.rawText;
            const tagMatch = displayText.match(/\{\\an([1-9])\}/);
            const pos = tagMatch ? parseInt(tagMatch[1]) : 2;
            displayText = displayText.replace(/\{\\an[1-9]\}/g, '').trim();
            
            span.innerHTML = displayText.replace(/\n/g, '<br>'); 
            applyStyles(span);

            // PENTING: tiap span nentuin posisinya SENDIRI-SENDIRI lewat
            // align-self (properti per-elemen), BUKAN lewat alignItems di
            // level container (yang cuma bisa 1 nilai buat SEMUA anak,
            // gampang saling timpa kalau ada beberapa subtitle beda posisi
            // aktif bersamaan). Ini fix utama bug tampilan berantakan.
            let targetOverlay;
            if (pos >= 7) {
                targetOverlay = topOverlay;
            } else if (pos >= 4) {
                targetOverlay = middleOverlay;
            } else {
                targetOverlay = bottomOverlay;
            }

            if ([1, 4, 7].includes(pos)) {
                span.style.alignSelf = 'flex-start';
                span.style.textAlign = 'left';
            } else if ([3, 6, 9].includes(pos)) {
                span.style.alignSelf = 'flex-end';
                span.style.textAlign = 'right';
            } else {
                span.style.alignSelf = 'center';
                span.style.textAlign = 'center';
            }
            targetOverlay.appendChild(span);
        });
    }

    const currentActive = new Set(subtitles.map((s, i) => (now >= s.start && now < s.end ? i : -1)).filter(i => i !== -1));
    if (JSON.stringify([...currentActive]) !== JSON.stringify([...activeIndices])) {
        activeIndices = currentActive;
        const cueEls = document.querySelectorAll('.subtitle-cue');
        cueEls.forEach((el, idx) => {
            if (activeIndices.has(idx)) el.classList.add('highlight');
            else el.classList.remove('highlight');
        });

        if (autoScrollEnabled && activeIndices.size > 0) {
            const firstActiveIdx = Math.min(...activeIndices);
            const targetEl = cueEls[firstActiveIdx];
            if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    requestAnimationFrame(updateLoop);
}

function toggleAutoScroll() {
    autoScrollEnabled = !autoScrollEnabled;
    const btn = document.getElementById('autoscroll-btn');
    if (btn) btn.classList.toggle('active', autoScrollEnabled);
}

function toggleFullscreen() {
    const btn = document.getElementById('fullscreen-btn');
    const el = document.documentElement;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;

    const enter = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;

    if (!isFs) {
        if (enter) {
            enter.call(el).then(() => {
                if (btn) { btn.innerHTML = '<i class="fas fa-compress"></i>'; btn.classList.add('active'); }
            }).catch(() => {
            });
        }
    } else if (exit) {
        exit.call(document);
        if (btn) { btn.innerHTML = '<i class="fas fa-expand"></i>'; btn.classList.remove('active'); }
    }
}
['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
    document.addEventListener(evt, () => {
        const btn = document.getElementById('fullscreen-btn');
        const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (btn) {
            btn.innerHTML = isFs ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
            btn.classList.toggle('active', !!isFs);
        }
    });
});

function togglePlay() { video.paused ? video.play() : video.pause(); updatePlayIcon(); }
function updatePlayIcon() {
    const btn = document.getElementById('play-pause-btn');
    if(btn) btn.innerHTML = video.paused ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>';
}
video.addEventListener('play', updatePlayIcon);
video.addEventListener('pause', updatePlayIcon);

function seekBy(delta) {
    if (!video.src) return;
    const dur = isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(dur, video.currentTime + delta));
}

const speedSteps = [0.5, 0.75, 1, 1.25, 1.5, 2];
let speedIndex = 2; 
function cycleSpeed() {
    speedIndex = (speedIndex + 1) % speedSteps.length;
    const rate = speedSteps[speedIndex];
    video.playbackRate = rate;
    const btn = document.getElementById('speed-btn');
    if (btn) btn.textContent = rate + 'x';
}

function adjustFontSize(delta) {
    const input = document.getElementById('font-size');
    let val = parseInt(input.value, 10) + delta;
    val = Math.max(1, Math.min(200, val));
    input.value = val;
    const display = document.getElementById('font-size-display');
    if (display) display.textContent = val;
}

function toggleSettings() { document.getElementById('settings-bar').classList.toggle('active'); }
function toggleRatio() { 
    const vp = document.getElementById('video-viewport'), btn = document.getElementById('ratio-btn');
    vp.classList.toggle('portrait'); 
    btn.innerHTML = vp.classList.contains('portrait') ? '<i class="fas fa-display"></i>' : '<i class="fas fa-mobile-screen"></i>';
    setTimeout(updateScaleFactor, 350); 
}

subInput.onchange = e => {
    const reader = new FileReader();
    reader.onload = (ev) => renderEditor(parseSRT(ev.target.result));
    reader.readAsText(e.target.files[0]);
};

document.getElementById('video-input').onchange = e => {
    if(!e.target.files[0]) return;
    video.style.display = 'block'; 
    video.src = URL.createObjectURL(e.target.files[0]); 
    video.pause();
    updatePlayIcon();
    requestAnimationFrame(updateLoop);
};

window.onload = () => {
    setupCueContainerEvents();
    const saved = localStorage.getItem('web_sub_draft_v2');
    if (saved) { 
        subtitles = JSON.parse(saved);
        renderEditor(subtitles, false);
        saveHistory();
    }
    updatePlayIcon();
    updateScaleFactor();
}