// ui.js — helper kecil untuk membuat elemen, toast, dialog, dan format waktu.

const PROPS = ['value', 'checked', 'disabled', 'hidden', 'selected', 'type', 'min', 'max', 'step']

/**
 * el('button', { class: 'btn', onclick: fn, text: 'Simpan' }, child1, child2)
 * Teks selalu dimasukkan sebagai teks biasa (bukan HTML) → aman dari XSS.
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value)
    else if (PROPS.includes(key)) node[key] = value
    else node.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : String(child))
  }
  return node
}

// ganti isi elemen; null/false dilewati (replaceChildren biasa menulisnya jadi teks "null")
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter(c => c !== null && c !== undefined && c !== false))
}

/* =========================
   TOAST
========================= */

export function toast(message, type = 'info') {
  let box = document.getElementById('toasts')
  if (!box) {
    box = el('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' })
    document.body.append(box)
  }
  const item = el('div', { class: `toast toast-${type}`, text: message })
  box.append(item)
  setTimeout(() => item.classList.add('is-leaving'), 3500)
  setTimeout(() => item.remove(), 4000)
}

/* =========================
   DIALOG
========================= */

// openModal({ title, body: Node, actions: [Node], wide }) → { dialog, close }
export function openModal({ title, body, actions = [], wide = false, onClose }) {
  const dialog = el('dialog', { class: `modal${wide ? ' modal-wide' : ''}` },
    el('div', { class: 'modal-head' },
      el('h2', { text: title }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Tutup', text: '✕', onclick: () => close() })
    ),
    el('div', { class: 'modal-body' }, body),
    actions.length ? el('div', { class: 'modal-actions' }, actions) : null
  )

  function close() {
    if (dialog.open) dialog.close()
  }

  dialog.addEventListener('close', () => {
    dialog.remove()
    if (onClose) onClose()
  })
  document.body.append(dialog)
  dialog.showModal()
  return { dialog, close }
}

export function confirmDialog(message, { okText = 'Ya', danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false
    const finish = value => {
      answered = true
      resolve(value)
      modal.close()
    }
    const modal = openModal({
      title: 'Konfirmasi',
      body: el('p', { text: message }),
      actions: [
        el('button', { class: 'btn btn-outline', type: 'button', text: 'Batal', onclick: () => finish(false) }),
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: okText, onclick: () => finish(true) })
      ],
      onClose: () => { if (!answered) resolve(false) }
    })
  })
}

/* =========================
   FORMAT
========================= */

export function fmtDate(iso) {
  if (!iso) return '–'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '–'
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso) {
  if (!iso) return 'belum pernah'
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'baru saja'
  if (seconds < 3600) return `${Math.round(seconds / 60)} menit lalu`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} jam lalu`
  return fmtDate(iso)
}

export function badge(text, kind = 'neutral') {
  return el('span', { class: `badge badge-${kind}`, text })
}

export function emptyState(text) {
  return el('div', { class: 'empty', text })
}

export function errorState(err, onRetry) {
  return el('div', { class: 'empty empty-error' },
    el('p', { text: err && err.message ? err.message : 'Gagal memuat data' }),
    onRetry ? el('button', { class: 'btn btn-outline', type: 'button', text: 'Coba lagi', onclick: onRetry }) : null
  )
}
