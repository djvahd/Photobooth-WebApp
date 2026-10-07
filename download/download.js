// download.js — tamu membuka link dari QR: /download/#t=<token>
// Token ada di bagian "#", jadi tidak terkirim ke server Netlify / tidak masuk log.
import { api } from '../shared/api.js'
import { BRAND } from '../shared/brand.js'

const $ = id => document.getElementById(id)

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
const POLL_MS = 5000                 // cek ulang saat foto belum siap
const MAX_WAIT_MS = 10 * 60 * 1000   // setelah ini tampilkan "belum tersedia"
const STATES = ['loading', 'processing', 'slow', 'error', 'ready']

let pollTimer = null

function showState(name) {
  STATES.forEach(s => { $('state-' + s).hidden = s !== name })
}

function readToken() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('t')
  const fromQuery = new URLSearchParams(location.search).get('t')
  const token = fromHash || fromQuery
  return token && TOKEN_PATTERN.test(token) ? token : null
}

function showError(title, text, canRetry) {
  $('error-title').textContent = title
  $('error-text').textContent = text
  $('error-retry').hidden = !canRetry
  showState('error')
}

async function load(token, startedAt) {
  clearTimeout(pollTimer)

  let data
  try {
    data = await api('getDownload', { token }, { timeoutMs: 30000 })
  } catch (err) {
    if (err.network) {
      // koneksi HP bermasalah: coba lagi diam-diam
      $('processing-detail').textContent = 'Koneksi bermasalah, mencoba lagi…'
      showState('processing')
      pollTimer = setTimeout(() => load(token, startedAt), POLL_MS)
      return
    }
    showError('Terjadi kesalahan', err.message, true)
    return
  }

  if (data.status === 'complete') {
    render(data)
    return
  }

  $('processing-detail').textContent = data.expected
    ? `${data.received} dari ${data.expected} file sudah diterima`
    : 'Menunggu foto dari photobooth…'
  showState('processing')

  if (Date.now() - startedAt < MAX_WAIT_MS) {
    pollTimer = setTimeout(() => load(token, startedAt), POLL_MS)
  } else {
    showState('slow')
  }
}

// gambar dari Drive; kalau URL thumbnail gagal, coba URL cadangan sekali
function driveImage(img, file, size) {
  img.src = file.view
  img.onerror = () => {
    img.onerror = null
    img.src = `https://lh3.googleusercontent.com/d/${encodeURIComponent(file.id)}=w${size}`
  }
}

function render(data) {
  driveImage($('final-img'), data.final, 2000)
  $('final-download').href = data.final.download

  if (data.createdAt) {
    const date = new Date(data.createdAt)
    $('taken-at').textContent = 'Diambil ' + date.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })
  }

  const grid = $('photo-grid')
  grid.replaceChildren()
  data.photos.forEach((file, i) => {
    const card = document.createElement('div')
    card.className = 'photo-card'

    const img = document.createElement('img')
    img.alt = `Foto ${i + 1}`
    img.loading = 'lazy'
    driveImage(img, file, 1200)

    const link = document.createElement('a')
    link.href = file.download
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = `⬇ Foto ${i + 1}`

    card.append(img, link)
    grid.append(card)
  })
  $('photos-section').hidden = data.photos.length === 0

  showState('ready')
}

function setupBranding() {
  $('event-name').textContent = BRAND.EVENT_NAME
  document.title = `Fotomu · ${BRAND.EVENT_NAME}`
  if (BRAND.EVENT_LOGO) {
    $('brand-logo-img').src = BRAND.EVENT_LOGO
    $('brand-logo').hidden = false
  }
}

function start() {
  const token = readToken()
  if (!token) {
    showError('Link tidak valid', 'Pastikan kamu membuka link dari QR code photobooth.', false)
    return
  }
  showState('loading')
  load(token, Date.now())
}

$('slow-retry').addEventListener('click', start)
$('error-retry').addEventListener('click', start)
window.addEventListener('hashchange', start)

setupBranding()
start()
