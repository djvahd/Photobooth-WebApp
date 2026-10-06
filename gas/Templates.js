/**
 * Templates.js — template frame foto.
 *
 * Template = PNG frame (disimpan di Drive: Photobooth/Frames) + konfigurasi:
 *   {
 *     width, height,        ukuran desain (= ukuran asli PNG frame)
 *     outputWidth,          lebar foto hasil akhir (tinggi menyesuaikan)
 *     frameLayer,           "above" = frame di ATAS foto (PNG berlubang transparan)
 *                           "below" = frame di BAWAH foto (PNG tidak transparan)
 *     background,           warna dasar, mis. "#ffffff"
 *     slots: [{x,y,w,h}],   posisi kotak foto (piksel desain), urut foto 1, 2, 3…
 *     texts: [{text,x,y,size,color,weight,align}]   (opsional)
 *   }
 *
 * Kiosk menggambar foto + frame sendiri di browser (canvas). PNG frame dikirim
 * sebagai base64 lewat getFrame — bukan link Drive — karena gambar dari link
 * Drive akan "mengunci" canvas (CORS) sehingga foto akhir tidak bisa dibuat.
 */

function listTemplates_(body, ctx) {
  let rows = table_('Templates').all()
  if (ctx.role !== 'admin') rows = rows.filter(t => t.active)

  rows.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))
  return rows.map(templateOut_)
}

function getFrame_(body, ctx) {
  const templateId = str_(body.templateId, 'templateId', { max: 64 })
  const row = table_('Templates').findBy('id', templateId)
  if (!row || (!row.active && ctx.role !== 'admin')) throw new AppError('not_found', 'Template tidak ditemukan')

  if (!row.frameFileId) return { templateId, version: row.updatedAt, dataUrl: null }

  const blob = DriveApp.getFileById(row.frameFileId).getBlob()
  return {
    templateId,
    version: row.updatedAt,
    dataUrl: `data:${blob.getContentType()};base64,${Utilities.base64Encode(blob.getBytes())}`
  }
}

function saveTemplate_(body) {
  const id = body.id ? str_(body.id, 'id', { pattern: /^[A-Za-z0-9-]{2,64}$/ }) : null
  const name = str_(body.name, 'Nama template', { max: 60 })
  const config = validateTemplateConfig_(body.config)
  const active = body.active === undefined ? true : !!body.active
  const sortOrder = int_(body.sortOrder, 'Urutan', { min: 0, max: 999, def: 0 })
  const frame = body.frameData ? decodeBase64_(body.frameData, ['image/png'], MAX_FRAME_BYTES) : null

  return withLock_(() => {
    const templates = table_('Templates')
    const existing = id ? templates.findBy('id', id) : null
    if (id && !existing) throw new AppError('not_found', 'Template tidak ditemukan')

    const templateId = existing ? existing.id : 'tpl-' + randomHex_().slice(0, 8)
    let frameFileId = existing ? existing.frameFileId : ''

    if (frame) {
      const folder = DriveApp.getFolderById(requireProp_('FRAMES_FOLDER_ID'))
      const file = folder.createFile(Utilities.newBlob(frame.bytes, 'image/png', `${templateId}.png`))
      if (frameFileId) trashQuietly_(frameFileId)
      frameFileId = file.getId()
    }

    const data = { id: templateId, name, active, sortOrder, frameFileId, config, updatedAt: nowIso_() }
    const row = existing ? templates.update(existing, data) : templates.insert(data)
    return templateOut_(row)
  })
}

function deleteTemplate_(body) {
  const templateId = str_(body.templateId, 'templateId', { max: 64 })

  return withLock_(() => {
    const templates = table_('Templates')
    const row = templates.findBy('id', templateId)
    if (!row) throw new AppError('not_found', 'Template tidak ditemukan')

    templates.remove(row)
    if (row.frameFileId) trashQuietly_(row.frameFileId)
    return { id: templateId, deleted: true }
  })
}

/* =========================
   HELPER
========================= */

function templateOut_(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    sortOrder: row.sortOrder,
    hasFrame: !!row.frameFileId,
    version: row.updatedAt,
    config: row.config
  }
}

function validateTemplateConfig_(c) {
  if (!c || typeof c !== 'object') throw new AppError('invalid_input', 'Konfigurasi template wajib diisi')

  const width = int_(c.width, 'Lebar desain', { min: 50, max: 10000 })
  const height = int_(c.height, 'Tinggi desain', { min: 50, max: 10000 })
  const outputWidth = int_(c.outputWidth, 'Lebar hasil', { min: 100, max: 6000, def: width })

  if (!Array.isArray(c.slots) || !c.slots.length) throw new AppError('invalid_input', 'Template minimal punya 1 kotak foto')
  if (c.slots.length > MAX_PHOTOS_PER_SESSION) throw new AppError('invalid_input', `Maksimal ${MAX_PHOTOS_PER_SESSION} kotak foto`)

  const slots = c.slots.map((s, i) => {
    const slot = { x: Number(s.x), y: Number(s.y), w: Number(s.w), h: Number(s.h) }
    const valid = [slot.x, slot.y, slot.w, slot.h].every(Number.isFinite) &&
      slot.x >= 0 && slot.y >= 0 && slot.w > 0 && slot.h > 0 &&
      slot.x + slot.w <= width + 1 && slot.y + slot.h <= height + 1
    if (!valid) throw new AppError('invalid_input', `Kotak foto #${i + 1} keluar dari ukuran desain (${width}x${height})`)
    return { x: Math.round(slot.x), y: Math.round(slot.y), w: Math.round(slot.w), h: Math.round(slot.h) }
  })

  const isColor = v => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)

  const texts = (Array.isArray(c.texts) ? c.texts : []).slice(0, 10).map(t => ({
    text: String(t.text || '').slice(0, 100),
    x: Number(t.x) || 0,
    y: Number(t.y) || 0,
    size: Math.min(Math.max(Number(t.size) || 32, 8), 400),
    color: isColor(t.color) ? t.color : '#000000',
    weight: t.weight === 'bold' ? 'bold' : 'normal',
    align: ['left', 'center', 'right'].indexOf(t.align) !== -1 ? t.align : 'center'
  }))

  return {
    width,
    height,
    outputWidth,
    frameLayer: c.frameLayer === 'below' ? 'below' : 'above',
    background: isColor(c.background) ? c.background : '#ffffff',
    slots,
    texts
  }
}

function trashQuietly_(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true)
  } catch (err) {
    console.warn('Gagal membuang file lama', fileId, err)
  }
}
