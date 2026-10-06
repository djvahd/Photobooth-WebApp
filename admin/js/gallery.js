import { getSession, addToPrintQueue, isLoggedIn, logout } from "./api.js"
import { safeUrl, openSafe } from "./dom.js"

const params = new URLSearchParams(window.location.search)
const sessionId = params.get("sessionId")
const photosEl = document.querySelector(".photos")
const finalEl = document.querySelector(".final")
let lastSig = ""

function requireLogin() {
    if (!isLoggedIn()) {
        window.location.href = "login.html"
        throw new Error("Not authenticated")
    }
}
requireLogin()

const IDLE_LIMIT = 10 * 60 * 1000
function updateActivity() { localStorage.setItem("lastActivity", Date.now()) }
updateActivity()
;["mousemove","keydown","click","touchstart"].forEach(evt=>window.addEventListener(evt,updateActivity,{passive:true}))
setInterval(async()=>{
    const last=Number(localStorage.getItem("lastActivity"))||Date.now()
    if(Date.now()-last>IDLE_LIMIT){
        await logout()
        window.location.replace("login.html")
    }
},30000)

if(!sessionId) window.location.href="home.html"
if(!photosEl) console.error("Missing .photos element in gallery.html")
if(!finalEl) console.error("Missing .final element in gallery.html")

function safeArray(v){ return Array.isArray(v)?v:[] }

function signature(data) {
    if (!data) return "";
    const photosSig = safeArray(data.photos)
        .map(p => (typeof p === 'object' ? p.url : p))
        .join("|");
    return `${data.final || ""}::${photosSig}`;
}

function renderGallery(data) {
    if (!photosEl) return;
    photosEl.innerHTML = "";

    if (data && data.photos) {
        data.photos.forEach(photo => {
            const photoUrl = typeof photo === 'object' ? photo.url : photo;
            const downloadUrl = photo.download || photoUrl;

            const card = document.createElement("div");
            card.className = "photo-card";

            const img = document.createElement("img");
            img.src = safeUrl(photoUrl);

            const btn = document.createElement("button");
            btn.className = "download-btn";
            btn.textContent = "Download";
            btn.addEventListener("click", () => openSafe(downloadUrl));

            card.append(img, btn);
            photosEl.appendChild(card);
        });
    }

    if (finalEl) {
        finalEl.innerHTML = "";
        if (data && data.final) {
            const img = document.createElement("img");
            img.id = "final-image";
            img.src = safeUrl(data.final);

            const actions = document.createElement("div");
            actions.className = "actions";

            const printBtn = document.createElement("button");
            printBtn.className = "print";
            printBtn.id = "print-strip-btn";
            printBtn.textContent = "Print Strip";
            actions.appendChild(printBtn);

            finalEl.append(img, actions);

            printBtn.onclick = () => {
                addToPrintQueue(sessionId, data.final);
                alert("Full strip added to print queue!");
            };
        } else {
            finalEl.innerHTML = "<p style='text-align:center'>Processing final strip...</p>";
        }
    }
}

async function loadGallery(){
    try{
        const data=await getSession(sessionId)
        renderGallery(data)
        return data
    } catch(err){
        console.error("Failed to load session:",err)
        renderGallery(null)
        return null
    }
}

setInterval(async()=>{
    const data=await loadGallery()
    if(!data) return
    const sig=signature(data)
    if(sig!==lastSig){
        lastSig=sig
        renderGallery(data)
    }
},10000)

loadGallery()
