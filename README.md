# Photobooth WebApp

Photobooth berbasis browser. File disimpan di **Google Drive**, backend memakai **Google Apps Script (GAS)**, dan website di-host di **Netlify**.

```
kiosk/   → halaman photobooth untuk tamu (kamera, preview, QR)
admin/   → panel admin / Gallery (sesi, antrian print)
gas/     → kode backend Google Apps Script
```

| Halaman | URL (Netlify) |
|---|---|
| Kiosk | `/` (otomatis ke `/kiosk/home.html`) |
| Admin | `/admin` |

---

## Bekerja dengan Google Apps Script (GAS)

Kode GAS disimpan di folder `gas/` dan dikirim ke Google memakai **clasp** (alat resmi Google).
Dengan cara ini kode backend ikut tersimpan di GitHub dan tidak akan hilang lagi.

### Persiapan (sekali saja)

Butuh **Node.js** (sudah terpasang kalau `node -v` di terminal menampilkan versi).

1. **Aktifkan Apps Script API** untuk akunmu:
   buka https://script.google.com/home/usersettings lalu nyalakan **Google Apps Script API**.

2. **Login clasp** (akan membuka browser untuk login Google):
   ```bash
   npm run gas:login
   ```

3. **Cari ID proyek GAS** yang sedang dipakai:
   ```bash
   npm run gas:list
   ```
   Hasilnya berupa daftar `nama proyek – https://script.google.com/d/<SCRIPT_ID>/edit`.
   Bisa juga dilihat di editor Apps Script: **Project Settings (ikon ⚙️) → IDs → Script ID**.

4. Buka file `.clasp.json`, ganti `ISI_SCRIPT_ID_DI_SINI` dengan Script ID tersebut.

5. **Ambil kode terbaru dari Google** (sekaligus mengambil `appsscript.json`):
   ```bash
   npm run gas:pull
   ```

### Setup backend (sekali, setelah `gas:push` pertama)

1. `npm run gas:open` → buka file **Setup.gs** → pilih fungsi **setup** di toolbar → klik ▶ **Run**.
   Pertama kali Google meminta izin akses Drive & Sheets → pilih akunmu → **Allow**
   (kalau muncul "Google hasn't verified this app": **Advanced → Go to … (unsafe)** — aman, ini script milikmu sendiri).
2. Fungsi ini membuat folder **Photobooth** (berisi `Sessions/`, `Frames/`) dan spreadsheet **Photobooth Database** di Drive.
3. **Project Settings (⚙️) → Script Properties → Add script property**:
   `ADMIN_PASSWORD` = password untuk login halaman admin.

### Memindahkan sesi dari akun Google lama

1. Login ke **akun lama** → buka folder sesi lama di Drive → **Share** → tambahkan email akun baru sebagai **Viewer**.
2. Di editor Apps Script (akun baru): buka **Migration.gs** → pilih fungsi **migrateLegacySessions** → ▶ **Run**.
3. Kalau log menulis *"Belum selesai"*, klik **Run** lagi sampai muncul *"Selesai"*.
   File disalin (bukan dipindah), jadi data di akun lama tetap utuh.

### Tes backend

```bash
npm test
```
Menjalankan seluruh API (`gas/`) dengan layanan Google tiruan, tanpa menyentuh Drive asli.

### Alur kerja sehari-hari

| Langkah | Perintah |
|---|---|
| Lihat file apa saja yang akan dikirim | `npm run gas:status` |
| Kirim kode dari `gas/` ke Google | `npm run gas:push` |
| Buka editor Apps Script di browser | `npm run gas:open` |
| Lihat daftar deployment | `npm run gas:deployments` |

> ⚠️ `gas:push` **menimpa** semua kode di proyek Apps Script dengan isi folder `gas/`.
> Kalau pernah mengedit langsung di editor web, jalankan `npm run gas:pull` dulu.

### Menerapkan perubahan ke URL web app (deploy)

`gas:push` hanya mengubah kode di editor. URL `/exec` yang dipakai website **baru berubah setelah deploy ulang**:

1. `npm run gas:open` → di editor klik **Deploy → Manage deployments**.
2. Klik ikon ✏️ (**Edit**) pada deployment yang sudah ada.
3. **Version** → pilih **New version** → **Deploy**.

Pakai **Edit** (bukan *New deployment*) supaya URL `/exec` tetap sama.
Pastikan pengaturan deployment:

- **Execute as:** Me
- **Who has access:** Anyone

Kalau *Who has access* bukan **Anyone**, website akan mendapat error **403** saat memanggil GAS.

---

## Kiosk (`/kiosk/`)

Alur tamu: **Mulai → pilih frame → foto (hitung mundur, otomatis) → review & ulangi → QR** → kembali ke awal.

- **Pairing (sekali per perangkat):** buka `/kiosk/` → masukkan nama perangkat + kode 6 digit.
  Sebelum halaman admin baru jadi, kode bisa dibuat dari editor Apps Script: buka **Setup.gs** →
  pilih fungsi **buatKodePairing** → ▶ Run → lihat kodenya di *Execution log* (berlaku 10 menit).
- **Tahan internet putus:** setiap sesi disimpan dulu di perangkat (IndexedDB), lalu diupload di
  belakang layar. QR langsung muncul; kalau internet putus atau halaman di-refresh, upload melanjutkan sendiri.
- **Pengaturan tersembunyi:** tekan lama 2 detik pada judul di halaman awal → status upload,
  coba upload lagi, layar penuh, putuskan kiosk.
- **Ubah nama acara, logo, durasi hitung mundur, dll.:** `kiosk/js/config.js`.
- Kalau belum ada template di admin, kiosk memakai frame bawaan `kiosk/assets/frame.png`.
- Foto **tidak di-mirror**: yang terlihat di layar sama dengan hasil foto.

Disarankan membuka kiosk di Chrome mode kiosk supaya layar penuh dan tidak bisa keluar:
```bash
chrome --kiosk https://<situs-netlify>/kiosk/
```

---

## Deploy website (Netlify)

Netlify menyajikan repo ini apa adanya (lihat `netlify.toml`), tanpa proses build.
Folder `gas/` dan file konfigurasi diblokir supaya tidak bisa diakses publik.
