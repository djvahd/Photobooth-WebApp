// app.js — alur kiosk:
//   (pairing) → Awal → Pilih frame → Kamera → Review/Ulangi → QR → Awal
import { CONFIG } from './config.js'
import { api } from '../../shared/api.js'
import { getDevice, setDevice, clearDevice, kioskApi } from './device.js'
import { outbox } from './db.js'
import { kick, onUploadState, getUploadState, refreshCounts, retryFailed } from './uploader.js'
import { startCamera, stopCamera, capturePhoto, cameraErrorMessage } from './camera.js'
import { composeImage } from './compose.js'
import { loadTemplates, getFrameSrc, preloadFrames } from './templates.js'
import qrcode from '../../shared/vendor/qrcode.mjs'

const $ = id => document.getElementById(id)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const SCREENS = ['pair', 'home', 'frames', 'camera', 'review', 'done']
const video = $('video')

let currentScreen = null
let screenTimers = []   // dibersihkan setiap pindah layar
let flowId = 0          // naik setiap pindah layar, untuk membatalkan alur async yang basi

// data sesi yang sedang berjalan
let session = null

/* =========================
   NAVIGASI
========================= */

function show(name) {
  screenTimers.forEach(t => clearTimeout(t))
  screenTimers = []
  flowId++
  SCREENS.forEach(s => { $('screen-' + s).hidden = s !== name })
  currentScreen = name
  document.body.dataset.screen = name
}

function after(ms, fn) {
  screenTimers.push(setTimeout(fn, ms))
}

// hitung mundur teks di layar, lalu panggil onDone
function countdownText(el, seconds, onDone) {
  let left = seconds
  el.textContent = left
  const tick = () => {
    left--
    el.textContent = Math.max(left, 0)
    if (left <= 0) onDone()
    else after(1000, tick)
  }
  after(1000, tick)
}

document.addEventListener('click', e => {
  const target = e.target.closest('[data-action="home"]')
  if (target) goHome()
})

/* =========================
   PAIRING
========================= */

function showPair(message) {
  stopCamera(video)
  show('pair')
  const err = $('pair-error')
  err.hidden = !message
  err.textContent = message || ''
  $('pair-code').value = ''
  $('pair-code').focus()
}

$('pair-form').addEventListener('submit', async e => {
  e.preventDefault()
  const code = $('pair-code').value.replace(/\D/g, '')
  const name = $('pair-name').value.trim() || 'Kiosk'
  const err = $('pair-error')
  const btn = $('pair-submit')

  if (code.length !== 6) {
    err.textContent = 'Kode pairing harus 6 digit'
    err.hidden = false
    return
  }

  btn.disabled = true
  btn.textContent = 'Menghubungkan…'
  try {
    const result = await api('pairDevice', { code, name })
    setDevice(result.deviceToken, result.name)
    kick(0)
    sendHeartbeat()
    goHome()
  } catch (error) {
    err.textContent = error.message
    err.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = 'Hubungkan'
  }
})

function handleUnauthorized() {
  clearDevice()
  showPair('Akses kiosk ini dicabut atau belum terdaftar. Hubungkan ulang dengan kode baru dari admin.')
}

/* =========================
   HALAMAN AWAL
========================= */

function setupBranding() {
  $('event-name').textContent = CONFIG.EVENT_NAME
  $('event-tagline').textContent = CONFIG.EVENT_TAGLINE
  document.title = CONFIG.EVENT_NAME
  if (CONFIG.EVENT_LOGO) {
    $('brand-logo-img').src = CONFIG.EVENT_LOGO
    $('brand-logo').hidden = false
  }
}

let templatesCache = null

function goHome() {
  if (!getDevice()) return showPair()
  stopCamera(video)
  session = null
  show('home')

  // siapkan template di belakang layar supaya layar berikutnya cepat
  loadTemplates()
    .then(list => {
      templatesCache = list
      preloadFrames(list)
    })
    .catch(err => {
      if (err.code === 'unauthorized') handleUnauthorized()
    })
}

$('start-btn').addEventListener('click', () => {
  enterFullscreen()
  openFrames()
})

/* =========================
   PILIH FRAME
========================= */

