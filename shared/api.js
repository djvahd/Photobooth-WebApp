// Klien API bersama untuk backend Google Apps Script (lihat gas/Router.js).
import { API_URL } from './config.js'

export class ApiError extends Error {
  constructor(code, message, network = false) {
    super(message)
    this.code = code
    this.network = network // true = gagal terhubung (layak dicoba ulang)
  }
}

/**
 * Panggil action di backend.
 * Content-Type text/plain supaya browser tidak mengirim CORS preflight
 * (Apps Script tidak bisa menjawab preflight).
 */
export async function api(action, body = {}, { timeoutMs = 60000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({}, body, { action })),
      signal: controller.signal
    })
  } catch (err) {
    throw new ApiError('network', 'Tidak bisa terhubung ke server', true)
  } finally {
    clearTimeout(timer)
  }

  let data
  try {
    data = await res.json()
  } catch (err) {
    throw new ApiError('bad_response', 'Respons server tidak valid', true)
  }

  if (!data || !data.ok) {
    const e = (data && data.error) || {}
    throw new ApiError(e.code || 'unknown', e.message || 'Terjadi kesalahan')
  }
  return data.data
}
