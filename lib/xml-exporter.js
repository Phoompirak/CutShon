const path = require('path');

/**
 * XML escaper for text inside FCP7 XML.
 * Premiere will refuse to import a doc with unescaped & < > inside <name> or <pathurl>.
 */
function xmlEscape(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Build a Premiere-friendly file:// URL for a given absolute path.
 * Premiere on Windows expects file://localhost/C:/path/to/file
 * Premiere on Mac/Linux expects file:///abs/path/to/file
 */
function buildPathUrl(absolutePath) {
    let p = absolutePath.replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(p)) {
        // Windows drive letter
        return 'file://localhost/' + encodeURI(p).replace(/'/g, '%27');
    }
    if (!p.startsWith('/')) p = '/' + p;
    return 'file://' + encodeURI(p).replace(/'/g, '%27');
}

class XMLExporter {
    /**
     * Generate Premiere Pro–compatible FCP7 XML (xmeml v4).
     * Tested with Premiere Pro 2024 / 2025 / 2026 (v24-v26).
     *
     * @param {Array}  segments       - [{start, end}, ...] keep ranges in seconds
     * @param {number} fps            - frames per second of the source
     * @param {string} originalName   - original filename (raw, will be escaped)
     * @param {number} totalDuration  - total source duration in seconds
     * @param {string} [absolutePath] - absolute path of the source on disk (optional but recommended)
     * @param {Object} [opts]         - { width, height, audioChannels, sampleRate }
     */
    static generate(segments, fps, originalName, totalDuration, absolutePath, opts = {}) {
        if (!segments || segments.length === 0) {
            throw new Error('No segments to export — analysis returned zero keep regions.');
        }
        if (!fps || !isFinite(fps) || fps <= 0) {
            throw new Error(`Invalid fps for XML export: ${fps}`);
        }

        const width  = opts.width  || 1920;
        const height = opts.height || 1080;
        const channels   = opts.audioChannels || 2;
        const sampleRate = opts.sampleRate    || 48000;

        const timebase = Math.round(fps);
        const ntsc = (Math.abs(fps - timebase) > 0.001) ? 'TRUE' : 'FALSE';
        const nameWithoutExt = path.parse(originalName).name;
        const escName = xmlEscape(originalName);
        const escSeqName = xmlEscape(nameWithoutExt + '_Cut');

        // Use absolute path if provided, else fall back to bare filename
        const pathUrl = absolutePath
            ? xmlEscape(buildPathUrl(absolutePath))
            : xmlEscape('file://localhost/' + originalName);

        const totalDurFrames = Math.max(1, Math.round(totalDuration * fps));

        // FCP7 XML rule: the FIRST clipitem of each track must embed the full <file>
        // definition inline (with <pathurl>, <rate>, <duration>, <media>). Later
        // clipitems can reference it by id only. Without this Premiere imports the
        // sequence but leaves every clip offline — timeline won't play.
        const fileFullDef = `<file id="file-1">
                <name>${escName}</name>
                <pathurl>${pathUrl}</pathurl>
                <rate>
                  <timebase>${timebase}</timebase>
                  <ntsc>${ntsc}</ntsc>
                </rate>
                <duration>${totalDurFrames}</duration>
                <media>
                  <video>
                    <samplecharacteristics>
                      <width>${width}</width>
                      <height>${height}</height>
                    </samplecharacteristics>
                  </video>
                  <audio>
                    <channelcount>${channels}</channelcount>
                  </audio>
                </media>
              </file>`;
        const fileRef = `<file id="file-1"/>`;
        let videoFileEmitted = false;
        const audioFileEmitted = { 1: false, 2: false };

        let videoClips = '';
        let audioClipsCh1 = '';
        let audioClipsCh2 = '';
        let timelineFrame = 0;

        segments.forEach((seg, index) => {
            const inFrame  = Math.max(0, Math.round(seg.start * fps));
            const outFrame = Math.min(totalDurFrames, Math.round(seg.end * fps));
            const dur      = outFrame - inFrame;
            if (dur <= 0) return;

            const start = timelineFrame;
            const end   = timelineFrame + dur;

            const videoFileTag = videoFileEmitted ? fileRef : fileFullDef;
            videoFileEmitted = true;

            videoClips += `
            <clipitem id="vclip-${index}">
              <name>${escName}</name>
              <enabled>TRUE</enabled>
              <duration>${totalDurFrames}</duration>
              <rate>
                <timebase>${timebase}</timebase>
                <ntsc>${ntsc}</ntsc>
              </rate>
              <start>${start}</start>
              <end>${end}</end>
              <in>${inFrame}</in>
              <out>${outFrame}</out>
              ${videoFileTag}
              <sourcetrack>
                <mediatype>video</mediatype>
              </sourcetrack>
            </clipitem>`;

            for (let ch = 1; ch <= channels; ch++) {
                const audioFileTag = audioFileEmitted[ch] ? fileRef : fileFullDef;
                audioFileEmitted[ch] = true;

                const block = `
            <clipitem id="aclip-${index}-${ch}">
              <name>${escName}</name>
              <enabled>TRUE</enabled>
              <duration>${totalDurFrames}</duration>
              <rate>
                <timebase>${timebase}</timebase>
                <ntsc>${ntsc}</ntsc>
              </rate>
              <start>${start}</start>
              <end>${end}</end>
              <in>${inFrame}</in>
              <out>${outFrame}</out>
              ${audioFileTag}
              <sourcetrack>
                <mediatype>audio</mediatype>
                <trackindex>${ch}</trackindex>
              </sourcetrack>
            </clipitem>`;
                if (ch === 1) audioClipsCh1 += block;
                else          audioClipsCh2 += block;
            }

            timelineFrame = end;

            // ── Add Transition (Cross Dissolve) between segments ──
            const transFrames = Math.round((opts.transitionSec || 0) * fps);
            if (transFrames > 0 && index < segments.length - 1) {
                const transStart = end - Math.floor(transFrames / 2);
                const transEnd   = transStart + transFrames;

                const videoTrans = `
            <transitionitem>
              <rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>
              <start>${transStart}</start>
              <end>${transEnd}</end>
              <alignment>center</alignment>
              <effect>
                <name>Cross Dissolve</name>
                <effectid>Cross Dissolve</effectid>
                <effectcategory>Dissolve</effectcategory>
                <effecttype>video-transition</effecttype>
                <mediatype>video</mediatype>
              </effect>
            </transitionitem>`;
                videoClips += videoTrans;

                const audioTrans = `
            <transitionitem>
              <rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>
              <start>${transStart}</start>
              <end>${transEnd}</end>
              <alignment>center</alignment>
              <effect>
                <name>Constant Power</name>
                <effectid>Audio Crossfade</effectid>
                <effectcategory>Crossfade</effectcategory>
                <effecttype>audio-transition</effecttype>
                <mediatype>audio</mediatype>
              </effect>
            </transitionitem>`;
                audioClipsCh1 += audioTrans;
                if (channels >= 2) audioClipsCh2 += audioTrans;
            }
        });

        const audioTracks = channels >= 2
            ? `<track>${audioClipsCh1}</track>\n        <track>${audioClipsCh2}</track>`
            : `<track>${audioClipsCh1}</track>`;

        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${escSeqName}</name>
    <duration>${timelineFrame}</duration>
    <rate>
      <timebase>${timebase}</timebase>
      <ntsc>${ntsc}</ntsc>
    </rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>${ntsc}</ntsc>
            </rate>
            <width>${width}</width>
            <height>${height}</height>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
            <colordepth>24</colordepth>
          </samplecharacteristics>
        </format>
        <track>${videoClips}
        </track>
      </video>
      <audio>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>${sampleRate}</samplerate>
          </samplecharacteristics>
        </format>
        ${audioTracks}
      </audio>
    </media>
  </sequence>
  <project>
    <name>${escSeqName}</name>
    <children>
      <file id="file-1">
        <name>${escName}</name>
        <pathurl>${pathUrl}</pathurl>
        <rate>
          <timebase>${timebase}</timebase>
          <ntsc>${ntsc}</ntsc>
        </rate>
        <duration>${totalDurFrames}</duration>
        <media>
          <video>
            <samplecharacteristics>
              <width>${width}</width>
              <height>${height}</height>
            </samplecharacteristics>
          </video>
          <audio>
            <channelcount>${channels}</channelcount>
          </audio>
        </media>
      </file>
    </children>
  </project>
</xmeml>`;
    }
}

module.exports = XMLExporter;
