// ═══════════════════════════════════════
//  CutShon — app.js
//  Server-side peaks waveform + real-time silence highlight
// ═══════════════════════════════════════

// ── State ──────────────────────────────
let wavesurfer;
let wsRegions;
let currentSessionId = null;
let silenceSegments = [];
let keepSegments    = [];
let totalDuration   = 0;
let isAnalyzing     = false;
let currentSse      = null;
let plyrPlayer      = null;

// Multi-video queue state
let videoQueue  = [];   // ordered list of QueueItem objects (see makeQueueItem)
let activeIndex = -1;   // which queue item is currently loaded into the editor
const MAX_PARALLEL_UPLOADS = 3;
let activeUploads = 0;
let processingState = 'idle'; // 'idle' | 'running' | 'paused'

// ── Zoom state (module-scope so slider + wheel share it) ──
// ── Zoom state (Relative Multiplier) ──
let zoomMultiplier = 1;   // 1 = Fit
let renderedPxPerSec = 0;
let zoomRAF      = null;

function cancelAutoZoom() {}

function tickZoom() {
    const inner = document.getElementById('waveform-inner');
    if (!inner || !totalDuration) return;
    
    const fitPx = inner.offsetWidth / totalDuration;
    const targetPxPerSec = zoomMultiplier * fitPx;
    
    const diff = targetPxPerSec - renderedPxPerSec;
    if (Math.abs(diff) < 0.1) {
        renderedPxPerSec = targetPxPerSec;
        try { wavesurfer.zoom(renderedPxPerSec); } catch (_) {}
        zoomRAF = null;
        updateZoomUI();
        return;
    }
    renderedPxPerSec += diff * 0.15;
    try { wavesurfer.zoom(renderedPxPerSec); } catch (_) {}
    zoomRAF = requestAnimationFrame(tickZoom);
}

function applyZoom(multiplier) {
    zoomMultiplier = Math.max(1, Math.min(multiplier, 50)); // Allow up to 50x for power users
    if (!zoomRAF) zoomRAF = requestAnimationFrame(tickZoom);
    updateZoomUI();
}

function updateZoomUI() {
    const slider = document.getElementById('zoom-slider');
    const label  = document.getElementById('zoom-level');
    if (slider) slider.value = zoomMultiplier;
    if (label)  label.textContent = zoomMultiplier <= 1.05 ? 'Fit' : zoomMultiplier.toFixed(1) + '×';
}

function zoomLabel(px) {
    if (px < 1) return 'Fit';
    const inner = document.getElementById('waveform-inner');
    if (!inner || !totalDuration) return Math.round(px) + ' px/s';
    const fitPx = inner.offsetWidth / totalDuration;
    const mult  = px / fitPx;
    if (mult < 10)  return mult.toFixed(1) + '×';
    return Math.round(mult) + '×';
}

// ── DOM refs ───────────────────────────
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const browseBtn      = document.getElementById('browse-btn');
const editorView     = document.getElementById('editor-view');
const previewVideo   = document.getElementById('preview-video');
const videoWrapper   = document.getElementById('video-wrapper');
const skipBadge      = document.getElementById('skip-badge');
const playBtn        = document.getElementById('play-pause');
const autoSkipToggle = document.getElementById('auto-skip-toggle');
const analyzeBtn     = document.getElementById('analyze-btn');
const exportBtn      = document.getElementById('export-btn');
const exportFormat   = document.getElementById('export-format');
const exportProgressContainer = document.getElementById('export-progress-container');
const exportProgressBar       = document.getElementById('export-progress-bar');
const exportProgressPercent   = document.getElementById('export-progress-percent');
const loader         = document.getElementById('loader');
const loaderText     = document.getElementById('loader-text');
const fileInfo       = document.getElementById('file-info');
const fileNameDisplay= document.getElementById('file-name-display');
const statusPill     = document.getElementById('status-pill');
const currentTimeEl  = document.getElementById('current-time');
const totalTimeEl    = document.getElementById('total-time');
const analysisBar    = document.getElementById('analysis-bar');
const analysisFill   = document.getElementById('analysis-fill');
const analysisText   = document.getElementById('analysis-text');
const statOriginal   = document.getElementById('stat-original');
const statAfter      = document.getElementById('stat-after');
const statReduced    = document.getElementById('stat-reduced');
const statSegs       = document.getElementById('stat-segs');

// Param map
const paramMap = {
    thresholdDb:   { el: document.getElementById('threshold-range'),      val: document.getElementById('threshold-val'),      unit: ' dB' },
    minSilence:    { el: document.getElementById('min-silence-range'),    val: document.getElementById('min-silence-val'),    unit: ' s' },
    paddingBefore: { el: document.getElementById('padding-before-range'), val: document.getElementById('padding-before-val'), unit: ' s' },
    paddingAfter:  { el: document.getElementById('padding-after-range'),  val: document.getElementById('padding-after-val'),  unit: ' s' },
    mergeGap:      { el: document.getElementById('merge-gap-range'),      val: document.getElementById('merge-gap-val'),      unit: ' s' },
    minClipLength: { el: document.getElementById('min-clip-range'),       val: document.getElementById('min-clip-val'),       unit: ' s' },
    transition:    { el: document.getElementById('transition-range'),     val: document.getElementById('transition-val'),     unit: ' s' }
};

const PRESETS = {
    natural:      { thresholdDb: -35, minSilence: 0.7, paddingBefore: 0.15, paddingAfter: 0.15, mergeGap: 0.3, minClipLength: 0.8 },
    aggressive:   { thresholdDb: -30, minSilence: 0.4, paddingBefore: 0.1,  paddingAfter: 0.1,  mergeGap: 0.2, minClipLength: 0.5 },
    conservative: { thresholdDb: -38, minSilence: 1.0, paddingBefore: 0.2,  paddingAfter: 0.2,  mergeGap: 0.5, minClipLength: 1.2 },
    live:         { thresholdDb: -28, minSilence: 0.6, paddingBefore: 0.2,  paddingAfter: 0.2,  mergeGap: 0.4, minClipLength: 0.8 },
    quiet:        { thresholdDb: -42, minSilence: 0.8, paddingBefore: 0.1,  paddingAfter: 0.15, mergeGap: 0.3, minClipLength: 0.6 }
};

let vZoom = 1.0;
const MAX_VZOOM = 50.0;
const MIN_VZOOM = 0.5;

let exportPollInterval = null;

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
function init() {
    initPlyr();
    bindEvents();
    initResizer();
    setupAutoAdvance();
    initMobileNav();
    initVerticalZoom();
    renderDbRuler();
}

function initMobileNav() {
    const tabs = document.querySelectorAll('.nav-tab');
    const queueRail = document.getElementById('queue-rail');
    const sidebar = document.querySelector('.sidebar');
    const viewport = document.querySelector('.viewport');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            
            // Update active tab button
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Toggle visibility
            if (target === 'queue') {
                queueRail.classList.add('active');
                sidebar.classList.remove('active');
            } else if (target === 'params') {
                sidebar.classList.add('active');
                queueRail.classList.remove('active');
            } else {
                queueRail.classList.remove('active');
                sidebar.classList.remove('active');
            }

            // Close sidebars when editor is clicked (on mobile)
            if (target === 'editor') {
                queueRail.classList.remove('active');
                sidebar.classList.remove('active');
            }
        });
    });
}

function initPlyr() {
    plyrPlayer = new Plyr('#preview-video', {
        controls: [
            'play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 
            'settings', 'pip', 'airplay', 'fullscreen'
        ],
        settings: ['speed', 'quality'],
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2, 4] },
        keyboard: { focused: true, global: false },
        tooltips: { controls: true, seek: true }
    });

    // Sync Plyr -> WaveSurfer
    plyrPlayer.on('seeking', () => {
        // WaveSurfer native media sync might need a nudge if paused
        if (wavesurfer && !plyrPlayer.playing) {
            wavesurfer.setTime(plyrPlayer.currentTime);
        }
    });
    plyrPlayer.on('ratechange', () => {
        // Optional: Sync playback rate to wavesurfer if we want audio to match
        if (wavesurfer) wavesurfer.setPlaybackRate(plyrPlayer.speed);
    });
}

