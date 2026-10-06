const API_BASE =
    "https://script.google.com/macros/s/AKfycbz2WrsPbfp9Nf0k54MNi0cHTegDC3uzuyiX2X33MTCRBGJM7Srg_8sD5le1t3qKowRc/exec"

const TOKEN_KEY = "authToken"

async function safeJson(res) {
    const text = await res.text()
    try {
        const data = JSON.parse(text)
        return typeof data === "string" ? JSON.parse(data) : data
    } catch (e) {
        console.error("API returned non-JSON:", text)
        throw new Error("API response is not valid JSON")
    }
}

/* =========================
   SESSION (TOKEN)
========================= */
export function getToken() {
    return localStorage.getItem(TOKEN_KEY)
}

export function isLoggedIn() {
    return !!getToken()
}

export function clearSession() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem("lastActivity")
    localStorage.removeItem("isLoggedIn") // sisa versi lama
}

/* =========================
   REQUEST HELPER
   Semua request = POST ?action=... dengan token di body (bukan di URL).
   Content-Type text/plain supaya tidak memicu CORS preflight ke GAS.
========================= */
async function call(action, { params = {}, body = {} } = {}) {
    const url = new URL(API_BASE)
    url.searchParams.set("action", action)
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
    }

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ ...body, token: getToken() })
    })
    if (!res.ok) throw new Error(`Request "${action}" failed`)

    const data = await safeJson(res)

    // token kedaluwarsa / tidak valid → kembali ke halaman login
    if (data && data.error === "unauthorized") {
        clearSession()
        window.location.replace("login.html")
        throw new Error("Session expired")
    }

    return data
}

/* =========================
   AUTH
========================= */
// hasil: { token } kalau berhasil, atau { error: "invalid" | "locked" | "not_configured" }
export async function login(password) {
    const data = await call("login", { body: { password } })
    if (data && data.token) {
        localStorage.setItem(TOKEN_KEY, data.token)
        localStorage.setItem("lastActivity", String(Date.now()))
    }
    return data
}

export async function logout() {
    try {
        await call("logout")
    } catch (e) {
        // token mungkin sudah kedaluwarsa, tetap bersihkan sesi lokal
    } finally {
        clearSession()
    }
}

/* =========================
   DATA
========================= */
export function listSessions() {
    return call("list")
}

export function getSession(sessionId) {
    return call("session", { params: { sessionId } })
}

export function getPrintQueue() {
    return call("printQueue")
}

export function addToPrintQueue(sessionId, finalUrl) {
    return call("addToQueue", { body: { sessionId, final: finalUrl } })
}

export function markPrinted(sessionId) {
    return call("markPrinted", { body: { sessionId } })
}
