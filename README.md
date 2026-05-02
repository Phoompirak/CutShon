# 🔥 CutShon — Professional Dead Air Cutter

CutShon is a high-performance web application designed for video editors to automatically detect and remove "dead air" (silence) from video and audio files. It streamlines the rough-cut process by providing visual feedback and professional export options.

[ภาษาไทยด้านล่าง]

## ✨ Features

- **Automated Silence Detection**: High-precision analysis of audio waveforms to find silent segments.
- **Premium Interface**: Minimalist design with glassmorphism aesthetics, powered by Vanilla CSS.
- **High-Performance Waveform**: Visualizes long files instantly using server-side peak extraction.
- **Plyr.io Integration**: A clean, professional video player with speed control and PIP support.
- **Bilingual Support**: Full English and Thai interface (i18n).
- **Pro Export Options**:
  - **Adobe Premiere Pro XML**: Full non-destructive timeline with transitions.
  - **EDL (Edit Decision List)**: Compatible with most NLEs.
  - **Direct Export**: MP4, MOV, and MP3 via server-side FFmpeg processing.
- **Batch Processing**: Queue multiple files and process them in the background.

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [FFmpeg](https://ffmpeg.org/) installed and added to your system PATH.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/CutShon.git
   cd CutShon
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`.

---

# 🔥 CutShon — ระบบตัดช่วงเงียบระดับมืออาชีพ

CutShon คือเว็บแอปพลิเคชันประสิทธิภาพสูงสำหรับนักตัดต่อวิดีโอ เพื่อตรวจจับและตัด "ช่วงเงียบ" (Dead Air) ออกจากไฟล์วิดีโอและเสียงโดยอัตโนมัติ ช่วยลดเวลาในการทำ Rough-cut ด้วยระบบ Visual Feedback และการส่งออกไฟล์ระดับมืออาชีพ

## ✨ ฟีเจอร์เด่น

- **ตรวจจับช่วงเงียบอัตโนมัติ**: วิเคราะห์คลื่นเสียงความแม่นยำสูงเพื่อค้นหาช่วงที่ไม่มีเสียง
- **ดีไซน์ระดับพรีเมียม**: หน้าตาโปรแกรมสไตล์ Minimalist พร้อมเอฟเฟกต์ Glassmorphism
- **กราฟเสียงประสิทธิภาพสูง**: แสดงผลคลื่นเสียงขนาดใหญ่ได้ทันทีด้วยระบบ Server-side Peak
- **Plyr.io Video Player**: เครื่องเล่นวิดีโอที่สะอาดตา ปรับความเร็วได้ และรองรับ PIP
- **รองรับ 2 ภาษา**: เปลี่ยนสลับภาษาไทยและอังกฤษได้ทันที (i18n)
- **ตัวเลือกการส่งออก (Export)**:
  - **Adobe Premiere Pro XML**: ส่งออกเป็น Timeline ที่นำไปแก้ไขต่อได้ทันทีพร้อม Transition
  - **EDL**: รองรับโปรแกรมตัดต่อวิดีโอส่วนใหญ่
  - **ส่งออกไฟล์โดยตรง**: MP4, MOV และ MP3 ผ่านระบบ FFmpeg หลังบ้าน
- **ระบบคิว (Batch Processing)**: จัดการไฟล์หลายๆ ไฟล์พร้อมกันในคิวและประมวลผลเบื้องหลัง

---

## 🚀 การติดตั้งและใช้งาน

### สิ่งที่ต้องมีในเครื่อง

- [Node.js](https://nodejs.org/) (เวอร์ชัน 16 ขึ้นไป)
- [FFmpeg](https://ffmpeg.org/) (ต้องติดตั้งในเครื่องและตั้งค่า PATH ให้เรียบร้อย)

### ขั้นตอนการติดตั้ง

1. Clone โปรเจกต์:
   ```bash
   git clone https://github.com/yourusername/CutShon.git
   cd CutShon
   ```

2. ติดตั้ง Dependencies:
   ```bash
   npm install
   ```

3. รันโปรเจกต์ (โหมดพัฒนา):
   ```bash
   npm run dev
   ```

4. เข้าใช้งานผ่านเบราว์เซอร์ที่: `http://localhost:3000`

---

## 🛠 Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (Glassmorphism)
- **Backend**: Node.js, Express
- **Multimedia**: FFmpeg
- **Libraries**: WaveSurfer.js (Waveform), Plyr.io (Video Player)

## 📄 License

MIT License - feel free to use and contribute!
