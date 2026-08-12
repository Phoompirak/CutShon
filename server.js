const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { spawn, execSync } = require('child_process');

const SilenceDetector = require('./lib/silence-detector');
const EDLExporter = require('./lib/edl-exporter');
const XMLExporter = require('./lib/xml-exporter');
const MediaExporter = require('./lib/media-exporter');
const { ffmpegPath, ffprobePath, setLowPriority, execFileAsync } = require('./lib/ffmpeg-helper');

// ═══════════════════════════════════════════════════════════════
// [Rule 7] Structured Logging
// ═══════════════════════════════════════════════════════════════
const LOG_DIR = path.join(os.homedir(), 'AppData', 'Local', 'CutShon', 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0,10)}.log`);

function writeLog(level, ctx, msg, data) {
    const line = `[${new Date().toISOString()}] [${level}] [${ctx}] ${msg}` +
                 (data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : '');
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}
const log = {
    info:  (c, m, d) => writeLog('INFO',  c, m, d),
    warn:  (c, m, d) => writeLog('WARN',  c, m, d),
    error: (c, m, e) => writeLog('ERROR', c, m, e?.stack || e?.message || e),
};

// ═══════════════════════════════════════════════════════════════
// [Rule 1] Global Error Handlers — ป้องกัน server crash
// ═══════════════════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
    log.error('process', 'Uncaught exception (continuing)', err);
});
process.on('unhandledRejection', (reason) => {
    log.error('process', 'Unhandled rejection (continuing)', reason);
});

const app = express();
const port = 3000;
const PUBLIC_BASE = `http://localhost:${port}`;

// ═══════════════════════════════════════════════════════════════
// [Rule 3] Storage Management — ใช้ user data dir แทน cwd
// ═══════════════════════════════════════════════════════════════
const APP_DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'CutShon');
const UPLOADS_DIR  = path.join(APP_DATA_DIR, 'uploads');
const OUTPUT_DIR   = path.join(APP_DATA_DIR, 'output');
const SESSIONS_FILE = path.join(APP_DATA_DIR, 'sessions.json');

[APP_DATA_DIR, UPLOADS_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log.info('startup', `Created directory: ${dir}`);
    }
});

