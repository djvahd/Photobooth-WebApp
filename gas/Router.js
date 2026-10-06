/**
 * Router.js — pintu masuk web app.
 *
 * Semua request dari website: POST ke URL /exec dengan body JSON
 *   { "action": "namaAction", "adminToken"?: "...", "deviceToken"?: "...", ...data }
 * Content-Type "text/plain" (bukan application/json) supaya browser tidak
 * mengirim CORS preflight yang tidak didukung GAS.
 *
 * Balasan selalu JSON:
 *   { "ok": true,  "data": ... }
 *   { "ok": false, "error": { "code": "...", "message": "..." } }
 *
 * Level akses tiap action:
 *   public → siapa saja (mis. halaman download tamu)
 *   kiosk  → perangkat kiosk yang sudah di-pairing (deviceToken)
 *   admin  → admin yang sudah login (adminToken)
 *   any    → kiosk atau admin
 */

function routes_() {
  return {
    ping: { auth: 'public', handler: () => ({ version: APP_VERSION }) },

    // auth & perangkat
    adminLogin: { auth: 'public', handler: adminLogin_ },
    adminLogout: { auth: 'admin', handler: adminLogout_ },
    createPairingCode: { auth: 'admin', handler: createPairingCode_ },
    pairDevice: { auth: 'public', handler: pairDevice_ },
    listDevices: { auth: 'admin', handler: listDevices_ },
    revokeDevice: { auth: 'admin', handler: revokeDevice_ },
    heartbeat: { auth: 'any', handler: heartbeat_ },
    getStatus: { auth: 'admin', handler: getStatus_ },

    // sesi foto
    createSession: { auth: 'kiosk', handler: createSession_ },
    uploadFile: { auth: 'kiosk', handler: uploadFile_ },
    getDownload: { auth: 'public', handler: getDownload_ },
    listSessions: { auth: 'admin', handler: listSessions_ },
    getSession: { auth: 'admin', handler: getSession_ },

    // print
    enqueuePrint: { auth: 'admin', handler: enqueuePrint_ },
    listPrintJobs: { auth: 'admin', handler: listPrintJobs_ },
    updatePrintJob: { auth: 'admin', handler: updatePrintJob_ },
    getSettings: { auth: 'admin', handler: getSettings_ },
    saveSettings: { auth: 'admin', handler: saveSettings_ },

    // template / frame
    listTemplates: { auth: 'any', handler: listTemplates_ },
    getFrame: { auth: 'any', handler: getFrame_ },
    saveTemplate: { auth: 'admin', handler: saveTemplate_ },
    deleteTemplate: { auth: 'admin', handler: deleteTemplate_ }
  }
}

function doGet() {
  return json_({ ok: true, data: { version: APP_VERSION } })
}

function doPost(e) {
  let body
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {}
  } catch (err) {
    return json_({ ok: false, error: { code: 'bad_request', message: 'Body request bukan JSON yang valid' } })
  }

  try {
    const route = routes_()[body.action]
    if (!route) throw new AppError('unknown_action', `Action "${body.action}" tidak dikenal`)

    const ctx = authenticate_(route.auth, body)
    const data = route.handler(body, ctx)
    return json_({ ok: true, data: data === undefined ? null : data })
  } catch (err) {
    if (err instanceof AppError) {
      return json_({ ok: false, error: { code: err.code, message: err.message } })
    }
    console.error(`Action "${body.action}" gagal:`, err && err.stack ? err.stack : err)
    return json_({ ok: false, error: { code: 'internal', message: 'Terjadi kesalahan di server' } })
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
