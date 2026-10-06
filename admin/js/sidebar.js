import { getPrintQueue, markPrinted, isLoggedIn, logout } from "./api.js"
import { openSafe } from "./dom.js"

const sidebar = document.getElementById("print-sidebar")
const toggleBtn = document.getElementById("sidebar-button")
const badge = document.getElementById("print-badge")

const queueList = document.getElementById("queue-list")
const historyList = document.getElementById("history-list")
const logoutBtn = document.getElementById("logout-btn")

function requireLogin() {
    if (!isLoggedIn()) {
        window.location.replace("login.html")
        throw new Error("Not authenticated")
    }
}
requireLogin()

if (localStorage.getItem("sidebarOpen") === "1") {
    document.body.classList.add("sidebar-open")
}

toggleBtn?.addEventListener("click", () => {
    const open = document.body.classList.toggle("sidebar-open")
    localStorage.setItem("sidebarOpen", open ? "1" : "0")

    if (open) sidebar?.classList.remove("notify")
})

logoutBtn?.addEventListener("click", async () => {
    if (!confirm("Logout now?")) return
    await logout()
    localStorage.removeItem("sidebarOpen")
    window.location.replace("login.html")
})

function setBadge(count) {
    if (!badge) return
    badge.hidden = count === 0
    badge.textContent = count
}

// baris antrian: sessionId sebagai teks biasa (bukan HTML) + satu tombol
function queueRow(sessionId, label) {
    const row = document.createElement("div")
    row.className = "queue-item"

    const id = document.createElement("span")
    id.textContent = sessionId

    const btn = document.createElement("button")
    btn.type = "button"
    btn.textContent = label

    row.append(id, btn)
    return row
}

function renderEmpty(el, text) {
    el.innerHTML = `<div class="empty">${text}</div>`
}

function renderQueue(queue) {
    if (!queueList) return
    queueList.innerHTML = ""

    if (!queue?.length) {
        renderEmpty(queueList, "No queue")
        return
    }

    queue.forEach(item => {
        const row = queueRow(item.sessionId, "Print")

        row.querySelector("button").addEventListener("click", async () => {
            try {

                if (item.final) openSafe(item.final)

                await markPrinted(item.sessionId)
                await loadQueue()
            } catch (err) {
                console.error(err)
                alert("Failed to print item")
            }
        })
        queueList.appendChild(row)
    })
}

function renderHistory(history) {
    if (!historyList) return
    historyList.innerHTML = ""

    if (!history?.length) {
        renderEmpty(historyList, "No history")
        return
    }

    history.forEach(item => {
        const row = queueRow(item.sessionId, "View")
        row.querySelector("button").addEventListener("click", () => {
            if (item.final) openSafe(item.final)
        })
        historyList.appendChild(row)
    })
}

let lastQueueCount = 0

async function loadQueue() {
    try {
        const data = await getPrintQueue()

        const queue = data.queue || []
        const history = data.history || []

        setBadge(queue.length)
        renderQueue(queue)
        renderHistory(history)

        const isOpen = document.body.classList.contains("sidebar-open")

        if (queue.length > lastQueueCount && !document.body.classList.contains("sidebar-open")) {
            sidebar.classList.add("notify")
            new Audio("assets/notify.mp3").play().catch(() => {})
        }

        lastQueueCount = queue.length
    } catch (err) {
        console.error("Failed to load print queue:", err)
    }
}

setInterval(loadQueue, 8000)
loadQueue()
