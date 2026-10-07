// views/print.js — antrean print & pengaturan stasiun cetak di laptop ini.
import { adminApi } from '../auth.js'
import { station, setStationEnabled, setPaused, onStationChange } from '../printer.js'
import { el, fill, toast, badge, fmtDate, timeAgo, emptyState, errorState, confirmDialog } from '../ui.js'

const REFRESH_MS = 5000
const STATUS_LABEL = {
  queued: ['Mengantre', 'warn'],
  printing: ['Mencetak…', 'warn'],
  failed: ['Gagal', 'bad'],
  done: ['Selesai', 'ok'],
  cancelled: ['Dibatalkan', 'neutral']
}

export function mount(root) {
  const stationBox = el('section', { class: 'card station' })
  const queueBox = el('div', { class: 'table-wrap' })
  const historyBox = el('div', { class: 'table-wrap' })

  root.append(
    el('header', { class: 'view-head' }, el('h1', { text: 'Antrean print' })),
    stationBox,
    el('h2', { class: 'section-title', text: 'Antrean' }),
    queueBox,
    el('h2', { class: 'section-title', text: 'Riwayat terakhir' }),
    historyBox
  )

  function renderStation() {
    const toggle = el('input', { type: 'checkbox', checked: station.enabled, onchange: e => setStationEnabled(e.target.checked) })

    let state
    if (!station.enabled) state = badge('Bukan stasiun cetak', 'neutral')
    else if (station.paused) state = badge('Dijeda', 'warn')
    else if (station.busy) state = badge('Sedang mencetak…', 'warn')
    else state = badge('Siap mencetak', 'ok')

    fill(stationBox,
      el('div', { class: 'station-head' },
        el('div', {},
          el('h2', { text: 'Stasiun cetak (laptop ini)' }),
          el('p', { class: 'muted', text: 'Aktifkan di laptop yang tersambung ke printer. Laptop ini akan mengambil antrean dan mencetak otomatis.' })
        ),
        state
      ),
      el('label', { class: 'switch' }, toggle, el('span', { text: 'Laptop ini tersambung ke printer' })),
      station.enabled ? el('div', { class: 'row' },
        el('button', {
          class: `btn ${station.paused ? 'btn-primary' : 'btn-outline'}`, type: 'button',
          text: station.paused ? '▶ Lanjutkan cetak' : '⏸ Jeda (printer belum tersambung)',
          onclick: () => setPaused(!station.paused)
        })
      ) : null,
      station.lastError ? el('p', { class: 'error-text', text: 'Error terakhir: ' + station.lastError }) : null,
      el('p', { class: 'muted small' },
        'Tips: buka Chrome dengan ', el('code', { text: '--kiosk-printing' }),
        ' supaya foto langsung tercetak ke printer default tanpa dialog.')
    )
  }

  async function load() {
    try {
      const [active, history] = await Promise.all([
        adminApi('listPrintJobs', { status: ['queued', 'printing', 'failed'], limit: 200 }),
        adminApi('listPrintJobs', { status: ['done', 'cancelled'], limit: 500 })
      ])
      queueBox.replaceChildren(active.length ? table(active, true) : emptyState('Antrean kosong.'))
      const recent = history.slice(-30).reverse()
      historyBox.replaceChildren(recent.length ? table(recent, false) : emptyState('Belum ada riwayat cetak.'))
    } catch (err) {
      if (err.code !== 'unauthorized') queueBox.replaceChildren(errorState(err, load))
    }
  }

  async function setStatus(job, status, message) {
    try {
      await adminApi('updatePrintJob', { jobId: job.id, status })
      toast(message, 'ok')
      load()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  function table(jobs, withActions) {
    return el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Foto' }), el('th', { text: 'Sesi' }), el('th', { text: 'Lembar' }),
        el('th', { text: 'Status' }), el('th', { text: 'Waktu' }), withActions ? el('th', { text: '' }) : null
      )),
      el('tbody', {}, jobs.map(job => {
        const [label, kind] = STATUS_LABEL[job.status] || [job.status, 'neutral']
        return el('tr', {},
          el('td', {}, job.final ? el('img', { class: 'job-thumb', src: job.final.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : '–'),
          el('td', { class: 'mono', text: job.sessionId }),
          el('td', { text: String(job.copies) }),
          el('td', {}, badge(label, kind), job.error ? el('div', { class: 'error-text small', text: job.error }) : null),
          el('td', { class: 'muted', text: withActions ? timeAgo(job.createdAt) : fmtDate(job.updatedAt) }),
          withActions ? el('td', { class: 'actions' },
            job.status !== 'queued' ? el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Cetak ulang', onclick: () => setStatus(job, 'queued', 'Masuk antrean lagi') }) : null,
            el('button', { class: 'btn btn-sm btn-outline', type: 'button', text: 'Tandai selesai', onclick: () => setStatus(job, 'done', 'Ditandai selesai') }),
            el('button', {
              class: 'btn btn-sm btn-ghost', type: 'button', text: 'Batalkan',
              onclick: async () => { if (await confirmDialog('Batalkan job print ini?', { okText: 'Batalkan', danger: true })) setStatus(job, 'cancelled', 'Job dibatalkan') }
            })
          ) : null
        )
      }))
    )
  }

  renderStation()
  load()
  const off = onStationChange(() => { renderStation(); load() })
  const timer = setInterval(load, REFRESH_MS)

  return { destroy: () => { clearInterval(timer); off() } }
}
