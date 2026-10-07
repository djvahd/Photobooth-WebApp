// views/frames.js — daftar template frame: pratinjau, aktif/nonaktif, edit, hapus.
import { adminApi } from '../auth.js'
import { composeImage } from '../../../kiosk/js/compose.js'
import { el, toast, badge, emptyState, errorState, confirmDialog } from '../ui.js'
import { openEditor } from './frame-editor.js'

const frameCache = new Map() // "id@version" → data URL

export async function loadFrameSrc(template) {
  if (!template.hasFrame) return null
  const key = `${template.id}@${template.version}`
  if (!frameCache.has(key)) {
    const frame = await adminApi('getFrame', { templateId: template.id }, { timeoutMs: 120000 })
    frameCache.set(key, frame.dataUrl)
  }
  return frameCache.get(key)
}

export function mount(root) {
  const grid = el('div', { class: 'frame-grid' }, emptyState('Memuat…'))

  root.append(
    el('header', { class: 'view-head' },
      el('div', {},
        el('h1', { text: 'Frame' }),
        el('p', { class: 'muted', text: 'Frame aktif muncul sebagai pilihan di kiosk. Kalau tidak ada yang aktif, kiosk memakai frame bawaan.' })
      ),
      el('button', { class: 'btn btn-primary', type: 'button', text: '+ Tambah frame', onclick: () => openEditor(null, null, load) })
    ),
    grid
  )

  async function load() {
    let list
    try {
      list = await adminApi('listTemplates')
    } catch (err) {
      if (err.code !== 'unauthorized') grid.replaceChildren(errorState(err, load))
      return
    }
    grid.replaceChildren(...(list.length ? list.map(card) : [emptyState('Belum ada frame. Klik "Tambah frame" untuk mengupload PNG frame pertama.')]))
  }

  function card(t) {
    const img = el('img', { alt: '' })
    const thumb = el('div', { class: 'frame-thumb' }, img)

    loadFrameSrc(t)
      .then(src => composeImage(t, [], src, { width: 260, placeholders: true, type: 'image/png' }))
      .then(dataUrl => { img.src = dataUrl })
      .catch(() => thumb.replaceChildren(el('span', { class: 'muted small', text: 'Pratinjau gagal dimuat' })))

    return el('article', { class: `card frame-card${t.active ? '' : ' is-inactive'}` },
      thumb,
      el('div', { class: 'frame-info' },
        el('h3', { text: t.name }),
        el('div', { class: 'badges' },
          badge(`${t.config.slots.length} foto`, 'neutral'),
          t.active ? badge('Aktif', 'ok') : badge('Nonaktif', 'neutral')
        )
      ),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn btn-sm btn-primary', type: 'button', text: 'Edit',
          onclick: async () => {
            try {
              openEditor(t, await loadFrameSrc(t), load)
            } catch (err) {
              toast(err.message, 'bad')
            }
          }
        }),
        el('button', { class: 'btn btn-sm btn-outline', type: 'button', text: t.active ? 'Nonaktifkan' : 'Aktifkan', onclick: () => toggle(t) }),
        el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Hapus', onclick: () => remove(t) })
      )
    )
  }

  async function toggle(t) {
    try {
      await adminApi('saveTemplate', { id: t.id, name: t.name, config: t.config, sortOrder: t.sortOrder, active: !t.active })
      toast(t.active ? 'Frame dinonaktifkan' : 'Frame diaktifkan', 'ok')
      load()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  async function remove(t) {
    if (!await confirmDialog(`Hapus frame "${t.name}"? Sesi lama yang memakai frame ini tidak terpengaruh.`, { okText: 'Hapus', danger: true })) return
    try {
      await adminApi('deleteTemplate', { templateId: t.id })
      toast('Frame dihapus', 'ok')
      load()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  load()
  return { destroy() {} }
}
