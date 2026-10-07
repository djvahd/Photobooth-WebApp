// detect-slots.js — cari kotak foto di PNG frame (area putih polos atau transparan).
// Dipakai halaman admin saat upload frame; hasilnya bisa digeser manual setelahnya.

const MIN_AREA_RATIO = 0.01 // kotak minimal 1% luas gambar
const MIN_FILL_RATIO = 0.9  // area harus hampir penuh persegi panjang

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gambar frame tidak bisa dibaca'))
    img.src = src
  })
}

/**
 * @param src data URL / URL same-origin gambar frame
 * @returns { width, height, slots: [{x,y,w,h}], suggestedLayer: 'above'|'below' }
 */
export async function detectSlots(src) {
  const img = await loadImage(src)
  const W = img.naturalWidth
  const H = img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, W, H).data

  // piksel "slot": hampir transparan, atau putih polos
  const isSlot = new Uint8Array(W * H)
  let transparentCount = 0
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3]
    const transparent = a < 20
    if (transparent) transparentCount++
    isSlot[i] = transparent || (data[i * 4] > 245 && data[i * 4 + 1] > 245 && data[i * 4 + 2] > 245) ? 1 : 0
  }

  // cari area yang saling terhubung (flood fill)
  const seen = new Uint8Array(W * H)
  const stack = new Int32Array(W * H)
  const slots = []

  for (let start = 0; start < W * H; start++) {
    if (!isSlot[start] || seen[start]) continue

    let top = 0
    stack[top++] = start
    seen[start] = 1
    let count = 0
    let minX = W, minY = H, maxX = 0, maxY = 0

    while (top > 0) {
      const p = stack[--top]
      const x = p % W
      const y = (p - x) / W
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      if (x > 0 && isSlot[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1 }
      if (x < W - 1 && isSlot[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1 }
      if (y > 0 && isSlot[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[top++] = p - W }
      if (y < H - 1 && isSlot[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[top++] = p + W }
    }

    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const touchesEdge = minX === 0 || minY === 0 || maxX === W - 1 || maxY === H - 1

    if (count >= W * H * MIN_AREA_RATIO && count / (w * h) >= MIN_FILL_RATIO && !touchesEdge) {
      // +2px ke segala arah supaya tidak ada celah tipis di tepi lubang
      slots.push({
        x: Math.max(0, minX - 2),
        y: Math.max(0, minY - 2),
        w: Math.min(W - Math.max(0, minX - 2), w + 4),
        h: Math.min(H - Math.max(0, minY - 2), h + 4)
      })
    }
  }

  // urutkan atas → bawah, lalu kiri → kanan
  slots.sort((a, b) => (Math.abs(a.y - b.y) > 10 ? a.y - b.y : a.x - b.x))

  return {
    width: W,
    height: H,
    slots,
    suggestedLayer: transparentCount > W * H * MIN_AREA_RATIO ? 'above' : 'below'
  }
}
