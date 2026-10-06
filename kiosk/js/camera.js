// Kamera: tampilan live & pengambilan foto.
// Foto TIDAK di-mirror (tidak dibalik kiri-kanan): tampilan live = hasil foto.
let stream = null

export async function startCamera(video) {
  if (!stream || !stream.active) {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    })
  }
  if (video.srcObject !== stream) video.srcObject = stream
  await video.play()
}

export function stopCamera(video) {
  if (stream) stream.getTracks().forEach(t => t.stop())
  stream = null
  if (video) video.srcObject = null
}

// ambil satu frame dari video → data URL JPEG (sisi terpanjang maks. maxSize px)
export function capturePhoto(video, maxSize, quality) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) throw new Error('Kamera belum siap')

  const scale = Math.min(1, maxSize / Math.max(vw, vh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vw * scale)
  canvas.height = Math.round(vh * scale)
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

export function cameraErrorMessage(err) {
  if (err && err.name === 'NotAllowedError') return 'Izin kamera ditolak. Izinkan akses kamera di pengaturan browser.'
  if (err && err.name === 'NotFoundError') return 'Kamera tidak ditemukan.'
  if (err && err.name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain.'
  return 'Kamera tidak bisa dibuka.'
}
