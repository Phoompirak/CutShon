const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { spawn, execSync } = require('child_process');

const SilenceDetector = require('./lib/silence-detector');
const EDLExporter = require('./lib/edl-exporter');
const XMLExporter = require('./lib/xml-exporter');
const MediaExporter = require('./lib/media-exporter');

const app = express();
const port = 3000;

// Ensure storage directories exist
['uploads', 'output'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[startup] Created directory: ${dir}`);
    }
});

// Detect hardware encoder once at startup
let hwEncoder = null;
try {
    const enc = execSync('ffmpeg -hide_banner -encoders 2>&1', { timeout: 6000 }).toString();
    if (enc.includes('h264_nvenc'))     hwEncoder = 'nvenc';
    else if (enc.includes('h264_amf')) hwEncoder = 'amf';
    else if (enc.includes('h264_qsv')) hwEncoder = 'qsv';
    if (hwEncoder) console.log(`[startup] Hardware encoder: ${hwEncoder}`);
    else           console.log('[startup] No hardware encoder found — using libx264');
} catch (_) { console.log('[startup] hwEncoder probe skipped'); }

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const id = uuidv4();
        cb(null, id + path.extname(file.originalname));
    }
});
const upload = multer({ storage });
const sessions = {};

/**
 * Helper to check if a file has non-standard audio (like fpcm in mp4)
 * and attempt to repair it to a temporary playable version.
 */
async function ensurePlayable(filePath) {
    return new Promise((resolve) => {
        // Try a quick probe
        try {
            const probe = execSync(`ffprobe -v error -show_streams -select_streams a "${filePath}"`).toString();
            if (probe.includes('codec_name=unknown') || probe.includes('codec_tag_string=fpcm')) {
                console.log('[upload] Non-standard audio detected. Attempting auto-repair...');
                const repairedPath = filePath.replace(path.extname(filePath), '_fixed.mp4');
                
                // Use forced decoder pcm_f32le to convert to standard AAC
                const ffmpeg = spawn('ffmpeg', [
                    '-c:a', 'pcm_f32le',
                    '-i', filePath,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    repairedPath
                ]);

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log('[upload] Auto-repair successful:', repairedPath);
                        resolve(repairedPath);
                    } else {
                        console.error('[upload] Auto-repair failed');
                        resolve(filePath); // Fallback to original
                    }
                });
            } else {
                resolve(filePath);
            }
        } catch (e) {
            resolve(filePath);
        }
    });
}

/**
 * Upload
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    // AUTO-REPAIR STEP
    const finalPath = await ensurePlayable(req.file.path);
    const finalFilename = path.basename(finalPath);

    const sessionId = path.parse(req.file.filename).name;
    sessions[sessionId] = {
        originalName: req.file.originalname,
        path: finalPath,
        fileUrl: `/uploads/${finalFilename}`,
        id: sessionId,
        settings: {}
    };
    res.json({ sessionId, filename: req.file.originalname, fileUrl: sessions[sessionId].fileUrl });
});

/**
 * Waveform peaks
 */
app.get('/api/waveform/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const TARGET_PEAKS = 8000;
    const SAMPLE_RATE  = 8000;

    const ffmpeg = spawn('ffmpeg', [
        '-i', session.path,
        '-vn',                                       // skip video decode
        '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'
    ]);

    const chunks = [];
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {}); 

    ffmpeg.on('close', (code) => {
        if (code !== 0) return res.status(500).json({ error: 'FFmpeg failed to extract waveform' });

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
        res.json({ peaks, sampleRate: SAMPLE_RATE, total });
    });

    ffmpeg.on('error', err => res.status(500).json({ error: err.message }));
});

/**
 * Save settings only
 */
app.post('/api/settings', (req, res) => {
    const { sessionId, settings } = req.body;
    const session = sessions[sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.settings = settings || {};
    res.json({ ok: true });
});

/**
 * SSE streaming analysis
 */
app.get('/api/analyze-stream/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    let settings = session.settings || {};
    if (req.query.settings) {
        try { settings = JSON.parse(req.query.settings); } catch(e) {}
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const detector = new SilenceDetector(settings);

    req.on('close', () => {
        console.log('[analyze-stream] Client disconnected, stopping detector.');
        detector.stop();
    });

    detector.on('segment', seg => {
        res.write(`data: ${JSON.stringify({ type: 'segment', data: seg })}\n\n`);
    });

    detector.on('progress', p => {
        res.write(`data: ${JSON.stringify({ type: 'progress', data: p })}\n\n`);
    });

    detector.detect(session.path)
        .then(result => {
            session.lastResult = result;
            res.write(`data: ${JSON.stringify({ type: 'complete', data: result })}\n\n`);
            res.end();
        })
        .catch(err => {
            console.error('[analyze-stream error]', err);
            res.write(`data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`);
            res.end();
        });
});

/**
 * Export EDL
 */
app.get('/api/export/edl/:sessionId', (req, res) => {
    try {
        const session = sessions[req.params.sessionId];
        if (!session) return res.status(404).json({ error: 'Session not found. Please re-upload the file.' });
        if (!session.lastResult) return res.status(400).json({ error: 'No analysis result yet. Run analysis first.' });

        const edlContent = EDLExporter.generate(
            session.lastResult.keeps.segments,
            session.lastResult.fps,
            session.originalName
        );
        if (!fs.existsSync('output')) fs.mkdirSync('output', { recursive: true });
        const exportPath = path.join('output', `${session.id}.edl`);
        fs.writeFileSync(exportPath, edlContent);
        res.download(exportPath, `${path.parse(session.originalName).name}_cut.edl`);
    } catch (err) {
        console.error('[edl export error]', err);
        res.status(500).json({ error: 'EDL export failed: ' + err.message, stack: err.stack });
    }
});

/**
 * Export XML
 */
app.get('/api/export/xml/:sessionId', (req, res) => {
    try {
        const session = sessions[req.params.sessionId];
        if (!session) return res.status(404).json({ error: 'Session not found. Please re-upload the file.' });
        if (!session.lastResult) return res.status(400).json({ error: 'No analysis result yet. Run analysis first.' });

        const transitionSec = parseFloat(req.query.transition) || 0;

        const xmlContent = XMLExporter.generate(
            session.lastResult.keeps.segments,
            session.lastResult.fps,
            session.originalName,
            session.lastResult.duration,
            path.resolve(session.path),
            {
                width:  session.lastResult.width  || 1920,
                height: session.lastResult.height || 1080,
                audioChannels: session.lastResult.audioChannels || 2,
                sampleRate:    session.lastResult.sampleRate    || 48000,
                transitionSec
            }
        );
        if (!fs.existsSync('output')) fs.mkdirSync('output', { recursive: true });
        const exportPath = path.join('output', `${session.id}.xml`);
        fs.writeFileSync(exportPath, xmlContent, 'utf8');
        res.download(exportPath, `${path.parse(session.originalName).name}_cut.xml`);
    } catch (err) {
        console.error('[xml export error]', err);
        res.status(500).json({ error: 'XML export failed: ' + err.message, stack: err.stack });
    }
});

/**
 * Export Media (MP4 / MOV / MP3)
 */
app.post('/api/export/media/:sessionId', async (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found. Please re-upload the file.' });
    if (!session.lastResult) return res.status(400).json({ error: 'No analysis result yet. Run analysis before exporting.' });

    const format = req.query.format;
    if (!['mp4', 'mov', 'mp3'].includes(format)) {
        return res.status(400).json({ error: `Invalid format "${format}". Use mp4, mov, or mp3.` });
    }

    const segments = session.lastResult.keeps.segments;
    if (!segments || segments.length === 0) {
        return res.status(400).json({ error: 'Nothing to export — analysis returned zero keep segments. Try a less aggressive threshold.' });
    }

    try {
        if (!fs.existsSync('output')) fs.mkdirSync('output', { recursive: true });
        const result = await MediaExporter.exportMedia(
            session.path,
            segments,
            format,
            session.originalName,
            hwEncoder
        );
        const fileUrl = `/api/download?path=${encodeURIComponent(result.path)}&name=${encodeURIComponent(result.filename)}`;
        res.json({ ok: true, url: fileUrl, filename: result.filename });
    } catch (err) {
        console.error('[export error]', err);
        res.status(500).json({
            error: 'Media export failed: ' + err.message,
            format,
            segmentCount: segments.length,
            stack: err.stack
        });
    }
});

app.get('/api/download', (req, res) => {
    const filePath = req.query.path;
    const fileName = req.query.name;
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not found');
    res.download(filePath, fileName);
});

app.listen(port, () => console.log(`CutShon server running at http://localhost:${port}`));
