// Pengaturan kiosk. Nama acara & logo diatur di shared/brand.js.
import { BRAND } from '../../shared/brand.js'

export const CONFIG = {
  // Tampilan halaman awal
  EVENT_NAME: BRAND.EVENT_NAME,
  EVENT_TAGLINE: BRAND.EVENT_TAGLINE,
  EVENT_LOGO: BRAND.EVENT_LOGO,

  // Waktu (detik)
  COUNTDOWN_SECONDS: 3,            // hitung mundur sebelum tiap foto
  AUTO_START_SECONDS: 10,          // kamera mulai memotret otomatis
  BETWEEN_SHOTS_MS: 900,           // jeda antar foto
  REVIEW_TIMEOUT_SECONDS: 60,      // review → otomatis lanjut
  DONE_TIMEOUT_SECONDS: 45,        // layar QR → kembali ke awal
  IDLE_TIMEOUT_SECONDS: 90,        // layar pilih frame tanpa aktivitas → kembali ke awal
  HEARTBEAT_SECONDS: 60,           // laporan status ke admin

  // Kualitas foto
  PHOTO_MAX_SIZE: 1600,            // sisi terpanjang foto mentah yang di-upload (px)
  PHOTO_QUALITY: 0.88,             // JPEG foto mentah
  FINAL_QUALITY: 0.92,             // JPEG hasil akhir (dengan frame)

  // Halaman download tamu (token dikirim lewat "#", tidak tercatat di log server)
  DOWNLOAD_PAGE: new URL('../download/', location.href).href
}
