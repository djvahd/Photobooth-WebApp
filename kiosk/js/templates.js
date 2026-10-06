// Daftar template frame: diambil dari backend, disimpan di cache supaya kiosk
// tetap bisa dipakai saat offline. Kalau admin belum membuat template sama
// sekali, kiosk memakai frame bawaan (assets/frame.png).
import { kioskApi } from './device.js'
import { kv } from './db.js'

export const BUILTIN_TEMPLATE = {
  id: '',
  builtin: true,
  name: 'Strip 3 Foto',
  frameUrl: 'assets/frame.png',
  version: 'builtin-1',
  config: {
    width: 1081,
    height: 3201,
    outputWidth: 1081,
    frameLayer: 'above',
    background: '#ffffff',
    // diukur otomatis dari lubang transparan frame.png (+2px supaya tidak ada celah)
    slots: [
      { x: 74, y: 573, w: 932, h: 621 },
      { x: 74, y: 1289, w: 932, h: 622 },
      { x: 74, y: 2007, w: 932, h: 622 }
    ],
    texts: []
  }
}

export async function loadTemplates() {
  try {
    const list = await kioskApi('listTemplates')
    await kv.set('templates', list)
    return list.length ? list : [BUILTIN_TEMPLATE]
  } catch (err) {
    if (err.code === 'unauthorized') throw err
    const cached = await kv.get('templates')
    return cached && cached.length ? cached : [BUILTIN_TEMPLATE]
  }
}

// gambar frame sebagai data URL (aman dipakai di canvas)
export async function getFrameSrc(template) {
  if (template.builtin) return template.frameUrl
  if (!template.hasFrame) return null

  const key = 'frame:' + template.id
  const cached = await kv.get(key)
  if (cached && cached.version === template.version) return cached.dataUrl

  try {
    const frame = await kioskApi('getFrame', { templateId: template.id }, { timeoutMs: 120000 })
    await kv.set(key, { version: frame.version, dataUrl: frame.dataUrl })
    return frame.dataUrl
  } catch (err) {
    // offline: pakai versi lama kalau ada
    if (cached) return cached.dataUrl
    throw err
  }
}

// unduh semua frame di belakang layar supaya siap dipakai saat offline
export async function preloadFrames(list) {
  for (const t of list) {
    try {
      await getFrameSrc(t)
    } catch (err) {
      // diabaikan: akan dicoba lagi saat template dipilih
    }
  }
}