function initResizer() {
    const resizer = document.getElementById('resizer');
    const videoWrapper = document.getElementById('video-wrapper');
    const editorView = document.getElementById('editor-view');
    let isDragging = false;

    if (!resizer) return;
    
    // Remove hidden if it was there
    resizer.classList.remove('hidden');

    resizer.addEventListener('mousedown', () => {
        isDragging = true;
        document.body.style.cursor = 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const containerRect = editorView.getBoundingClientRect();
        let newHeightPct = ((e.clientY - containerRect.top) / containerRect.height) * 100;
        newHeightPct = Math.max(15, Math.min(newHeightPct, 75));
        videoWrapper.style.flexBasis = `${newHeightPct}%`;
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = '';
            // WaveSurfer needs a tick to reflow its canvas before we measure it
            setTimeout(drawThresholdLine, 80);
        }
    });
}

/**
 * Create WaveSurfer using server-side peaks (no browser decoding needed).
 * The peaks array from server gives a sharp, clear waveform even for 2hr+ files.
 */
function initWaveSurfer(peaks) {
    if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; }

    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#1db954',
        progressColor: '#00b89c',
        cursorColor: '#00d9ff',
        cursorWidth: 3,
        barWidth: 1,
        barGap: 0,
        barRadius: 0,
        height: 'auto',
        normalize: false,
        interact: true,
        dragToSeek: { debounceTime: 20 },   // smooth drag scrubbing
        peaks: [peaks],
        duration: totalDuration,
        minPxPerSec: 0,
        url: plyrPlayer ? plyrPlayer.media.src : document.getElementById('preview-video').src,
        media: plyrPlayer ? plyrPlayer.media : document.getElementById('preview-video')
    });

    // Register Timeline plugin (timecode strip)
    try {
        if (WaveSurfer.Timeline) {
            wavesurfer.registerPlugin(WaveSurfer.Timeline.create({
                container: '#waveform-timeline-bar',
                height: 20,
                timeInterval: 5,
                primaryLabelInterval: 30,
                style: {
                    fontSize: '10px',
                    color: '#8b9bb4',
                }
            }));
        }
    } catch (_) {}

    // Register Hover plugin (playhead tooltip)
    try {
        if (WaveSurfer.Hover) {
            wavesurfer.registerPlugin(WaveSurfer.Hover.create({
                lineColor: '#00d9ff',
                lineWidth: 2,
                labelBackground: '#1a1a1a',
                labelColor: '#00d9ff',
                labelSize: '11px',
            }));
        }
    } catch (_) {}

    // ── Alt + Scroll → smooth zoom (uses module-scope applyZoom) ──
    const wfEl = document.getElementById('waveform');
    wfEl.addEventListener('wheel', (e) => {
        if (e.altKey) {
            e.preventDefault();
            
            // Zoom in/out by 20%
            const factor = e.deltaY > 0 ? 0.8 : 1.2;
            applyZoom(zoomMultiplier * factor);
        }
    }, { passive: false });

    // Register Minimap overview strip
    try {
        if (WaveSurfer.Minimap) {
            wavesurfer.registerPlugin(WaveSurfer.Minimap.create({
                height: 36,
                waveColor: '#1db954',
                progressColor: '#1db954',
                overlayColor: 'rgba(0, 229, 255, 0.22)',
                container: '#waveform-overview',
                insertPosition: 'afterbegin',
            }));
        }
    } catch (_) {}

    wsRegions = wavesurfer.registerPlugin(WaveSurfer.Regions.create());

    // Remove manual sync listeners as 'media: previewVideo' handles interaction, seeking, and playback sync natively!
    
    // Sync play/pause button text
    wavesurfer.on('play',  () => { playBtn.textContent = '⏸'; });
    wavesurfer.on('pause', () => { playBtn.textContent = '▶'; });

    // Keep time display updated from video
    const mediaEl = plyrPlayer ? plyrPlayer.media : document.getElementById('preview-video');
    mediaEl.addEventListener('timeupdate', () => {
        currentTimeEl.textContent = fmtTime(mediaEl.currentTime);
    });

    // Draw threshold line after waveform renders
    setTimeout(drawThresholdLine, 100);
}

// ═══════════════════════════════════════
//  THRESHOLD LINE — canvas overlay
// ═══════════════════════════════════════
function getWaveformMetrics() {
    const inner = document.getElementById('waveform-inner');
    const canvas = document.getElementById('threshold-overlay');
    if (!inner || !canvas) return null;

    const W = inner.offsetWidth;
    const containerH = inner.offsetHeight;
    if (W === 0 || containerH === 0) return null;

    canvas.width = W;
    canvas.height = containerH;

    const wsCanvas = inner.querySelector('#waveform canvas');
    let centerY, waveHalf;
    if (wsCanvas) {
        const innerRect = inner.getBoundingClientRect();
        const wsRect = wsCanvas.getBoundingClientRect();
        const offsetTop = wsRect.top - innerRect.top;
        waveHalf = wsRect.height / 2;
        centerY = offsetTop + waveHalf;
    } else {
        waveHalf = containerH / 2;
        centerY = containerH / 2;
    }

    return { W, containerH, centerY, waveHalf };
}

