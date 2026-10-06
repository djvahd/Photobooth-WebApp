/**
 * Setup.js — menyiapkan Drive & database. Jalankan SEKALI dari editor:
 *
 *   1. npm run gas:open  (atau buka https://script.google.com)
 *   2. Buka file "Setup.gs", pilih fungsi "setup" di toolbar atas, klik ▶ Run
 *   3. Pertama kali akan diminta izin akses Drive & Sheets → Allow
 *   4. Lihat hasilnya di "Execution log" di bagian bawah
 *
 * Aman dijalankan ulang: yang sudah ada tidak dibuat dua kali.
 *
 * Yang dibuat:
 *   Drive:  Photobooth/                (folder utama)
 *           Photobooth/Sessions/       (foto per sesi, dikelompokkan per tanggal)
 *           Photobooth/Frames/         (PNG frame template)
 *           Photobooth/Photobooth Database   (spreadsheet = database)
 *   Script Properties: ROOT_FOLDER_ID, SESSIONS_FOLDER_ID, FRAMES_FOLDER_ID, SPREADSHEET_ID
 *
 * Yang harus diisi MANUAL (Project Settings → Script Properties → Add):
 *   ADMIN_PASSWORD = password login halaman admin
 */

function setup() {
  // 1. folder Drive
  let root = folderFromProp_('ROOT_FOLDER_ID')
  if (!root) {
    root = DriveApp.createFolder('Photobooth')
    setProp_('ROOT_FOLDER_ID', root.getId())
  }

  let sessionsFolder = folderFromProp_('SESSIONS_FOLDER_ID')
  if (!sessionsFolder) {
    sessionsFolder = childFolder_(root, 'Sessions')
    setProp_('SESSIONS_FOLDER_ID', sessionsFolder.getId())
  }

  let framesFolder = folderFromProp_('FRAMES_FOLDER_ID')
  if (!framesFolder) {
    framesFolder = childFolder_(root, 'Frames')
    setProp_('FRAMES_FOLDER_ID', framesFolder.getId())
  }

  // 2. spreadsheet database
  let ss = null
  if (prop_('SPREADSHEET_ID')) {
    try {
      ss = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'))
    } catch (err) {
      ss = null
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Photobooth Database')
    DriveApp.getFileById(ss.getId()).moveTo(root)
    setProp_('SPREADSHEET_ID', ss.getId())
  }

  Object.keys(SHEETS).forEach(name => ensureSheet_(ss, name, SHEETS[name]))

  // hapus sheet bawaan kosong ("Sheet1" / "Lembar1")
  ss.getSheets().forEach(sheet => {
    if (!SHEETS[sheet.getName()] && ss.getSheets().length > 1 && sheet.getLastRow() === 0) ss.deleteSheet(sheet)
  })

  // 3. laporan
  console.log('✅ Setup selesai')
  console.log('Folder Drive  : ' + root.getUrl())
  console.log('Database      : ' + ss.getUrl())
  if (!prop_('ADMIN_PASSWORD')) {
    console.warn('⚠️  ADMIN_PASSWORD belum diisi. Buka Project Settings → Script Properties → Add script property:')
    console.warn('    Property = ADMIN_PASSWORD, Value = password admin pilihanmu')
  } else {
    console.log('ADMIN_PASSWORD: sudah diisi')
  }
}

/**
 * Buat kode pairing kiosk dari editor (tanpa halaman admin).
 * Pilih fungsi "buatKodePairing" → ▶ Run → lihat kodenya di Execution log.
 * Kode berlaku 10 menit dan hanya bisa dipakai sekali.
 */
function buatKodePairing() {
  const result = createPairingCode_()
  console.log(`🔑 Kode pairing kiosk: ${result.code}  (berlaku ${result.expiresIn / 60} menit)`)
  return result.code
}

function folderFromProp_(key) {
  const id = prop_(key)
  if (!id) return null
  try {
    const folder = DriveApp.getFolderById(id)
    return folder.isTrashed() ? null : folder
  } catch (err) {
    return null
  }
}

function ensureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name)

  // semua kolom = teks polos, supaya Sheets tidak mengubah tanggal/angka otomatis
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@')
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold')
  sheet.setFrozenRows(1)
}
