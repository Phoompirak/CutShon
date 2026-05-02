const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

class MediaExporter {
    static async exportMedia(inputPath, segments, format, originalName, hwEncoder = null, onProgress = null) {
        return new Promise((resolve, reject) => {
            const jobId = uuidv4();
            const outputExt = format === 'mp3' ? '.mp3' : format === 'mov' ? '.mov' : '.mp4';
            const outputPath = path.join('output', `${jobId}${outputExt}`);
            const listPath = path.join('uploads', `${jobId}_list.txt`);

            // Calculate total expected duration
            const totalDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);

            // Generate concat demuxer file
            let listContent = '';
            const absoluteInputPath = path.resolve(inputPath);
            const safeInputPath = absoluteInputPath.replace(/\\/g, '/');
            
            for (const seg of segments) {
                listContent += `file '${safeInputPath}'\n`;
                listContent += `inpoint ${seg.start}\n`;
                listContent += `outpoint ${seg.end}\n`;
            }
            fs.writeFileSync(listPath, listContent);

            let ffmpegArgs = [];
            
            if (format === 'mp3') {
                ffmpegArgs = [
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-vn',                       // no video
                    '-c:a', 'libmp3lame',
                    '-q:a', '2',                 // ~190kbps VBR (transparent quality)
                    '-ar', '48000',
                    '-id3v2_version', '3',
                    outputPath
                ];
            } else if (format === 'mov') {
                // ProRes 4444 with alpha — broadcast-grade for Premiere/FCP
                ffmpegArgs = [
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-c:v', 'qtrle',             // QT Animation (supports alpha)
                    '-c:a', 'pcm_s16le',         // uncompressed audio for editing
                    '-ar', '48000',
                    '-pix_fmt', 'argb',
                    outputPath
                ];
            } else if (hwEncoder === 'nvenc') {
                // NVIDIA GPU path — 6–10× faster than CPU
                ffmpegArgs = [
                    '-fflags', '+genpts+igndts',
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-avoid_negative_ts', 'make_zero',
                    '-c:v', 'h264_nvenc',
                    '-rc', 'vbr',
                    '-cq', '20',
                    '-preset', 'p4',
                    '-pix_fmt', 'yuv420p',
                    '-fps_mode', 'cfr',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    '-max_interleave_delta', '0',
                    '-max_muxing_queue_size', '4096',
                    outputPath
                ];
            } else if (hwEncoder === 'amf') {
                // AMD GPU path
                ffmpegArgs = [
                    '-fflags', '+genpts+igndts',
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-avoid_negative_ts', 'make_zero',
                    '-c:v', 'h264_amf',
                    '-quality', 'balanced',
                    '-rc', 'vbr_latency',
                    '-qp_i', '20', '-qp_p', '22',
                    '-pix_fmt', 'yuv420p',
                    '-fps_mode', 'cfr',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    '-max_interleave_delta', '0',
                    '-max_muxing_queue_size', '4096',
                    outputPath
                ];
            } else if (hwEncoder === 'qsv') {
                // Intel QuickSync path
                ffmpegArgs = [
                    '-fflags', '+genpts+igndts',
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-avoid_negative_ts', 'make_zero',
                    '-c:v', 'h264_qsv',
                    '-global_quality', '20',
                    '-pix_fmt', 'yuv420p',
                    '-fps_mode', 'cfr',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    '-max_interleave_delta', '0',
                    '-max_muxing_queue_size', '4096',
                    outputPath
                ];
            } else {
                // CPU fallback — preset fast (~35% faster than medium, imperceptible quality diff at CRF 20)
                ffmpegArgs = [
                    '-fflags', '+genpts+igndts',
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-avoid_negative_ts', 'make_zero',
                    '-c:v', 'libx264',
                    '-crf', '20',
                    '-preset', 'fast',
                    '-threads', '0',
                    '-pix_fmt', 'yuv420p',
                    '-profile:v', 'high',
                    '-level', '4.1',
                    '-fps_mode', 'cfr',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    '-max_interleave_delta', '0',
                    '-max_muxing_queue_size', '4096',
                    outputPath
                ];
            }

            const ffmpeg = spawn('ffmpeg', ffmpegArgs);
            let errorLog = '';

            ffmpeg.stderr.on('data', (data) => {
                const str = data.toString();
                errorLog += str;
                
                // PROGRESS PARSING: time=00:00:00.00
                const timeMatch = str.match(/time=(\d+):(\d+):(\d+.\d+)/);
                if (timeMatch && onProgress && totalDuration > 0) {
                    const hours = parseFloat(timeMatch[1]);
                    const mins  = parseFloat(timeMatch[2]);
                    const secs  = parseFloat(timeMatch[3]);
                    const currentSecs = (hours * 3600) + (mins * 60) + secs;
                    const percent = Math.min(99, Math.round((currentSecs / totalDuration) * 100));
                    onProgress(percent);
                }

                // FILTER SPAM: Hide repetitive DTS warnings to keep logs readable
                if (str.includes('Non-monotonous DTS') || str.includes('Queue input is backward')) {
                    return; 
                }
                
                console.log('[ffmpeg export]', str.trim());
            });

            ffmpeg.on('close', (code) => {
                // Cleanup temp list file
                if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
                
                if (code === 0) {
                    if (onProgress) onProgress(100);
                    const finalFilename = `${path.parse(originalName).name}_cut${outputExt}`;
                    resolve({ path: outputPath, filename: finalFilename });
                } else {
                    reject(new Error(`FFmpeg export failed with code ${code}.`));
                }
            });
            
            ffmpeg.on('error', (err) => {
                if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
                reject(err);
            });
        });
    }
}

module.exports = MediaExporter;
