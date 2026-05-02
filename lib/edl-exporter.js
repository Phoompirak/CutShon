/**
 * EDL Exporter for CMX 3600 format
 */
class EDLExporter {
    /**
     * Convert seconds to HH:MM:SS:FF timecode
     */
    static toTimecode(seconds, fps) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const f = Math.floor((seconds % 1) * fps);

        const pad = (n) => n.toString().padStart(2, '0');
        return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
    }

    /**
     * Generate CMX 3600 EDL content
     */
    static generate(segments, fps, filename = "Source") {
        let edl = `TITLE: CUTSHON EXPORT\n`;
        edl += `FCM: NON-DROP FRAME\n\n`;

        let recordStart = 0;

        segments.forEach((seg, index) => {
            const entryNum = (index + 1).toString().padStart(3, '0');
            const sourceStartTC = this.toTimecode(seg.start, fps);
            const sourceEndTC = this.toTimecode(seg.end, fps);
            
            const duration = seg.end - seg.start;
            const recordEndTC = this.toTimecode(recordStart + duration, fps);
            const recordStartTC = this.toTimecode(recordStart, fps);

            // Entry line
            // [Num] [Reel] [Track] [Edit] [SourceStart] [SourceEnd] [RecordStart] [RecordEnd]
            edl += `${entryNum}  AX       V     C        ${sourceStartTC} ${sourceEndTC} ${recordStartTC} ${recordEndTC}\n`;
            edl += `* FROM CLIP NAME: ${filename}\n\n`;

            recordStart += duration;
        });

        return edl;
    }
}

module.exports = EDLExporter;