function drawThresholdLine() {
    const metrics = getWaveformMetrics();
    if (!metrics) return;
    const { W, containerH, centerY, waveHalf } = metrics;

    const canvas = document.getElementById('threshold-overlay');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, containerH);

    const db  = parseFloat(paramMap.thresholdDb.el.value);
    const amp = Math.pow(10, db / 20);

    // Account for vertical zoom
    const topY    = centerY - (amp * waveHalf * vZoom);
    const bottomY = centerY + (amp * waveHalf * vZoom);
    const bandH   = bottomY - topY;

    ctx.save();
    // Gradient fill — stronger at center, fades at edges of band
    const grad = ctx.createLinearGradient(0, topY, 0, bottomY);
    grad.addColorStop(0,   'rgba(255, 210, 40, 0.30)');
    grad.addColorStop(0.5, 'rgba(255, 210, 40, 0.10)');
    grad.addColorStop(1,   'rgba(255, 210, 40, 0.30)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, topY, W, bandH);

    // Dashed threshold lines
    ctx.strokeStyle = 'rgba(255, 210, 40, 0.85)';
    ctx.setLineDash([5, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, topY); ctx.lineTo(W, topY);
    ctx.moveTo(0, bottomY); ctx.lineTo(W, bottomY);
    ctx.stroke();

    // dB label
    ctx.setLineDash([]);
    ctx.font      = 'bold 11px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255, 210, 40, 0.95)';
    const labelY = topY < 16 ? topY + 16 : topY - 5;
    ctx.fillText(`${db} dB`, 8, labelY);

    ctx.restore();
}

// ═══════════════════════════════════════
//  VERTICAL ZOOM & dB RULER
// ═══════════════════════════════════════
function initVerticalZoom() {
    const ruler = document.getElementById('db-ruler');
    const waveformWrapper = document.getElementById('waveform-v-wrapper');
    
    // RULER HOVER: Vertical Zoom (Amplitude)
    ruler?.addEventListener('wheel', (e) => {
        if (e.shiftKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            vZoom = Math.min(MAX_VZOOM, Math.max(MIN_VZOOM, vZoom * delta));
            updateVerticalZoom();
        }
    }, { passive: false });

    // WAVEFORM HOVER: Horizontal Panning (Scroll)
    waveformWrapper?.addEventListener('wheel', (e) => {
        if (e.shiftKey) {
            e.preventDefault();
            // Scroll the internal WaveSurfer container horizontally
            const scrollable = document.querySelector('#waveform shadow-root div') || document.querySelector('#waveform > div');
            if (scrollable) {
                // deltaY is used for horizontal scroll to match standard editor behavior
                scrollable.scrollLeft += e.deltaY;
            } else if (wavesurfer && typeof wavesurfer.getScroll === 'function') {
                // Fallback for newer WaveSurfer versions if direct DOM access is tricky
                const current = wavesurfer.getScroll();
                wavesurfer.setScroll(current + e.deltaY);
            }
        }
    }, { passive: false });
}

function updateVerticalZoom() {
    const waveform = document.getElementById('waveform');
    if (waveform) {
        // We scale the waveform container
        waveform.style.transform = `scaleY(${vZoom})`;
        waveform.style.transformOrigin = 'center';
    }
    drawThresholdLine();
    renderDbRuler();
}

function renderDbRuler() {
    const metrics = getWaveformMetrics();
    if (!metrics) return;
    const { containerH, centerY, waveHalf } = metrics;

    const ruler = document.getElementById('db-ruler');
    if (!ruler) return;
    
    ruler.innerHTML = '';
    
    // Labels to show
    const dbSteps = [0, -3, -6, -9, -12, -18, -24, -36, -48, -60];
    const drawnPositions = new Set();
    
    dbSteps.forEach(db => {
        const amp = Math.pow(10, db / 20);
        // Bipolar: positive and negative peaks
        const offsets = db === 0 ? [amp, -amp] : [amp, -amp];
        
        offsets.forEach(offsetAmp => {
            const y = centerY - (offsetAmp * waveHalf * vZoom);
            
            // Check bounds and prevent overlapping labels (min 12px apart)
            if (y < 0 || y > containerH) return;
            const posKey = Math.round(y / 12);
            if (drawnPositions.has(posKey)) return;
            drawnPositions.add(posKey);
            
            const tick = document.createElement('div');
            tick.className = 'db-tick' + (db % 6 === 0 ? ' major' : '');
            tick.style.top = `${y}px`;
            tick.innerHTML = `<span>${db === 0 ? '0' : db}</span>`;
            ruler.appendChild(tick);
        });
    });

    // Add center -inf tick if it's visible and not crowded
    const infKey = Math.round(centerY / 12);
    if (!drawnPositions.has(infKey)) {
        const infTick = document.createElement('div');
        infTick.className = 'db-tick major';
        infTick.style.top = `${centerY}px`;
        infTick.innerHTML = '<span>-∞</span>';
        ruler.appendChild(infTick);
    }
}

// ═══════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════
function bindEvents() {
    browseBtn.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => { if (e.target.files.length) addFiles(e.target.files); });

    // Whole-window drop target once editor is open (drop more files into queue)
    window.addEventListener('dragover', (e) => {
        if (editorView.classList.contains('hidden')) return;
        if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        document.getElementById('queue-rail').classList.add('drop-target');
    });
    window.addEventListener('dragleave', (e) => {
        if (e.target === document || e.relatedTarget === null) {
            document.getElementById('queue-rail')?.classList.remove('drop-target');
        }
    });
    window.addEventListener('drop', (e) => {
        if (editorView.classList.contains('hidden')) return;
        if (!e.dataTransfer || !e.dataTransfer.files.length) return;
        e.preventDefault();
        document.getElementById('queue-rail').classList.remove('drop-target');
        addFiles(e.dataTransfer.files);
    });

    // Queue rail
    document.getElementById('queue-add-btn').addEventListener('click', () => fileInput.click());
    document.getElementById('queue-list').addEventListener('click', (e) => {
        const removeBtn = e.target.closest('[data-action="remove"]');
        if (removeBtn) {
            e.stopPropagation();
            removeItem(parseInt(removeBtn.dataset.idx, 10));
            return;
        }
        const item = e.target.closest('.queue-item');
        if (item) {
            const idx = parseInt(item.dataset.idx, 10);
            if (idx !== activeIndex) setActiveIndex(idx).catch(() => {});
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
            
            e.preventDefault();
            e.stopImmediatePropagation();

            if (plyrPlayer) {
                plyrPlayer.togglePlay();
            } else {
                const mediaEl = document.getElementById('preview-video');
                if (mediaEl.paused) mediaEl.play();
                else mediaEl.pause();
            }
        }
    }, true);

    playBtn.addEventListener('click', () => {
        if (plyrPlayer) {
            plyrPlayer.togglePlay();
        } else {
            if (previewVideo.paused) previewVideo.play();
            else previewVideo.pause();
        }
    });

    const onPlay = () => {
        playBtn.textContent = '⏸';
        ensureWebAudio();
        scheduleNextJcTick();
    };
    const onPause = () => {
        playBtn.textContent = '▶';
        if (jumpRAF) { cancelAnimationFrame(jumpRAF); jumpRAF = null; }
        jcResetFade();
    };
    const onSeeking = () => { jcResetFade(); };

    if (plyrPlayer) {
        plyrPlayer.on('play', onPlay);
        plyrPlayer.on('pause', onPause);
        plyrPlayer.on('seeking', onSeeking);
    } else {
        previewVideo.addEventListener('play', onPlay);
        previewVideo.addEventListener('pause', onPause);
        previewVideo.addEventListener('seeking', onSeeking);
    }
    autoSkipToggle.addEventListener('change', () => { jcResetFade(); scheduleNextJcTick(); });

    analyzeBtn.addEventListener('click', () => {
        if (processingState !== 'running') setProcessingState('running');
        runAnalysis();
    });

    document.getElementById('processing-toggle-btn').addEventListener('click', () => {
        if (processingState === 'running') return pauseProcessing();
        return startOrResumeProcessing();
    });

    // New single export button
    exportBtn.addEventListener('click', handleExport);

    document.getElementById('preset-select').addEventListener('change', (e) => {
        const p = PRESETS[e.target.value];
        if (p) {
            applyPreset(p);
            const item = activeItem();
            if (item) item.settings = getSettings();
        }
    });

    Object.keys(paramMap).forEach(key => {
        const { el, val, unit } = paramMap[key];
        el.addEventListener('input', () => {
            val.textContent = el.value + unit;
            
            const item = activeItem();
            if (item) item.settings[key] = parseFloat(el.value);

            // Real-time visual feedback
            if (key === 'thresholdDb') drawThresholdLine();
            
            // Debounced preview of silence regions
            debounce(updateSilencePreview, 50)();
        });
    });

    // Zoom slider
    document.getElementById('zoom-slider').addEventListener('input', (e) => {
        applyZoom(parseFloat(e.target.value));
    });

    // Redraw on resize
    window.addEventListener('resize', () => { 
        requestAnimationFrame(() => {
            drawThresholdLine();
            renderDbRuler();
        });
    });
}

// ═══════════════════════════════════════
//  ERROR MODAL
// ═══════════════════════════════════════
const errorModal = {
    el:        document.getElementById('error-modal'),
    title:     document.getElementById('error-title'),
    subtitle:  document.getElementById('error-subtitle'),
    message:   document.getElementById('error-message'),
    stack:     document.getElementById('error-stack'),
    details:   document.getElementById('error-details'),
    closeBtn:  document.getElementById('error-close-btn'),
    copyBtn:   document.getElementById('error-copy-btn'),
    retryBtn:  document.getElementById('error-retry-btn'),
    _retry:    null,
};

