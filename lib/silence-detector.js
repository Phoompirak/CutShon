const { spawn, execSync } = require('child_process');
const EventEmitter = require('events');

/**
 * Core Silence Detector
 * Extends EventEmitter so it can stream real-time segment events via SSE.
 */
class SilenceDetector extends EventEmitter {
    constructor(options = {}) {
        super();

        this.thresholdDb  = options.thresholdDb !== undefined ? options.thresholdDb : -35;
        this.minSilence   = options.minSilence !== undefined ? options.minSilence : 0.7;
        this.paddingBefore= options.paddingBefore !== undefined ? options.paddingBefore : 0.15;
        this.paddingAfter = options.paddingAfter !== undefined ? options.paddingAfter : 0.15;
        this.mergeGap     = options.mergeGap !== undefined ? options.mergeGap : 0.3;
        this.minClipLength= options.minClipLength !== undefined ? options.minClipLength : 0.8;
        
        this.activeProcess = null;
    }

    getFileInfo(filePath) {
        try {
            const duration = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString());
            const fpsStr = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
            let fps = 29.97;
            if (fpsStr.includes('/')) {
                const [num, den] = fpsStr.split('/').map(Number);
                fps = num / den;
            } else {
                fps = parseFloat(fpsStr);
            }
            return { duration, fps };
        } catch (e) {
            console.error('[ffprobe error]', e.message);
            return { duration: 0, fps: 29.97 };
        }
    }

    async detect(filePath) {
        const { duration, fps } = this.getFileInfo(filePath);

        return new Promise((resolve, reject) => {
            this.activeProcess = spawn('ffmpeg', [
                '-i', filePath,
                '-vn',              // skip video decode entirely
                '-ac', '1',         // mix to mono (50% less data)
                '-ar', '16000',     // downsample to 16kHz (sufficient for silence detection)
                '-af', `silencedetect=noise=${this.thresholdDb}dB:d=${this.minSilence}`,
                '-f', 'null', '-'
            ]);

            const ffmpeg = this.activeProcess;

            let fullLog = '';
            let lastSilenceEnd = 0;
            let pendingSilenceStart = null;

            ffmpeg.stderr.on('data', (data) => {
                const chunk = data.toString();
                fullLog += chunk;

                const startMatch = /silence_start:\s*([\d.]+)/.exec(chunk);
                const endMatch   = /silence_end:\s*([\d.]+)/.exec(chunk);

                if (startMatch) {
                    const start = parseFloat(startMatch[1]);
                    pendingSilenceStart = start;
                    if (start > lastSilenceEnd + 0.001) {
                        this.emit('segment', { type: 'keep', start: lastSilenceEnd, end: start });
                    }
                }

                if (endMatch) {
                    const end   = parseFloat(endMatch[1]);
                    const start = pendingSilenceStart;
                    this.emit('segment', { type: 'silence', start, end });
                    lastSilenceEnd = end;
                    pendingSilenceStart = null;
                }

                const timeMatch = /time=([\d:]+\.[\d]+)/.exec(chunk);
                if (timeMatch) {
                    this.emit('progress', { currentTime: timeMatch[1], totalDuration: duration });
                }
            });

            ffmpeg.on('close', (code) => {
                this.activeProcess = null;
                if (code !== 0 && code !== null) {
                    return reject(new Error(`FFmpeg exited with code ${code}`));
                }

                const silences = this.parseSilenceLogs(fullLog, duration);
                const keeps    = this.calculateKeepSegments(silences, duration);

                if (lastSilenceEnd < duration - 0.1) {
                    this.emit('segment', { type: 'keep', start: lastSilenceEnd, end: duration });
                }

                this.emit('complete');
                resolve({ silences, keeps, duration, fps });
            });

            ffmpeg.on('error', (err) => {
                this.activeProcess = null;
                reject(err);
            });
        });
    }

    stop() {
        if (this.activeProcess) {
            this.activeProcess.kill('SIGKILL');
            this.activeProcess = null;
        }
    }

    parseSilenceLogs(log, totalDuration) {
        const silences = [];
        const startRegex = /silence_start:\s*([\d.]+)/g;
        const endRegex   = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;

        let match;
        const starts = [];
        while ((match = startRegex.exec(log)) !== null) starts.push(parseFloat(match[1]));

        let i = 0;
        while ((match = endRegex.exec(log)) !== null) {
            const end = parseFloat(match[1]);
            const duration = parseFloat(match[2]);
            const start = (starts[i] !== undefined) ? starts[i] : (end - duration);
            silences.push({ start, end, duration });
            i++;
        }
        return silences;
    }

    calculateKeepSegments(silences, totalDuration) {
        if (silences.length === 0) return { segments: [{ start: 0, end: totalDuration }], total: totalDuration };

        let keeps = [];
        let lastEnd = 0;

        silences.forEach(s => {
            let keepStart = lastEnd;
            let keepEnd   = s.start;
            
            // Add padding
            keepStart = Math.max(0, keepStart - (lastEnd === 0 ? 0 : this.paddingAfter));
            keepEnd   = Math.min(totalDuration, keepEnd + this.paddingBefore);

            if (keepEnd - keepStart > 0.01) {
                keeps.push({ start: keepStart, end: keepEnd });
            }
            lastEnd = s.end;
        });

        // Final segment
        let finalStart = lastEnd - this.paddingAfter;
        if (finalStart < totalDuration - 0.05) {
            keeps.push({ start: Math.max(0, finalStart), end: totalDuration });
        }

        // Merge logic
        if (keeps.length <= 1) return { segments: keeps, total: keeps.reduce((acc, k) => acc + (k.end - k.start), 0) };

        let merged = [];
        let current = keeps[0];

        for (let i = 1; i < keeps.length; i++) {
            let next = keeps[i];
            let gap = next.start - current.end;

            if (gap <= this.mergeGap) {
                current.end = next.end;
            } else {
                if (current.end - current.start >= this.minClipLength) {
                    merged.push(current);
                }
                current = next;
            }
        }
        if (current.end - current.start >= this.minClipLength) merged.push(current);

        return {
            segments: merged,
            total: merged.reduce((acc, k) => acc + (k.end - k.start), 0)
        };
    }
}

module.exports = SilenceDetector;
