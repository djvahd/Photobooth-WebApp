const ROOT_FOLDER_ID = "1bnXx-uzU3zxMwWkuYHekz0GDTVkXd8C6"
const QUEUE_FILE_NAME = "_printQueue.json"

function doGet(e) {
  try {
    const action = (e.parameter.action || "").trim()

    if (action === "list") return listSessionsHandler()
    if (action === "session") return getSessionHandler(e)
    if (action === "printQueue") return printQueueHandler()

    return jsonResponse({ error: "Invalid action" }, 404)
  } catch (err) {
    return jsonResponse({ error: err.message }, 500)
  }
}

function doPost(e) {
  try {
    const action = (e.parameter.action || "").trim()
    const path = (e.parameter.path || "").trim()
    const raw = e.postData && e.postData.contents ? e.postData.contents : "{}"
    const body = raw ? JSON.parse(raw) : {}

    if (path === "upload") return uploadHandler(body)

    if (action === "addToQueue") return addToQueueHandler(body)
    if (action === "markPrinted") return markPrintedHandler(body)

    return jsonResponse({ error: "Invalid endpoint" }, 404)
  } catch (err) {
    return jsonResponse({ error: err.message }, 500)
  }
}

function uploadHandler(data) {
  if (!data || !data.sessionId || !data.photos || !Array.isArray(data.photos) || !data.finalImage) {
    return jsonResponse({ error: "Invalid payload" }, 400)
  }

  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID)
  const folderName = sanitizeFolderName(data.sessionId)
  const sessionFolder = rootFolder.createFolder(folderName)

  data.photos.forEach((base64, index) => {
    const blob = base64ToBlob(base64, `photo${index + 1}.jpg`, "image/jpeg")
    sessionFolder.createFile(blob)
  })

  const finalBlob = base64ToBlob(data.finalImage, "final.png", "image/png")
  sessionFolder.createFile(finalBlob)

  sessionFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)

  return jsonResponse({
    success: true,
    sessionId: data.sessionId,
    folderName: folderName,
    folderUrl: sessionFolder.getUrl()
  })
}

function listSessionsHandler() {
  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const folders = rootFolder.getFolders();

  const sessions = [];
  while (folders.hasNext()) {
    const f = folders.next();
    const files = f.getFiles();
    const sessionPhotos = [];

    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName().toLowerCase();
      if (name.includes("photo") && !name.includes("final")) {
        sessionPhotos.push({
          url: "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w400"
        });
      }
    }

    sessions.push({
      sessionId: f.getName(),
      folderUrl: f.getUrl(),
      photos: sessionPhotos
    });
  }

  sessions.sort((a, b) => (a.sessionId < b.sessionId ? 1 : -1));
  return jsonResponse(sessions);
}

function getSessionHandler(e) {
  const sessionId = (e.parameter.sessionId || "").trim();
  if (!sessionId) return jsonResponse({ error: "Missing sessionId" }, 400);

  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);

  const folders = rootFolder.getFoldersByName(sessionId);

  if (!folders.hasNext()) {
    return jsonResponse({ error: "Session folder not found" }, 404);
  }

  const folder = folders.next();
  const files = folder.getFiles();
  const photos = [];
  let finalUrl = "";

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName().toLowerCase();
    const id = file.getId();


    const displayUrl = "https://drive.google.com/thumbnail?id=" + id + "&sz=w1200";
    const downloadUrl = "https://drive.google.com/uc?export=download&id=" + id;

    if (name.includes("final")) {
      finalUrl = displayUrl;
    } else if (name.includes("photo")) {
      photos.push({
        name: file.getName(),
        url: displayUrl,
        download: downloadUrl
      });
    }
  }

  photos.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));

  return jsonResponse({
    sessionId: sessionId,
    photos: photos,
    final: finalUrl
  });
}

function printQueueHandler() {
  const state = readQueueState()
  return jsonResponse(state)
}