function showError({ title, subtitle, message, details, retry }) {
    errorModal.title.textContent    = title    || t('error_title');
    errorModal.subtitle.textContent = subtitle || '';
    errorModal.message.textContent  = message  || t('error_unexpected'); // I should add this to i18n.js too, or just use a default
    if (details) {
        errorModal.stack.textContent = String(details);
        errorModal.details.style.display = '';
    } else {
        errorModal.details.style.display = 'none';
    }
    errorModal._retry = typeof retry === 'function' ? retry : null;
    errorModal.retryBtn.classList.toggle('hidden', !errorModal._retry);
    errorModal.el.classList.remove('hidden');
    setTimeout(() => errorModal.closeBtn?.focus(), 50);
    console.error('[ui error]', { title, subtitle, message, details });
}

function hideError() {
    errorModal.el.classList.add('hidden');
    errorModal._retry = null;
}

errorModal.closeBtn.addEventListener('click', hideError);
errorModal.el.addEventListener('click', (e) => { if (e.target === errorModal.el) hideError(); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !errorModal.el.classList.contains('hidden')) hideError();
});
errorModal.copyBtn.addEventListener('click', async () => {
    const txt = [
        errorModal.title.textContent,
        errorModal.subtitle.textContent,
        errorModal.message.textContent,
        '---',
        errorModal.stack.textContent,
    ].filter(Boolean).join('\n');
    try {
        await navigator.clipboard.writeText(txt);
        errorModal.copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { errorModal.copyBtn.textContent = 'Copy Details'; }, 1500);
    } catch (_) {}
});
errorModal.retryBtn.addEventListener('click', () => {
    const r = errorModal._retry;
    hideError();
    if (r) r();
});

function showToast(text) {
    let toast = document.getElementById('action-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'action-toast';
        toast.className = 'btn-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.remove('show'), 1800);
}

/**
 * Try to extract a useful error message from a fetch Response.
 */
async function readFetchError(res, fallback) {
    let body = '';
    try {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
            const j = await res.json();
            return { message: j.error || fallback, details: j.stack || JSON.stringify(j, null, 2) };
        }
        body = await res.text();
    } catch (_) {}
    return { message: fallback + ` (HTTP ${res.status})`, details: body.slice(0, 2000) };
}

// ═══════════════════════════════════════
//  QUEUE — multi-video state
// ═══════════════════════════════════════
function makeQueueItem(file) {
    return {
        id:               'q_' + Math.random().toString(36).slice(2, 9),
        file,
        fileName:         file.name,
        isAudio:          file.type.startsWith('audio/'),
        sessionId:        null,
        fileUrl:          null,
        peaks:            null,
        duration:         0,
        thumbDataUrl:     null,
        silenceSegments:  [],
        keepSegments:     [],
        analysisDone:     false,
        analysisStats:    null,
        status:           'queued',   // queued | uploading | waveform | ready | analyzing | done | error
        progress:         0,
        error:            null,
        settings:         getSettings(), // Initial settings from UI
    };
}

function activeItem() { return activeIndex >= 0 ? videoQueue[activeIndex] : null; }

async function addFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const newItems = Array.from(fileList).map(makeQueueItem);
    const startIdx = videoQueue.length;
    videoQueue.push(...newItems);
    renderQueue();
    showQueueRail();
    updateProcessingToggleUI();

    // Schedule processing — limited concurrency
    for (let i = 0; i < newItems.length; i++) {
        scheduleNext();
    }

    // If nothing is active, the first newly added item becomes active once it's ready
    if (activeIndex < 0 && newItems.length > 0) {
        // Mark the first as the next-to-activate target — actual switch happens after waveform loads
        videoQueue[startIdx]._autoActivate = true;
    }
}

function scheduleNext() {
    if (activeUploads >= MAX_PARALLEL_UPLOADS) return;
    const next = videoQueue.find(it => it.status === 'queued');
    if (!next) return;
    activeUploads++;
    processItem(next).finally(() => {
        activeUploads--;
        scheduleNext();
    });
}

let activeBackgroundAnalysis = 0;
function scheduleAnalysis() {
    if (processingState !== 'running') return;
    if (activeBackgroundAnalysis >= 2) return; // Max 2 parallel background analyses

    // Find next ready item that hasn't been analyzed and isn't currently analyzing
    const next = videoQueue.find(it => it.status === 'ready' && !it.analysisDone && !it._isAnalyzing);
    if (!next) {
        const anyAnalyzing = videoQueue.some(it => it._isAnalyzing) || isAnalyzing;
        if (!anyAnalyzing) setProcessingState('idle');
        return;
    }

    // Skip the active item because it is handled by the manual runAnalysis() which binds to UI
    if (next === activeItem()) return;

    activeBackgroundAnalysis++;
    next._isAnalyzing = true;
    next.status = 'analyzing';
    next.progress = 0;
    renderQueue();
    updateQueueProgressBadge();

    const qs = encodeURIComponent(JSON.stringify(next.settings));
    const sse = new EventSource(`/api/analyze-stream/${next.sessionId}?settings=${qs}`);
    next._bgSse = sse;
    
    sse.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        
        if (msg.type === 'segment') {
            if (msg.data.type === 'silence') {
                next.silenceSegments.push({ start: msg.data.start, end: msg.data.end });
            }
        }
        if (msg.type === 'progress') {
            const sec = parseHMS(msg.data.currentTime);
            const pct = next.duration > 0 ? Math.min(100, (sec / next.duration) * 100) : 0;
            next.progress = pct;
            renderQueue();
        }
        if (msg.type === 'complete') {
            next.keepSegments = msg.data.keeps.segments;
            next.analysisStats = msg.data.keeps;
            next.duration = msg.data.duration;
            next.analysisDone = true;
            next.status = 'done';
            
            sse.close();
            next._bgSse = null;
            next._isAnalyzing = false;
            activeBackgroundAnalysis--;
            renderQueue();
            scheduleAnalysis();
        }
        if (msg.type === 'error') {
            next.error = msg.data;
            next.status = 'error';
            sse.close();
            next._bgSse = null;
            next._isAnalyzing = false;
            activeBackgroundAnalysis--;
            renderQueue();
            scheduleAnalysis();
        }
    };
    sse.onerror = () => {
        sse.close();
        next._bgSse = null;
        if (next.status === 'analyzing') next.status = 'error';
        next._isAnalyzing = false;
        activeBackgroundAnalysis--;
        renderQueue();
        scheduleAnalysis();
    };
}


async function processItem(item) {
    try {
        // Upload
        item.status = 'uploading';
        item.progress = 5;
        renderQueue();

        const form = new FormData();
        form.append('file', item.file);

        const res = await fetch('/api/upload', { method: 'POST', body: form });
        if (!res.ok) {
            const { message, details } = await readFetchError(res, t('err_upload_failed'));
            throw Object.assign(new Error(message), { details });
        }
        const data = await res.json();
        item.sessionId = data.sessionId;
        item.fileUrl   = data.fileUrl;

        item.status = 'waveform';
        item.progress = 50;
        renderQueue();

        // Generate thumbnail (video only) in parallel with waveform fetch
        if (!item.isAudio) {
            extractThumbnail(item).catch(() => {});
        }

        // Waveform peaks
        const wvRes = await fetch(`/api/waveform/${item.sessionId}`);
        if (!wvRes.ok) {
            const { message, details } = await readFetchError(wvRes, t('err_waveform_failed'));
            throw Object.assign(new Error(message), { details });
        }
        const wvData = await wvRes.json();
        item.peaks = wvData.peaks;

        item.status = 'ready';
        item.progress = 100;
        renderQueue();

        // Auto-activate first ready item
        if (activeIndex < 0 || item._autoActivate) {
            item._autoActivate = false;
            const idx = videoQueue.indexOf(item);
            await setActiveIndex(idx);
        }

        // Trigger background analysis only if user has started processing
        if (processingState === 'running') scheduleAnalysis();
        updateProcessingToggleUI();
        updateQueueProgressBadge();
    } catch (err) {
        item.status = 'error';
        item.error  = err.message || String(err);
        renderQueue();
        showError({
            title:    t('err_process_title'),
            subtitle: item.fileName,
            message:  err.message || t('err_process_msg'),
            details:  err.details || err.stack || null,
            retry:    () => { item.status = 'queued'; item.error = null; renderQueue(); scheduleNext(); },
        });
    }
}

