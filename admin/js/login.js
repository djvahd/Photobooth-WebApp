import { login as apiLogin, isLoggedIn } from "./api.js"

// sudah punya token → langsung ke home
if (isLoggedIn()) window.location.replace("home.html")

const passwordEl = document.getElementById("password")
const loginBtn = document.getElementById("login-btn")
const errorEl = document.getElementById("error")

const ERROR_MESSAGES = {
    invalid: "Password salah",
    locked: "Terlalu banyak percobaan, coba lagi 5 menit lagi",
    not_configured: "Password belum diatur di server (GALLERY_PASSWORD)"
}

loginBtn.addEventListener("click", login)
passwordEl.addEventListener("input", () => {
    errorEl.hidden = true
})

passwordEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login()
})

function showError(text) {
    errorEl.textContent = text
    errorEl.hidden = false
}

async function login() {
    const input = passwordEl.value
    if (!input || loginBtn.disabled) return

    loginBtn.disabled = true
    loginBtn.textContent = "Memeriksa…"

    try {
        const result = await apiLogin(input)

        if (result && result.token) {
            window.location.replace("home.html")
            return
        }

        showError(ERROR_MESSAGES[result && result.error] || "Login gagal")
    } catch (err) {
        console.error("Login error:", err)
        showError("Tidak bisa terhubung ke server")
    } finally {
        loginBtn.disabled = false
        loginBtn.textContent = "Login"
    }
}