// ═══════════════════════════════════════════════════════════════
// [Rule 3] Disk Space Check
// ═══════════════════════════════════════════════════════════════
function getFreeSpaceMB(dirPath) {
    try {
        if (process.platform === 'win32') {
            const drive = path.parse(path.resolve(dirPath)).root.replace('\\', '');
            const out = execSync(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`,
                                 { timeout: 3000 }).toString();
            const m = out.match(/FreeSpace=(\d+)/);
            return m ? Math.floor(parseInt(m[1]) / 1024 / 1024) : null;
        }
        const stat = fs.statfsSync ? fs.statfsSync(dirPath) : null;
        if (stat) return Math.floor((stat.bavail * stat.bsize) / 1024 / 1024);
    } catch (e) { log.warn('disk', 'free space check failed', e.message); }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// [Rule 3] Auto-Cleanup
// ═══════════════════════════════════════════════════════════════
function runCleanup() {
    const DIRS = [UPLOADS_DIR, OUTPUT_DIR];
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let deletedCount = 0;

    DIRS.forEach(dir => {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > MAX_AGE_MS) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    const sid = path.parse(file).name;
                    if (sessions[sid]) delete sessions[sid];
                }
            } catch (_) {}
        });
    });

    // Also rotate logs older than 14 days
    try {
        const logs = fs.readdirSync(LOG_DIR);
        logs.forEach(f => {
            const fp = path.join(LOG_DIR, f);
            const st = fs.statSync(fp);
            if (now - st.mtimeMs > 14 * 24 * 60 * 60 * 1000) fs.unlinkSync(fp);
        });
    } catch (_) {}

    if (deletedCount > 0) {
        saveSessions();
        log.info('cleanup', `Removed ${deletedCount} stale files`);
    }
}
setInterval(runCleanup, 60 * 60 * 1000);
setTimeout(runCleanup, 5000);

// Detect hardware encoder asynchronously (non-blocking)
let hwEncoder = null;
execFileAsync(ffmpegPath, ['-hide_banner', '-encoders']).then(({ stdout, stderr }) => {
    const enc = stdout + stderr;
    if (enc.includes('h264_nvenc'))     hwEncoder = 'nvenc';
    else if (enc.includes('h264_amf')) hwEncoder = 'amf';
    else if (enc.includes('h264_qsv')) hwEncoder = 'qsv';
    log.info('startup', hwEncoder ? `Hardware encoder: ${hwEncoder}` : 'No HW encoder, using libx264');
}).catch(() => log.warn('startup', 'hwEncoder probe skipped'));

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ═══════════════════════════════════════════════════════════════
// Custom static handler — works with pkg snapshot fs (express.static doesn't)
// ═══════════════════════════════════════════════════════════════
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.otf':  'font/otf',
    '.map':  'application/json',
    '.wasm': 'application/wasm',
};
function servePublic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();

    let urlPath = decodeURIComponent(req.path);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR)) return res.status(403).send('Forbidden');

    try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(data);
    } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'EISDIR') return next();
        log.error('static', `Failed to serve ${urlPath} (${filePath})`, e);
        res.status(500).send('Static read error: ' + e.message);
    }
}
app.use(servePublic);

// Debug endpoint to verify snapshot fs
app.get('/api/debug-fs', (req, res) => {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    let exists = false, list = [], err = null;
    try { exists = fs.existsSync(indexPath); } catch (e) { err = e.message; }
    try { list = fs.readdirSync(PUBLIC_DIR); } catch (e) { err = e.message; }
    res.json({ __dirname, PUBLIC_DIR, indexPath, exists, list, err });
});

// uploads served from APP_DATA_DIR (real disk, not pkg snapshot — can use express.static)
app.use('/uploads', express.static(UPLOADS_DIR));

// ═══════════════════════════════════════════════════════════════
// [Rule 6] Input Validation — Multer with file filter
// ═══════════════════════════════════════════════════════════════
const ALLOWED_EXTENSIONS = new Set([
    '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.flv', '.wmv',
    '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus'
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const id = uuidv4();
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, id + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return cb(new Error(`File extension "${ext}" not allowed`));
        }
        const mime = file.mimetype || '';
        if (!mime.startsWith('video/') && !mime.startsWith('audio/') && mime !== 'application/octet-stream') {
            return cb(new Error(`Invalid MIME type: ${mime}`));
        }
        cb(null, true);
    }
});

// ═══════════════════════════════════════════════════════════════
// Session Persistence
// ═══════════════════════════════════════════════════════════════
let sessions = {};

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            Object.keys(sessions).forEach(id => {
                const s = sessions[id];
                if (s.originalName) {
                    try {
                        const test = Buffer.from(s.originalName, 'latin1').toString('utf8');
                        if (/[ก-ฮ]/.test(test) || /[\u{1F300}-\u{1F9FF}]/u.test(test)) {
                            s.originalName = test;
                        }
                    } catch (_) {}
                }
            });
            log.info('startup', `Loaded ${Object.keys(sessions).length} sessions`);
        }
    } catch (err) {
        log.error('startup', 'Failed to load sessions', err);
        sessions = {};
    }
}
function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (err) { log.error('sessions', 'Save failed', err); }
}
loadSessions();

// ═══════════════════════════════════════════════════════════════
// [Rule 2 + 4] Process Tracking — ป้องกัน zombie ffmpeg + memory leak
// ═══════════════════════════════════════════════════════════════
const activeProcesses = new Map(); // sessionId -> Set<ChildProcess>
const activeDetectors = new Map(); // sessionId -> SilenceDetector

function trackProcess(sessionId, child) {
    if (!activeProcesses.has(sessionId)) activeProcesses.set(sessionId, new Set());
    activeProcesses.get(sessionId).add(child);
    child.once('close', () => activeProcesses.get(sessionId)?.delete(child));
    child.once('exit',  () => activeProcesses.get(sessionId)?.delete(child));
}
function killSessionProcesses(sessionId) {
    const procs = activeProcesses.get(sessionId);
    if (procs) {
        for (const p of procs) {
            try { p.kill('SIGTERM'); } catch (_) {}
        }
        activeProcesses.delete(sessionId);
    }
    const det = activeDetectors.get(sessionId);
    if (det) {
        try { det.removeAllListeners(); det.stop(); } catch (_) {}
        activeDetectors.delete(sessionId);
    }
}

// ═══════════════════════════════════════════════════════════════
// [Rule 1] Async Route Wrapper — auto-catch errors
// ═══════════════════════════════════════════════════════════════
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// ═══════════════════════════════════════════════════════════════
// Helper: ensure playable (non-blocking async)
// ═══════════════════════════════════════════════════════════════
async function ensurePlayable(filePath) {
    try {
        const { stdout } = await execFileAsync(ffprobePath, [
            '-v', 'error', '-show_streams', '-select_streams', 'a', filePath
        ], { timeout: 10000 });
        if (stdout.includes('codec_name=unknown') || stdout.includes('codec_tag_string=fpcm')) {
            log.info('upload', 'Auto-repair non-standard audio');
            const repairedPath = filePath.replace(path.extname(filePath), '_fixed.mp4');
            return new Promise((resolve) => {
                const ffmpeg = spawn(ffmpegPath, [
                    '-c:a', 'pcm_f32le', '-i', filePath,
                    '-c:v', 'copy', '-c:a', 'aac', repairedPath
                ]);
                setLowPriority(ffmpeg);
                ffmpeg.on('close', (code) => {
                    if (code === 0) { log.info('upload', 'Auto-repair OK'); resolve(repairedPath); }
                    else { log.warn('upload', 'Auto-repair failed'); resolve(filePath); }
                });
                ffmpeg.on('error', () => resolve(filePath));
            });
        }
        return filePath;
    } catch (e) { return filePath; }
}

// ═══════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════

// Upload
app.post('/api/upload', (req, res, next) => {
    // [Rule 3] Disk space check before accepting upload
    const free = getFreeSpaceMB(UPLOADS_DIR);
    if (free !== null && free < 500) {
        log.warn('upload', `Low disk space: ${free} MB`);
        return res.status(507).json({ error: `Insufficient disk space (${free} MB free, 500 MB required)` });
    }
    upload.single('file')(req, res, (err) => {
        if (err) {
            log.error('upload', 'Multer error', err);
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Catch 0-byte files (common in Tauri WebView2 drag-and-drop restrictions)
    if (req.file.size === 0) {
        log.warn('upload', `0-byte file detected: ${req.file.originalname}. This is often caused by WebView2 drag-and-drop restrictions.`);
        return res.status(400).json({ 
            error: `File is empty (0 bytes).\n\nIf you dragged and dropped the file, it was blocked by Windows security restrictions. Please use the "Browse file" button instead.` 
        });
    }

    let originalName = req.file.originalname;
    try { originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); }
    catch (_) {}

    const finalPath = await ensurePlayable(req.file.path);
    const finalFilename = path.basename(finalPath);

    const sessionId = path.parse(req.file.filename).name;
    // Return absolute URL so <video src> works inside Tauri exe (where origin is tauri://localhost)
    const fileUrl = `${PUBLIC_BASE}/uploads/${finalFilename}`;
    sessions[sessionId] = {
        originalName, path: finalPath,
        fileUrl,
        id: sessionId, settings: {}
    };
    saveSessions();
    log.info('upload', `Uploaded: ${originalName} (${(req.file.size/1024/1024).toFixed(1)} MB)`);
    res.json({ sessionId, filename: originalName, fileUrl });
}));

// Upload by local file path (Tauri desktop mode & direct file drop)
app.post('/api/upload-path', asyncHandler(async (req, res) => {
    const { filePath } = req.body || {};
    if (!filePath || typeof filePath !== 'string') {
        return res.status(400).json({ error: 'File path is required' });
    }

    const normalizedPath = path.normalize(filePath);
    if (!fs.existsSync(normalizedPath)) {
        return res.status(404).json({ error: `File not found: ${path.basename(normalizedPath)}` });
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        return res.status(400).json({ error: `File extension "${ext}" not allowed` });
    }

    const stat = await fs.promises.stat(normalizedPath);
    if (stat.size === 0) {
        return res.status(400).json({ error: `File is empty (0 bytes)` });
    }

    const sessionId = uuidv4();
    const originalName = path.basename(normalizedPath);
    const destName = sessionId + ext;
    const destPath = path.join(UPLOADS_DIR, destName);

    if (path.resolve(normalizedPath) !== path.resolve(destPath)) {
        await fs.promises.copyFile(normalizedPath, destPath);
    }

    const finalPath = await ensurePlayable(destPath);
    const finalFilename = path.basename(finalPath);
    const fileUrl = `${PUBLIC_BASE}/uploads/${finalFilename}`;

    sessions[sessionId] = {
        originalName,
        path: finalPath,
        fileUrl,
        id: sessionId,
        settings: {}
    };
    saveSessions();
    log.info('upload-path', `Added local file by path: ${originalName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    res.json({ sessionId, filename: originalName, fileUrl });
}));

// Waveform
app.get('/api/waveform/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const TARGET_PEAKS = 8000;
    const SAMPLE_RATE  = 8000;

    const cpuCores = os.cpus()?.length || 4;
    const safeThreads = Math.max(1, Math.min(4, Math.floor(cpuCores / 2)));

    const ffmpeg = spawn(ffmpegPath, [
        '-threads', String(safeThreads),
        '-i', session.path, '-vn', '-ac', '1',
        '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'
    ]);
    setLowPriority(ffmpeg);
    trackProcess(req.params.sessionId, ffmpeg);

    const chunks = [];
    let responded = false;

    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {});

    // [Rule 2] Cleanup if client disconnects
    req.on('close', () => { try { ffmpeg.kill('SIGTERM'); } catch (_) {} });

    ffmpeg.on('close', (code) => {
        if (responded) return;
        if (code !== 0) {
            responded = true;
            return res.status(500).json({ error: 'FFmpeg failed' });
        }
        try {
            const buf   = Buffer.concat(chunks);
            const total = buf.length / 4;
            const step  = Math.max(1, Math.floor(total / TARGET_PEAKS));
            const peaks = [];
            for (let i = 0; i < total; i += step) {
                let max = 0;
                for (let j = i; j < Math.min(i + step, total); j++) {
                    const v = Math.abs(buf.readFloatLE(j * 4));
                    if (v > max) max = v;
                }
                peaks.push(Math.min(1, max));
            }
            responded = true;
            res.json({ peaks, sampleRate: SAMPLE_RATE, total });
        } catch (e) {
            log.error('waveform', 'parse error', e);
            if (!responded) {
                responded = true;
                res.status(500).json({ error: e.message });
            }
        }
    });
    ffmpeg.on('error', err => {
        log.error('waveform', 'ffmpeg error', err);
        if (!responded) {
            responded = true;
            res.status(500).json({ error: err.message });
        }
    });
});

