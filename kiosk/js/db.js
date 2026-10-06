// IndexedDB kecil untuk kiosk:
//   outbox → sesi yang menunggu/ sedang di-upload (tahan refresh & internet putus)
//   kv     → cache daftar template & gambar frame (supaya bisa jalan offline)
const DB_NAME = 'photobooth-kiosk'
const DB_VERSION = 1

let dbPromise = null

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'sessionId' })
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function run(storeName, mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    tx.oncomplete = () => resolve(req ? req.result : undefined)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export const outbox = {
  put: item => run('outbox', 'readwrite', s => s.put(item)),
  get: id => run('outbox', 'readonly', s => s.get(id)),
  all: () => run('outbox', 'readonly', s => s.getAll()),
  remove: id => run('outbox', 'readwrite', s => s.delete(id))
}

export const kv = {
  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, value) => run('kv', 'readwrite', s => s.put(value, key))
}
