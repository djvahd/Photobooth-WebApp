// Tes backend GAS dengan layanan Google tiruan (in-memory). Jalankan: npm test
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const crypto = require('crypto')

const GAS_DIR = path.join(__dirname, '..', 'gas')

/* ---------- mock Google services ---------- */
const store = { props: {}, cache: new Map(), folders: new Map(), files: new Map(), sheets: new Map(), logs: [] }
let idSeq = 0
const newId = p => `${p}${++idSeq}`

function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] } }

function makeFile(blob, parent) {
  const f = {
    id: newId('file'), name: blob.name, bytes: blob.bytes, mime: blob.mime, parent: parent.id, trashed: false, sharing: null,
    getId() { return this.id }, getName() { return this.name },
    setSharing(a, p) { this.sharing = a + ':' + p; return this },
    setTrashed(t) { this.trashed = t; return this },
    getBlob() { const s = this; return { getBytes: () => s.bytes, getContentType: () => s.mime } },
    makeCopy(name, folder) { return makeFile({ name, bytes: this.bytes, mime: this.mime }, folder) },
    moveTo(folder) { this.parent = folder.id; return this }
  }
  store.files.set(f.id, f)
  return f
}

function makeFolder(name, parent) {
  const f = {
    id: newId('folder'), name, parent: parent ? parent.id : null, trashed: false, created: new Date('2026-01-15T03:00:00Z'),
    getId() { return this.id }, getName() { return this.name }, getUrl() { return 'https://drive/' + this.id },
    isTrashed() { return this.trashed }, getDateCreated() { return this.created },
    createFolder(n) { return makeFolder(n, this) },
    getFoldersByName(n) { return iter([...store.folders.values()].filter(x => x.parent === this.id && x.name === n && !x.trashed)) },
    getFolders() { return iter([...store.folders.values()].filter(x => x.parent === this.id && !x.trashed)) },
    getFiles() { return iter([...store.files.values()].filter(x => x.parent === this.id && !x.trashed)) },
    createFile(blob) { return makeFile(blob, this) }
  }
  store.folders.set(f.id, f)
  return f
}
const driveRoot = makeFolder('My Drive', null)

function makeSheet(name) {
  const data = []
  const sh = {
    name, data, maxRows: 1000, frozen: 0,
    getName() { return name },
    getLastRow() { let n = data.length; while (n > 0 && data[n - 1].every(v => v === '' || v === undefined)) n--; return n },
    getMaxRows() { return this.maxRows },
    insertRowsAfter(_, n) { this.maxRows += n },
    setFrozenRows(n) { this.frozen = n },
    deleteRow(r) { data.splice(r - 1, 1) },
    getRange(r, c, nr, nc) {
      return {
        setNumberFormat() { return this }, setFontWeight() { return this },
        setValues(vals) {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error('setValues dimension mismatch')
          vals.forEach((row, i) => {
            while (data.length < r + i) data.push([])
            row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v })
          })
          return this
        },
        getValues() {
          const out = []
          for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; out.push(Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? '')) }
          return out
        }
      }
    }
  }
  return sh
}

function makeSpreadsheet(name) {
  const ss = {
    id: newId('ss'), name, sheets: [makeSheet('Sheet1')],
    getId() { return this.id }, getUrl() { return 'https://sheets/' + this.id },
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null },
    insertSheet(n) { const s = makeSheet(n); this.sheets.push(s); return s },
    getSheets() { return this.sheets.slice() },
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s) }
  }
  store.sheets.set(ss.id, ss)
  store.files.set(ss.id, { id: ss.id, moveTo(f) { this.parent = f.id }, parent: driveRoot.id })
  return ss
}

const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b))
const fromSigned = arr => Buffer.from(arr.map(b => (b + 256) % 256))

