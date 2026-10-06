// Menggabungkan foto + frame menjadi satu gambar (di browser, dengan canvas).
// Format template sama dengan backend (lihat gas/Templates.js).

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gambar gagal dimuat'))
    img.src = src
  })
}

// isi kotak tanpa gepeng (potong bagian tengah)
function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height
  const tr = w / h
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height

  if (ir > tr) {
    sw = sh * tr
    sx = (img.width - sw) / 2
  } else {
    sh = sw / tr
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function drawPlaceholder(ctx, index, s) {
  ctx.fillStyle = '#e2e8f0'
  ctx.fillRect(s.x, s.y, s.w, s.h)
  ctx.fillStyle = '#94a3b8'
  ctx.font = `700 ${Math.round(Math.min(s.w, s.h) * 0.35)}px Montserrat, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(index + 1), s.x + s.w / 2, s.y + s.h / 2)
}

/**
 * @param template   { config: { width, height, outputWidth, frameLayer, background, slots, texts } }
 * @param photos     array data URL (boleh kosong untuk pratinjau)
 * @param frameSrc   data URL / URL same-origin PNG frame, atau null
 * @param opts       { width, placeholders, type, quality }
 * @returns data URL
 */
export async function composeImage(template, photos, frameSrc, opts = {}) {
  const c = template.config
  const outWidth = opts.width || c.outputWidth || c.width
  const scale = outWidth / c.width

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(c.width * scale)
  canvas.height = Math.round(c.height * scale)

  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.scale(scale, scale)

  ctx.fillStyle = c.background || '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)

  const frame = frameSrc ? await loadImage(frameSrc) : null
  const frameAbove = c.frameLayer !== 'below'

  if (frame && !frameAbove) ctx.drawImage(frame, 0, 0, c.width, c.height)

  for (let i = 0; i < c.slots.length; i++) {
    const s = c.slots[i]
    if (photos && photos[i]) drawCover(ctx, await loadImage(photos[i]), s.x, s.y, s.w, s.h)
    else if (opts.placeholders) drawPlaceholder(ctx, i, s)
  }

  if (frame && frameAbove) ctx.drawImage(frame, 0, 0, c.width, c.height)

  for (const t of c.texts || []) {
    ctx.fillStyle = t.color || '#000000'
    ctx.font = `${t.weight === 'bold' ? 700 : 400} ${t.size || 32}px Montserrat, sans-serif`
    ctx.textAlign = t.align || 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t.text, t.x, t.y)
  }

  return canvas.toDataURL(opts.type || 'image/jpeg', opts.quality || 0.92)
}
