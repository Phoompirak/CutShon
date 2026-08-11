# 🔥 CutShon — Professional Dead Air Cutter

[![Download Windows](https://img.shields.io/badge/Download-Windows-blue?style=for-the-badge&logo=windows)](https://github.com/Phoompirak/CutShon/releases)

CutShon is a high-performance application designed for video editors to automatically detect and remove \"dead air\" (silence) from video and audio files. Now available as a **Standalone Windows App**!

---

## 📥 Download (Windows)

1. Go to the [Releases](https://github.com/Phoompirak/CutShon/releases) page.
2. Download the `CutShon_x.x.x_x64_en-US.msi` or `.exe` file.
3. Install and run. **No Node.js or FFmpeg installation required!**

---

## ✨ Features

- **Automated Silence Detection**: High-precision analysis of audio waveforms.
- **Standalone App**: Powered by Tauri, includes bundled FFmpeg.
- **Mobile Ready**: Built with Capacitor for Android deployment.
- **Pro Export Options**: Premiere Pro XML, EDL, and direct MP4/MOV/MP3 export.
- **Bilingual**: Supports English and Thai.

---

## 🚀 Quick Start (For Developers)

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [Rust](https://www.rust-lang.org/) (For building the Windows app)
- [Android Studio](https://developer.android.com/studio) (For Android)

### Development
1. `npm install`
2. `npm run dev` (Web)
3. `npm run tauri dev` (Windows Desktop)

---

# 🔥 CutShon — ระบบตัดช่วงเงียบระดับมืออาชีพ

[![ดาวน์โหลดสำหรับ Windows](https://img.shields.io/badge/ดาวน์โหลด-Windows-blue?style=for-the-badge&logo=windows)](https://github.com/Phoompirak/CutShon/releases)

CutShon คือเครื่องมือสำหรับนักตัดต่อวิดีโอ เพื่อตรวจจับและตัด \"ช่วงเงียบ\" (Dead Air) ออกอัตโนมัติ ตอนนี้รองรับการใช้งานเป็น **โปรแกรมบน Windows** แล้ว!

## 📥 วิธีดาวน์โหลด (Windows)

1. เข้าไปที่หน้า [Releases](https://github.com/Phoompirak/CutShon/releases)
2. โหลดไฟล์ `CutShon_x.x.x_x64_en-US.msi` หรือ `.exe`
3. ติดตั้งแล้วใช้งานได้ทันที **ไม่ต้องลง Node.js หรือ FFmpeg เพิ่มเอง!**

## 🛠 Tech Stack
- **Desktop**: Tauri (Rust + JavaScript)
- **Mobile**: Capacitor
- **Core**: FFmpeg

---

## 📦 How to Create a New Release (Automated Build)

When you want to release a new version (e.g. `v0.2.2`), run the following commands in your terminal:

```bash
# 1. Stage and commit your changes
git add .
git commit -m "release: v0.2.2"

# 2. Push latest code to main branch
git push origin main

# 3. Create and push a new Git tag to trigger auto-build & release
git tag v0.2.2
git push origin v0.2.2
```

> **Note**: GitHub Actions will automatically build the Windows installer (`.exe` / `.msi`) and Android APK (`.apk`), then publish them to the GitHub Releases page.

---

## 📦 วิธีสร้าง Release เวอร์ชั่นใหม่ (Build อัตโนมัติ)

เมื่อต้องการปล่อยเวอร์ชันใหม่ (เช่น `v0.2.2`) ให้รันคำสั่งด้านล่างใน Terminal:

```bash
# 1. Commit งานทั้งหมดที่แก้ไข
git add .
git commit -m "release: v0.2.2"

# 2. Push โค้ดขึ้น branch main
git push origin main

# 3. ติด Tag เวอร์ชั่นใหม่แล้ว Push ขึ้น GitHub เพื่อเริ่ม Build อัตโนมัติ
git tag v0.2.2
git push origin v0.2.2
```

> **หมายเหตุ**: ระบบ GitHub Actions จะทำการ Build ไฟล์ติดตั้งสำหรับ Windows (`.exe` / `.msi`) และ Android (`.apk`) แล้วอัปโหลดขึ้นหน้า GitHub Releases ให้อัตโนมัติครับ

---

## 🐳 Docker Support (Run Anywhere)

You can run CutShon inside a Docker container on any OS (Linux, macOS, Windows) without installing Node.js or FFmpeg manually.

### Using Docker Compose (Recommended)

```bash
# Start container
docker compose up -d

# Open in browser
http://localhost:3000
```

### Using Docker CLI directly

```bash
# Build image
docker build -t cutshon .

# Run container
docker run -d -p 3000:3000 --name cutshon cutshon
```

---

## 🐳 การใช้งานด้วย Docker (รันได้ทุกเครื่อง)

คุณสามารถนำ CutShon ไปรันบนเครื่องอื่นผ่าน Docker ได้ทันทีโดยไม่ต้องติดตั้ง Node.js หรือ FFmpeg ในเครื่องเป้าหมาย

```bash
# สั่ง Build และรันใน background
docker compose up -d

# เข้าใช้งานผ่าน Web Browser
http://localhost:3000
```