const services = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => store.props[k] ?? null, setProperty: (k, v) => { store.props[k] = String(v) } }) },
  CacheService: { getScriptCache: () => ({ get: k => store.cache.get(k) ?? null, put: (k, v) => store.cache.set(k, v), remove: k => store.cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    base64Decode: s => { if (!/^[A-Za-z0-9+/=]*$/.test(s)) throw new Error('bad b64'); return toSigned(Buffer.from(s, 'base64')) },
    base64Encode: bytes => fromSigned(bytes).toString('base64'),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    computeDigest: (alg, text) => toSigned(crypto.createHash('sha256').update(text, 'utf8').digest()),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    formatDate: (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10)
  },
  Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
  DriveApp: {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    createFolder: n => makeFolder(n, driveRoot),
    getFolderById: id => { const f = store.folders.get(id); if (!f) throw new Error('No folder ' + id); return f },
    getFileById: id => { const f = store.files.get(id); if (!f) throw new Error('No file ' + id); return f }
  },
  SpreadsheetApp: {
    create: n => makeSpreadsheet(n),
    openById: id => { const s = store.sheets.get(id); if (!s) throw new Error('No ss'); return s }
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this } }) },
  console: { log: (...a) => store.logs.push(a.join(' ')), warn: (...a) => store.logs.push('WARN ' + a.join(' ')), error: (...a) => store.logs.push('ERROR ' + a.join(' ')) }
}

const ctx = vm.createContext(Object.assign({}, services))
const gasCode = fs.readdirSync(GAS_DIR).filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync(path.join(GAS_DIR, f), 'utf8')).join('\n;\n')
vm.runInContext(gasCode + '\n;globalThis.__gas = { doPost, doGet, setup, migrateLegacySessions, buatKodePairing }', ctx)
const gas = ctx.__gas

