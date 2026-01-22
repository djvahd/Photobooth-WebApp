document.addEventListener("DOMContentLoaded", () => {

    const photoEls = document.querySelectorAll(".photo")
    const retakeContainers = document.querySelectorAll(".button-container")
    const nextBtn = document.getElementById("next-button")
    const countdownEl = document.getElementById("countdown-start")
    const finalPreviewImg = document.getElementById("final-preview")

    let photos = JSON.parse(localStorage.getItem("photos") || "[]")
    const finalImage = localStorage.getItem("finalImage")
    const sessionId = localStorage.getItem("sessionId")

    if (photos.length !== 3 || !finalImage || !sessionId) {
        window.location.href = "home.html"
        return
    }

    photoEls.forEach((el, index) => {
        el.style.backgroundImage = `url(${photos[index]})`
    })

    finalPreviewImg.src = finalImage

    retakeContainers.forEach(container => {
        const index = Number(container.dataset.index)
        const btn = container.querySelector(".retake-button")

        btn.addEventListener("click", () => {
            localStorage.setItem("retakeIndex", index)
            window.location.href = "camera.html"
        })
    })

    nextBtn.addEventListener("click", uploadAndNext)

    let count = 90;
    countdownEl.textContent = formatTime(count)

    const interval = setInterval(() => {
        count--
        countdownEl.textContent = formatTime(count)

        if (count <= 0) {
            clearInterval(interval)
            uploadAndNext()
        }
    }, 1000)

    function formatTime(seconds) {
        const m = String(Math.floor(seconds / 60)).padStart(2, "0")
        const s = String(seconds % 60).padStart(2, "0")
        return `${m}:${s}`
    }

    async function uploadAndNext() {
        clearInterval(interval)
        nextBtn.disabled = true
        nextBtn.textContent = "Uploading..."

        try {
            const finalImage = localStorage.getItem("finalImage")
            if (!finalImage) throw new Error("Final image missing")

            const res = await fetch("https://script.google.com/macros/s/AKfycbz2WrsPbfp9Nf0k54MNi0cHTegDC3uzuyiX2X33MTCRBGJM7Srg_8sD5le1t3qKowRc/exec" + "?path=upload", {
                method: "POST",
                body: JSON.stringify({ sessionId, photos, finalImage })
            })

            const text = await res.text()
            const result = JSON.parse(text)
            if (!result.success) throw new Error(result.error)
    
            localStorage.setItem("folderUrl", result.folderUrl)
            window.location.href = "qr.html"

        } catch (err) {
            alert(err.message)
            nextBtn.disabled = false
            nextBtn.textContent = "Next"
        }
    }
})