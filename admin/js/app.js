// app.js — halaman admin: login, menu, routing (#/sesi, #/print, …), status.
import { getToken, login, onUnauthorized } from './auth.js'
import { startStatus, stopStatus, onStatus, summarize } from './status.js'
import { startStation, stopStation } from './printer.js'
import { BRAND } from '../../shared/brand.js'
import * as sessionsView from './views/sessions.js'
import * as printView from './views/print.js'
import * as devicesView from './views/devices.js'
import * as framesView from './views/frames.js'
import * as settingsView from './views/settings.js'

const ROUTES = {
  sesi: sessionsView,
  print: printView,
  perangkat: devicesView,
  frame: framesView,
  pengaturan: settingsView
}

const $ = id => document.getElementById(id)
let currentView = null
let appStarted = false

/* =========================
   LOGIN
========================= */

function showLogin(message) {
  stopStatus()
  stopStation()
  appStarted = false
  if (currentView && currentView.destroy) currentView.destroy()
  currentView = null

  $('app-view').hidden = true
  $('login-view').hidden = false
  $('login-error').hidden = !message
  $('login-error').textContent = message || ''
  $('login-password').value = ''
  $('login-password').focus()
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault()
  const btn = $('login-submit')
  btn.disabled = true
  btn.textContent = 'Memeriksa…'
  try {
    await login($('login-password').value)
    route()
  } catch (err) {
    $('login-error').textContent = err.message
    $('login-error').hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = 'Masuk'
  }
})

onUnauthorized(() => showLogin('Sesi admin berakhir, silakan masuk lagi.'))

/* =========================
   APLIKASI
========================= */

function startApp() {
  if (appStarted) return
  appStarted = true
  $('login-view').hidden = true
  $('app-view').hidden = false

  const refresh = startStatus($('status-bar'), $('alert-banner'))
  devicesView.setStatusRefresher(refresh)
  startStation()

  onStatus(status => {
    const s = summarize(status)
    const count = s.printQueue.queued + s.printQueue.printing
    const badge = $('nav-print-count')
    badge.hidden = !count
    badge.textContent = count
  })
}

function route() {
  if (!getToken()) return showLogin()
  startApp()

  const name = location.hash.replace(/^#\/?/, '').split('/')[0] || 'sesi'
  const view = ROUTES[name] || ROUTES.sesi

  document.querySelectorAll('.nav a').forEach(a => {
    a.classList.toggle('is-active', a.dataset.route === name)
  })

  if (currentView && currentView.destroy) currentView.destroy()
  const content = $('content')
  content.replaceChildren()
  content.scrollTop = 0
  currentView = view.mount(content)
}

window.addEventListener('hashchange', route)

$('brand-name').textContent = BRAND.EVENT_NAME
route()
