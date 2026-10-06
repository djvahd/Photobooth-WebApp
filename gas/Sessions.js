/**
 * Sessions.js — sesi foto: dibuat kiosk, file di-upload satu per satu,
 * dilihat tamu lewat halaman download, dikelola admin.
 *
 * Alur kiosk (tahan internet putus — boleh diulang kapan saja):
 *   1. createSession  { sessionId, downloadToken, templateId, photoCount, createdAt }
 *      sessionId & downloadToken dibuat di KIOSK, supaya QR bisa langsung tampil
 *      walaupun upload belum selesai / sedang offline.
 *   2. uploadFile     { sessionId, kind: "photo", index: 0..n-1, data }  (per foto)
 *      uploadFile     { sessionId, kind: "final", data }
 *   Status sesi otomatis jadi "complete" setelah semua foto + final masuk.
 *
 * Struktur Drive: Photobooth/Sessions/<yyyy-MM-dd>/<sessionId>/photo-1.jpg … final.png
 * Setiap file di-share "Anyone with the link (Viewer)" supaya bisa tampil di
 * halaman download; foldernya sendiri tidak di-share.
 */

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const DOWNLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/

/* =========================
   KIOSK
========================= */

function createSession_(body, ctx) {
  const id = str_(body.sessionId, 'sessionId', { pattern: SESSION_ID_PATTERN })
  const downloadToken = str_(body.downloadToken, 'downloadToken', { pattern: DOWNLOAD_TOKEN_PATTERN })
  const templateId = str_(body.templateId, 'templateId', { optional: true, max: 64, pattern: /^[A-Za-z0-9-]*$/ })
  const photoCount = int_(body.photoCount, 'photoCount', { min: 1, max: MAX_PHOTOS_PER_SESSION })
  const createdAt = clientDate_(body.createdAt)

  return withLock_(() => {
    const sessions = table_('Sessions')
    const all = sessions.all()

    const existing = all.find(s => s.id === id)
    if (existing) {
      // kiosk boleh mengirim ulang (mis. setelah koneksi putus) → tidak dibuat dua kali
      if (existing.deviceId !== ctx.deviceId) throw new AppError('conflict', 'ID sesi sudah dipakai perangkat lain')
      return sessionSummary_(existing)
    }
    if (all.some(s => s.downloadToken === downloadToken)) {
      throw new AppError('conflict', 'Token download sudah dipakai')
    }

    const folder = sessionFolder_(id, createdAt)
    const row = sessions.insert({
      id,
      createdAt,
      updatedAt: nowIso_(),
      status: SESSION_STATUS.UPLOADING,
      templateId,
      deviceId: ctx.deviceId,
      downloadToken,
      folderId: folder.getId(),
      photoCount,
      photoFileIds: new Array(photoCount).fill(''),
      finalFileId: '',
      legacyFolderId: ''
    })
    return sessionSummary_(row)
  })
}

function uploadFile_(body, ctx) {
  const id = str_(body.sessionId, 'sessionId', { pattern: SESSION_ID_PATTERN })
  const kind = str_(body.kind, 'kind', { pattern: /^(photo|final)$/ })

  const row = table_('Sessions').findBy('id', id)
  if (!row) throw new AppError('not_found', 'Sesi belum dibuat (panggil createSession dulu)')
  if (row.deviceId !== ctx.deviceId) throw new AppError('forbidden', 'Sesi ini milik perangkat lain')

  let index = null
  if (kind === 'photo') {
    index = int_(body.index, 'index', { min: 0, max: row.photoCount - 1 })
    if ((row.photoFileIds || [])[index]) return { status: row.status, alreadyUploaded: true }
  } else if (row.finalFileId) {
    return { status: row.status, alreadyUploaded: true }
  }

  const allowed = kind === 'final' ? ['image/png', 'image/jpeg'] : ['image/jpeg']
  const decoded = decodeBase64_(body.data, allowed, MAX_UPLOAD_BYTES)
  const mimeType = decoded.mimeType || 'image/jpeg'
  const ext = mimeType === 'image/png' ? 'png' : 'jpg'
  const name = kind === 'final' ? `final.${ext}` : `photo-${index + 1}.${ext}`

  // buat file di luar lock (lambat), lalu catat di Sheets di dalam lock
  const file = DriveApp.getFolderById(row.folderId).createFile(Utilities.newBlob(decoded.bytes, mimeType, name))
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)

  const result = withLock_(() => {
    const sessions = table_('Sessions')
    const fresh = sessions.findBy('id', id)
    const ids = (fresh.photoFileIds || new Array(fresh.photoCount).fill('')).slice()
    let finalFileId = fresh.finalFileId

    // request kembar yang lolos bersamaan → simpan satu, buang duplikatnya
    const duplicate = kind === 'photo' ? !!ids[index] : !!finalFileId
    if (duplicate) {
      file.setTrashed(true)
      return { row: fresh, becameComplete: false }
    }

    if (kind === 'photo') ids[index] = file.getId()
    else finalFileId = file.getId()

    const complete = !!finalFileId && ids.slice(0, fresh.photoCount).every(Boolean)
    const updated = sessions.update(fresh, {
      photoFileIds: ids,
      finalFileId,
      status: complete ? SESSION_STATUS.COMPLETE : SESSION_STATUS.UPLOADING,
      updatedAt: nowIso_()
    })
    return { row: updated, becameComplete: complete && fresh.status !== SESSION_STATUS.COMPLETE }
  })

  if (result.becameComplete) autoPrintIfEnabled_(result.row)

  return { status: result.row.status, alreadyUploaded: false }
}

