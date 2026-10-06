// Antrian upload di belakang layar.
//
// Setiap sesi disimpan dulu di IndexedDB (outbox), lalu di-upload langkah demi
// langkah: createSession → foto 1..n → final. Progres dicatat per langkah, jadi
// kalau internet putus / halaman di-refresh, upload melanjutkan dari langkah
// terakhir. Data sesi dihapus dari perangkat setelah semuanya terkirim.
import { outbox } from './db.js'
import { kioskApi } from './device.js'

const RETRY_SECONDS = [5, 15, 30, 60, 120]
// error yang tidak akan berhasil walau dicoba ulang
const PERMANENT_ERRORS = ['invalid_input', 'forbidden', 'conflict', 'too_large']

const listeners = new Set()
let state = { pending: 0, failed: 0, uploading: false, lastError: null, unauthorized: false }
let running = false
let timer = null
let attempt = 0

export function onUploadState(fn) {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

export function getUploadState() {
  return state
}

function emit(patch) {
  state = Object.assign({}, state, patch)
  listeners.forEach(fn => fn(state))
}

export async function refreshCounts() {
  const items = await outbox.all()
  emit({
    pending: items.filter(i => !i.failed).length,
    failed: items.filter(i => i.failed).length
  })
}

// jalankan antrian (setelah jeda opsional)
export function kick(delayMs = 0) {
  clearTimeout(timer)
  timer = setTimeout(run, delayMs)
}

// sesi yang gagal permanen dicoba lagi (mis. setelah admin memperbaiki sesuatu)
export async function retryFailed() {
  const items = await outbox.all()
  for (const item of items.filter(i => i.failed)) {
    item.failed = false
    item.lastError = null
    await outbox.put(item)
  }
  attempt = 0
  kick(0)
}

async function run() {
  if (running) return
  running = true
  // reset status "dicabut" (mis. setelah pairing ulang); diset lagi kalau masih ditolak
  emit({ uploading: true, unauthorized: false })

  try {
    const items = (await outbox.all())
      .filter(i => !i.failed)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

    for (const item of items) await uploadItem(item)

    attempt = 0
    emit({ lastError: null, unauthorized: false })
  } catch (err) {
    if (err.code === 'unauthorized') {
      // kiosk dicabut aksesnya: berhenti, data tetap aman di perangkat
      emit({ lastError: err.message, unauthorized: true })
    } else {
      const wait = RETRY_SECONDS[Math.min(attempt, RETRY_SECONDS.length - 1)]
      attempt++
      emit({ lastError: err.message })
      kick(wait * 1000)
    }
  } finally {
    running = false
    emit({ uploading: false })
    await refreshCounts()
  }
}

async function uploadItem(item) {
  try {
    if (!item.created) {
      await kioskApi('createSession', {
        sessionId: item.sessionId,
        downloadToken: item.downloadToken,
        templateId: item.templateId,
        photoCount: item.photos.length,
        createdAt: item.createdAt
      })
      item.created = true
      await outbox.put(item)
    }

    for (let i = 0; i < item.photos.length; i++) {
      if (item.uploaded[i]) continue
      await kioskApi('uploadFile', { sessionId: item.sessionId, kind: 'photo', index: i, data: item.photos[i] }, { timeoutMs: 120000 })
      item.uploaded[i] = true
      await outbox.put(item)
    }

    if (!item.finalUploaded) {
      await kioskApi('uploadFile', { sessionId: item.sessionId, kind: 'final', data: item.final }, { timeoutMs: 120000 })
    }

    await outbox.remove(item.sessionId)
  } catch (err) {
    if (PERMANENT_ERRORS.indexOf(err.code) !== -1) {
      item.failed = true
      item.lastError = err.message
      await outbox.put(item)
      return
    }
    throw err
  }
}

window.addEventListener('online', () => kick(0))
// jaga-jaga: cek antrian berkala
setInterval(() => kick(0), 60000)
