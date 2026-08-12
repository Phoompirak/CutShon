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

    test('POST /api/upload-path with invalid path should return error', async () => {
        const res = await request(app)
            .post('/api/upload-path')
            .send({ filePath: 'non_existent_file.mp4' });
        expect(res.statusCode).toBe(404);
        expect(res.body.error).toContain('File not found');
    });

    test('POST /api/upload-path with valid file path should create session', async () => {
        const path = require('path');
        const samplePath = path.join(__dirname, '..', 'testsrc.mp4');
        const res = await request(app)
            .post('/api/upload-path')
            .send({ filePath: samplePath });
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('sessionId');
        expect(res.body).toHaveProperty('fileUrl');
    });
});
