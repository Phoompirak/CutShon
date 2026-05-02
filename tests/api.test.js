const request = require('supertest');
const app = require('../server');

describe('API Endpoints', () => {
    test('GET / should serve the frontend', async () => {
        const res = await request(app).get('/');
        expect(res.statusCode).toBe(200);
        expect(res.text).toContain('CutShon');
    });

    test('GET /api/waveform/nonexistent should return 404', async () => {
        const res = await request(app).get('/api/waveform/invalid-id');
        expect(res.statusCode).toBe(404);
        expect(res.body.error).toBe('Session not found');
    });

    test('POST /api/settings with invalid session should return 404', async () => {
        const res = await request(app)
            .post('/api/settings')
            .send({ sessionId: 'invalid', settings: {} });
        expect(res.statusCode).toBe(404);
    });
});
