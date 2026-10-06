// Identitas kiosk hasil pairing (disimpan di perangkat ini saja).
import { api } from '../../shared/api.js'

const TOKEN_KEY = 'pb.kiosk.deviceToken'
const NAME_KEY = 'pb.kiosk.deviceName'

function read(key) {
  try {
    return localStorage.getItem(key)
  } catch (err) {
    return null
  }
}

export function getDevice() {
  const token = read(TOKEN_KEY)
  return token ? { token, name: read(NAME_KEY) || 'Kiosk' } : null
}

export function setDevice(token, name) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(NAME_KEY, name)
}

export function clearDevice() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(NAME_KEY)
}

// panggil API sebagai kiosk ini
export function kioskApi(action, body = {}, opts) {
  const device = getDevice()
  return api(action, Object.assign({}, body, { deviceToken: device ? device.token : '' }), opts)
}
