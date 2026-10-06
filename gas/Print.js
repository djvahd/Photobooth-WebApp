/**
 * Print.js — antrian print & pengaturan.
 *
 * Printer tersambung ke laptop admin. Halaman admin mengambil job "queued",
 * mencetaknya, lalu melaporkan hasilnya (done / failed) lewat updatePrintJob.
 * Kalau printer belum tersambung, job tetap mengantre dan bisa dicetak nanti.
 *
 * Status job: queued → printing → done | failed | cancelled
 * (failed/cancelled bisa dikembalikan ke queued untuk cetak ulang)
 */

function enqueuePrint_(body) {
  const sessionId = str_(body.sessionId, 'sessionId', { max: 64 })
  const copies = int_(body.copies, 'Jumlah cetak', { min: 1, max: 10, def: 1 })

  const session = table_('Sessions').findBy('id', sessionId)
  if (!session) throw new AppError('not_found', 'Sesi tidak ditemukan')
  if (session.status !== SESSION_STATUS.COMPLETE || !session.finalFileId) {
    throw new AppError('not_ready', 'Foto final sesi ini belum selesai di-upload')
  }

  return createPrintJob_(sessionId, copies)
}

function createPrintJob_(sessionId, copies) {
  const now = nowIso_()
  const job = {
    id: 'job-' + randomHex_().slice(0, 10),
    sessionId,
    copies,
    status: 'queued',
    error: '',
    createdAt: now,
    updatedAt: now
  }
  withLock_(() => table_('PrintJobs').insert(job))
  return job
}

// dipanggil saat sesi baru selesai di-upload
function autoPrintIfEnabled_(session) {
  const settings = readSettings_()
  if (settings.autoPrint) createPrintJob_(session.id, settings.autoPrintCopies)
}

function listPrintJobs_(body) {
  const limit = int_(body.limit, 'limit', { min: 1, max: 500, def: 100 })

  let statuses = null
  if (body.status) {
    statuses = [].concat(body.status)
    statuses.forEach(s => {
      if (PRINT_STATUS.indexOf(s) === -1) throw new AppError('invalid_input', `Status "${s}" tidak dikenal`)
    })
  }

  const finalBySession = {}
  table_('Sessions').all().forEach(s => { finalBySession[s.id] = s.finalFileId })

  let jobs = table_('PrintJobs').all()
  if (statuses) jobs = jobs.filter(j => statuses.indexOf(j.status) !== -1)
  // antrian: yang paling lama dicetak duluan
  jobs.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))

  return jobs.slice(0, limit).map(j => Object.assign(clean_(j), {
    final: fileUrls_(finalBySession[j.sessionId])
  }))
}

function updatePrintJob_(body) {
  const jobId = str_(body.jobId, 'jobId', { max: 40 })
  const status = str_(body.status, 'status')
  if (PRINT_STATUS.indexOf(status) === -1) throw new AppError('invalid_input', `Status "${status}" tidak dikenal`)
  const error = str_(body.error, 'error', { optional: true, max: 300 })

  return withLock_(() => {
    const jobs = table_('PrintJobs')
    const row = jobs.findBy('id', jobId)
    if (!row) throw new AppError('not_found', 'Job print tidak ditemukan')

    return clean_(jobs.update(row, {
      status,
      error: status === 'failed' ? error : '',
      updatedAt: nowIso_()
    }))
  })
}

/* =========================
   PENGATURAN
========================= */

function readSettings_() {
  let saved = {}
  try {
    saved = JSON.parse(prop_('SETTINGS') || '{}')
  } catch (err) {
    saved = {}
  }
  return Object.assign({}, DEFAULT_SETTINGS, saved)
}

function getSettings_() {
  return readSettings_()
}

function saveSettings_(body) {
  const input = body.settings || {}
  const settings = {
    autoPrint: !!input.autoPrint,
    autoPrintCopies: int_(input.autoPrintCopies, 'Jumlah cetak otomatis', { min: 1, max: 10, def: 1 })
  }
  setProp_('SETTINGS', JSON.stringify(settings))
  return settings
}