async function openFrames() {
  show('frames')
  const myFlow = flowId
  const grid = $('frame-grid')
  const err = $('frames-error')
  err.hidden = true
  grid.replaceChildren()

  after(CONFIG.IDLE_TIMEOUT_SECONDS * 1000, goHome)

  let list = templatesCache
  try {
    if (!list) list = templatesCache = await loadTemplates()
  } catch (error) {
    if (error.code === 'unauthorized') return handleUnauthorized()
    err.textContent = error.message
    err.hidden = false
    return
  }
  if (myFlow !== flowId) return

  // hanya satu frame → langsung ke kamera
  if (list.length === 1) return selectTemplate(list[0])

  for (const template of list) {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'frame-card'

    const thumb = document.createElement('div')
    thumb.className = 'frame-thumb'
    const img = document.createElement('img')
    img.alt = ''
    thumb.append(img)

    const name = document.createElement('span')
    name.className = 'frame-name'
    name.textContent = template.name

    const count = document.createElement('span')
    count.className = 'frame-count'
    count.textContent = `${template.config.slots.length} foto`

    card.append(thumb, name, count)
    card.addEventListener('click', () => selectTemplate(template, card))
    grid.append(card)

    // pratinjau dengan kotak bernomor
    getFrameSrc(template)
      .then(src => composeImage(template, [], src, { width: 320, placeholders: true, type: 'image/png' }))
      .then(dataUrl => { img.src = dataUrl })
      .catch(() => { thumb.textContent = 'Pratinjau tidak tersedia' })
  }
}

async function selectTemplate(template, card) {
  if (card) card.classList.add('is-loading')
  try {
    const frameSrc = await getFrameSrc(template)
    session = {
      template,
      frameSrc,
      photos: new Array(template.config.slots.length).fill(null),
      final: null
    }
    openCamera(session.photos.map((_, i) => i))
  } catch (error) {
    if (card) card.classList.remove('is-loading')
    if (error.code === 'unauthorized') return handleUnauthorized()
    $('frames-error').textContent = 'Frame ini belum bisa dimuat (periksa internet). Pilih frame lain.'
    $('frames-error').hidden = false
  }
}

/* =========================
   KAMERA
========================= */

async function openCamera(indices) {
  show('camera')
  const myFlow = flowId
  const total = session.photos.length

  $('camera-error').hidden = true
  $('countdown').hidden = true
  $('camera-actions').hidden = false
  $('shot-progress').textContent = indices.length === 1 && total > 1
    ? `Ulangi foto ${indices[0] + 1}`
    : `Foto 1 dari ${total}`

  try {
    await startCamera(video)
  } catch (err) {
    $('camera-error-text').textContent = cameraErrorMessage(err)
    $('camera-error').hidden = false
    $('camera-actions').hidden = true
    return
  }
  if (myFlow !== flowId) return

  let started = false
  const begin = () => {
    if (started) return
    started = true
    shoot(indices, myFlow)
  }
  $('shoot-btn').onclick = begin
  countdownText($('auto-start'), CONFIG.AUTO_START_SECONDS, begin)
}

async function shoot(indices, myFlow) {
  $('camera-actions').hidden = true
  const total = session.photos.length

  for (let n = 0; n < indices.length; n++) {
    const index = indices[n]
    if (indices.length > 1 || total === 1) $('shot-progress').textContent = `Foto ${index + 1} dari ${total}`

    await bigCountdown(CONFIG.COUNTDOWN_SECONDS, myFlow)
    if (myFlow !== flowId) return

    flash()
    session.photos[index] = capturePhoto(video, CONFIG.PHOTO_MAX_SIZE, CONFIG.PHOTO_QUALITY)
    await wait(CONFIG.BETWEEN_SHOTS_MS)
    if (myFlow !== flowId) return
  }

  openReview()
}

async function bigCountdown(seconds, myFlow) {
  const el = $('countdown')
  el.hidden = false
  for (let s = seconds; s > 0; s--) {
    if (myFlow !== flowId) return
    const num = document.createElement('span')
    num.textContent = s
    el.replaceChildren(num)
    await wait(1000)
  }
  el.hidden = true
  el.replaceChildren()
}

function flash() {
  const el = $('flash')
  el.classList.remove('is-on')
  void el.offsetWidth // ulang animasi
  el.classList.add('is-on')
}

/* =========================
   REVIEW
========================= */

async function openReview() {
  show('review')
  const myFlow = flowId
  const list = $('review-photos')
  list.replaceChildren()

  session.photos.forEach((src, i) => {
    const item = document.createElement('div')
    item.className = 'review-photo'

    const img = document.createElement('img')
    img.src = src
    img.alt = `Foto ${i + 1}`

    const num = document.createElement('span')
    num.className = 'num'
    num.textContent = i + 1

    const retake = document.createElement('button')
    retake.type = 'button'
    retake.className = 'btn'
    retake.textContent = '↺ Ulangi'
    retake.addEventListener('click', () => openCamera([i]))

    item.append(img, num, retake)
    list.append(item)
  })

  const confirmBtn = $('confirm-btn')
  confirmBtn.disabled = true
  $('review-final').removeAttribute('src')

  session.final = await composeImage(session.template, session.photos, session.frameSrc, { quality: CONFIG.FINAL_QUALITY })
  if (myFlow !== flowId) return

  $('review-final').src = session.final
  confirmBtn.disabled = false
  confirmBtn.onclick = finishSession
  countdownText($('review-timer'), CONFIG.REVIEW_TIMEOUT_SECONDS, finishSession)
}

/* =========================
   SELESAI → simpan ke antrean upload + tampilkan QR
========================= */

