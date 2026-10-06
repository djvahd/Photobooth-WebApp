/**
 * Auth.js — login admin (password → token) dan pairing perangkat kiosk.
 *
 * Admin:  password disimpan di Script Property ADMIN_PASSWORD.
 *         Login berhasil → token acak, berlaku 6 jam (diperpanjang selama dipakai).
 * Kiosk:  admin membuat kode pairing 6 digit → kode dimasukkan sekali di kiosk
 *         → kiosk menerima deviceToken permanen (yang disimpan di server hanya
 *         hash-nya). Perangkat bisa dicabut aksesnya dari admin.
 */

function authenticate_(level, body) {
  if (level === 'public') return { role: 'public' }

  if (level === 'admin' || level === 'any') {
    if (checkAdminToken_(body.adminToken)) return { role: 'admin' }
    if (level === 'admin') throw new AppError('unauthorized', 'Sesi admin berakhir, silakan login lagi')
  }

  const device = findDeviceByToken_(body.deviceToken)
  if (device) return { role: 'kiosk', deviceId: device.id, deviceName: device.name }

  throw new AppError('unauthorized', 'Perangkat belum terdaftar atau aksesnya dicabut')
}

/* =========================
   ADMIN
========================= */

function adminLogin_(body) {
  const password = body.password
  const cache = CacheService.getScriptCache()

  const fails = Number(cache.get('login_fails') || 0)
  if (fails >= LOGIN_MAX_FAILS) throw new AppError('locked', 'Terlalu banyak percobaan, coba lagi 5 menit lagi')

  const expected = requireProp_('ADMIN_PASSWORD')
  if (typeof password !== 'string' || password !== expected) {
    cache.put('login_fails', String(fails + 1), LOGIN_LOCK_SECONDS)
    throw new AppError('invalid_password', 'Password salah')
  }

  cache.remove('login_fails')
  const token = randomHex_() + randomHex_()
  cache.put('admin_' + token, '1', ADMIN_TOKEN_TTL)
  return { adminToken: token, expiresIn: ADMIN_TOKEN_TTL }
}

function adminLogout_(body) {
  CacheService.getScriptCache().remove('admin_' + body.adminToken)
  return { loggedOut: true }
}

function checkAdminToken_(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false
  const cache = CacheService.getScriptCache()
  if (cache.get('admin_' + token) !== '1') return false
  cache.put('admin_' + token, '1', ADMIN_TOKEN_TTL) // perpanjang selama dipakai
  return true
}

/* =========================
   PAIRING KIOSK
========================= */

function createPairingCode_() {
  // 6 digit dari bilangan acak UUID
  const code = String(parseInt(randomHex_().slice(0, 8), 16) % 1000000).padStart(6, '0')
  CacheService.getScriptCache().put('pair_' + code, '1', PAIRING_CODE_TTL)
  return { code, expiresIn: PAIRING_CODE_TTL }
}

function pairDevice_(body) {
  const cache = CacheService.getScriptCache()

  const fails = Number(cache.get('pair_fails') || 0)
  if (fails >= LOGIN_MAX_FAILS) throw new AppError('locked', 'Terlalu banyak percobaan, coba lagi 5 menit lagi')

  const code = str_(body.code, 'Kode pairing', { pattern: /^\d{6}$/ })
  const name = str_(body.name, 'Nama perangkat', { optional: true, def: 'Kiosk', max: 40 })

  if (cache.get('pair_' + code) !== '1') {
    cache.put('pair_fails', String(fails + 1), LOGIN_LOCK_SECONDS)
    throw new AppError('invalid_code', 'Kode pairing salah atau sudah kedaluwarsa')
  }
  cache.remove('pair_' + code)

  const deviceToken = randomHex_() + randomHex_()
  const device = {
    id: 'dev-' + randomHex_().slice(0, 10),
    name,
    tokenHash: sha256Hex_(deviceToken),
    createdAt: nowIso_(),
    revoked: false
  }
  withLock_(() => table_('Devices').insert(device))

  return { deviceId: device.id, name: device.name, deviceToken }
}

function findDeviceByToken_(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null

  const hash = sha256Hex_(token)
  const cache = CacheService.getScriptCache()
  const cached = cache.get('dev_' + hash)
  if (cached) return JSON.parse(cached)

  const row = table_('Devices').findBy('tokenHash', hash)
  if (!row || row.revoked) return null

  const device = { id: row.id, name: row.name }
  cache.put('dev_' + hash, JSON.stringify(device), DEVICE_CACHE_TTL)
  return device
}

function listDevices_() {
  const cache = CacheService.getScriptCache()
  return table_('Devices').all().map(d => ({
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    revoked: d.revoked,
    heartbeat: JSON.parse(cache.get('hb_' + d.id) || 'null')
  }))
}

function revokeDevice_(body) {
  const deviceId = str_(body.deviceId, 'deviceId', { max: 40 })

  return withLock_(() => {
    const devices = table_('Devices')
    const row = devices.findBy('id', deviceId)
    if (!row) throw new AppError('not_found', 'Perangkat tidak ditemukan')

    devices.update(row, { revoked: true })
    CacheService.getScriptCache().remove('dev_' + row.tokenHash)
    return { id: row.id, revoked: true }
  })
}
