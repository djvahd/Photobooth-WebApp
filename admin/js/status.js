// status.js — bar status di atas halaman admin + peringatan.
// Mengambil getStatus setiap 15 detik; masalah ditampilkan sebagai banner merah
// dan (kalau diizinkan) notifikasi browser.
import { adminApi } from './auth.js'
import { el } from './ui.js'

const POLL_MS = 15000
const KIOSK_OFFLINE_MS = 3 * 60 * 1000      // kiosk heartbeat tiap 60 dtk
const STATION_OFFLINE_MS = 2 * 60 * 1000    // stasiun cetak heartbeat tiap 30 dtk

let timer = null
let lastAlertKeys = new Set()
const listeners = new Set()
let latest = null

export function onStatus(fn) {
  listeners.add(fn)
  if (latest) fn(latest)
  return () => listeners.delete(fn)
}

export function startStatus(bar, banner) {
  stopStatus()
  const refresh = async () => {
    try {
      latest = await adminApi('getStatus', {}, { timeoutMs: 30000 })
      render(bar, banner, latest)
      listeners.forEach(fn => fn(latest))
    } catch (err) {
      if (err.code !== 'unauthorized') {
        bar.replaceChildren(chip('Tidak bisa terhubung ke server', 'bad'))
      }
    }
  }
  refresh()
  timer = setInterval(refresh, POLL_MS)
  return refresh
}

export function stopStatus() {
  clearInterval(timer)
}

function isFresh(heartbeat, maxAgeMs) {
  return !!heartbeat && Date.now() - new Date(heartbeat.at).getTime() < maxAgeMs
}

// ringkasan yang dipakai bar status & halaman lain
export function summarize(status) {
  const kiosks = status.devices.map(d => ({
    ...d,
    online: isFresh(d.heartbeat, KIOSK_OFFLINE_MS),
    info: (d.heartbeat && d.heartbeat.info) || {}
  }))
  const admin = status.admin
  const stationInfo = (admin && admin.info) || {}
  const stationOnline = !!stationInfo.printStation && isFresh(admin, STATION_OFFLINE_MS)

  return {
    kiosks,
    kiosksOnline: kiosks.filter(k => k.online).length,
    pendingUploads: kiosks.reduce((sum, k) => sum + (Number(k.info.pendingUploads) || 0), 0),
    failedUploads: kiosks.reduce((sum, k) => sum + (Number(k.info.failedUploads) || 0), 0),
    station: {
      online: stationOnline,
      paused: !!stationInfo.paused,
      lastError: stationInfo.lastError || null,
      lastSeen: admin ? admin.at : null
    },
    printQueue: status.printQueue
  }
}

function chip(text, kind) {
  return el('span', { class: `chip${kind ? ' is-' + kind : ''}`, text })
}

function render(bar, banner, status) {
  const s = summarize(status)

  let stationChip
  if (!s.station.online) stationChip = chip('Stasiun cetak offline', s.printQueue.queued ? 'bad' : '')
  else if (s.station.paused) stationChip = chip('Printer dijeda', 'warn')
  else stationChip = chip('Printer siap', 'ok')

  bar.replaceChildren(
    chip(`Kiosk online: ${s.kiosksOnline}/${s.kiosks.length}`, s.kiosks.length && !s.kiosksOnline ? 'bad' : s.kiosksOnline ? 'ok' : ''),
    chip(`Menunggu upload: ${s.pendingUploads}`, s.pendingUploads ? 'warn' : 'ok'),
    chip(`Antrean print: ${s.printQueue.queued + s.printQueue.printing}`, s.printQueue.queued ? 'warn' : 'ok'),
    stationChip
  )

  // ===== peringatan =====
  const alerts = []
  s.kiosks.filter(k => k.heartbeat && !k.online).forEach(k => {
    alerts.push({ key: 'kiosk-' + k.id, text: `Kiosk "${k.name}" tidak terhubung (offline).` })
  })
  if (s.failedUploads) alerts.push({ key: 'upload-failed', text: `${s.failedUploads} sesi gagal diupload dari kiosk — cek menu Perangkat.` })
  if (s.printQueue.failed) alerts.push({ key: 'print-failed', text: `${s.printQueue.failed} job print gagal — buka Antrean print untuk cetak ulang.` })
  if (s.printQueue.queued && !s.station.online) alerts.push({ key: 'station-offline', text: 'Ada foto menunggu dicetak, tapi stasiun cetak offline. Nyalakan stasiun cetak di laptop printer.' })
  if (s.printQueue.queued && s.station.online && s.station.paused) alerts.push({ key: 'station-paused', text: 'Printer dijeda — foto tetap mengantre sampai dilanjutkan.' })

  banner.hidden = alerts.length === 0
  banner.replaceChildren(...alerts.map(a => el('p', { text: '⚠ ' + a.text })))

  notifyNew(alerts)
}

function notifyNew(alerts) {
  const keys = new Set(alerts.map(a => a.key))
  const fresh = alerts.filter(a => !lastAlertKeys.has(a.key))
  lastAlertKeys = keys
  if (!fresh.length) return

  if ('Notification' in window && Notification.permission === 'granted') {
    fresh.forEach(a => new Notification('Photobooth Admin', { body: a.text, tag: a.key }))
  }
  beep()
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
  } catch (err) {
    // browser tidak mendukung audio — abaikan
  }
}
