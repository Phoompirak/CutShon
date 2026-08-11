const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const isPkg = typeof process.pkg !== 'undefined';
const exeDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

let ffmpegPath = null;
let ffprobePath = null;

if (!isPkg) {
    // 1. Try ffmpeg-static
    try {
        const ffmpegStatic = require('ffmpeg-static');
        if (ffmpegStatic && fs.existsSync(ffmpegStatic)) ffmpegPath = ffmpegStatic;
    } catch (_) {}

    // 2. Try @ffprobe-installer/ffprobe
    try {
        const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
        if (ffprobeInstaller && ffprobeInstaller.path && fs.existsSync(ffprobeInstaller.path)) {
            ffprobePath = ffprobeInstaller.path;
        }
    } catch (_) {}
}

// 3. Fallback candidates
if (!ffmpegPath) {
    const candidates = [
        path.join(exeDir, 'ffmpeg.exe'),
        path.join(exeDir, 'ffmpeg'),
        path.join(exeDir, 'ffmpeg-x86_64-pc-windows-msvc.exe'),
        path.join(exeDir, 'src-tauri', 'bin', 'ffmpeg-x86_64-pc-windows-msvc.exe'),
        path.join(exeDir, 'bin', 'ffmpeg.exe')
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            ffmpegPath = c;
            break;
        }
    }
}

if (!ffprobePath) {
    const candidates = [
        path.join(exeDir, 'ffprobe.exe'),
        path.join(exeDir, 'ffprobe'),
        path.join(exeDir, 'ffprobe-x86_64-pc-windows-msvc.exe'),
        path.join(exeDir, 'src-tauri', 'bin', 'ffprobe-x86_64-pc-windows-msvc.exe'),
        path.join(exeDir, 'bin', 'ffprobe.exe')
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            ffprobePath = c;
            break;
        }
    }
}

ffmpegPath = ffmpegPath || 'ffmpeg';
ffprobePath = ffprobePath || 'ffprobe';

/**
 * Set process priority to BELOW_NORMAL so Windows dwm.exe & UI stay responsive
 */
function setLowPriority(child) {
    if (!child || !child.pid) return;
    try {
        const priority = os.constants && os.constants.priority
            ? os.constants.priority.PRIORITY_BELOW_NORMAL
            : 10;
        os.setPriority(child.pid, priority);
    } catch (_) {}
}

/**
 * Non-blocking async wrapper for execFile
 */
function execFileAsync(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, options, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({ stdout: stdout ? stdout.toString() : '', stderr: stderr ? stderr.toString() : '' });
        });
    });
}

module.exports = {
    ffmpegPath,
    ffprobePath,
    setLowPriority,
    execFileAsync
};