function addToQueueHandler(body) {
  const sessionId = (body && body.sessionId ? String(body.sessionId) : "").trim()
  if (!sessionId) return jsonResponse({ error: "Missing sessionId" }, 400)

  const session = getSessionDataById(sessionId)
  if (!session) return jsonResponse({ error: "Session not found" }, 404)
  if (!session.final) return jsonResponse({ error: "Final image not found" }, 404)

  const state = readQueueState()

  const alreadyInQueue = state.queue.some(x => x.sessionId === sessionId)
  const alreadyInHistory = state.history.some(x => x.sessionId === sessionId)

  if (!alreadyInQueue && !alreadyInHistory) {
    state.queue.unshift({
      sessionId,
      final: session.final,
      createdAt: new Date().toISOString()
    })
    writeQueueState(state)
  }

  return jsonResponse({ success: true, queue: state.queue, history: state.history })
}

function markPrintedHandler(body) {
  const sessionId = (body && body.sessionId ? String(body.sessionId) : "").trim()
  if (!sessionId) return jsonResponse({ error: "Missing sessionId" }, 400)

  const state = readQueueState()

  const idx = state.queue.findIndex(x => x.sessionId === sessionId)
  if (idx === -1) {
    return jsonResponse({ success: true, queue: state.queue, history: state.history })
  }

  const item = state.queue.splice(idx, 1)[0]
  state.history.unshift({
    sessionId: item.sessionId,
    final: item.final,
    printedAt: new Date().toISOString()
  })

  if (state.history.length > 50) state.history = state.history.slice(0, 50)

  writeQueueState(state)
  return jsonResponse({ success: true, queue: state.queue, history: state.history })
}

function getSessionDataById(sessionId) {
  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID)
  const folders = rootFolder.getFoldersByName(sanitizeFolderName(sessionId))
  if (!folders.hasNext()) return null

  const folder = folders.next()
  const files = folder.getFiles()

  let finalUrl = ""
  while (files.hasNext()) {
    const file = files.next()
    const name = file.getName().toLowerCase()
    if (name === "final.png" || name === "final.jpg" || name === "final.jpeg") {
      finalUrl = makePublicFileUrl(file.getId())
      break
    }
  }

  return {
    sessionId,
    final: finalUrl
  }
}

function readQueueState() {
  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID)
  const files = rootFolder.getFilesByName(QUEUE_FILE_NAME)

  if (!files.hasNext()) {
    const init = { queue: [], history: [] }
    rootFolder.createFile(QUEUE_FILE_NAME, JSON.stringify(init), MimeType.PLAIN_TEXT)
    return init
  }

  const file = files.next()
  const txt = file.getBlob().getDataAsString() || ""

  try {
    const data = JSON.parse(txt)
    return {
      queue: Array.isArray(data.queue) ? data.queue : [],
      history: Array.isArray(data.history) ? data.history : []
    }
  } catch (e) {
    return { queue: [], history: [] }
  }
}

function writeQueueState(state) {
  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID)
  const files = rootFolder.getFilesByName(QUEUE_FILE_NAME)

  let file
  if (files.hasNext()) {
    file = files.next()
  } else {
    file = rootFolder.createFile(QUEUE_FILE_NAME, "", MimeType.PLAIN_TEXT)
  }

  file.setContent(JSON.stringify({
    queue: state.queue || [],
    history: state.history || []
  }))
}

function sanitizeFolderName(name) {
  return String(name).replace(/[\\\/:*?"<>|]/g, "_")
}

function base64ToBlob(base64, filename, mimeType) {
  const content = String(base64).split(",")[1]
  const bytes = Utilities.base64Decode(content)
  return Utilities.newBlob(bytes, mimeType, filename)
}

function makePublicFileUrl(fileId) {
  return "https://drive.google.com/uc?export=view&id=" + fileId
}

function jsonResponse(data, code) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
