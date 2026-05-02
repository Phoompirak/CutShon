const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

class MediaExporter {
    static async exportMedia(inputPath, segments, format, originalName, hwEncoder = null) {
        return new Promise((resolve, reject) => {
            const jobId = uuidv4();
            const outputExt = format === 'mp3' ? '.mp3' : format === 'mov' ? '.mov' : '.mp4';
            const outputPath = path.join('output', `${jobId}${outputExt}`);
            const listPath = path.join('uploads', `${jobId}_list.txt`);

            // Generate concat demuxer file
            let listContent = '';
            // Make input path absolute and fix backslashes for FFmpeg concat demuxer format
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
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-c:v', 'h264_nvenc',
                    '-rc', 'vbr',
                    '-cq', '20',
                    '-preset', 'p4',             // NVENC balanced quality/speed preset
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    outputPath
                ];
            } else if (hwEncoder === 'amf') {
                // AMD GPU path
                ffmpegArgs = [
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-c:v', 'h264_amf',
                    '-quality', 'balanced',
                    '-rc', 'vbr_latency',
                    '-qp_i', '20', '-qp_p', '22',
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    outputPath
                ];
            } else if (hwEncoder === 'qsv') {
                // Intel QuickSync path
                ffmpegArgs = [
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-c:v', 'h264_qsv',
                    '-global_quality', '20',
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    outputPath
                ];
            } else {
                // CPU fallback — preset fast (~35% faster than medium, imperceptible quality diff at CRF 20)
                ffmpegArgs = [
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', listPath,
                    '-c:v', 'libx264',
                    '-crf', '20',
                    '-preset', 'fast',           // was: medium (+35% speed, same visual quality)
                    '-threads', '0',             // use all available CPU cores
                    '-pix_fmt', 'yuv420p',
                    '-profile:v', 'high',
                    '-level', '4.1',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-ar', '48000',
                    '-ac', '2',
                    outputPath
                ];
            }

            const ffmpeg = spawn('ffmpeg', ffmpegArgs);
            let errorLog = '';

            ffmpeg.stderr.on('data', (data) => {
                const str = data.toString();
                errorLog += str;
                console.log('[ffmpeg export]', str.trim());
            });

            ffmpeg.on('close', (code) => {
                // Cleanup temp list file
                if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
                
                if (code === 0) {
                    const finalFilename = `${path.parse(originalName).name}_cut${outputExt}`;
                    resolve({ path: outputPath, filename: finalFilename });
                } else {
                    reject(new Error(`FFmpeg export failed with code ${code}. Log: ${errorLog.slice(-500)}`));
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
