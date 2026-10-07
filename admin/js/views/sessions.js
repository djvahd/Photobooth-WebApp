// views/sessions.js — daftar sesi foto, detail, QR/link download, dan cetak.
import { adminApi } from '../auth.js'
import { el, fill, toast, openModal, badge, fmtDate, timeAgo, emptyState, errorState } from '../ui.js'
import qrcode from '../../../shared/vendor/qrcode.mjs'

const PAGE_SIZE = 24
const REFRESH_MS = 20000
const DOWNLOAD_PAGE = new URL('../download/', location.href).href

const STATUS_BADGE = {
  complete: ['Selesai', 'ok'],
  uploading: ['Mengupload', 'warn'],
  incomplete: ['Tidak lengkap', 'bad']
}

export function mount(root) {
  let query = ''
  let items = []
  let total = 0
  let searchTimer = null

  const search = el('input', { class: 'input', type: 'search', placeholder: 'Cari ID sesi…', 'aria-label': 'Cari sesi' })
  const count = el('span', { class: 'muted' })
  const grid = el('div', { class: 'session-grid' })
  const more = el('button', { class: 'btn btn-outline', type: 'button', text: 'Muat lebih banyak', hidden: true })

  root.append(
    el('header', { class: 'view-head' },
      el('div', {}, el('h1', { text: 'Sesi foto' }), count),
      el('div', { class: 'view-tools' }, search,
        el('button', { class: 'btn btn-outline', type: 'button', text: '↻ Muat ulang', onclick: () => load(true) }))
    ),
    grid,
    el('div', { class: 'center' }, more)
  )

  search.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      query = search.value.trim()
      load(true)
    }, 350)
  })
  more.addEventListener('click', () => load(false))

  async function load(reset) {
    try {
      const result = await adminApi('listSessions', { query, limit: PAGE_SIZE, offset: reset ? 0 : items.length })
      items = reset ? result.items : items.concat(result.items)
      total = result.total
      render()
    } catch (err) {
      if (err.code === 'unauthorized') return
      grid.replaceChildren(errorState(err, () => load(true)))
    }
  }

  function render() {
    count.textContent = `${total} sesi`
    more.hidden = items.length >= total
    if (!items.length) {
      grid.replaceChildren(emptyState(query ? 'Tidak ada sesi yang cocok.' : 'Belum ada sesi foto.'))
      return
    }
    grid.replaceChildren(...items.map(card))
  }

  function card(s) {
    const [label, kind] = STATUS_BADGE[s.status] || [s.status, 'neutral']
    return el('button', { class: 'session-card', type: 'button', onclick: () => openDetail(s.id) },
      el('div', { class: 'session-thumb' },
        s.thumb ? el('img', { src: s.thumb.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'muted', text: 'Belum ada foto' })
      ),
      el('div', { class: 'session-meta' },
        el('strong', { class: 'mono', text: s.id }),
        el('span', { class: 'muted small', text: timeAgo(s.createdAt) }),
        el('div', { class: 'badges' },
          badge(label, kind),
          s.legacy ? badge('Akun lama', 'neutral') : null,
          s.prints.done ? badge(`Dicetak ${s.prints.done}×`, 'ok') : null,
          s.prints.queued ? badge('Antre cetak', 'warn') : null,
          s.prints.failed ? badge('Cetak gagal', 'bad') : null
        )
      )
    )
  }

  load(true)
  // muat ulang berkala hanya saat melihat halaman pertama tanpa pencarian
  const timer = setInterval(() => {
    if (!query && items.length <= PAGE_SIZE && !document.querySelector('dialog[open]')) load(true)
  }, REFRESH_MS)

  return { destroy: () => clearInterval(timer) }
}

/* =========================
   DETAIL SESI
========================= */

async function openDetail(sessionId) {
  const body = el('div', { class: 'detail' }, el('p', { class: 'muted', text: 'Memuat…' }))
  const modal = openModal({ title: `Sesi ${sessionId}`, body, wide: true })

  let s
  try {
    s = await adminApi('getSession', { sessionId })
  } catch (err) {
    body.replaceChildren(errorState(err))
    return
  }

  const link = DOWNLOAD_PAGE + '#t=' + s.downloadToken
  const qr = qrcode(0, 'M')
  qr.addData(link)
  qr.make()
  const qrBox = el('div', { class: 'qr' })
  // SVG dibuat oleh library dari link milik sendiri (bukan input pengguna)
  qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true })

  const copies = el('select', { class: 'input input-sm', 'aria-label': 'Jumlah cetak' },
    [1, 2, 3, 4, 5].map(n => el('option', { value: String(n), text: `${n} lembar` }))
  )
  const printBtn = el('button', {
    class: 'btn btn-primary', type: 'button', text: '🖨 Cetak',
    disabled: s.status !== 'complete',
    onclick: async () => {
      printBtn.disabled = true
      try {
        await adminApi('enqueuePrint', { sessionId: s.id, copies: Number(copies.value) })
        toast('Masuk antrean print', 'ok')
        modal.close()
      } catch (err) {
        toast(err.message, 'bad')
        printBtn.disabled = false
      }
    }
  })

  const copyBtn = el('button', {
    class: 'btn btn-outline', type: 'button', text: 'Salin link',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(link)
        toast('Link disalin', 'ok')
      } catch (err) {
        toast('Gagal menyalin link', 'bad')
      }
    }
  })

  fill(body,
    el('div', { class: 'detail-main' },
      el('div', { class: 'detail-final' },
        s.final
          ? el('img', { src: s.final.view, alt: 'Foto dengan frame', referrerpolicy: 'no-referrer' })
          : el('p', { class: 'muted', text: `Foto final belum diupload (${s.uploadedPhotos}/${s.photoCount} foto masuk).` })
      ),
      el('aside', { class: 'detail-side' },
        el('dl', { class: 'facts' },
          el('dt', { text: 'Waktu' }), el('dd', { text: fmtDate(s.createdAt) }),
          el('dt', { text: 'Status' }), el('dd', { text: (STATUS_BADGE[s.status] || [s.status])[0] }),
          el('dt', { text: 'Foto' }), el('dd', { text: `${s.uploadedPhotos}/${s.photoCount}` }),
          el('dt', { text: 'Perangkat' }), el('dd', { class: 'mono', text: s.deviceId || '–' })
        ),
        el('div', { class: 'detail-print' }, copies, printBtn),
        el('h3', { text: 'Link download tamu' }),
        qrBox,
        el('div', { class: 'row' }, copyBtn,
          el('a', { class: 'btn btn-outline', href: link, target: '_blank', rel: 'noopener', text: 'Buka' })),
        s.printJobs.length ? el('h3', { text: 'Riwayat cetak' }) : null,
        s.printJobs.length ? el('ul', { class: 'mini-list' },
          s.printJobs.map(j => el('li', {}, `${fmtDate(j.createdAt)} · ${j.copies} lembar · ${j.status}${j.error ? ' (' + j.error + ')' : ''}`))) : null
      )
    ),
    s.photos.length ? el('h3', { text: 'Foto satu per satu' }) : null,
    el('div', { class: 'detail-photos' },
      s.photos.map((p, i) => el('a', { href: p.download, target: '_blank', rel: 'noopener', title: `Download foto ${i + 1}` },
        el('img', { src: p.thumb, alt: `Foto ${i + 1}`, loading: 'lazy', referrerpolicy: 'no-referrer' })))
    )
  )
}
