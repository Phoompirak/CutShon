// bridge.js - Universal Bridge for CutShon
const isTauri = !!window.__TAURI_INTERNALS__;
const isMobile = !!window.Capacitor;

export const Bridge = {
    async upload(file) {
        if (isTauri) {
            // ใน Tauri เราจะใช้พาธไฟล์ตรงๆ ได้เลย
            return { sessionId: 'local', filename: file.name, fileUrl: URL.createObjectURL(file) };
        }
        // ... โหมดปกติ
    },
    // เดี๋ยวผมจะเติม Logic อื่นๆ ให้ครบครับ
};
