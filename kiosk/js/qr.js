document.addEventListener("DOMContentLoaded", () => {
    const folderUrl = localStorage.getItem("folderUrl")
    const sessionId = localStorage.getItem("sessionId")
    const countdownEl = document.getElementById("countdown-start")
    const homeBtn = document.getElementById("home-button")
    
    if (!folderUrl) {
            window.location.href = "home.html"
            return
        }

    if (sessionId) {
        document.getElementById("session-id").textContent =
    sessionId.slice(0, 6)
    }

    generateQR(folderUrl)

    let count = 60;
    countdownEl.textContent = formatTime(count)

    const interval = setInterval(() => {
        count--
        countdownEl.textContent = formatTime(count)

        if (count <= 0) {
            clearInterval(interval)
            resetSession()
            setTimeout(() => {
                window.location.href = "home.html"
            }, 300)
        }
    }, 1000)

    homeBtn.addEventListener("click", () => {
        clearInterval(interval)
        resetSession()
        setTimeout(() => {
            window.location.href = "home.html"
        }, 300)
    })
})

function formatTime(seconds) {
    const m = String(Math.floor(seconds / 60)).padStart(2, "0")
    const s = String(seconds % 60).padStart(2, "0")
    return `${m}:${s}`
}

function generateQR(text) {
    const container = document.getElementById("qr-code")
    container.innerHTML = ""

    const qr = new QRCodeStyling({
        width: 300,
        height: 300,
        type: "svg",
        data: text,

        dotsOptions: {
            type: "rounded",
            color: "#081b1b"
        },

        cornersSquareOptions: {
            type: "extra-rounded",
            color: "#081b1b"
        },

        cornersDotOptions: {
            type: "dot",
            color: "#081b1b"
        },

        backgroundOptions: {
            color: "#e0e0e0"
        },

        qrOptions: {
            errorCorrectionLevel: "H"
        }
    })

    qr.append(container)
}

function resetSession() {
    localStorage.removeItem("photos")
    localStorage.removeItem("finalImage")
    localStorage.removeItem("sessionId")
    localStorage.removeItem("folderUrl")
    localStorage.removeItem("retakeIndex")
}
