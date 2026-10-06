/**
 * Status.js — heartbeat perangkat & ringkasan status untuk admin.
 *
 * Kiosk dan halaman admin mengirim heartbeat berkala. Disimpan di cache
 * (bukan Sheets) karena sering berubah dan tidak perlu disimpan permanen.
 * "info" bebas diisi klien, mis. { printer: "ready" } atau { pendingUploads: 2 }.
 */

function heartbeat_(body, ctx) {
  const key = ctx.role === 'admin' ? 'hb_admin' : 'hb_' + ctx.deviceId

  let info = body.info && typeof body.info === 'object' ? body.info : {}
  if (JSON.stringify(info).length > 2000) info = { truncated: true }

  const beat = { at: nowIso_(), info }
  CacheService.getScriptCache().put(key, JSON.stringify(beat), HEARTBEAT_TTL)
  return beat
}

function getStatus_() {
  const cache = CacheService.getScriptCache()
  const jobs = table_('PrintJobs').all()
  const sessions = table_('Sessions').all()

  return {
    serverTime: nowIso_(),
    admin: JSON.parse(cache.get('hb_admin') || 'null'),
    devices: listDevices_().filter(d => !d.revoked),
    printQueue: {
      queued: jobs.filter(j => j.status === 'queued').length,
      printing: jobs.filter(j => j.status === 'printing').length,
      failed: jobs.filter(j => j.status === 'failed').length
    },
    sessions: {
      total: sessions.length,
      uploading: sessions.filter(s => s.status === SESSION_STATUS.UPLOADING).length
    }
  }
}