/* ---------- helpers ---------- */
const call = (action, body = {}) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(Object.assign({ action }, body)) } }).text)
const results = []
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`)
const err = r => (r.ok ? 'ok' : r.error.code)
const jpg = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64')
const png = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64')
const tok = () => crypto.randomBytes(24).toString('base64url')

/* ---------- 1. setup ---------- */
gas.setup()
check('setup membuat properti', ['ROOT_FOLDER_ID', 'SESSIONS_FOLDER_ID', 'FRAMES_FOLDER_ID', 'SPREADSHEET_ID'].every(k => store.props[k]))
check('setup memperingatkan ADMIN_PASSWORD kosong', store.logs.some(l => l.includes('ADMIN_PASSWORD belum diisi')))
const ss = store.sheets.get(store.props.SPREADSHEET_ID)
check('sheet dibuat + Sheet1 dihapus', ss.sheets.map(s => s.name).join(',') === 'Sessions,PrintJobs,Devices,Templates', ss.sheets.map(s => s.name).join(','))
const propsBefore = JSON.stringify(store.props); gas.setup()
check('setup ulang tidak membuat duplikat', JSON.stringify(store.props) === propsBefore && store.sheets.size === 1)
check('login sebelum password diisi → not_configured', err(call('adminLogin', { password: 'x' })) === 'not_configured')
store.props.ADMIN_PASSWORD = 'rahasia-admin'

/* ---------- 2. admin login ---------- */
check('doGet ping', JSON.parse(gas.doGet().text).data.version === '2.0.0')
check('action tak dikenal', err(call('hapusSemua')) === 'unknown_action')
check('body bukan JSON', JSON.parse(gas.doPost({ postData: { contents: '{oops' } }).text).error.code === 'bad_request')
check('password salah', err(call('adminLogin', { password: 'salah' })) === 'invalid_password')
const login = call('adminLogin', { password: 'rahasia-admin' })
const A = login.data.adminToken
check('password benar → token', login.ok && /^[0-9a-f]{64}$/.test(A))
check('admin action tanpa token → unauthorized', err(call('listSessions')) === 'unauthorized')

/* ---------- 3. pairing kiosk ---------- */
const code = call('createPairingCode', { adminToken: A }).data.code
check('kode pairing 6 digit', /^\d{6}$/.test(code))
const pair = call('pairDevice', { code, name: 'Kiosk Utama' })
const K = pair.data.deviceToken
check('pairing berhasil', pair.ok && /^[0-9a-f]{64}$/.test(K) && pair.data.name === 'Kiosk Utama')
check('kode pairing hanya sekali pakai', err(call('pairDevice', { code })) === 'invalid_code')
check('token kiosk tidak disimpan mentah', !JSON.stringify(ss.getSheetByName('Devices').data).includes(K))
const code2 = call('createPairingCode', { adminToken: A }).data.code
const K2 = call('pairDevice', { code: code2, name: 'Kiosk 2' }).data.deviceToken
check('kiosk tidak bisa action admin', err(call('listSessions', { deviceToken: K })) === 'unauthorized')

const editorCode = gas.buatKodePairing()
check('buatKodePairing dari editor → kode bisa dipakai', /^\d{6}$/.test(editorCode) && call('pairDevice', { code: editorCode, name: 'Dari editor' }).ok)

/* ---------- 4. template ---------- */
const badTpl = call('saveTemplate', { adminToken: A, name: 'X', config: { width: 1000, height: 1500, slots: [{ x: 900, y: 0, w: 200, h: 100 }] } })
check('slot keluar batas ditolak', err(badTpl) === 'invalid_input', badTpl.error && badTpl.error.message)
const tpl = call('saveTemplate', { adminToken: A, name: 'Strip 3', frameData: png, config: { width: 1080, height: 3240, outputWidth: 1080, slots: [{ x: 75, y: 575, w: 930, h: 619 }, { x: 75, y: 1290, w: 930, h: 619 }, { x: 75, y: 2005, w: 930, h: 619 }] } })
check('simpan template + frame', tpl.ok && tpl.data.hasFrame && tpl.data.config.frameLayer === 'above', JSON.stringify(tpl.error || ''))
const tplOff = call('saveTemplate', { adminToken: A, name: 'Nonaktif', active: false, config: { width: 500, height: 500, slots: [{ x: 0, y: 0, w: 500, h: 500 }] } })
check('kiosk hanya lihat template aktif', call('listTemplates', { deviceToken: K }).data.length === 1 && call('listTemplates', { adminToken: A }).data.length === 2)
const frame = call('getFrame', { deviceToken: K, templateId: tpl.data.id })
check('getFrame → data URL base64', frame.ok && frame.data.dataUrl === png)
check('kiosk tidak bisa ambil frame nonaktif', err(call('getFrame', { deviceToken: K, templateId: tplOff.data.id })) === 'not_found')
const oldFrameId = [...store.files.values()].find(f => f.name === tpl.data.id + '.png').id
call('saveTemplate', { adminToken: A, id: tpl.data.id, name: 'Strip 3 v2', frameData: png, config: tpl.data.config })
check('ganti frame → file lama dibuang', store.files.get(oldFrameId).trashed)
check('kiosk tidak bisa simpan template', err(call('saveTemplate', { deviceToken: K, name: 'x', config: tpl.data.config })) === 'unauthorized')
const delTpl = call('deleteTemplate', { adminToken: A, templateId: tplOff.data.id })
check('hapus template', delTpl.ok && call('listTemplates', { adminToken: A }).data.length === 1)

/* ---------- 5. sesi & upload ---------- */
const S1 = 'S20261006-abcdef12', T1 = tok()
const cs = call('createSession', { deviceToken: K, sessionId: S1, downloadToken: T1, templateId: tpl.data.id, photoCount: 3, createdAt: '2026-10-06T10:00:00.000Z' })
check('createSession', cs.ok && cs.data.status === 'uploading', JSON.stringify(cs.error || ''))
check('createSession diulang (idempoten)', call('createSession', { deviceToken: K, sessionId: S1, downloadToken: T1, templateId: tpl.data.id, photoCount: 3 }).ok && ss.getSheetByName('Sessions').getLastRow() === 2)
check('ID sesi dipakai kiosk lain → conflict', err(call('createSession', { deviceToken: K2, sessionId: S1, downloadToken: tok(), photoCount: 3 })) === 'conflict')
check('sessionId tidak valid', err(call('createSession', { deviceToken: K, sessionId: 'a/b', downloadToken: tok(), photoCount: 3 })) === 'invalid_input')
check('download sebelum upload → processing', call('getDownload', { token: T1 }).data.status === 'processing')
check('upload ke sesi kiosk lain → forbidden', err(call('uploadFile', { deviceToken: K2, sessionId: S1, kind: 'photo', index: 0, data: jpg })) === 'forbidden')
check('index di luar jumlah foto', err(call('uploadFile', { deviceToken: K, sessionId: S1, kind: 'photo', index: 3, data: jpg })) === 'invalid_input')
check('foto harus JPEG', err(call('uploadFile', { deviceToken: K, sessionId: S1, kind: 'photo', index: 0, data: png })) === 'invalid_input')
for (let i = 0; i < 3; i++) call('uploadFile', { deviceToken: K, sessionId: S1, kind: 'photo', index: i, data: jpg })
const dup = call('uploadFile', { deviceToken: K, sessionId: S1, kind: 'photo', index: 1, data: jpg })
check('upload ulang foto sama → alreadyUploaded', dup.ok && dup.data.alreadyUploaded)
const mid = call('getDownload', { token: T1 }).data
check('download saat final belum ada → processing 3/4', mid.status === 'processing' && mid.received === 3 && mid.expected === 4)
const fin = call('uploadFile', { deviceToken: K, sessionId: S1, kind: 'final', data: png })
check('upload final → complete', fin.ok && fin.data.status === 'complete')
const dl = call('getDownload', { token: T1 }).data
check('download complete: 3 foto + final', dl.status === 'complete' && dl.photos.length === 3 && /thumbnail\?id=/.test(dl.final.thumb))
const sessFolder = store.folders.get(store.files.get(dl.final.id).parent)
check('folder per tanggal (WIB) + nama file', store.folders.get(sessFolder.parent).name === '2026-10-06' && [...store.files.values()].filter(f => f.parent === sessFolder.id).map(f => f.name).sort().join(',') === 'final.png,photo-1.jpg,photo-2.jpg,photo-3.jpg')
check('file di-share publik (view)', store.files.get(dl.final.id).sharing === 'ANYONE_WITH_LINK:VIEW')
check('token download palsu → processing (tidak bocor)', call('getDownload', { token: tok() }).data.status === 'processing')
check('tanggal disimpan sebagai teks', typeof ss.getSheetByName('Sessions').data[1][1] === 'string')

/* ---------- 6. print ---------- */
const S2 = 'S20261006-incomplete', T2 = tok()
call('createSession', { deviceToken: K, sessionId: S2, downloadToken: T2, photoCount: 1 })
check('print sesi belum selesai → not_ready', err(call('enqueuePrint', { adminToken: A, sessionId: S2 })) === 'not_ready')
const job = call('enqueuePrint', { adminToken: A, sessionId: S1, copies: 2 })
check('enqueuePrint', job.ok && job.data.status === 'queued' && job.data.copies === 2)
const queued = call('listPrintJobs', { adminToken: A, status: 'queued' }).data
check('listPrintJobs berisi URL final', queued.length === 1 && queued[0].final && queued[0].final.view)
check('status print tidak dikenal', err(call('updatePrintJob', { adminToken: A, jobId: job.data.id, status: 'meledak' })) === 'invalid_input')
const failed = call('updatePrintJob', { adminToken: A, jobId: job.data.id, status: 'failed', error: 'Printer offline' })
check('job gagal menyimpan pesan error', failed.data.status === 'failed' && failed.data.error === 'Printer offline')
call('updatePrintJob', { adminToken: A, jobId: job.data.id, status: 'queued' })
const done = call('updatePrintJob', { adminToken: A, jobId: job.data.id, status: 'done' })
check('cetak ulang → done, error dibersihkan', done.data.status === 'done' && done.data.error === '')

/* ---------- 7. auto print ---------- */
call('saveSettings', { adminToken: A, settings: { autoPrint: true, autoPrintCopies: 1 } })
const S3 = 'S20261006-autoprint', T3 = tok()
call('createSession', { deviceToken: K, sessionId: S3, downloadToken: T3, photoCount: 1 })
call('uploadFile', { deviceToken: K, sessionId: S3, kind: 'photo', index: 0, data: jpg })
call('uploadFile', { deviceToken: K, sessionId: S3, kind: 'final', data: png })
call('uploadFile', { deviceToken: K, sessionId: S3, kind: 'final', data: png })
const autoJobs = call('listPrintJobs', { adminToken: A, status: 'queued' }).data.filter(j => j.sessionId === S3)
check('auto print → tepat 1 job (tidak dobel saat upload diulang)', autoJobs.length === 1)
check('getSettings', call('getSettings', { adminToken: A }).data.autoPrint === true)

/* ---------- 8. admin list & status ---------- */
const list = call('listSessions', { adminToken: A }).data
check('listSessions + hitungan print', list.total === 3 && list.items.find(s => s.id === S1).prints.done === 1)
check('listSessions filter query', call('listSessions', { adminToken: A, query: 'autoprint' }).data.total === 1)
check('getSession detail', call('getSession', { adminToken: A, sessionId: S1 }).data.photos.length === 3)
call('heartbeat', { deviceToken: K, info: { pendingUploads: 0 } })
call('heartbeat', { adminToken: A, info: { printer: 'ready' } })
const st = call('getStatus', { adminToken: A }).data
check('getStatus: heartbeat kiosk & admin + antrian', st.admin.info.printer === 'ready' && st.devices.find(d => d.name === 'Kiosk Utama').heartbeat && st.printQueue.queued === 1)

/* ---------- 9. cabut perangkat ---------- */
const devId = call('listDevices', { adminToken: A }).data.find(d => d.name === 'Kiosk 2').id
call('revokeDevice', { adminToken: A, deviceId: devId })
check('kiosk dicabut → unauthorized', err(call('listTemplates', { deviceToken: K2 })) === 'unauthorized')
check('kiosk lain tetap jalan', call('listTemplates', { deviceToken: K }).ok)

/* ---------- 10. brute force & logout ---------- */
for (let i = 0; i < 10; i++) call('adminLogin', { password: 'tebak' + i })
check('10x salah → locked', err(call('adminLogin', { password: 'rahasia-admin' })) === 'locked')
store.cache.delete('login_fails')
call('adminLogout', { adminToken: A })
check('logout → token tidak berlaku', err(call('listSessions', { adminToken: A })) === 'unauthorized')

/* ---------- 11. migrasi ---------- */
const legacy = makeFolder('Legacy Root', driveRoot)
store.props.LEGACY_FOLDER_ID = legacy.id
const mk = (name, files) => { const f = makeFolder(name, legacy); files.forEach(n => makeFile({ name: n, bytes: [1], mime: 'image/jpeg' }, f)); return f }
mk('#ab12c-6-1-2026-10:00:00', ['photo2.jpg', 'photo1.jpg', 'photo3.jpg', 'final.png'])
mk('#zz99x-7-1-2026-11:00:00', ['photo1.jpg'])
makeFile({ name: '_printQueue.json', bytes: [1], mime: 'text/plain' }, legacy)
const m1 = gas.migrateLegacySessions()
const m2 = gas.migrateLegacySessions()
check('migrasi 2 sesi, putaran kedua dilewati', m1.done && m1.migrated === 2 && m2.migrated === 0 && m2.skipped === 2, JSON.stringify([m1, m2]))
const A2 = call('adminLogin', { password: 'rahasia-admin' }).data.adminToken
const legacySessions = call('listSessions', { adminToken: A2, query: 'legacy' }).data.items
const full = legacySessions.find(s => s.status === 'complete')
check('sesi lama: complete + 3 foto + bisa didownload', full && full.uploadedPhotos === 3 && call('getDownload', { token: full.downloadToken }).data.status === 'complete')
check('sesi lama tanpa final → incomplete', legacySessions.some(s => s.status === 'incomplete'))
const fullDetail = call('getSession', { adminToken: A2, sessionId: full.id }).data
check('urutan foto lama dipertahankan', fullDetail.photos.map(p => store.files.get(p.id).name).join(',') === 'photo1.jpg,photo2.jpg,photo3.jpg')
check('file lama tidak dihapus (disalin)', [...store.files.values()].filter(f => f.parent && store.folders.get(f.parent) && store.folders.get(f.parent).parent === legacy.id && !f.trashed).length === 5)

/* ---------- 12. error internal tidak membocorkan detail ---------- */
const orig = ctx.DriveApp.getFolderById
ctx.DriveApp.getFolderById = () => { throw new Error('Drive meledak: detail rahasia') }
const r4 = call('createSession', { deviceToken: K, sessionId: 'S20261006-crash000', downloadToken: tok(), photoCount: 1 })
ctx.DriveApp.getFolderById = orig
check('error tak terduga → "internal" tanpa detail', err(r4) === 'internal' && !JSON.stringify(r4).includes('rahasia'))

console.log(results.join('\n'))
const fails = results.filter(r => r.startsWith('FAIL'))
console.log(`\n${results.length - fails.length}/${results.length} lolos`)
process.exit(fails.length ? 1 : 0)
