const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

// 1. Create a 10-second test video
console.log('Generating testsrc.mp4...');
execSync(`"${ffmpegPath}" -f lavfi -i testsrc=duration=10:size=640x360:rate=30 -vf "drawtext=text='%{pts\\\\:hms}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" -c:v libx264 -pix_fmt yuv420p D:/CutShon/testsrc.mp4 -y`);

// 2. Create the concat list for testing inpoint/outpoint (extract 1s to 3s, and 6s to 8s)
const listTxt = `file 'D:/CutShon/testsrc.mp4'
inpoint 1.5
outpoint 3.5
file 'D:/CutShon/testsrc.mp4'
inpoint 6.5
outpoint 8.5`;
fs.writeFileSync('D:/CutShon/test_concat.txt', listTxt);

// 3. Run the export with concat demuxer and re-encoding
console.log('Exporting using concat demuxer...');
execSync(`"${ffmpegPath}" -f concat -safe 0 -i D:/CutShon/test_concat.txt -c:v libx264 -preset ultrafast D:/CutShon/test_export.mp4 -y`);

console.log('Done!');
