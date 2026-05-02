const EDLExporter = require('../lib/edl-exporter');

describe('EDLExporter', () => {
    test('toTimecode should convert seconds correctly', () => {
        // 1 hour, 2 minutes, 3 seconds, 15 frames @ 30fps
        const seconds = 3600 + 120 + 3 + (15/30);
        expect(EDLExporter.toTimecode(seconds, 30)).toBe('01:02:03:15');
    });

    test('generate should create valid EDL format', () => {
        const segments = [
            { start: 0, end: 10 },
            { start: 15, end: 25 }
        ];
        const edl = EDLExporter.generate(segments, 30, 'test.mp4');
        
        expect(edl).toContain('TITLE: CUTSHON EXPORT');
        expect(edl).toContain('001  AX       V     C        00:00:00:00 00:00:10:00 00:00:00:00 00:00:10:00');
        expect(edl).toContain('002  AX       V     C        00:00:15:00 00:00:25:00 00:00:10:00 00:00:20:00');
        expect(edl).toContain('* FROM CLIP NAME: test.mp4');
    });

    test('should handle fractional seconds in timecode', () => {
        // 0.5 seconds @ 24fps = 12 frames
        expect(EDLExporter.toTimecode(0.5, 24)).toBe('00:00:00:12');
    });
});
