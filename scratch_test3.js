const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

const listTxt = `file 'D:/CutShon/testsrc.mp4'
inpoint 1.5
outpoint 3.5
file 'D:/CutShon/testsrc.mp4'
inpoint 6.5
outpoint 8.5`;
fs.writeFileSync('D:/CutShon/test_concat.txt', listTxt);

console.log('Exporting using concat demuxer + setpts...');
try {
    execSync(`"${ffmpegPath}" -f concat -safe 0 -i D:/CutShon/test_concat.txt -vf "setpts=N/FRAME_RATE/TB" -af "asetpts=N/SR/TB" -c:v libx264 -preset ultrafast D:/CutShon/test_export_concat.mp4 -y`, { stdio: 'inherit' });
    console.log('Done!');
} catch (e) {
    console.error(e.message);
}
