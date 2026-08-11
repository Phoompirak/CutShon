const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

let exprParts = [];
for (let i = 0; i < 500; i++) {
    exprParts.push(`between(t,${1.5 + (i * 0.001)},${3.5 + (i * 0.001)})`);
}
const expr = exprParts.join('+');
const filterPath = 'D:/CutShon/test_filter.txt';
fs.writeFileSync(filterPath, `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB[outv]`);

console.log('Exporting using massive select filter...');
try {
    const start = Date.now();
    execSync(`"${ffmpegPath}" -i D:/CutShon/testsrc.mp4 -filter_complex_script ${filterPath} -map "[outv]" -c:v libx264 -preset ultrafast D:/CutShon/test_export_massive.mp4 -y`, { stdio: 'ignore' });
    console.log(`Done in ${Date.now() - start} ms`);
} catch (e) {
    console.error(e.message);
}
