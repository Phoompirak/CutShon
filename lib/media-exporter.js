const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { ffmpegPath, setLowPriority } = require('./ffmpeg-helper');

const fmtTime = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
    return h > 0
        ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
        : `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
};

class MediaExporter {
    static exportMedia(inputPath, segments, format, originalName, hwEncoder = null, onProgress = null) {
        return new Promise((resolve, reject) => {
            const jobId = uuidv4();
            const outputExt = format === 'mp3' ? '.mp3' : format === 'mov' ? '.mov' : '.mp4';
            
            const APP_DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'CutShon');
            const outputPath = path.join(APP_DATA_DIR, 'output', `${jobId}${outputExt}`);
            const filterFilePath = path.join(APP_DATA_DIR, 'uploads', `${jobId}_filter.txt`);
            
            const finalFilename = `${path.parse(originalName).name}_cut${outputExt}`;
            const totalKeepDur = segments.reduce((s, x) => s + (x.end - x.start), 0);

            const encoderLabel = (hwEncoder || 'cpu').toUpperCase();
            console.log(`[export] ${path.basename(originalName)}  ${encoderLabel}  ${format.toUpperCase()}  ${segments.length} seg  ${fmtTime(totalKeepDur)}`);

            const absoluteInputPath = path.resolve(inputPath);
            const safeInputPath = absoluteInputPath.replace(/\\/g, '/');

            // Build 'select' expression
            const exprParts = segments.map(s => `between(t,${s.start},${s.end})`);
            const expr = exprParts.join('+');

            let filterContent = '';
            let mapArgs = [];

            if (format !== 'mp3') {
                filterContent += `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB[outv];\n`;
                filterContent += `[0:a]aselect='${expr}',asetpts=N/SR/TB[outa]`;
                mapArgs = ['-filter_complex_script', filterFilePath, '-map', '[outv]', '-map', '[outa]'];
            } else {
                filterContent += `[0:a]aselect='${expr}',asetpts=N/SR/TB[outa]`;
                mapArgs = ['-filter_complex_script', filterFilePath, '-map', '[outa]'];
            }

            fs.writeFileSync(filterFilePath, filterContent, 'utf8');

            const baseArgs = buildEncoderArgs(format, hwEncoder, mapArgs, outputPath);
            const ffmpegArgs = [
                '-i', safeInputPath,
                ...baseArgs
            ];

            const ffmpeg = spawn(ffmpegPath, ffmpegArgs);
            setLowPriority(ffmpeg);
            let errorLog = '';
            let progressLineActive = false;

            ffmpeg.stderr.on('data', (data) => {
                const str = data.toString();
                errorLog += str;

                const timeMatch = str.match(/time=(\d+):(\d+):(\d+[.,]\d+)/);
                if (timeMatch && totalKeepDur > 0) {
                    const currentSecs = parseFloat(timeMatch[1]) * 3600 + parseFloat(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
                    const percent = Math.min(99, Math.round((currentSecs / totalKeepDur) * 100));
                    if (onProgress) onProgress(percent);

                    const fps = (str.match(/fps=\s*(\d+)/) || [])[1] || '';
                    const speed = (str.match(/speed=\s*([\d.]+x)/) || [])[1] || '';
                    const bar = '█'.repeat(Math.floor(percent / 5)).padEnd(20, '░');
                    process.stdout.write(`\r[export] ${String(percent).padStart(3)}% ${bar}  ${fmtTime(currentSecs)} / ${fmtTime(totalKeepDur)}${fps ? `  ${fps}fps` : ''}${speed ? `  ${speed}` : ''}   `);
                    progressLineActive = true;
                }
            });

            ffmpeg.on('close', (code) => {
                if (progressLineActive) process.stdout.write('\n');
                try { fs.unlinkSync(filterFilePath); } catch (_) {}

                if (code === 0) {
                    if (onProgress) onProgress(100);
                    console.log(`[export] done  →  ${finalFilename}`);
                    resolve({ path: outputPath, filename: finalFilename });
                } else {
                    console.error(`[export] failed (code ${code})\n${errorLog.slice(-800)}`);
                    reject(new Error(`FFmpeg export failed with code ${code}.`));
                }
            });

            ffmpeg.on('error', (err) => {
                if (progressLineActive) process.stdout.write('\n');
                try { fs.unlinkSync(filterFilePath); } catch (_) {}
                reject(err);
            });
        });
    }
}

function buildEncoderArgs(format, hwEncoder, mapArgs, outputPath) {
    if (format === 'mp3') {
        return [...mapArgs, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-ar', '48000', '-id3v2_version', '3', outputPath];
    }
    if (format === 'mov') {
        return [...mapArgs, '-c:v', 'qtrle', '-c:a', 'pcm_s16le', '-ar', '48000', '-pix_fmt', 'argb', outputPath];
    }
    if (hwEncoder === 'nvenc') {
        return [...mapArgs, '-c:v', 'h264_nvenc', '-rc', 'vbr', '-cq', '20', '-preset', 'p4',
                '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-movflags', '+faststart',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-max_interleave_delta', '0', '-max_muxing_queue_size', '4096', outputPath];
    }
    if (hwEncoder === 'amf') {
        return [...mapArgs, '-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'vbr_latency',
                '-qp_i', '20', '-qp_p', '22', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr',
                '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-max_interleave_delta', '0', '-max_muxing_queue_size', '4096', outputPath];
    }
    if (hwEncoder === 'qsv') {
        return [...mapArgs, '-c:v', 'h264_qsv', '-global_quality', '20', '-pix_fmt', 'yuv420p',
                '-fps_mode', 'cfr', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k',
                '-ar', '48000', '-ac', '2', '-max_interleave_delta', '0',
                '-max_muxing_queue_size', '4096', outputPath];
    }
    // CPU fallback — leave at least 2 cores free for system responsiveness
    const maxCpuThreads = Math.max(1, (os.cpus()?.length || 4) - 2);
    return [...mapArgs, '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-threads', String(maxCpuThreads),
            '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1', '-fps_mode', 'cfr',
            '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-max_interleave_delta', '0', '-max_muxing_queue_size', '4096', outputPath];
}

module.exports = MediaExporter;