/** Capture a single video frame as a thumbnail data URL. */
function extractThumbnail(item) {
    return new Promise((resolve) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.preload = 'metadata';
        v.src = item.fileUrl;
        v.addEventListener('loadedmetadata', () => {
            v.currentTime = Math.min(1.5, (v.duration || 1) * 0.1);
        }, { once: true });
        v.addEventListener('seeked', () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width  = 80;
                canvas.height = 80;
                const ctx = canvas.getContext('2d');
                const aspect = v.videoWidth / v.videoHeight;
                let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
                if (aspect > 1) { sw = sh = v.videoHeight; sx = (v.videoWidth - sw) / 2; }
                else            { sh = sw = v.videoWidth;  sy = (v.videoHeight - sh) / 2; }
                ctx.drawImage(v, sx, sy, sw, sh, 0, 0, 80, 80);
                item.thumbDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                renderQueue();
                resolve();
            } catch (e) { resolve(); }
        }, { once: true });
        v.addEventListener('error', () => resolve(), { once: true });
    });
}

async function setActiveIndex(idx) {
    const item = videoQueue[idx];
    if (!item || item.status === 'error') return;
    if (item.status !== 'ready' && item.status !== 'analyzing' && item.status !== 'done') return;

    // Snapshot current state into the previous active item before switching away
    const prev = activeItem();
    if (prev && prev !== item) {
        prev.silenceSegments = silenceSegments.slice();
        prev.keepSegments    = keepSegments.slice();
    }

    // Reset UI state from previous item
    if (exportPollInterval) {
        clearInterval(exportPollInterval);
        exportPollInterval = null;
    }
    exportProgressContainer.classList.add('hidden');
    if (wsRegions) wsRegions.clearRegions();

    activeIndex = idx;
    currentSessionId = item.sessionId;

    // UI: editor view, file info, audio-only mode
    dropZone.classList.add('hidden');
    editorView.classList.remove('hidden');
    fileInfo.style.display = 'flex';
    fileNameDisplay.textContent = item.fileName;
    videoWrapper.classList.toggle('audio-only', item.isAudio);

    // Auto-switch to editor tab on mobile
    if (window.innerWidth <= 850) {
        const editorTab = document.querySelector('.nav-tab[data-tab="editor"]');
        if (editorTab) editorTab.click();
    }

    // Load video element
    if (previewVideo.src !== location.origin + item.fileUrl) {
        if (plyrPlayer) {
            plyrPlayer.source = {
                type: item.isAudio ? 'audio' : 'video',
                sources: [{ src: item.fileUrl }]
            };
        } else {
            previewVideo.src = item.fileUrl;
        }

        const mediaEl = plyrPlayer ? plyrPlayer.media : document.getElementById('preview-video');

        await new Promise((resolve, reject) => {
            const onMeta = () => { cleanup(); resolve(); };
            const onErr  = () => { cleanup(); reject(new Error('Failed to load media: ' + item.fileName)); };
            const cleanup = () => {
                mediaEl.removeEventListener('loadedmetadata', onMeta);
                mediaEl.removeEventListener('error', onErr);
            };
            
            // If already loaded
            if (mediaEl.readyState >= 1) {
                cleanup();
                resolve();
            } else {
                mediaEl.addEventListener('loadedmetadata', onMeta, { once: true });
                mediaEl.addEventListener('error', onErr, { once: true });
            }
        }).catch(err => {
            showError({
                title:    'Cannot load media',
                subtitle: item.fileName,
                message:  err.message,
            });
            throw err;
        });
    }

    const currentMedia = plyrPlayer ? plyrPlayer.media : document.getElementById('preview-video');
    totalDuration = currentMedia.duration || 0;
    totalTimeEl.textContent = fmtTime(totalDuration);
    item.duration = totalDuration;

    // Restore silence/keep state
    silenceSegments = item.silenceSegments.slice();
    keepSegments    = item.keepSegments.slice();

    // Init WaveSurfer with cached peaks
    initWaveSurfer(item.peaks);

    // Restore regions after a tick (regions plugin needs to be ready)
    setTimeout(() => {
        if (wsRegions) {
            wsRegions.clearRegions();
            silenceSegments.forEach(s => {
                wsRegions.addRegion({
                    start: s.start, end: s.end,
                    color: 'rgba(255, 50, 50, 0.45)',
                    drag: false, resize: false,
                });
            });
        }
    }, 100);

    // Restore UI settings from item
    if (item.settings) {
        Object.keys(item.settings).forEach(k => {
            if (paramMap[k]) {
                paramMap[k].el.value = item.settings[k];
                paramMap[k].val.textContent = item.settings[k] + paramMap[k].unit;
            }
        });
        drawThresholdLine();
    }

    renderQueue();

    // Always enable analyze button once a file is loaded
    analyzeBtn.disabled = false;

    // Loading an item no longer auto-starts analysis — user controls that via Start/Pause/Resume.
    if (!item.analysisDone && item.status === 'ready') {
        setStatus('Ready — press Start to analyze', 'ready');
        // Cancel any background analysis already running for this item so its UI binds to the editor on next Start/Resume.
        if (item._bgSse) {
            try { item._bgSse.close(); } catch (_) {}
            item._bgSse = null;
            item._isAnalyzing = false;
            activeBackgroundAnalysis = Math.max(0, activeBackgroundAnalysis - 1);
            if (item.status === 'analyzing') item.status = 'ready';
            if (processingState === 'running') scheduleAnalysis();
        }
    } else if (item.analysisDone) {
        setStatus('Ready ✓', 'done');
        exportBtn.disabled  = false;
        if (item.analysisStats) updateStats(item.duration, item.analysisStats);
    }
    updateQueueProgressBadge();
}

function removeItem(idx) {
    const item = videoQueue[idx];
    if (!item) return;
    videoQueue.splice(idx, 1);

    if (item._bgSse) {
        try { item._bgSse.close(); } catch (_) {}
        item._bgSse = null;
        if (item._isAnalyzing) activeBackgroundAnalysis = Math.max(0, activeBackgroundAnalysis - 1);
    }

    if (idx === activeIndex) {
        activeIndex = -1;
        // Pick another ready item
        const nextIdx = videoQueue.findIndex(it => it.status === 'ready' || it.status === 'done');
        if (nextIdx >= 0) {
            setActiveIndex(nextIdx);
        } else {
            // Queue empty: back to drop zone
            editorView.classList.add('hidden');
            dropZone.classList.remove('hidden');
            fileInfo.style.display = 'none';
            if (videoQueue.length === 0) hideQueueRail();
        }
    } else if (idx < activeIndex) {
        activeIndex--;
    }
    if (videoQueue.length === 0) setProcessingState('idle');
    else if (processingState === 'running') scheduleAnalysis();
    updateProcessingToggleUI();
    updateQueueProgressBadge();
    renderQueue();
}

function showQueueRail() {
    document.getElementById('queue-rail').classList.remove('hidden');
}
function hideQueueRail() {
    document.getElementById('queue-rail').classList.add('hidden');
}

// ── Manual processing control ─────────────────────────
function setProcessingState(next) {
    processingState = next;
    updateProcessingToggleUI();
    updateQueueProgressBadge();
}

function updateProcessingToggleUI() {
    const btn = document.getElementById('processing-toggle-btn');
    if (!btn) return;
    btn.disabled = videoQueue.length === 0;
    btn.textContent = processingState === 'running' ? 'Pause'
                    : processingState === 'paused'  ? 'Resume'
                    : 'Start';
}