// Sessions list & restore
app.get('/api/sessions', (req, res) => {
    const list = Object.values(sessions)
        .filter(s => s && s.path && fs.existsSync(s.path))
        .map(s => ({
            sessionId: s.id,
            originalName: s.originalName,
            path: s.path,
            fileUrl: s.fileUrl,
            settings: s.settings || {},
            lastResult: s.lastResult || null
        }));
    res.json({ sessions: list });
});

app.delete('/api/sessions/:sessionId', (req, res) => {
    const sid = req.params.sessionId;
    if (sessions[sid]) {
        try { if (fs.existsSync(sessions[sid].path)) fs.unlinkSync(sessions[sid].path); } catch (_) {}
        delete sessions[sid];
        saveSessions();
    }
    res.json({ ok: true });
});

// Settings
app.post('/api/settings', (req, res) => {
    const { sessionId, settings } = req.body;
    const session = sessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.settings = settings || {};
    saveSessions();
    res.json({ ok: true });
});

// SSE analysis
app.get('/api/analyze-stream/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    let settings = session.settings || {};
    if (req.query.settings) {
        try { settings = JSON.parse(req.query.settings); } catch (_) {}
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const detector = new SilenceDetector(settings);
    activeDetectors.set(req.params.sessionId, detector);

    // [Rule 2] Always cleanup on disconnect
    const cleanup = () => {
        try { detector.removeAllListeners(); detector.stop(); } catch (_) {}
        activeDetectors.delete(req.params.sessionId);
    };
    req.on('close', () => { log.info('analyze', 'client disconnected'); cleanup(); });

    detector.on('segment',  seg => res.write(`data: ${JSON.stringify({ type:'segment',  data: seg })}\n\n`));
    detector.on('progress', p   => res.write(`data: ${JSON.stringify({ type:'progress', data: p   })}\n\n`));

    detector.detect(session.path)
        .then(result => {
            session.lastResult = result;
            saveSessions();
            res.write(`data: ${JSON.stringify({ type:'complete', data: result })}\n\n`);
            res.end();
            cleanup();
        })
        .catch(err => {
            log.error('analyze-stream', 'detect failed', err);
            res.write(`data: ${JSON.stringify({ type:'error', data: err.message })}\n\n`);
            res.end();
            cleanup();
        });
});

