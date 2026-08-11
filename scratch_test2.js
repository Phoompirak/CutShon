const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Test select filter
console.log('Exporting using select filter...');
const expr = "between(t,1.5,3.5)+between(t,6.5,8.5)";
try {
    execSync(`"${ffmpegPath}" -i D:/CutShon/testsrc.mp4 -vf "select='${expr}',setpts=N/FRAME_RATE/TB" -c:v libx264 -preset ultrafast D:/CutShon/test_export_select.mp4 -y`, { stdio: 'inherit' });
    console.log('Done!');
} catch (e) {
    console.error(e.message);
}