/* =========================
   TAMU (halaman download)
========================= */

function getDownload_(body) {
  const token = str_(body.token, 'token', { pattern: DOWNLOAD_TOKEN_PATTERN })
  const row = table_('Sessions').findBy('downloadToken', token)

  // belum sampai server (kiosk masih offline/meng-upload)
  if (!row) return { status: 'processing', received: 0, expected: null }

  const photos = (row.photoFileIds || []).filter(Boolean).map(fileUrls_)

  if (row.status !== SESSION_STATUS.COMPLETE) {
    return {
      status: 'processing',
      received: photos.length + (row.finalFileId ? 1 : 0),
      expected: row.photoCount + 1
    }
  }

  return {
    status: 'complete',
    createdAt: row.createdAt,
    final: fileUrls_(row.finalFileId),
    photos
  }
}

/* =========================
   ADMIN
========================= */

function listSessions_(body) {
  const limit = int_(body.limit, 'limit', { min: 1, max: 200, def: 50 })
  const offset = int_(body.offset, 'offset', { min: 0, def: 0 })
  const query = typeof body.query === 'string' ? body.query.trim().toLowerCase() : ''

  const jobsBySession = groupBy_(table_('PrintJobs').all(), 'sessionId')

  let rows = table_('Sessions').all()
  if (query) rows = rows.filter(r => r.id.toLowerCase().indexOf(query) !== -1)
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return {
    total: rows.length,
    items: rows.slice(offset, offset + limit).map(r => sessionSummary_(r, jobsBySession[r.id]))
  }
}

function getSession_(body) {
  const id = str_(body.sessionId, 'sessionId', { max: 64 })
  const row = table_('Sessions').findBy('id', id)
  if (!row) throw new AppError('not_found', 'Sesi tidak ditemukan')

  const jobs = table_('PrintJobs').all().filter(j => j.sessionId === id)
  return Object.assign(sessionSummary_(row, jobs), {
    photos: (row.photoFileIds || []).filter(Boolean).map(fileUrls_),
    printJobs: jobs.map(clean_)
  })
}

/* =========================
   HELPER
========================= */

function sessionSummary_(row, jobs) {
  const photoIds = (row.photoFileIds || []).filter(Boolean)
  const list = jobs || []
  return {
    id: row.id,
    createdAt: row.createdAt,
    status: row.status,
    templateId: row.templateId,
    deviceId: row.deviceId,
    photoCount: row.photoCount,
    uploadedPhotos: photoIds.length,
    downloadToken: row.downloadToken,
    final: fileUrls_(row.finalFileId),
    thumb: fileUrls_(row.finalFileId || photoIds[0]),
    legacy: !!row.legacyFolderId,
    prints: {
      queued: list.filter(j => j.status === 'queued' || j.status === 'printing').length,
      done: list.filter(j => j.status === 'done').length,
      failed: list.filter(j => j.status === 'failed').length
    }
  }
}

// waktu dari kiosk dipakai kalau masuk akal (±7 hari), selain itu waktu server
function clientDate_(value) {
  const d = new Date(value)
  if (value && !isNaN(d.getTime()) && Math.abs(Date.now() - d.getTime()) < 7 * 24 * 3600 * 1000) {
    return d.toISOString()
  }
  return nowIso_()
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name)
  return it.hasNext() ? it.next() : parent.createFolder(name)
}

function sessionFolder_(sessionId, createdAt) {
  const root = DriveApp.getFolderById(requireProp_('SESSIONS_FOLDER_ID'))
  const day = Utilities.formatDate(new Date(createdAt), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  return childFolder_(childFolder_(root, day), sessionId)
}

function groupBy_(rows, key) {
  const out = {}
  rows.forEach(r => {
    if (!out[r[key]]) out[r[key]] = []
    out[r[key]].push(r)
  })
  return out
}
