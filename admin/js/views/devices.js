// views/devices.js — kiosk terdaftar, status online, tambah kiosk (pairing), cabut akses.
import { adminApi } from '../auth.js'
import { onStatus, summarize } from '../status.js'
import { el, fill, toast, openModal, badge, timeAgo, emptyState, confirmDialog } from '../ui.js'

export function mount(root) {
  const list = el('div', { class: 'device-list' }, emptyState('Memuat…'))
  const station = el('section', { class: 'card' })

  root.append(
    el('header', { class: 'view-head' },
      el('div', {}, el('h1', { text: 'Perangkat' }), el('p', { class: 'muted', text: 'Kiosk yang terhubung ke sistem.' })),
      el('button', { class: 'btn btn-primary', type: 'button', text: '+ Tambah kiosk', onclick: addKiosk })
    ),
    list,
    el('h2', { class: 'section-title', text: 'Stasiun cetak' }),
    station
  )

  function render(status) {
    const s = summarize(status)

    list.replaceChildren(...(s.kiosks.length ? s.kiosks.map(k => el('article', { class: 'card device' },
      el('div', { class: 'device-head' },
        el('div', {}, el('h3', { text: k.name }), el('span', { class: 'muted small mono', text: k.id })),
        k.online ? badge('Online', 'ok') : badge(k.heartbeat ? 'Offline' : 'Belum pernah aktif', k.heartbeat ? 'bad' : 'neutral')
      ),
      el('dl', { class: 'facts' },
        el('dt', { text: 'Terakhir aktif' }), el('dd', { text: k.heartbeat ? timeAgo(k.heartbeat.at) : 'belum pernah' }),
        el('dt', { text: 'Menunggu upload' }), el('dd', { text: `${Number(k.info.pendingUploads) || 0} sesi` }),
        el('dt', { text: 'Gagal upload' }), el('dd', { text: `${Number(k.info.failedUploads) || 0} sesi` }),
        k.info.lastError ? el('dt', { text: 'Error terakhir' }) : null,
        k.info.lastError ? el('dd', { class: 'error-text', text: String(k.info.lastError) }) : null
      ),
      el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Cabut akses', onclick: () => revoke(k) })
    )) : [emptyState('Belum ada kiosk. Klik "Tambah kiosk" untuk menghubungkan perangkat pertama.')]))

    const st = s.station
    fill(station,
      el('div', { class: 'device-head' },
        el('div', {},
          el('h3', { text: 'Laptop printer' }),
          el('span', { class: 'muted small', text: st.lastSeen ? `Terakhir aktif ${timeAgo(st.lastSeen)}` : 'Belum pernah aktif' })
        ),
        !st.online ? badge('Offline', 'bad') : st.paused ? badge('Dijeda', 'warn') : badge('Siap', 'ok')
      ),
      st.lastError ? el('p', { class: 'error-text small', text: 'Error terakhir: ' + st.lastError }) : null,
      el('p', { class: 'muted small', text: 'Atur di menu Antrean print pada laptop yang tersambung ke printer.' })
    )
  }

  async function addKiosk() {
    let result
    try {
      result = await adminApi('createPairingCode')
    } catch (err) {
      toast(err.message, 'bad')
      return
    }

    const timer = el('b', { text: '10:00' })
    const modal = openModal({
      title: 'Tambah kiosk',
      body: el('div', { class: 'pair-box' },
        el('p', { text: 'Di perangkat kiosk, buka halaman kiosk lalu masukkan kode ini:' }),
        el('div', { class: 'pair-code', text: result.code }),
        el('p', { class: 'muted' }, 'Berlaku ', timer, ' · hanya bisa dipakai sekali.')
      ),
      actions: [el('button', { class: 'btn btn-primary', type: 'button', text: 'Selesai', onclick: () => modal.close() })],
      onClose: () => clearInterval(tick)
    })

    const expires = Date.now() + result.expiresIn * 1000
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((expires - Date.now()) / 1000))
      timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
      if (!left) clearInterval(tick)
    }, 1000)
  }

  async function revoke(device) {
    const ok = await confirmDialog(`Cabut akses "${device.name}"? Kiosk ini harus di-pairing ulang untuk dipakai lagi. Foto yang belum terupload tetap tersimpan di perangkat itu.`, { okText: 'Cabut akses', danger: true })
    if (!ok) return
    try {
      await adminApi('revokeDevice', { deviceId: device.id })
      toast('Akses dicabut', 'ok')
      if (refreshStatus) refreshStatus()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const off = onStatus(render)
  return { destroy: off }
}

// diisi app.js supaya halaman ini bisa meminta status terbaru
let refreshStatus = null
export function setStatusRefresher(fn) {
  refreshStatus = fn
}
