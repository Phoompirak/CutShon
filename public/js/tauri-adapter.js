// tauri-adapter.js
// แซงหน้า fetch เพื่อให้ทำงานกับ Tauri Sidecar ได้โดยไม่ต้องมี Server
if (window.__TAURI_INTERNALS__) {
    const { Command } = window.__TAURI__.shell;
    
    // แทนที่ fetch เดิม
    const originalFetch = window.fetch;
    window.fetch = async (url, options) => {
        if (url.startsWith('/api/')) {
            console.log('Tauri Adapter intercepting:', url);
            // เดี๋ยวผมจะเพิ่ม Logic การจัดการ FFmpeg ตรงนี้ให้ครับ
            // สำหรับตอนนี้ให้มันพยายามเรียก Localhost:3000 ไปก่อนถ้าคุณรันคู่กัน
        }
        return originalFetch(url, options);
    };
}
