/**
 * Config.js — konstanta, skema database (Sheets), dan helper umum.
 *
 * ID folder/spreadsheet & password TIDAK ditulis di kode, tapi disimpan di
 * Script Properties (Project Settings → Script Properties). Lihat Setup.js.
 *
 * Catatan GAS: semua file di proyek berbagi satu lingkup global, jadi fungsi
 * dari file lain bisa dipanggil langsung. Jangan memanggil fungsi file lain di
 * level atas file (saat file dimuat), hanya di dalam fungsi.
 */

const APP_VERSION = '2.0.0'

// Kolom tiap sheet. Urutan = urutan kolom di spreadsheet.
const SHEETS = {
  Sessions: [
    'id', 'createdAt', 'updatedAt', 'status', 'templateId', 'deviceId',
    'downloadToken', 'folderId', 'photoCount', 'photoFileIds', 'finalFileId', 'legacyFolderId'
  ],
  PrintJobs: ['id', 'sessionId', 'copies', 'status', 'error', 'createdAt', 'updatedAt'],
  Devices: ['id', 'name', 'tokenHash', 'createdAt', 'revoked'],
  Templates: ['id', 'name', 'active', 'sortOrder', 'frameFileId', 'config', 'updatedAt']
}

// Tipe kolom selain string (semua disimpan sebagai teks di Sheets)
const COLUMN_TYPES = {
  photoCount: 'number',
  copies: 'number',
  sortOrder: 'number',
  revoked: 'bool',
  active: 'bool',
  photoFileIds: 'json',
  config: 'json'
}

const ADMIN_TOKEN_TTL = 6 * 60 * 60   // detik (maks CacheService = 21600)
const LOGIN_MAX_FAILS = 10            // salah sebanyak ini → dikunci
const LOGIN_LOCK_SECONDS = 5 * 60
const PAIRING_CODE_TTL = 10 * 60
const DEVICE_CACHE_TTL = 10 * 60
const HEARTBEAT_TTL = 6 * 60 * 60

const MAX_PHOTOS_PER_SESSION = 10
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_FRAME_BYTES = 15 * 1024 * 1024

const SESSION_STATUS = { UPLOADING: 'uploading', COMPLETE: 'complete' }
const PRINT_STATUS = ['queued', 'printing', 'done', 'failed', 'cancelled']

const DEFAULT_SETTINGS = { autoPrint: false, autoPrintCopies: 1 }

/* =========================
   ERROR
========================= */

// Error yang aman ditampilkan ke klien (code + pesan bahasa Indonesia)
class AppError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/* =========================
   SCRIPT PROPERTIES
========================= */

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key)
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value)
}

function requireProp_(key) {
  const value = prop_(key)
  if (!value) throw new AppError('not_configured', `Script Property ${key} belum diisi. Jalankan setup() dulu.`)
  return value
}

/* =========================
   VALIDASI INPUT
========================= */

function str_(value, name, opts) {
  const o = opts || {}
  if (value === undefined || value === null || value === '') {
    if (o.optional) return o.def !== undefined ? o.def : ''
    throw new AppError('invalid_input', `${name} wajib diisi`)
  }
  if (typeof value !== 'string') throw new AppError('invalid_input', `${name} harus berupa teks`)
  const v = value.trim()
  if (o.max && v.length > o.max) throw new AppError('invalid_input', `${name} maksimal ${o.max} karakter`)
  if (o.pattern && !o.pattern.test(v)) throw new AppError('invalid_input', `${name} tidak valid`)
  return v
}

function int_(value, name, opts) {
  const o = opts || {}
  if ((value === undefined || value === null || value === '') && o.def !== undefined) return o.def
  const n = Number(value)
  if (!Number.isInteger(n)) throw new AppError('invalid_input', `${name} harus bilangan bulat`)
  if (o.min !== undefined && n < o.min) throw new AppError('invalid_input', `${name} minimal ${o.min}`)
  if (o.max !== undefined && n > o.max) throw new AppError('invalid_input', `${name} maksimal ${o.max}`)
  return n
}

/* =========================
   UTIL
========================= */

function nowIso_() {
  return new Date().toISOString()
}

// 32 karakter hex acak (dari UUID v4, ~122 bit acak)
function randomHex_() {
  return Utilities.getUuid().replace(/-/g, '')
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('')
}

function withLock_(fn) {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(20000)) throw new AppError('busy', 'Server sedang sibuk, coba lagi')
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}

// "data:image/png;base64,AAAA" atau "AAAA" → { bytes, mimeType }
function decodeBase64_(data, allowedMimeTypes, maxBytes) {
  if (typeof data !== 'string' || !data) throw new AppError('invalid_input', 'Data file kosong')

  let mimeType = null
  let b64 = data
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(data)
  if (match) {
    mimeType = match[1].toLowerCase()
    b64 = data.slice(match[0].length)
  }

  let bytes
  try {
    bytes = Utilities.base64Decode(b64)
  } catch (err) {
    throw new AppError('invalid_input', 'Data file bukan base64 yang valid')
  }
  if (bytes.length > maxBytes) throw new AppError('too_large', `Ukuran file maksimal ${Math.round(maxBytes / 1024 / 1024)}MB`)
  if (mimeType && allowedMimeTypes.indexOf(mimeType) === -1) throw new AppError('invalid_input', 'Jenis file tidak diizinkan')

  return { bytes, mimeType }
}

// URL gambar Drive untuk file yang sudah di-share "Anyone with the link"
function fileUrls_(fileId) {
  if (!fileId) return null
  return {
    id: fileId,
    thumb: `https://drive.google.com/thumbnail?id=${fileId}&sz=w600`,
    view: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`,
    download: `https://drive.google.com/uc?export=download&id=${fileId}`
  }
}
