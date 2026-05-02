// public/js/i18n.js

const translations = {
    en: {
        header_pro: "PRO",
        status_ready: "Ready",
        btn_export_edl_small: "Export EDL",
        queue_title: "Queue",
        auto_advance: "Auto-advance",
        drop_hint: "Drop more files anywhere",
        drop_title: "Drop your video or audio",
        drop_subtitle: "MP4 · MOV · MKV · MP3 · WAV · FLAC",
        btn_browse: "Browse Files",
        skip_silence_badge: "⏭ Skipping Silence",
        zoom_label: "Zoom",
        btn_play_pause_title: "Play / Pause (Space)",
        current_time_label: "Current Time",
        skip_silence_toggle: "Skip Silence",
        stat_original: "Original",
        stat_after: "After Cut",
        stat_saved: "Saved",
        stat_segments: "Segments",
        analyzing_text: "Analyzing…",
        params_title: "Parameters",
        preset_label: "Preset",
        threshold_label: "Silence Threshold",
        min_silence_label: "Min Silence Duration",
        pad_before_label: "Pad Before",
        pad_after_label: "Pad After",
        merge_gap_label: "Merge Gap",
        min_clip_label: "Min Clip",
        transition_label: "Transition Duration",
        transition_hint: "Cross Dissolve (XML only)",
        btn_reanalyze: "Re-Analyze",
        export_title: "Export",
        format_label: "Format",
        btn_export_now: "Export Now",
        footer_text: "CutShon — FFmpeg + EDL workflow",
        loader_working: "Working…",
        error_title: "Something went wrong",
        btn_copy_details: "Copy Details",
        btn_retry: "Retry",
        btn_close: "Close",
        err_process_title: "Failed to process file",
        err_process_msg: "Upload or waveform extraction failed.",
        err_upload_failed: "Upload failed",
        err_waveform_failed: "Waveform extraction failed",
        toast_export_started: "Export started...",
        toast_export_done: "Export complete!",
        status_analyzing: "Analyzing...",
        status_done: "Done",
        status_queued: "Queued",
        status_uploading: "Uploading...",
        status_waveform: "Building waveform...",
        status_ready_analyze: "Ready — analyze",
        status_error: "Error",
        error_unexpected: "An unexpected error occurred.",
        analysis_starting: "Starting analysis...",
        analysis_failed_status: "✗ Analysis failed",
        analysis_failed_title: "Analysis failed",
        analysis_done_count: "Done — {count} silence region(s)",
        status_ready_check: "Ready ✓",
        no_video_title: "No video selected",
        no_video_msg: "Please select a video from the queue before exporting.",
        analysis_incomplete_title: "Analysis not complete",
        analysis_incomplete_msg: "Run analysis to generate cut segments before exporting.",
        nothing_export_title: "Nothing to export",
        nothing_export_msg: "Analysis returned zero keep segments. Try a less aggressive Silence Threshold or Min Silence Duration.",
        export_encoding: "Encoding {format}...",
        export_done_download: "✓ Done — downloading...",
        export_failed_status: "✗ Failed",
        hint_quiet: "quiet",
        hint_loud: "loud",
        hint_aggressive: "aggressive",
        hint_conservative: "conservative",
        preset_natural: "🎙 Natural (Recommended)",
        preset_aggressive: "⚡ Aggressive",
        preset_conservative: "🌿 Conservative",
        preset_live: "🎤 Live / Noisy Room",
        preset_quiet: "🔇 Very Quiet Room",
        format_xml: "Premiere Pro XML (v24-26)",
        format_edl: "EDL (Legacy)",
        format_mp4: "MP4 Video (H.264)",
        format_mov: "MOV (Transparent / ProRes)",
        format_mp3: "MP3 Audio",
        nav_editor: "Editor",
        nav_queue: "Queue",
        nav_params: "Params"
    },
    th: {
        header_pro: "โปร",
        status_ready: "พร้อม",
        btn_export_edl_small: "ส่งออก EDL",
        queue_title: "คิว",
        auto_advance: "เล่นไฟล์ถัดไป",
        drop_hint: "ลากไฟล์มาวางเพื่อเพิ่มเข้าคิว",
        drop_title: "ลากไฟล์วิดีโอหรือเสียงมาวางที่นี่",
        drop_subtitle: "รองรับ MP4 · MOV · MKV · MP3 · WAV · FLAC",
        btn_browse: "เลือกไฟล์จากเครื่อง",
        skip_silence_badge: "⏭ กำลังข้ามช่วงเงียบ",
        zoom_label: "ซูม",
        btn_play_pause_title: "เล่น / หยุด (Space)",
        current_time_label: "เวลาปัจจุบัน",
        skip_silence_toggle: "ข้ามช่วงเงียบ",
        stat_original: "ต้นฉบับ",
        stat_after: "หลังตัด",
        stat_saved: "ประหยัดเวลา",
        stat_segments: "จำนวนคลิป",
        analyzing_text: "กำลังวิเคราะห์…",
        params_title: "ตั้งค่าพารามิเตอร์",
        preset_label: "พรีเซ็ต",
        threshold_label: "ระดับเสียงเงียบ (Threshold)",
        min_silence_label: "ระยะเวลาเงียบขั้นต่ำ",
        pad_before_label: "เผื่อเวลาก่อนหน้า",
        pad_after_label: "เผื่อเวลาหลัง",
        merge_gap_label: "รวมช่องว่าง",
        min_clip_label: "ความยาวคลิปขั้นต่ำ",
        transition_label: "ระยะเวลา Transition",
        transition_hint: "Cross Dissolve (เฉพาะ XML)",
        btn_reanalyze: "วิเคราะห์ใหม่",
        export_title: "ส่งออก",
        format_label: "รูปแบบไฟล์",
        btn_export_now: "ส่งออกทันที",
        footer_text: "CutShon — FFmpeg + EDL workflow",
        loader_working: "กำลังดำเนินการ…",
        error_title: "เกิดข้อผิดพลาด",
        btn_copy_details: "คัดลอกรายละเอียด",
        btn_retry: "ลองใหม่",
        btn_close: "ปิด",
        err_process_title: "การประมวลผลไฟล์ล้มเหลว",
        err_process_msg: "การอัปโหลดหรือการดึงข้อมูล Waveform ล้มเหลว",
        err_upload_failed: "อัปโหลดล้มเหลว",
        err_waveform_failed: "ดึงข้อมูล Waveform ล้มเหลว",
        toast_export_started: "เริ่มการส่งออก...",
        toast_export_done: "ส่งออกสำเร็จ!",
        status_analyzing: "กำลังวิเคราะห์...",
        status_done: "เสร็จสิ้น",
        status_queued: "อยู่ในคิว",
        status_uploading: "กำลังอัปโหลด...",
        status_waveform: "กำลังสร้าง Waveform...",
        status_ready_analyze: "พร้อม — รอวิเคราะห์",
        status_error: "เกิดข้อผิดพลาด",
        error_unexpected: "เกิดข้อผิดพลาดที่ไม่คาดคิด",
        analysis_starting: "กำลังเริ่มการวิเคราะห์...",
        analysis_failed_status: "✗ การวิเคราะห์ล้มเหลว",
        analysis_failed_title: "การวิเคราะห์ล้มเหลว",
        analysis_done_count: "เสร็จสิ้น — พบ {count} ช่วงเงียบ",
        status_ready_check: "พร้อมใช้งาน ✓",
        no_video_title: "ไม่ได้เลือกวิดีโอ",
        no_video_msg: "โปรดเลือกวิดีโอจากคิวก่อนทำการส่งออก",
        analysis_incomplete_title: "ยังไม่ได้วิเคราะห์",
        analysis_incomplete_msg: "โปรดรันการวิเคราะห์เพื่อกำหนดช่วงที่ต้องตัดก่อนส่งออก",
        nothing_export_title: "ไม่มีอะไรให้ส่งออก",
        nothing_export_msg: "ผลการวิเคราะห์ไม่พบช่วงที่ต้องเก็บไว้ โปรดลองปรับลดค่า Threshold หรือระยะเวลาเงียบขั้นต่ำ",
        export_encoding: "กำลังประมวลผล {format}...",
        export_done_download: "✓ เสร็จสิ้น — กำลังดาวน์โหลด...",
        export_failed_status: "✗ ล้มเหลว",
        hint_quiet: "เงียบ",
        hint_loud: "ดัง",
        hint_aggressive: "รวดเร็ว",
        hint_conservative: "นุ่มนวล",
        preset_natural: "🎙 ธรรมชาติ (แนะนำ)",
        preset_aggressive: "⚡ รวดเร็ว/ดุดัน",
        preset_conservative: "🌿 นุ่มนวล/อนุรักษ์นิยม",
        preset_live: "🎤 ไลฟ์สด/ห้องมีเสียงรบกวน",
        preset_quiet: "🔇 ห้องเงียบมาก",
        format_xml: "Premiere Pro XML (v24-26)",
        format_edl: "EDL (Legacy)",
        format_mp4: "วิดีโอ MP4 (H.264)",
        format_mov: "MOV (โปร่งใส / ProRes)",
        format_mp3: "เสียง MP3",
        nav_editor: "เครื่องมือ",
        nav_queue: "คิวไฟล์",
        nav_params: "ตั้งค่า"
    }
};

let currentLang = localStorage.getItem('cutshon_lang') || 'en';

function setLanguage(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    localStorage.setItem('cutshon_lang', lang);

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });

    // Update titles/placeholders if needed
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (translations[lang][key]) {
            el.setAttribute('title', translations[lang][key]);
        }
    });

    // Update button states
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    // Update HTML lang attribute
    document.documentElement.lang = lang;

    window.dispatchEvent(new CustomEvent('languageChanged', { detail: lang }));
}

function t(key) {
    return translations[currentLang][key] || key;
}

document.addEventListener('DOMContentLoaded', () => {
    // Inject switcher logic if buttons exist
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLanguage(btn.getAttribute('data-lang'));
        });
    });

    setLanguage(currentLang);
});
