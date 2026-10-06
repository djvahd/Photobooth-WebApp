/**
 * Migration.js — memindahkan sesi foto dari Drive akun LAMA ke sistem baru.
 * Dijalankan manual, cukup sekali (boleh diulang, sesi yang sudah pindah dilewati).
 *
 * Langkah:
 *   1. Login ke akun Google LAMA → buka folder sesi lama di Drive
 *      (ID: 1bnXx-uzU3zxMwWkuYHekz0GDTVkXd8C6) → Share → tambahkan email akun
 *      BARU sebagai Viewer.
 *   2. Pastikan setup() sudah dijalankan.
 *   3. Di editor Apps Script akun baru: buka "Migration.gs", pilih fungsi
 *      "migrateLegacySessions", klik ▶ Run.
 *   4. GAS membatasi satu eksekusi ±6 menit. Kalau log menulis "Belum selesai",
 *      klik Run lagi sampai muncul "Selesai".
 *
 * File di-SALIN (bukan dipindah), jadi data di akun lama tetap utuh.
 * Kalau ID folder lama berbeda, isi Script Property LEGACY_FOLDER_ID.
 */

const LEGACY_DEFAULT_FOLDER_ID = '1bnXx-uzU3zxMwWkuYHekz0GDTVkXd8C6'
const MIGRATION_TIME_BUDGET_MS = 5 * 60 * 1000

function migrateLegacySessions() {
  const started = Date.now()
  const legacyId = prop_('LEGACY_FOLDER_ID') || LEGACY_DEFAULT_FOLDER_ID

  let legacyRoot
  try {
    legacyRoot = DriveApp.getFolderById(legacyId)
    legacyRoot.getName()
  } catch (err) {
    throw new Error(`Folder lama (${legacyId}) tidak bisa dibuka. Pastikan sudah di-share dari akun lama ke akun ini.`)
  }

  const alreadyMigrated = {}
  table_('Sessions').all().forEach(s => {
    if (s.legacyFolderId) alreadyMigrated[s.legacyFolderId] = true
  })

  let migrated = 0
  let skipped = 0
  const folders = legacyRoot.getFolders()

  while (folders.hasNext()) {
    if (Date.now() - started > MIGRATION_TIME_BUDGET_MS) {
      console.log(`⏳ Belum selesai: ${migrated} sesi dipindahkan di putaran ini. Klik Run lagi untuk melanjutkan.`)
      return { done: false, migrated, skipped }
    }

    const folder = folders.next()
    if (alreadyMigrated[folder.getId()]) {
      skipped++
      continue
    }

    migrateOneLegacySession_(folder)
    migrated++
  }

  console.log(`✅ Selesai! ${migrated} sesi dipindahkan, ${skipped} sudah dipindahkan sebelumnya.`)
  return { done: true, migrated, skipped }
}

function migrateOneLegacySession_(legacyFolder) {
  const createdAt = legacyFolder.getDateCreated().toISOString()

  // ID baru: "legacy-<nama lama yang dibersihkan>-<acak>" (pola ID sesi: huruf, angka, "-")
  const base = legacyFolder.getName().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 45)
  const id = `legacy-${base || 'sesi'}-${randomHex_().slice(0, 6)}`

  const target = sessionFolder_(id, createdAt)

  const files = []
  const it = legacyFolder.getFiles()
  while (it.hasNext()) files.push(it.next())
  files.sort((a, b) => a.getName().localeCompare(b.getName(), undefined, { numeric: true }))

  const photoFileIds = []
  let finalFileId = ''

  files.forEach(file => {
    const name = file.getName().toLowerCase()
    if (!/\.(jpe?g|png)$/.test(name)) return

    const copy = file.makeCopy(file.getName(), target)
    copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)

    if (name.indexOf('final') === 0) finalFileId = copy.getId()
    else if (name.indexOf('photo') !== -1) photoFileIds.push(copy.getId())
  })

  withLock_(() => table_('Sessions').insert({
    id,
    createdAt,
    updatedAt: nowIso_(),
    status: finalFileId ? SESSION_STATUS.COMPLETE : 'incomplete',
    templateId: 'legacy',
    deviceId: 'legacy',
    downloadToken: randomHex_() + randomHex_().slice(0, 8),
    folderId: target.getId(),
    photoCount: photoFileIds.length,
    photoFileIds,
    finalFileId,
    legacyFolderId: legacyFolder.getId()
  }))
}