function updateQueueProgressBadge() {
    const badge = document.getElementById('queue-progress-badge');
    if (!badge) return;
    const total = videoQueue.length;
    if (total === 0) { badge.style.display = 'none'; return; }
    let cur = videoQueue.findIndex(it => it._isAnalyzing) + 1;
    if (cur === 0) cur = activeIndex >= 0 ? activeIndex + 1 : 1;
    badge.style.display = '';
    badge.textContent = `Video ${cur} of ${total}`;
}

function startOrResumeProcessing() {
    if (videoQueue.length === 0) return;
    setProcessingState('running');
    const item = activeItem();
    if (item && item.status === 'ready' && !item.analysisDone) {
        runAnalysis();
    } else {
        scheduleAnalysis();
    }
}

function pauseProcessing() {
    setProcessingState('paused');

    // Active-item SSE: closing it triggers server detector.stop()
    if (currentSse) { try { currentSse.close(); } catch (_) {} currentSse = null; }
    if (isAnalyzing) {
        const a = activeItem();
        if (a) {
            a.silenceSegments = [];
            a.status = 'ready';
            a.analysisDone = false;
            a.progress = 100;
            a._isAnalyzing = false;
        }
        isAnalyzing = false;
        silenceSegments = [];
        if (wsRegions) wsRegions.clearRegions();
        analysisBar.classList.add('hidden');
        setStatus('Paused', 'ready');
    }

    // Background SSEs
    videoQueue.forEach(it => {
        if (it._bgSse) { try { it._bgSse.close(); } catch (_) {} it._bgSse = null; }
        if (it._isAnalyzing) {
            it._isAnalyzing = false;
            it.silenceSegments = [];
            if (it.status === 'analyzing') { it.status = 'ready'; it.progress = 100; }
        }
    });
    activeBackgroundAnalysis = 0;
    renderQueue();
}

function renderQueue() {
    const list = document.getElementById('queue-list');
    const count = document.getElementById('queue-count');
    if (!list) return;
    count.textContent = videoQueue.length;

    list.innerHTML = '';
    videoQueue.forEach((it, idx) => {
        const div = document.createElement('div');
        div.className = 'queue-item' + (idx === activeIndex ? ' active' : '') + (it.status === 'error' ? ' error' : '');
        div.dataset.idx = idx;

        const statusText = ({
            queued:    t('status_queued'),
            uploading: t('status_uploading'),
            waveform:  t('status_waveform'),
            ready:     it.analysisDone ? t('status_ready') : t('status_ready_analyze'),
            analyzing: t('status_analyzing'),
            done:      t('status_done') + ' ✓',
            error:     t('status_error'),
        })[it.status] || it.status;

        const statusCls =
            it.status === 'error'                          ? 'error' :
            (it.status === 'uploading' || it.status === 'waveform' || it.status === 'analyzing') ? 'processing' :
            (it.status === 'ready' || it.status === 'done')? 'ready' : '';

        const showProgress = it.status === 'uploading' || it.status === 'waveform' || it.status === 'analyzing';
        const dur = it.duration ? fmtTime(it.duration) : '';

        const thumb = it.thumbDataUrl
            ? `<img src="${it.thumbDataUrl}" alt="">`
            : (it.isAudio ? '🎵' : '🎬');

        div.innerHTML = `
            <button class="qi-remove" title="Remove" data-action="remove" data-idx="${idx}">×</button>
            <div class="qi-row">
                <div class="qi-thumb">${thumb}</div>
                <div class="qi-info">
                    <div class="qi-name" title="${escapeHtml(it.fileName)}"><span class="qi-index">${idx + 1}.</span>${escapeHtml(it.fileName)}</div>
                    <div class="qi-meta">
                        <span class="qi-status ${statusCls}">${statusText}</span>
                        ${dur ? `<span>·</span><span>${dur}</span>` : ''}
                    </div>
                </div>
            </div>
            ${showProgress ? `<div class="qi-progress"><div class="qi-progress-fill" style="width:${it.progress}%"></div></div>` : ''}
        `;
        list.appendChild(div);
    });
    updateQueueProgressBadge();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Auto-advance when current video ends
function setupAutoAdvance() {
    const handleEnded = () => {
        const advanceToggle = document.getElementById('auto-advance-toggle');
        if (!advanceToggle || !advanceToggle.checked) return;
        if (videoQueue.length < 2) return;
        // Find next playable item
        let nextIdx = -1;
        for (let i = activeIndex + 1; i < videoQueue.length; i++) {
            const it = videoQueue[i];
            if (it.status === 'ready' || it.status === 'done') { nextIdx = i; break; }
        }
        if (nextIdx >= 0) {
            setActiveIndex(nextIdx).then(() => {
                setTimeout(() => {
                    if (plyrPlayer) plyrPlayer.play();
                    else document.getElementById('preview-video').play().catch(() => {});
                }, 200);
            });
        }
    };

    if (plyrPlayer) {
        plyrPlayer.on('ended', handleEnded);
    } else {
        document.getElementById('preview-video').addEventListener('ended', handleEnded);
    }
}

// ═══════════════════════════════════════
//  FILE HANDLING (legacy single-file shim → queue)
// ═══════════════════════════════════════
async function handleFile(file) {
    return addFiles([file]);
}

// ═══════════════════════════════════════
//  ANALYSIS — SSE
// ═══════════════════════════════════════
async function runAnalysis() {
    if (!currentSessionId) return;
    
    // Allow immediate re-analysis by closing existing stream
    if (currentSse) {
        currentSse.close();
        currentSse = null;
    }

    isAnalyzing = true;
    // analyzeBtn.disabled = true; // Don't disable anymore
    silenceSegments = [];
    keepSegments    = [];
    if (wsRegions) wsRegions.clearRegions();

    const item = activeItem();
    if (item) {
        item.status = 'analyzing';
        item.progress = 0;
        item._isAnalyzing = true;
        renderQueue();
    }

    analysisBar.classList.remove('hidden');
    analysisFill.style.width = '0%';
    analysisText.textContent = t('analysis_starting');
    setStatus(t('status_analyzing') + ' 0%', 'analyzing');

    const settings = getSettings();
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSessionId, settings })
        });
    } catch (_) { /* non-fatal: settings are also passed via query string */ }

    const qs = encodeURIComponent(JSON.stringify(settings));
    currentSse = new EventSource(`/api/analyze-stream/${currentSessionId}?settings=${qs}`);
    const sse = currentSse;
    let analysisError = null;

    sse.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }

        if (msg.type === 'segment') {
            const s = msg.data;
            if (s.type === 'silence' && s.start != null && s.end != null) {
                silenceSegments.push({ start: s.start, end: s.end });
                if (wsRegions) {
                    wsRegions.addRegion({
                        start: s.start,
                        end:   s.end,
                        color: 'rgba(255, 50, 50, 0.45)',
                        drag:   false,
                        resize: false
                    });
                }
            }
        }

        if (msg.type === 'progress') {
            const sec = parseHMS(msg.data.currentTime);
            const pct = totalDuration > 0
                ? Math.min(100, (sec / totalDuration) * 100)
                : 0;
            const pctStr = pct.toFixed(0) + '%';
            analysisFill.style.width = pct.toFixed(1) + '%';
            analysisText.textContent = `${t('status_analyzing').replace('...', '')}: ${fmtTime(sec)} / ${fmtTime(totalDuration)} (${pctStr})`;
            setStatus(`${t('status_analyzing').replace('...', '')} ${pctStr}`, 'analyzing');
            if (item) { item.progress = pct; renderQueue(); }
        }

        if (msg.type === 'complete') {
            keepSegments = msg.data.keeps.segments;
            updateStats(msg.data.duration, msg.data.keeps);
            if (item) {
                item.silenceSegments = silenceSegments.slice();
                item.keepSegments    = keepSegments.slice();
                item.analysisDone    = true;
                item.analysisStats   = msg.data.keeps;
                item.duration        = msg.data.duration;
                item.status          = 'done';
                renderQueue();
            }
            finishAnalysis(sse);
        }

        if (msg.type === 'error') {
            analysisError = msg.data;
            finishAnalysis(sse);
        }
    };

    sse.onerror = () => finishAnalysis(sse);

    function finishAnalysis(sse) {
        if (sse === currentSse) currentSse = null;
        if (sse) sse.close();
        isAnalyzing = false;
        analyzeBtn.disabled = false;
        analysisFill.style.width = '100%';
        if (item) item._isAnalyzing = false;

        if (processingState === 'running') {
            scheduleAnalysis(); // Trigger background queue to continue if needed
        } else if (!videoQueue.some(it => it._isAnalyzing)) {
            setProcessingState('idle');
        }
        updateQueueProgressBadge();

        if (analysisError) {
            analysisText.textContent = t('analysis_failed_status');
            setStatus(t('status_error'), '');
            if (item) { item.status = 'error'; item.error = analysisError; renderQueue(); }
            showError({
                title:    t('analysis_failed_title') || t('status_error'), // I should add this to i18n
                subtitle: item ? item.fileName : '',
                message:  analysisError,
                retry:    runAnalysis,
            });
        } else {
            analysisText.textContent = t('analysis_done_count').replace('{count}', silenceSegments.length);
            setStatus(t('status_ready_check'), 'done');
            exportBtn.disabled = false;
        }
        setTimeout(() => analysisBar.classList.add('hidden'), 3000);
    }
}

