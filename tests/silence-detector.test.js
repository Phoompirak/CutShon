const SilenceDetector = require('../lib/silence-detector');

describe('SilenceDetector', () => {
    let detector;

    beforeEach(() => {
        detector = new SilenceDetector({
            thresholdDb: -35,
            minSilence: 0.7,
            paddingBefore: 0.1,
            paddingAfter: 0.1,
            mergeGap: 0.3,
            minClipLength: 0.5
        });
    });

    test('should return whole duration if no silences found', () => {
        const silences = [];
        const result = detector.calculateKeepSegments(silences, 60);
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]).toEqual({ start: 0, end: 60 });
        expect(result.total).toBe(60);
    });

    test('should correctly identify keep segments between silences', () => {
        const silences = [
            { start: 10, end: 12, duration: 2 },
            { start: 20, end: 25, duration: 5 }
        ];
        const result = detector.calculateKeepSegments(silences, 30);
        
        // Expected segments:
        // 1. 0 to 10.1 (10 + 0.1 paddingBefore)
        // 2. 11.9 (12 - 0.1 paddingAfter) to 20.1 (20 + 0.1)
        // 3. 24.9 (25 - 0.1) to 30
        expect(result.segments).toHaveLength(3);
        expect(result.segments[0].start).toBe(0);
        expect(result.segments[0].end).toBeCloseTo(10.1);
        expect(result.segments[1].start).toBeCloseTo(11.9);
        expect(result.segments[1].end).toBeCloseTo(20.1);
        expect(result.segments[2].start).toBeCloseTo(24.9);
        expect(result.segments[2].end).toBe(30);
    });

    test('should merge segments if gap is smaller than mergeGap', () => {
        detector.mergeGap = 1.0;
        const silences = [
            { start: 10, end: 11, duration: 1 } // Gap between end of seg1 (10.1) and start of seg2 (10.9) is 0.8
        ];
        const result = detector.calculateKeepSegments(silences, 20);
        
        // Seg 1 ends at 10.1
        // Seg 2 starts at 10.9
        // Gap = 0.8 which is <= 1.0 mergeGap
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].start).toBe(0);
        expect(result.segments[0].end).toBe(20);
    });

    test('should filter out segments shorter than minClipLength', () => {
        detector.minClipLength = 2.0;
        const silences = [
            { start: 1, end: 10, duration: 9 }
        ];
        const result = detector.calculateKeepSegments(silences, 12);
        
        // Seg 1: 0 to 1.1 (Duration 1.1) -> Too short (< 2.0)
        // Seg 2: 9.9 to 12 (Duration 2.1) -> OK
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].start).toBeCloseTo(9.9);
        expect(result.segments[0].end).toBe(12);
    });
});
