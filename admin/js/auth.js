// auth.js — login admin (password → token dari GAS), disimpan di perangkat ini.
import { api } from '../../shared/api.js'

const TOKEN_KEY = 'pb.admin.token'
let unauthorizedHandler = () => {}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch (err) {
    return null
  }
}

export function onUnauthorized(fn) {
  unauthorizedHandler = fn
}

// panggil API sebagai admin; token kedaluwarsa → kembali ke layar login
export async function adminApi(action, body = {}, opts) {
  try {
    return await api(action, Object.assign({}, body, { adminToken: getToken() || '' }), opts)
  } catch (err) {
    if (err.code === 'unauthorized') {
      localStorage.removeItem(TOKEN_KEY)
      unauthorizedHandler()
    }
    throw err
  }
}

export async function login(password) {
  const result = await api('adminLogin', { password })
  localStorage.setItem(TOKEN_KEY, result.adminToken)
}

export async function logout() {
  try {
    await adminApi('adminLogout')
  } catch (err) {
    // token mungkin sudah kedaluwarsa — tetap hapus di perangkat
  }
  localStorage.removeItem(TOKEN_KEY)
}
