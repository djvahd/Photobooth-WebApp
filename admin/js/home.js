import { listSessions, isLoggedIn, logout } from "./api.js"
import { safeUrl } from "./dom.js"

const grid = document.querySelector(".session-grid")
const searchInput = document.querySelector(".search")
let sessions = []

function requireLogin() {
    if (!isLoggedIn()) {
        window.location.replace("login.html")
        throw new Error("Not authenticated")
    }
}
requireLogin()

const IDLE_LIMIT = 10 * 60 * 1000
function updateActivity() { localStorage.setItem("lastActivity", Date.now()) }
updateActivity()
;["mousemove","keydown","click","touchstart"].forEach(evt => window.addEventListener(evt, updateActivity, {passive:true}))
setInterval(async()=>{
    const last=Number(localStorage.getItem("lastActivity"))||Date.now()
    if(Date.now()-last>IDLE_LIMIT){
        await logout()
        window.location.replace("login.html")
    }
},30000)

function renderSessions(data) {
    if (!grid) return;
    grid.innerHTML = "";
    if (!data.length) { 
        grid.innerHTML = "<div class='empty'>No sessions found</div>"; 
        return; 
    }

    data.forEach(s => {
        const card = document.createElement("div");
        card.className = "session-card";
        const thumb = document.createElement("div");
        thumb.className = "thumb";

        const idEl = document.createElement("div");
        idEl.className = "session-id";
        idEl.textContent = s.sessionId;

        card.append(thumb, idEl);

        if (s.photos && s.photos.length > 0) {
            const img = document.createElement("img");
            const firstPhoto = s.photos[0];
            img.src = safeUrl(typeof firstPhoto === 'object' ? firstPhoto.url : firstPhoto);
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            img.style.borderRadius = "14px";
            img.style.transition = "opacity 0.5s ease";
            
            thumb.appendChild(img);

            if (s.photos.length > 1) {
                let currentIndex = 0;
                setInterval(() => {
                    img.style.opacity = "0";
                    setTimeout(() => {
                        currentIndex = (currentIndex + 1) % s.photos.length;
                        const nextPhoto = s.photos[currentIndex];
                        img.src = safeUrl(typeof nextPhoto === 'object' ? nextPhoto.url : nextPhoto);
                        img.style.opacity = "1";
                    }, 500); 
                }, 3000);
            }
        } else {
            thumb.style.display = "flex";
            thumb.style.alignItems = "center";
            thumb.style.justifyContent = "center";
            const placeholder = document.createElement("span");
            placeholder.className = "thumb-placeholder";
            placeholder.textContent = "No preview photos";
            thumb.appendChild(placeholder);
        }

        card.onclick = () => window.location.href = `gallery.html?sessionId=${encodeURIComponent(s.sessionId)}`;
        grid.appendChild(card);
    });
}

async function loadSessions(){
    try{
        const latest=await listSessions()
        sessions=Array.isArray(latest)?latest:[]
        renderSessions(sessions)
    }catch(err){
        console.error("Failed to load sessions:", err)
        renderSessions([])
    }
}

function sessionsSignature(arr){ return arr.map(x=>x.sessionId).join("|") }
let lastSignature=""
setInterval(async()=>{
    try{
        const latest=await listSessions()
        const sig=sessionsSignature(latest)
        if(sig!==lastSignature){
            lastSignature=sig
            sessions=latest
            renderSessions(sessions)
        }
    }catch(err){ console.warn("Polling failed:", err) }
},15000)

if(searchInput){
    searchInput.addEventListener("input",e=>{
        const q=e.target.value.toLowerCase().trim()
        const filtered=sessions.filter(s=>String(s.sessionId).toLowerCase().includes(q))
        renderSessions(filtered)
    })
}

loadSessions()
