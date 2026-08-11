const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '..', 'src-tauri', 'bin');
if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
}

console.log('[prepare-binaries] Locating FFmpeg and FFprobe...');

// 1. FFmpeg
let ffmpegSrc = null;
try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        ffmpegSrc = ffmpegStatic;
    }
} catch (e) {
    console.error('[prepare-binaries] Error resolving ffmpeg-static:', e.message);
}

// 2. FFprobe
let ffprobeSrc = null;
try {
    const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
    if (ffprobeInstaller && ffprobeInstaller.path && fs.existsSync(ffprobeInstaller.path)) {
        ffprobeSrc = ffprobeInstaller.path;
    }
} catch (e) {
    console.error('[prepare-binaries] Error resolving ffprobe-installer:', e.message);
}

const copyBinary = (src, name) => {
    if (!src) {
        console.warn(`[prepare-binaries] Warning: Could not find source for ${name}. Skipping.`);
        return;
    }
    const targetName = `${name}-x86_64-pc-windows-msvc.exe`;
    const targetPath = path.join(TARGET_DIR, targetName);
    
    console.log(`[prepare-binaries] Copying ${name} from ${src} to ${targetPath}`);
    try {
        fs.copyFileSync(src, targetPath);
        console.log(`[prepare-binaries] Successfully copied ${targetName}`);
    } catch (err) {
        console.error(`[prepare-binaries] Failed to copy ${name}:`, err);
    }
};

copyBinary(ffmpegSrc, 'ffmpeg');
copyBinary(ffprobeSrc, 'ffprobe');
console.log('[prepare-binaries] Done!');