// ═══════════════════════════════════════
//  JUMP-CUT PREVIEW ENGINE
//  Drives playback from keepSegments (matching export precision).
let webAudio = { ctx: null, src: null, gain: null, attachedMedia: null };

function getActiveMedia() {
    return (plyrPlayer && plyrPlayer.media) ? plyrPlayer.media : document.getElementById('preview-video');
}

function ensureWebAudio() {
    const media = getActiveMedia();
    if (!media) return;
    
    // If media changed, we must re-attach
    if (webAudio.attachedMedia !== media) {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) { webAudio.attachedMedia = media; return; }
            if (!webAudio.ctx) webAudio.ctx = new Ctx();
            
            // Re-create source node for the new element
            webAudio.src = webAudio.ctx.createMediaElementSource(media);
            if (!webAudio.gain) {
                webAudio.gain = webAudio.ctx.createGain();
                webAudio.gain.gain.value = 1;
            }
            webAudio.src.connect(webAudio.gain).connect(webAudio.ctx.destination);
            webAudio.attachedMedia = media;
        } catch (_) {
            webAudio.attachedMedia = media; 
        }
    }
}

const JC_FADE_LEAD_SEC = 0.040;   // begin fade 40ms before cut
const JC_FADE_DUR_SEC  = 0.028;   // 28ms ramp duration (~2 frames @60Hz)
const JC_SEEK_SAFETY   = 0.004;   // 4ms safety margin past segment start

let jumpRAF = null;
let jcFadingOut = false;
let jcScheduledJumpAt = -1;
let jcScheduledJumpTo = -1;

function findCurrentKeep(t) {
    for (let i = 0; i < keepSegments.length; i++) {
        const k = keepSegments[i];
        if (t >= k.start - 0.002 && t < k.end) return { idx: i, seg: k };
    }
    return null;
}

function findNextKeep(afterT) {
    for (let i = 0; i < keepSegments.length; i++) {
        if (keepSegments[i].start > afterT - 0.002) return keepSegments[i];
    }
    return null;
}

function rampGain(target, durationSec) {
    if (!webAudio.gain || !webAudio.ctx) return;
    const t = webAudio.ctx.currentTime;
    try {
        webAudio.gain.gain.cancelScheduledValues(t);
        webAudio.gain.gain.setValueAtTime(webAudio.gain.gain.value, t);
        webAudio.gain.gain.linearRampToValueAtTime(target, t + Math.max(0.001, durationSec));
    } catch (_) {}
}

function applyVisualFade(out) {
    if (videoWrapper) videoWrapper.classList.toggle('jc-fading', out);
}

function jcResetFade() {
    jcFadingOut = false;
    jcScheduledJumpAt = -1;
    jcScheduledJumpTo = -1;
    applyVisualFade(false);
    rampGain(1, 0.020);
}

function performJump(targetTime) {
    const media = getActiveMedia();
    if (media) media.currentTime = Math.max(0, targetTime + JC_SEEK_SAFETY);
    requestAnimationFrame(() => {
        applyVisualFade(false);
        rampGain(1, JC_FADE_DUR_SEC);
    });
    jcFadingOut = false;
    jcScheduledJumpAt = -1;
    jcScheduledJumpTo = -1;
}

function jumpCutTick() {
    jumpRAF = null;
    const media = getActiveMedia();
    if (!media || media.paused) return; 
    
    if (!autoSkipToggle.checked || !keepSegments.length) {
        scheduleNextJcTick();
        return;
    }
    const t = media.currentTime;
    const cur = findCurrentKeep(t);

    if (!cur) {
        const next = findNextKeep(t);
        if (next) {
            ensureWebAudio();
            applyVisualFade(true);
            rampGain(0, JC_FADE_DUR_SEC);
            showSkipBadge();
            performJump(next.start);
        } else if (keepSegments.length > 0 && t > keepSegments[keepSegments.length - 1].end - 0.05) {
            if (plyrPlayer) plyrPlayer.pause();
            else media.pause();
            return;
        }
        scheduleNextJcTick();
        return;
    }

    const segEnd = cur.seg.end;
    const next = keepSegments[cur.idx + 1];

    if (next && !jcFadingOut && t >= segEnd - JC_FADE_LEAD_SEC) {
        ensureWebAudio();
        jcFadingOut = true;
        jcScheduledJumpAt = segEnd;
        jcScheduledJumpTo = next.start;
        applyVisualFade(true);
        rampGain(0, JC_FADE_DUR_SEC);
        showSkipBadge();
    }

    if (jcFadingOut && t >= jcScheduledJumpAt) {
        performJump(jcScheduledJumpTo);
    } else if (!next && t >= segEnd - 0.005) {
        if (plyrPlayer) plyrPlayer.pause();
        else media.pause();
        return;
    }

    scheduleNextJcTick();
}

function scheduleNextJcTick() {
    if (jumpRAF) return;
    const media = getActiveMedia();
    if (media && !media.paused) jumpRAF = requestAnimationFrame(jumpCutTick);
}

function showSkipBadge() {
    skipBadge.classList.add('show');
    clearTimeout(skipBadge._tid);
    skipBadge._tid = setTimeout(() => skipBadge.classList.remove('show'), 600);
}

