/**
 * Migration.js — memindahkan sesi foto dari Drive akun LAMA ke sistem baru.
 *
 * Cara pakai (di editor Apps Script akun baru):
 *   1. Pastikan folder lama bisa dibuka akun ini (di-share ke akun ini, atau
 *      "Siapa saja yang memiliki link").
 *   2. Buka "Migration.gs" → pilih fungsi "migrateLegacySessions" → ▶ Run.
 *   3. Cukup SEKALI. GAS membatasi satu eksekusi ±6 menit; kalau belum selesai,
 *      script menjadwalkan dirinya jalan lagi 1 menit kemudian, terus sampai
 *      selesai, lalu jadwalnya dihapus otomatis.
 *   4. Cek progres kapan saja: jalankan fungsi "statusMigrasi".
 *
 * File di-SALIN (bukan dipindah), jadi data di akun lama tetap utuh.
 * Sesi yang terpotong batas waktu dibatalkan bersih dan diulang di putaran berikutnya.
 * Kalau ID folder lama berbeda, isi Script Property LEGACY_FOLDER_ID.
 */

const LEGACY_DEFAULT_FOLDER_ID = '1bnXx-uzU3zxMwWkuYHekz0GDTVkXd8C6'
// berhenti jauh sebelum batas 6 menit GAS (waktu dicek sebelum setiap file)
const MIGRATION_TIME_BUDGET_MS = 4 * 60 * 1000
const MIGRATION_HANDLER = 'migrateLegacySessions'

function migrateLegacySessions() {
  const started = Date.now()
  const budget = Number(prop_('MIGRATION_BUDGET_MS')) || MIGRATION_TIME_BUDGET_MS
  const outOfTime = () => Date.now() - started > budget

  removeMigrationTriggers_()

  const legacyRoot = openLegacyRoot_()
  const sessions = table_('Sessions').all()

  const alreadyMigrated = {}
  sessions.forEach(s => {
    if (s.legacyFolderId) alreadyMigrated[s.legacyFolderId] = true
  })

  const cleaned = cleanupOrphanLegacyFolders_(sessions)
  if (cleaned) console.log(`🧹 ${cleaned} folder sisa dari putaran yang terpotong dibersihkan.`)

  let migrated = 0
  let skipped = 0
  const folders = legacyRoot.getFolders()

  while (folders.hasNext()) {
    if (outOfTime()) return pauseMigration_(migrated)

    const folder = folders.next()
    if (alreadyMigrated[folder.getId()]) {
      skipped++
      continue
    }

    const t0 = Date.now()
    if (!migrateOneLegacySession_(folder, outOfTime)) return pauseMigration_(migrated)

    migrated++
    console.log(`✓ ${folder.getName()} (${Math.round((Date.now() - t0) / 1000)} dtk)`)
  }

  console.log(`✅ Selesai! ${migrated} sesi dipindahkan di putaran ini, ${skipped} sudah dipindahkan sebelumnya.`)
  return { done: true, migrated, skipped }
}

// lihat progres migrasi tanpa memindahkan apa pun
function statusMigrasi() {
  const legacyRoot = openLegacyRoot_()
  const migratedIds = {}
  table_('Sessions').all().forEach(s => {
    if (s.legacyFolderId) migratedIds[s.legacyFolderId] = true
  })

  let total = 0
  let done = 0
  const folders = legacyRoot.getFolders()
  while (folders.hasNext()) {
    total++
    if (migratedIds[folders.next().getId()]) done++
  }

  const scheduled = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === MIGRATION_HANDLER)
  console.log(`📊 ${done} dari ${total} sesi lama sudah dipindahkan.` +
    (done < total ? (scheduled ? ' Putaran berikutnya sudah dijadwalkan otomatis.' : ' Jalankan migrateLegacySessions untuk melanjutkan.') : ''))
  return { total, done, scheduled }
}

/**
 * @returns true kalau sesi selesai disalin & dicatat,
 *          false kalau waktu habis di tengah jalan (salinan setengah jadi dibuang)
 */
function migrateOneLegacySession_(legacyFolder, outOfTime) {
  const createdAt = legacyFolder.getDateCreated().toISOString()

  // ID baru: "legacy-<nama lama yang dibersihkan>-<acak>" (pola ID sesi: huruf, angka, "-")
  const base = legacyFolder.getName().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 45)
  const id = `legacy-${base || 'sesi'}-${randomHex_().slice(0, 6)}`

  const files = []
  const it = legacyFolder.getFiles()
  while (it.hasNext()) {
    const file = it.next()
    if (/\.(jpe?g|png)$/i.test(file.getName())) files.push(file)
  }
  files.sort((a, b) => a.getName().localeCompare(b.getName(), undefined, { numeric: true }))

  const target = sessionFolder_(id, createdAt)
  const photoFileIds = []
  let finalFileId = ''

  for (const file of files) {
    if (outOfTime()) {
      target.setTrashed(true)
      return false
    }

    const name = file.getName().toLowerCase()
    const copy = file.makeCopy(file.getName(), target)
    copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)

    if (name.indexOf('final') === 0) finalFileId = copy.getId()
    else if (name.indexOf('photo') !== -1) photoFileIds.push(copy.getId())
  }

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
  return true
}

/* =========================
   HELPER
========================= */

function openLegacyRoot_() {
  const legacyId = prop_('LEGACY_FOLDER_ID') || LEGACY_DEFAULT_FOLDER_ID
  try {
    const folder = DriveApp.getFolderById(legacyId)
    folder.getName()
    return folder
  } catch (err) {
    throw new Error(`Folder lama (${legacyId}) tidak bisa dibuka. Share folder itu dari akun lama ke akun ini (Viewer), lalu coba lagi.`)
  }
}

function pauseMigration_(migrated) {
  ScriptApp.newTrigger(MIGRATION_HANDLER).timeBased().after(60 * 1000).create()
  console.log(`⏳ Belum selesai: ${migrated} sesi dipindahkan di putaran ini. Dilanjutkan otomatis dalam ±1 menit — tidak perlu klik Run lagi.`)
  return { done: false, migrated }
}

function removeMigrationTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === MIGRATION_HANDLER)
    .forEach(t => ScriptApp.deleteTrigger(t))
}

// folder "legacy-…" di Sessions/<tanggal>/ yang tidak tercatat di database
// = sisa sesi yang terpotong batas waktu → dibuang
function cleanupOrphanLegacyFolders_(sessions) {
  const known = {}
  sessions.forEach(s => { if (s.folderId) known[s.folderId] = true })

  let cleaned = 0
  const days = DriveApp.getFolderById(requireProp_('SESSIONS_FOLDER_ID')).getFolders()
  while (days.hasNext()) {
    const children = days.next().getFolders()
    while (children.hasNext()) {
      const folder = children.next()
      if (folder.getName().indexOf('legacy-') === 0 && !known[folder.getId()]) {
        folder.setTrashed(true)
        cleaned++
      }
    }
  }
  return cleaned
}
