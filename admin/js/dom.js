// Helper aman untuk menampilkan data dari API (cegah XSS)

// hanya izinkan URL http(s) atau data:image, selain itu dikosongkan
export function safeUrl(url) {
    if (typeof url !== "string") return ""
    if (url.startsWith("data:image/")) return url
    try {
        const u = new URL(url, location.href)
        return u.protocol === "https:" || u.protocol === "http:" ? u.href : ""
    } catch {
        return ""
    }
}

// buka URL di tab baru tanpa memberi akses window.opener
export function openSafe(url) {
    const href = safeUrl(url)
    if (href) window.open(href, "_blank", "noopener,noreferrer")
}
