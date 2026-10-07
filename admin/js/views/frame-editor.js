// views/frame-editor.js — upload PNG frame, atur kotak foto, pratinjau, simpan.
//
// Kotak foto dideteksi otomatis (area putih polos / transparan), lalu bisa:
//   • digeser   : tarik kotaknya
//   • diubah    : tarik pegangan di pojok kanan bawah
//   • ditambah / dihapus lewat tombol
// Koordinat disimpan dalam piksel asli gambar frame.
import { adminApi } from '../auth.js'
import { detectSlots } from '../../../shared/detect-slots.js'
import { composeImage } from '../../../kiosk/js/compose.js'
import { el, toast, openModal } from '../ui.js'

const MAX_FRAME_MB = 15
const MIN_SLOT = 20

export function openEditor(template, frameSrc, onSaved) {
  const state = {
    id: template ? template.id : null,
    name: template ? template.name : '',
    active: template ? template.active : true,
    sortOrder: template ? template.sortOrder : 0,
    config: template ? JSON.parse(JSON.stringify(template.config)) : null,
    frameSrc: frameSrc || null,
    newFrameData: null,
    selected: 0
  }

  /* ---------- elemen ---------- */
  const fileInput = el('input', { type: 'file', accept: 'image/png', hidden: true, onchange: e => pickFile(e.target.files[0]) })
  const frameImg = el('img', { class: 'editor-frame', alt: '', draggable: 'false' })
  const slotLayer = el('div', { class: 'editor-slots' })
  const stage = el('div', { class: 'editor-stage' }, frameImg, slotLayer)
  const canvasBox = el('div', { class: 'editor-canvas' }, stage)
  const dropHint = el('button', {
    class: 'editor-drop', type: 'button', onclick: () => fileInput.click()
  }, el('strong', { text: 'Pilih file PNG frame' }), el('span', { class: 'muted small', text: `Area foto berwarna putih polos atau transparan · maks. ${MAX_FRAME_MB}MB` }))

  const nameInput = el('input', { class: 'input', value: state.name, maxlength: '60', placeholder: 'mis. Strip 3 Foto', oninput: e => { state.name = e.target.value } })
  const layerSelect = el('select', { class: 'input', onchange: e => { state.config.frameLayer = e.target.value } },
    el('option', { value: 'above', text: 'Frame di atas foto (PNG berlubang transparan)' }),
    el('option', { value: 'below', text: 'Frame di bawah foto (area foto putih)' })
  )
  const widthInput = el('input', { class: 'input', type: 'number', min: '100', max: '6000', step: '1', oninput: e => { state.config.outputWidth = Number(e.target.value) } })
  const activeInput = el('input', { type: 'checkbox', checked: state.active, onchange: e => { state.active = e.target.checked } })
  const slotList = el('ol', { class: 'slot-list' })
  const previewImg = el('img', { class: 'editor-preview', alt: 'Pratinjau hasil', hidden: true })
  const saveBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Simpan frame', onclick: save })

  const form = el('div', { class: 'editor-form' },
    el('div', { class: 'field' }, el('label', { text: 'Nama frame' }), nameInput),
    el('div', { class: 'field' }, el('label', { text: 'Gambar frame' }),
      el('button', { class: 'btn btn-outline', type: 'button', text: 'Ganti gambar PNG…', onclick: () => fileInput.click() })),
    el('div', { class: 'field' }, el('label', { text: 'Posisi frame' }), layerSelect),
    el('div', { class: 'field' }, el('label', { text: 'Lebar hasil (px)' }), widthInput),
    el('label', { class: 'switch' }, activeInput, el('span', { text: 'Aktif (tampil di kiosk)' })),
    el('div', { class: 'field' },
      el('label', { text: 'Kotak foto' }),
      el('p', { class: 'muted small', text: 'Tarik kotak untuk memindahkan, tarik pojok kanan bawah untuk mengubah ukuran. Urutan = urutan foto.' }),
      slotList,
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-sm btn-outline', type: 'button', text: '+ Tambah kotak', onclick: addSlot }),
        el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Hapus kotak terpilih', onclick: removeSlot }),
        el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Deteksi otomatis', onclick: redetect })
      )
    ),
    el('button', { class: 'btn btn-outline', type: 'button', text: '👁 Pratinjau dengan foto contoh', onclick: preview }),
    previewImg
  )

  const body = el('div', { class: 'editor' }, fileInput, el('div', { class: 'editor-left' }, dropHint, canvasBox), form)

  const modal = openModal({
    title: template ? `Edit frame: ${template.name}` : 'Tambah frame',
    body,
    wide: true,
    actions: [
      el('button', { class: 'btn btn-outline', type: 'button', text: 'Batal', onclick: () => modal.close() }),
      saveBtn
    ],
    onClose: () => window.removeEventListener('resize', layout)
  })

  window.addEventListener('resize', layout)

  /* ---------- gambar frame ---------- */
  async function pickFile(file) {
    if (!file) return
    if (file.type !== 'image/png') return toast('Frame harus berupa file PNG', 'bad')
    if (file.size > MAX_FRAME_MB * 1024 * 1024) return toast(`Ukuran maksimal ${MAX_FRAME_MB}MB`, 'bad')

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

    const detected = await detectSlots(dataUrl)
    state.frameSrc = dataUrl
    state.newFrameData = dataUrl
    state.config = {
      width: detected.width,
      height: detected.height,
      outputWidth: detected.width,
      frameLayer: detected.suggestedLayer,
      background: (state.config && state.config.background) || '#ffffff',
      slots: detected.slots,
      texts: (state.config && state.config.texts) || []
    }
    state.selected = 0
    if (!state.name) {
      state.name = file.name.replace(/\.png$/i, '')
      nameInput.value = state.name
    }
    toast(detected.slots.length ? `${detected.slots.length} kotak foto terdeteksi` : 'Kotak foto tidak terdeteksi — tambahkan manual', detected.slots.length ? 'ok' : 'warn')
    render()
  }

  async function redetect() {
    if (!state.frameSrc) return
    const detected = await detectSlots(state.frameSrc)
    state.config.slots = detected.slots
    state.config.frameLayer = detected.suggestedLayer
    state.selected = 0
    toast(`${detected.slots.length} kotak foto terdeteksi`, detected.slots.length ? 'ok' : 'warn')
    render()
  }

  /* ---------- kotak foto ---------- */
  function addSlot() {
    if (!state.config) return
    const c = state.config
    const w = Math.round(c.width * 0.6)
    const h = Math.round(w * 0.66)
    c.slots.push({ x: Math.round((c.width - w) / 2), y: Math.round((c.height - h) / 2), w, h })
    state.selected = c.slots.length - 1
    render()
  }

  function removeSlot() {
    if (!state.config || !state.config.slots.length) return
    state.config.slots.splice(state.selected, 1)
    state.selected = Math.max(0, state.selected - 1)
    render()
  }

  function startDrag(e, index, mode) {
    e.preventDefault()
    e.stopPropagation()
    state.selected = index
    renderSlots()

    const c = state.config
    const slot = c.slots[index]
    const rect = stage.getBoundingClientRect()
    const unit = c.width / rect.width // piksel layar → piksel desain
    const startX = e.clientX
    const startY = e.clientY
    const orig = { ...slot }

    const move = ev => {
      const dx = (ev.clientX - startX) * unit
      const dy = (ev.clientY - startY) * unit
      if (mode === 'move') {
        slot.x = Math.round(clamp(orig.x + dx, 0, c.width - slot.w))
        slot.y = Math.round(clamp(orig.y + dy, 0, c.height - slot.h))
      } else {
        slot.w = Math.round(clamp(orig.w + dx, MIN_SLOT, c.width - slot.x))
        slot.h = Math.round(clamp(orig.h + dy, MIN_SLOT, c.height - slot.y))
      }
      renderSlots()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- tampilan ---------- */
  function layout() {
    if (!state.config) return
    const c = state.config
    const maxW = canvasBox.clientWidth
    const maxH = canvasBox.clientHeight
    const scale = Math.min(maxW / c.width, maxH / c.height)
    stage.style.width = `${Math.round(c.width * scale)}px`
    stage.style.height = `${Math.round(c.height * scale)}px`
  }

  function renderSlots() {
    const c = state.config
    slotLayer.replaceChildren(...c.slots.map((s, i) => {
      const box = el('div', {
        class: `editor-slot${i === state.selected ? ' is-selected' : ''}`,
        style: {
          left: `${(s.x / c.width) * 100}%`,
          top: `${(s.y / c.height) * 100}%`,
          width: `${(s.w / c.width) * 100}%`,
          height: `${(s.h / c.height) * 100}%`
        },
        onpointerdown: e => startDrag(e, i, 'move')
      },
        el('span', { class: 'slot-num', text: String(i + 1) }),
        el('span', { class: 'slot-handle', 'aria-label': 'Ubah ukuran', onpointerdown: e => startDrag(e, i, 'resize') })
      )
      return box
    }))

    slotList.replaceChildren(...c.slots.map((s, i) => el('li', {
      class: i === state.selected ? 'is-selected' : '',
      onclick: () => { state.selected = i; renderSlots() }
    }, `Foto ${i + 1}: x ${s.x}, y ${s.y}, ${s.w}×${s.h}px`)))
  }

  function render() {
    const has = !!state.config && !!state.frameSrc
    dropHint.hidden = has
    canvasBox.hidden = !has
    previewImg.hidden = true
    if (!state.config) return

    frameImg.src = state.frameSrc
    layerSelect.value = state.config.frameLayer
    widthInput.value = String(state.config.outputWidth)
    // tunggu modal tampil supaya ukuran wadah sudah diketahui
    requestAnimationFrame(layout)
    renderSlots()
  }

  /* ---------- pratinjau & simpan ---------- */
  async function preview() {
    if (!state.config || !state.config.slots.length) return toast('Tambahkan minimal satu kotak foto', 'bad')
    const samples = state.config.slots.map((_, i) => samplePhoto(i))
    const dataUrl = await composeImage({ config: state.config }, samples, state.frameSrc, { width: 700, type: 'image/jpeg', quality: 0.85 })
    previewImg.src = dataUrl
    previewImg.hidden = false
    previewImg.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function save() {
    if (!state.config || !state.frameSrc) return toast('Pilih gambar frame dulu', 'bad')
    if (!state.name.trim()) return toast('Nama frame wajib diisi', 'bad')
    if (!state.config.slots.length) return toast('Tambahkan minimal satu kotak foto', 'bad')

    saveBtn.disabled = true
    saveBtn.textContent = state.newFrameData ? 'Mengupload frame…' : 'Menyimpan…'
    try {
      await adminApi('saveTemplate', {
        id: state.id || undefined,
        name: state.name.trim(),
        active: state.active,
        sortOrder: state.sortOrder,
        config: state.config,
        frameData: state.newFrameData || undefined
      }, { timeoutMs: 180000 })
      toast('Frame disimpan', 'ok')
      modal.close()
      if (onSaved) onSaved()
    } catch (err) {
      toast(err.message, 'bad')
      saveBtn.disabled = false
      saveBtn.textContent = 'Simpan frame'
    }
  }

  render()
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max)
}

// foto contoh berwarna dengan nomor, untuk pratinjau
function samplePhoto(i) {
  const colors = ['#f5b800', '#4f9dde', '#e5677d', '#4fbf8f', '#9b6bd6', '#f08a3c']
  const c = document.createElement('canvas')
  c.width = 1200
  c.height = 900
  const ctx = c.getContext('2d')
  ctx.fillStyle = colors[i % colors.length]
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '700 260px Montserrat, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(i + 1), c.width / 2, c.height / 2)
  return c.toDataURL('image/jpeg', 0.8)
}
