// printer.js — "stasiun cetak": laptop admin yang tersambung ke printer.
//
// Kalau diaktifkan di laptop ini, halaman admin mengambil job "queued" satu per
// satu dari GAS, mencetaknya, lalu melaporkan hasilnya (done / failed).
// Printer belum tersambung? Tekan "Jeda" → job tetap mengantre dan bisa
// dicetak nanti. Tidak ada yang hilang.
//
// Supaya tidak muncul dialog print setiap kali, buka Chrome dengan flag:
//   chrome --kiosk-printing https://<situs>/admin/
// (Chrome langsung mencetak ke printer default.)
import { adminApi } from './auth.js'

const STATION_KEY = 'pb.admin.printStation'
const PAUSED_KEY = 'pb.admin.printerPaused'
const POLL_MS = 5000
const HEARTBEAT_MS = 30000
const IMAGE_TIMEOUT_MS = 60000

const listeners = new Set()
let pollTimer = null
let heartbeatTimer = null
let busy = false
let lastError = null
let currentJob = null

function flag(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch (err) {
    return false
  }
}

export const station = {
  get enabled() { return flag(STATION_KEY) },
  get paused() { return flag(PAUSED_KEY) },
  get busy() { return busy },
  get currentJob() { return currentJob },
  get lastError() { return lastError }
}

export function onStationChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  listeners.forEach(fn => fn(station))
}

export function setStationEnabled(on) {
  localStorage.setItem(STATION_KEY, on ? '1' : '0')
  startStation()
  emit()
}

export function setPaused(on) {
  localStorage.setItem(PAUSED_KEY, on ? '1' : '0')
  sendHeartbeat()
  emit()
  if (!on) tick()
}

export function startStation() {
  clearInterval(pollTimer)
  clearInterval(heartbeatTimer)
  if (!station.enabled) return

  sendHeartbeat()
  recoverStaleJobs().then(tick)
  pollTimer = setInterval(tick, POLL_MS)
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS)
}

export function stopStation() {
  clearInterval(pollTimer)
  clearInterval(heartbeatTimer)
}

// job "printing" saat stasiun baru mulai = sisa dari halaman yang ditutup/di-refresh
// di tengah cetak → kembalikan ke antrean supaya tidak macet selamanya
async function recoverStaleJobs() {
  try {
    const stale = await adminApi('listPrintJobs', { status: 'printing', limit: 50 })
    for (const job of stale) {
      await adminApi('updatePrintJob', { jobId: job.id, status: 'queued' })
    }
  } catch (err) {
    // diabaikan; dicoba lagi saat stasiun dimulai ulang
  }
}

async function sendHeartbeat() {
  if (!station.enabled) return
  try {
    await adminApi('heartbeat', {
      info: { printStation: true, paused: station.paused, busy, lastError }
    }, { timeoutMs: 20000 })
  } catch (err) {
    // diabaikan; dicoba lagi di heartbeat berikutnya
  }
}

async function tick() {
  if (!station.enabled || station.paused || busy) return

  let jobs
  try {
    jobs = await adminApi('listPrintJobs', { status: 'queued', limit: 1 }, { timeoutMs: 30000 })
  } catch (err) {
    return
  }
  if (!jobs.length || busy || station.paused) return

  const job = jobs[0]
  busy = true
  currentJob = job
  emit()

  try {
    await adminApi('updatePrintJob', { jobId: job.id, status: 'printing' })
    if (!job.final) throw new Error('Foto final tidak ditemukan')
    await printImage(job.final.view, job.copies)
    await adminApi('updatePrintJob', { jobId: job.id, status: 'done' })
    lastError = null
  } catch (err) {
    lastError = err.message
    await adminApi('updatePrintJob', { jobId: job.id, status: 'failed', error: err.message }).catch(() => {})
  } finally {
    busy = false
    currentJob = null
    emit()
    sendHeartbeat()
  }
}

function waitForImage(img) {
  return new Promise((resolve, reject) => {
    if (img.complete) return img.naturalWidth ? resolve() : reject(new Error('Gambar rusak'))
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => reject(new Error('Gambar gagal dimuat')), { once: true })
  })
}

/**
 * Cetak gambar lewat iframe tersembunyi (1 halaman per salinan).
 * Ukuran kertas mengikuti pengaturan printer; gambar dipaskan ke halaman.
 */
export function printImage(src, copies = 1) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
    document.body.append(frame)

    const doc = frame.contentDocument
    const style = doc.createElement('style')
    style.textContent = '@page{margin:0}html,body{margin:0;height:100%}' +
      'img{display:block;width:100%;height:100vh;object-fit:contain;break-after:page}'
    doc.head.append(style)

    const images = []
    for (let i = 0; i < copies; i++) {
      const img = doc.createElement('img')
      img.src = src
      doc.body.append(img)
      images.push(img)
    }

    const cleanup = () => setTimeout(() => frame.remove(), 1000)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Gambar tidak bisa dimuat (periksa internet)'))
    }, IMAGE_TIMEOUT_MS)

    // catatan: jangan pakai img.decode() — di iframe 0×0 yang tidak dirender,
    // Chrome tidak pernah menyelesaikan promise-nya walau gambar sudah termuat
    Promise.all(images.map(waitForImage))
      .then(() => {
        clearTimeout(timer)
        frame.contentWindow.focus()
        frame.contentWindow.print()
        cleanup()
        resolve()
      })
      .catch(() => {
        clearTimeout(timer)
        cleanup()
        reject(new Error('Gambar tidak bisa dimuat'))
      })
  })
}
