function resetSession() {
    localStorage.removeItem("photos")
    localStorage.removeItem("sessionID")
    localStorage.removeItem("folderUrl")
}

let isStarting = false

function startPhotobooth() {
    if (isStarting) return
    isStarting = 
    
    resetSession()

    setTimeout(() => {
        window.location.href = "camera.html"
    }, 300)
}

document
    .getElementById("start-button")
    .addEventListener("click", startPhotobooth)

window.addEventListener("load", resetSession)