let finishing = false

async function finishSession() {
  if (finishing || !session || !session.final) return
  finishing = true

  try {
    const now = new Date()
    const item = {
      sessionId: newSessionId(now),
      downloadToken: randomToken(),
      templateId: session.template.builtin ? '' : session.template.id,
      createdAt: now.toISOString(),
      photos: session.photos,
      final: session.final,
      created: false,
      uploaded: session.photos.map(() => false),
      finalUploaded: false,
      failed: false,
      lastError: null
    }
    await outbox.put(item)
    await refreshCounts()
    kick(0)

    stopCamera(video)
    showDone(CONFIG.DOWNLOAD_PAGE + '#t=' + item.downloadToken)
  } finally {
    finishing = false
  }
}

function showDone(url) {
  show('done')
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  // SVG dibuat dari URL milik sendiri (bukan input pengguna)
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true })
  countdownText($('done-timer'), CONFIG.DONE_TIMEOUT_SECONDS, goHome)
}

// contoh: 20261007-143005-k3x9qa
function newSessionId(d) {
  const p = n => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => alphabet[b % alphabet.length]).join('')
  return `${date}-${time}-${rand}`
}

// 32 karakter acak (192 bit) untuk link download
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* =========================
   STATUS & HEARTBEAT
========================= */

function renderStatus(state) {
  const chip = $('status-chip')
  chip.classList.remove('is-ok', 'is-warn', 'is-bad')

  if (!navigator.onLine) {
    chip.classList.add('is-bad')
    chip.textContent = state.pending ? `Offline · ${state.pending} sesi menunggu upload` : 'Offline · foto tetap tersimpan'
  } else if (state.failed) {
    chip.classList.add('is-bad')
    chip.textContent = `${state.failed} sesi gagal diupload`
  } else if (state.pending && state.lastError) {
    chip.classList.add('is-warn')
    chip.textContent = `${state.pending} sesi menunggu upload · server belum terjangkau`
  } else if (state.pending) {
    chip.classList.add('is-warn')
    chip.textContent = `Mengupload ${state.pending} sesi…`
  } else {
    chip.classList.add('is-ok')
    chip.textContent = 'Terhubung · semua foto terupload'
  }

  if (state.unauthorized && getDevice()) handleUnauthorized()
}

async function sendHeartbeat() {
  if (!getDevice()) return
  const state = getUploadState()
  try {
    await kioskApi('heartbeat', {
      info: {
        screen: currentScreen,
        online: navigator.onLine,
        pendingUploads: state.pending,
        failedUploads: state.failed,
        lastError: state.lastError
      }
    }, { timeoutMs: 20000 })
  } catch (err) {
    if (err.code === 'unauthorized') handleUnauthorized()
  }
}

/* =========================
   PENGATURAN (tekan lama 2 detik pada judul halaman awal)
========================= */

function setupSettings() {
  const dialog = $('settings')
  let pressTimer = null

  const start = () => { pressTimer = setTimeout(openSettings, 2000) }
  const cancel = () => clearTimeout(pressTimer)
  const brand = $('home-brand')
  brand.addEventListener('pointerdown', start)
  brand.addEventListener('pointerup', cancel)
  brand.addEventListener('pointerleave', cancel)

  function openSettings() {
    const device = getDevice()
    const state = getUploadState()
    $('set-device').textContent = device ? device.name : '–'
    $('set-pending').textContent = `${state.pending} sesi`
    $('set-failed').textContent = `${state.failed} sesi`
    $('set-error').textContent = state.lastError || (navigator.onLine ? 'Normal' : 'Offline')
    dialog.showModal()
  }

  $('set-close').addEventListener('click', () => dialog.close())
  $('set-retry').addEventListener('click', () => { retryFailed(); dialog.close() })
  $('set-fullscreen').addEventListener('click', () => { enterFullscreen(); dialog.close() })
  $('set-unpair').addEventListener('click', () => {
    if (!confirm('Putuskan kiosk ini? Foto yang belum terupload tetap tersimpan di perangkat.')) return
    dialog.close()
    clearDevice()
    showPair()
  })
}

/* =========================
   LAYAR PENUH & LAYAR TETAP MENYALA
========================= */

function enterFullscreen() {
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {})
  }
}

let wakeLock = null
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen')
    }
  } catch (err) {
    wakeLock = null
  }
}
document.addEventListener('visibilitychange', keepScreenOn)

/* =========================
   MULAI
========================= */

setupBranding()
setupSettings()
onUploadState(renderStatus)
window.addEventListener('online', () => renderStatus(getUploadState()))
window.addEventListener('offline', () => renderStatus(getUploadState()))
refreshCounts().then(() => kick(0))
setInterval(sendHeartbeat, CONFIG.HEARTBEAT_SECONDS * 1000)
keepScreenOn()

if (getDevice()) {
  goHome()
  sendHeartbeat()
} else {
  showPair()
}
