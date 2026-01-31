document.addEventListener("DOMContentLoaded", () => {

    const video = document.getElementById("video")
    const canvas = document.getElementById("capture")
    const flash = document.getElementById("flash-overlay")
    const countdownEl = document.getElementById("capture-countdown")
    const startBtn = document.getElementById("start-button")
    const startCountdownEl = document.getElementById("countdown-start")

    const TOTAL_PHOTOS = 3
    let photos = JSON.parse(localStorage.getItem("photos") || "[]")
    let retakeIndex = localStorage.getItem("retakeIndex")
    retakeIndex = retakeIndex !== null ? Number(retakeIndex) : null
    let isRetake = Number.isInteger(retakeIndex) && retakeIndex >= 0
    let isRunning = false
    let sessionId = ""
    let autoStartInterval = null

    if (isRetake) {
        document.body.classList.add("session-active-retake")
    }

    async function initCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {facingMode: "user"},
            audio: false
        })
        video.srcObject = stream
        await video.play()

        if (isRetake) {
            await delay(1000)
            await countdown(5)
            await flashEffect()
            photos[retakeIndex] = capture()

            const finalImage = await generateFinalImage(photos)

            localStorage.setItem("photos", JSON.stringify(photos))
            localStorage.setItem("finalImage", finalImage)
            localStorage.removeItem("retakeIndex")

            stopCamera()
            setTimeout(() => {
                window.location.href = "preview.html"
            }, 100)
            return
        }

        startAutoCountdown(30)
    }

    const delay = ms => new Promise (r => setTimeout(r, ms))

    function flashEffect() {
        return new Promise(resolve => {
            flash.classList.add("active")
            setTimeout(() => {
                flash.classList.remove("active")
                resolve()
            }, 200)
        })
    }

    function countdown(seconds = 5) {
        return new Promise(resolve => {
            let count = seconds
            countdownEl.textContent = count

            const i = setInterval(() => {
                count--
                countdownEl.textContent = count

                if (count === 0) {
                    clearInterval(i)
                    countdownEl.textContent = ""
                    resolve()
                }
            }, 1000)
        })
    }

    function capture() {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext("2d").drawImage(video, 0, 0)
        return canvas.toDataURL("image/jpeg", 0.9)
    }

    function stopCamera() {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop())
            video.srcObject = null
         }
    }

    async function startSession() {
        if (isRunning) return;
        isRunning = true
        startBtn.disabled = true

        if (autoStartInterval) {
            clearInterval(autoStartInterval)
            autoStartInterval = null
            startCountdownEl.textContent = ""
        }

        document.body.classList.add("session-active")

        sessionId = generateSessionId()
        photos = isRetake ? photos : []

        await delay(1000)
        for (let i = 0; i < TOTAL_PHOTOS; i++) {
            await countdown(5)
            await flashEffect()
            photos.push(capture())
            await delay(1000)
        }

        const finalImage = await generateFinalImage(photos)

        localStorage.setItem("photos", JSON.stringify(photos))
        localStorage.setItem("finalImage", finalImage)
        localStorage.setItem("sessionId", sessionId)
        
        stopCamera()
        setTimeout(() => {
            window.location.href = "preview.html"
        }, 100)
    }

    async function generateFinalImage(photos) {
        const frameImg = new Image()
        frameImg.src = "assets/frame.png"
        frameImg.crossOrigin = "anonymous"
        await frameImg.decode()

        const canvas = document.createElement("canvas")
        canvas.width = frameImg.naturalWidth
        canvas.height = frameImg.naturalHeight

        const ctx = canvas.getContext("2d")

        const slots = [
            {x: 75, y:575},
            {x: 75, y:1290},
            {x: 75, y:2005}
        ]

        const w = 930
        const h = 619

        for (let i = 0; i < 3; i++) {
            const img = new Image()
            img.src = photos[i]
            await img.decode()
            ctx.drawImage(img, slots[i].x, slots[i].y, w, h)
        }

        ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height)

        return canvas.toDataURL("image/png")
    }

    function generateSessionId() {
        const r = Math.random().toString(36).substring(2, 7)
        const d = new Date()

        const date = d.toLocaleDateString("id-ID").replace(/\//g, "-")
        const time = d.toTimeString().substring(0, 8)

        return `#${r}-${date}-${time}`
    }

    function startAutoCountdown(seconds = 30) {
        let count = seconds;
        startCountdownEl.textContent = formatTime(count)

        const interval = setInterval(() => {
            count--
            startCountdownEl.textContent = formatTime(count)

            if (count <= 0) {
                clearInterval(interval)
                startCountdownEl.textContent = ""
                startSession()
            }
        }, 1000)

        return interval
    }

    function formatTime(seconds) {
        const m = String(Math.floor(seconds / 60)).padStart(2, "0")
        const s = String(seconds % 60).padStart(2, "0")
        return `${m}:${s}`
    }

    startBtn.addEventListener("click", startSession)
    initCamera()
})