// ═══════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════
async function handleExport() {
    const format = exportFormat.value;
    const item = activeItem();

    if (!currentSessionId) {
        showError({
            title:    t('no_video_title'),
            message:  t('no_video_msg'),
        });
        return;
    }
    if (item && !item.analysisDone) {
        showError({
            title:    t('analysis_incomplete_title'),
            subtitle: item.fileName,
            message:  t('analysis_incomplete_msg'),
        });
        return;
    }
    if (item && item.analysisStats && item.analysisStats.segments && item.analysisStats.segments.length === 0) {
        showError({
            title:    t('nothing_export_title'),
            subtitle: item.fileName,
            message:  t('nothing_export_msg'),
        });
        return;
    }

    // Document export — direct download via streamed endpoint
    if (format === 'edl' || format === 'xml') {
        try {
            const settings = getSettings();
            const transUrl = format === 'xml' ? `?transition=${settings.transition}` : '';
            
            // Probe first to surface server errors as a popup instead of a broken download
            const probe = await fetch(`/api/export/${format}/${currentSessionId}${transUrl}`, { method: 'GET' });
            if (!probe.ok) {
                const { message, details } = await readFetchError(probe, `${format.toUpperCase()} export failed`);
                throw Object.assign(new Error(message), { details });
            }
            const blob = await probe.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            const baseName = (item ? item.fileName : 'export').replace(/\.[^.]+$/, '');
            a.href = url;
            a.download = `${baseName}_cut.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`${format.toUpperCase()} exported`);
        } catch (e) {
            showError({
                title:    `${format.toUpperCase()} export failed`,
                subtitle: item ? item.fileName : '',
                message:  e.message,
                details:  e.details || e.stack,
                retry:    handleExport,
            });
        }
        return;
    }

    // Media export (FFmpeg) — long-running, show progress
    exportBtn.disabled = true;
    exportProgressContainer.classList.remove('hidden');
    exportProgressBar.style.width = '0%';
    exportProgressPercent.textContent = '0%';

    if (exportPollInterval) clearInterval(exportPollInterval);

    try {
        // Start polling for progress
        exportPollInterval = setInterval(async () => {
            try {
                const sres = await fetch(`/api/export-status/${currentSessionId}`);
                if (sres.ok) {
                    const sdata = await sres.json();
                    const p = sdata.progress || 0;
                    exportProgressBar.style.width = p + '%';
                    exportProgressPercent.textContent = p + '%';
                }
            } catch (_) {}
        }, 1500);

        const res = await fetch(`/api/export/media/${currentSessionId}?format=${format}`, { method: 'POST' });
        
        if (exportPollInterval) {
            clearInterval(exportPollInterval);
            exportPollInterval = null;
        }

        if (!res.ok) {
            const { message, details } = await readFetchError(res, `${format.toUpperCase()} export failed`);
            throw Object.assign(new Error(message), { details });
        }
        const data = await res.json();
        if (!data.ok || !data.url) {
            throw new Error(data.error || 'Export server returned no file URL.');
        }

        // Success
        exportProgressBar.style.width = '100%';
        exportProgressPercent.textContent = '100%';
        setTimeout(() => { exportProgressContainer.classList.add('hidden'); }, 3000);

        const a = document.createElement('a');
        a.href = data.url;
        a.download = data.filename || 'export';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(t('status_done'));
    } catch (e) {
        if (exportPollInterval) {
            clearInterval(exportPollInterval);
            exportPollInterval = null;
        }
        exportProgressContainer.classList.add('hidden');
        showError({
            title:    `${format.toUpperCase()} export failed`,
            subtitle: item ? item.fileName : '',
            message:  e.message,
            details:  e.details || e.stack,
            retry:    handleExport,
        });
    } finally {
        exportBtn.disabled = false;
    }
}

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════
function getSettings() {
    const s = {};
    Object.keys(paramMap).forEach(k => s[k] = parseFloat(paramMap[k].el.value));
    return s;
}

function applyPreset(p) {
    Object.keys(p).forEach(k => {
        if (paramMap[k]) {
            paramMap[k].el.value = p[k];
            paramMap[k].val.textContent = p[k] + paramMap[k].unit;
        }
    });
    // Redraw threshold line when preset changes dB
    drawThresholdLine();
}

function updateStats(orig, keeps) {
    const totalKept = keeps.total || 0;
    const diff = Math.max(0, orig - totalKept);
    const pct = orig > 0 ? ((diff / orig) * 100).toFixed(1) : '0.0';

    statOriginal.textContent = fmtTime(orig);
    statAfter.textContent    = fmtTime(totalKept);
    statReduced.textContent  = `-${pct}%`;
    statSegs.textContent     = keeps.segments.length;
}

function setStatus(text, cls) {
    statusPill.textContent = text;
    statusPill.className = 'pill ' + (cls || '');
}

function fmtTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
}

function parseHMS(hms) {
    if (!hms) return 0;
    const p = hms.split(':').map(parseFloat);
    if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
    if (p.length === 2) return p[0]*60 + p[1];
    return parseFloat(hms) || 0;
}

function showLoader(msg) { loaderText.textContent = msg || t('loader_working'); loader.classList.remove('hidden'); }
function hideLoader()    { loader.classList.add('hidden'); }

// ── REAL-TIME PREVIEW ──────────────────
let previewTimeout = null;
function debounce(fn, ms) {
    return function() {
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(() => fn.apply(this, arguments), ms);
    };
}

// Mirrors server-side SilenceDetector.calculateKeepSegments so live preview
// matches what export will actually produce.
function computeKeepsFromSilences(silences, dur, settings) {
    if (!silences || silences.length === 0) return [{ start: 0, end: dur }];
    const padBefore = settings.paddingBefore;
    const padAfter  = settings.paddingAfter;
    const mergeGap  = settings.mergeGap;
    const minClip   = settings.minClipLength;

    let keeps = [];
    let lastEnd = 0;
    silences.forEach(s => {
        let keepStart = Math.max(0, lastEnd - (lastEnd === 0 ? 0 : padAfter));
        let keepEnd   = Math.min(dur, s.start + padBefore);
        if (keepEnd - keepStart > 0.01) keeps.push({ start: keepStart, end: keepEnd });
        lastEnd = s.end;
    });
    const finalStart = lastEnd - padAfter;
    if (finalStart < dur - 0.05) keeps.push({ start: Math.max(0, finalStart), end: dur });

    if (keeps.length <= 1) return keeps;
    const merged = [];
    let cur = keeps[0];
    for (let i = 1; i < keeps.length; i++) {
        const next = keeps[i];
        if (next.start - cur.end <= mergeGap) cur.end = next.end;
        else {
            if (cur.end - cur.start >= minClip) merged.push(cur);
            cur = next;
        }
    }
    if (cur.end - cur.start >= minClip) merged.push(cur);
    return merged;
}

function updateSilencePreview() {
    if (!wavesurfer || !wsRegions || isAnalyzing) return;
    const item = activeItem();
    if (!item || !item.peaks) return;

    const settings = getSettings();
    const threshold = Math.pow(10, settings.thresholdDb / 20);
    const minSil = settings.minSilence;
    const peaks = item.peaks;
    const dur = item.duration;
    if (!dur || !peaks.length) return;

    const secPerPeak = dur / peaks.length;
    
    // Clear old regions (both real and preview)
    wsRegions.clearRegions();
    
    let previewSilences = [];
    let currentStart = null;
    
    for (let i = 0; i < peaks.length; i++) {
        const isSilent = Math.abs(peaks[i]) < threshold;
        const t = i * secPerPeak;
        
        if (isSilent && currentStart === null) {
            currentStart = t;
        } else if (!isSilent && currentStart !== null) {
            const silenceDur = t - currentStart;
            if (silenceDur >= minSil) {
                previewSilences.push({ start: currentStart, end: t });
            }
            currentStart = null;
        }
    }
    if (currentStart !== null && (dur - currentStart >= minSil)) {
        previewSilences.push({ start: currentStart, end: dur });
    }

    // Update both silence + keep segments so Jump-Cut preview matches export exactly
    silenceSegments = previewSilences;
    keepSegments    = computeKeepsFromSilences(previewSilences, dur, settings);

    // Draw preview regions
    previewSilences.forEach(s => {
        wsRegions.addRegion({
            start: s.start,
            end: s.end,
            color: 'rgba(255, 50, 50, 0.3)', // Semi-transparent red for preview
            drag: false,
            resize: false
        });
    });
    
    // Note: We don't update the stats (Saved %) in preview mode 
    // to keep it fast, but we could if needed.
}

init();