// EDL export
app.get('/api/export/edl/:sessionId', asyncHandler(async (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found. Please re-upload.' });
    if (!session.lastResult) return res.status(400).json({ error: 'No analysis result yet.' });

    const edlContent = EDLExporter.generate(
        session.lastResult.keeps.segments, session.lastResult.fps, session.originalName
    );
    const exportPath = path.join(OUTPUT_DIR, `${session.id}.edl`);
    fs.writeFileSync(exportPath, edlContent);
    res.download(exportPath, `${path.parse(session.originalName).name}_cut.edl`);
}));

// XML export
app.get('/api/export/xml/:sessionId', asyncHandler(async (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found. Please re-upload.' });
    if (!session.lastResult) return res.status(400).json({ error: 'No analysis result yet.' });

    const transitionSec = parseFloat(req.query.transition) || 0;
    const xmlContent = XMLExporter.generate(
        session.lastResult.keeps.segments, session.lastResult.fps,
        session.originalName, session.lastResult.duration,
        path.resolve(session.path),
        {
            width:  session.lastResult.width  || 1920,
            height: session.lastResult.height || 1080,
            audioChannels: session.lastResult.audioChannels || 2,
            sampleRate:    session.lastResult.sampleRate    || 48000,
            transitionSec
        }
    );
    const exportPath = path.join(OUTPUT_DIR, `${session.id}.xml`);
    fs.writeFileSync(exportPath, xmlContent, 'utf8');
    res.download(exportPath, `${path.parse(session.originalName).name}_cut.xml`);
}));

