// Thumbnail bergantian seperti GIF: foto-foto sesi tampil bergantian (crossfade).
// Gambar diisi object-fit: cover (lihat .slideshow di admin.css), jadi tidak gepeng.
//
// Hemat koneksi: hanya foto pertama yang dimuat; sisanya baru dimuat dan
// diputar saat kartu terlihat di layar, dan berhenti saat keluar layar.
const INTERVAL_MS = 1200

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function makeImage(src) {
  const img = document.createElement('img')
  img.alt = ''
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  img.src = src
  return img
}

export function slideshow(urls) {
  const box = document.createElement('div')
  box.className = 'slideshow'

  const first = makeImage(urls[0])
  first.classList.add('is-active')
  box.append(first)
  if (urls.length < 2 || reducedMotion) return box

  let imgs = [first]
  let index = 0
  let timer = null

  const tick = () => {
    imgs[index].classList.remove('is-active')
    index = (index + 1) % imgs.length
    imgs[index].classList.add('is-active')
  }
  const start = () => { if (!timer) timer = setInterval(tick, INTERVAL_MS) }
  const stop = () => { clearInterval(timer); timer = null }

  const observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return stop()
    if (imgs.length === 1) {
      // foto lain baru ikut dimuat setelah kartu terlihat; yang gagal dimuat dibuang
      const rest = urls.slice(1).map(makeImage)
      rest.forEach(img => {
        img.addEventListener('error', () => {
          const wasActive = img.classList.contains('is-active')
          imgs = imgs.filter(i => i !== img)
          img.remove()
          index = index % imgs.length
          if (wasActive) imgs[index].classList.add('is-active')
        }, { once: true })
        box.append(img)
      })
      imgs = imgs.concat(rest)
    }
    start()
  })
  observer.observe(box)

  return box
}
