// views/settings.js — auto-print, notifikasi browser, akun.
import { adminApi, logout } from '../auth.js'
import { el, toast, errorState } from '../ui.js'
import { api } from '../../../shared/api.js'

export function mount(root) {
  const printCard = el('section', { class: 'card' }, el('p', { class: 'muted', text: 'Memuat…' }))
  const notifCard = el('section', { class: 'card' })
  const accountCard = el('section', { class: 'card' })

  root.append(
    el('header', { class: 'view-head' }, el('h1', { text: 'Pengaturan' })),
    el('div', { class: 'settings-grid' }, printCard, notifCard, accountCard)
  )

  async function loadPrint() {
    let settings
    try {
      settings = await adminApi('getSettings')
    } catch (err) {
      if (err.code !== 'unauthorized') printCard.replaceChildren(errorState(err, loadPrint))
      return
    }

    const auto = el('input', { type: 'checkbox', checked: settings.autoPrint })
    const copies = el('select', { class: 'input input-sm' },
      [1, 2, 3, 4, 5].map(n => el('option', { value: String(n), text: `${n} lembar`, selected: n === settings.autoPrintCopies })))
    const save = el('button', {
      class: 'btn btn-primary', type: 'button', text: 'Simpan',
      onclick: async () => {
        save.disabled = true
        try {
          await adminApi('saveSettings', { settings: { autoPrint: auto.checked, autoPrintCopies: Number(copies.value) } })
          toast('Pengaturan disimpan', 'ok')
        } catch (err) {
          toast(err.message, 'bad')
        } finally {
          save.disabled = false
        }
      }
    })

    printCard.replaceChildren(
      el('h2', { text: 'Cetak otomatis' }),
      el('p', { class: 'muted', text: 'Setiap sesi yang selesai diupload langsung masuk antrean print, tanpa perlu klik Cetak.' }),
      el('label', { class: 'switch' }, auto, el('span', { text: 'Cetak otomatis setiap sesi' })),
      el('div', { class: 'row' }, el('span', { text: 'Jumlah per sesi' }), copies),
      el('div', { class: 'row' }, save)
    )
  }

  function renderNotif() {
    const supported = 'Notification' in window
    const permission = supported ? Notification.permission : 'unsupported'
    notifCard.replaceChildren(
      el('h2', { text: 'Notifikasi' }),
      el('p', { class: 'muted', text: 'Tampilkan notifikasi browser saat kiosk offline, upload gagal, atau print bermasalah.' }),
      permission === 'granted' ? el('p', { class: 'ok-text', text: '✓ Notifikasi aktif di browser ini' })
        : permission === 'denied' ? el('p', { class: 'error-text', text: 'Notifikasi diblokir. Izinkan lewat ikon gembok di address bar.' })
          : permission === 'unsupported' ? el('p', { class: 'muted', text: 'Browser ini tidak mendukung notifikasi.' })
            : el('button', {
              class: 'btn btn-outline', type: 'button', text: 'Aktifkan notifikasi',
              onclick: async () => { await Notification.requestPermission(); renderNotif() }
            })
    )
  }

  async function renderAccount() {
    let version = '…'
    accountCard.replaceChildren(
      el('h2', { text: 'Akun' }),
      el('p', { class: 'muted', text: 'Password admin diatur di Apps Script: Project Settings → Script Properties → ADMIN_PASSWORD.' }),
      el('button', {
        class: 'btn btn-outline', type: 'button', text: 'Keluar',
        onclick: async () => { await logout(); location.hash = '' ; location.reload() }
      })
    )
    try {
      version = (await api('ping')).version
    } catch (err) {
      version = 'tidak terjangkau'
    }
    accountCard.append(el('p', { class: 'muted small', text: `Versi backend: ${version}` }))
  }

  loadPrint()
  renderNotif()
  renderAccount()
  return { destroy() {} }
}