// Media export
app.post('/api/export/media/:sessionId', asyncHandler(async (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found. Please re-upload.' });
    if (!session.lastResult) return res.status(400).json({ error: 'No analysis result yet.' });

    const format = req.query.format;
    if (!['mp4', 'mov', 'mp3'].includes(format)) {
        return res.status(400).json({ error: `Invalid format "${format}".` });
    }
    const segments = session.lastResult.keeps.segments;
    if (!segments || segments.length === 0) {
        return res.status(400).json({ error: 'Nothing to export.' });
    }

    // [Rule 3] disk space check
    const free = getFreeSpaceMB(OUTPUT_DIR);
    if (free !== null && free < 1000) {
        return res.status(507).json({ error: `Insufficient disk space (${free} MB free)` });
    }

    session.exportProgress = 0;
    const result = await MediaExporter.exportMedia(
        session.path, segments, format, session.originalName, hwEncoder,
        (p) => { session.exportProgress = p; }
    );
    const fileUrl = `${PUBLIC_BASE}/api/download?path=${encodeURIComponent(result.path)}&name=${encodeURIComponent(result.filename)}`;
    res.json({ ok: true, url: fileUrl, filename: result.filename });
}));

// ═══════════════════════════════════════════════════════════════
// [Rule 6] Download — Path traversal protection
// ═══════════════════════════════════════════════════════════════
app.get('/api/download', (req, res) => {
    const requested = req.query.path || '';
    const fileName = req.query.name || 'download';
    const resolved = path.resolve(requested);
    const allowedRoot = path.resolve(OUTPUT_DIR);

    // [SECURITY] only files inside OUTPUT_DIR
    if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
        log.warn('download', `Blocked path traversal: ${requested}`);
        return res.status(403).json({ error: 'Access denied' });
    }
    if (!fs.existsSync(resolved)) return res.status(404).send('File not found');

    // sanitize filename header
    const safeName = path.basename(fileName).replace(/[^\w.\-ก-ฮะ-ูเ-๏เ-็่-๋์]/g, '_');
    res.download(resolved, safeName);
});

// Status
app.get('/api/export-status/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ progress: session.exportProgress || 0 });
});

// Health check (used by Tauri startup probe)
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
        sessions: Object.keys(sessions).length
    });
});

// ═══════════════════════════════════════════════════════════════
// [Rule 1] Express Error Middleware — last resort
// ═══════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
    log.error('express', `${req.method} ${req.url}`, err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error'
    });
});

// ═══════════════════════════════════════════════════════════════
// [Rule 4] Graceful Shutdown — kill all child processes
// ═══════════════════════════════════════════════════════════════
function shutdown(signal) {
    log.info('shutdown', `Received ${signal}, cleaning up...`);
    for (const sid of activeProcesses.keys()) killSessionProcesses(sid);
    saveSessions();
    setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

app.get('/api/ping', (req, res) => res.send('pong'));

if (process.env.NODE_ENV !== 'test') {
    const startServer = (portToTry) => {
        const s = app.listen(portToTry, '127.0.0.1', () => {
            log.info('startup', `CutShon server at http://localhost:${portToTry}`);
        });
        s.on('error', (err) => {
            if (err.code === 'EADDRINUSE' && portToTry < 3010) {
                log.warn('startup', `Port ${portToTry} in use, trying ${portToTry + 1}...`);
                startServer(portToTry + 1);
            } else {
                log.error('startup', 'Failed to start server', err);
            }
        });
    };
    startServer(port);
}

module.exports = app;
