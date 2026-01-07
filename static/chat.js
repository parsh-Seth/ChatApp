const $ = (s) => document.querySelector(s);

const refreshBtn = $("#refreshBtn");
const sockStatus = $("#sockStatus");

const tabs = Array.from(document.querySelectorAll(".tab"));
const listTitle = $("#listTitle");
const listStatus = $("#listStatus");
const peopleList = $("#peopleList");

const friendsCount = $("#friendsCount");
const pendingCount = $("#pendingCount");
const sentCount = $("#sentCount");

const whoAvatar = $("#whoAvatar");
const whoName = $("#whoName");
const whoUser = $("#whoUser");

const searchInput = $("#searchInput");
const searchBtn = $("#searchBtn");
const searchResult = $("#searchResult");

const messagesEl = $("#messages");
const chatEmpty = $("#chatEmpty");
const msgInput = $("#msgInput");
const sendBtn = $("#sendBtn");
const clearBtn = $("#clearBtn");

const PLACEHOLDER_AVATAR =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="20" fill="rgba(255,255,255,0.08)"/>
    <circle cx="48" cy="38" r="16" fill="rgba(255,255,255,0.35)"/>
    <path d="M18 84c6-16 18-24 30-24s24 8 30 24" fill="rgba(255,255,255,0.20)"/>
  </svg>
`);

function safeAvatar(url) {
  if (!url || typeof url !== "string") return PLACEHOLDER_AVATAR;
  const u = url.trim();
  if (!u) return PLACEHOLDER_AVATAR;
  if (u.startsWith("/")) return u;
  if (u.startsWith("static/")) return "/" + u;
  if (u.startsWith("image/")) return "/static/" + u;
  if (u.startsWith("www.")) return "https://" + u;
  return u;
}

async function fetchJSON(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    throw new Error(`Expected JSON from ${path} (maybe redirected to /login).`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

async function postAction(url) {
  return fetchJSON(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ---- State ----
let currentTab = "friends";
let cache = { friends: [], pending: [], sent: [] };
let selectedFriend = null;

let me = null;     // {id, username, name, profile_pic_url}
let socket = null; // socket.io client

// Store messages per friend username (local UI thread)
function msgKey(friendUsername) {
  return `msgs_${friendUsername}`;
}
function loadMsgs(friendUsername) {
  try {
    return JSON.parse(localStorage.getItem(msgKey(friendUsername)) || "[]");
  } catch {
    return [];
  }
}
function saveMsgs(friendUsername, msgs) {
  localStorage.setItem(msgKey(friendUsername), JSON.stringify(msgs));
}

// ---- UI ----
function setTab(tab) {
  currentTab = tab;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  listTitle.textContent =
    tab === "friends" ? "Friends" : tab === "pending" ? "Pending Requests" : "Sent Requests";

  selectedFriend = null;
  renderHeader();
  renderList();
  renderChat();
}

function renderCounts() {
  friendsCount.textContent = cache.friends.length;
  pendingCount.textContent = cache.pending.length;
  sentCount.textContent = cache.sent.length;
}

function renderHeader() {
  if (!selectedFriend) {
    whoAvatar.src = PLACEHOLDER_AVATAR;
    whoName.textContent = "Select a friend";
    whoUser.textContent = "@";
    msgInput.disabled = true;
    sendBtn.disabled = true;
    return;
  }
  whoAvatar.src = safeAvatar(selectedFriend.profile_pic_url);
  whoName.textContent = selectedFriend.name || selectedFriend.username;
  whoUser.textContent = "@" + selectedFriend.username;
  msgInput.disabled = false;
  sendBtn.disabled = false;
}

function renderChat() {
  messagesEl.innerHTML = "";
  if (!selectedFriend) {
    chatEmpty.style.display = "block";
    return;
  }
  chatEmpty.style.display = "none";

  const msgs = loadMsgs(selectedFriend.username);
  msgs.forEach((m) => {
    const div = document.createElement("div");
    div.className = `bubble ${m.who === "me" ? "me" : "them"}`;
    div.innerHTML = `
      <div>${escapeHtml(m.text)}</div>
      <div class="meta2">${escapeHtml(m.from)} • ${fmtTime(m.ts)}</div>
    `;
    messagesEl.appendChild(div);
  });

  // scroll down
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
}

function makeActionsForUser(u) {
  const wrap = document.createElement("div");
  wrap.className = "row-actions";

  if (currentTab === "pending") {
    wrap.innerHTML = `
      <button class="btn ok">Accept</button>
      <button class="btn danger">Decline</button>
    `;
    const [aBtn, dBtn] = wrap.querySelectorAll("button");
    aBtn.addEventListener("click", async () => {
      aBtn.disabled = dBtn.disabled = true;
      try {
        await postAction(`/accept_friends/${u.id}`);
        await refreshAll();
      } catch (e) {
        alert(e.message);
        aBtn.disabled = dBtn.disabled = false;
      }
    });
    dBtn.addEventListener("click", async () => {
      aBtn.disabled = dBtn.disabled = true;
      try {
        await postAction(`/decline_friends/${u.id}`);
        await refreshAll();
      } catch (e) {
        alert(e.message);
        aBtn.disabled = dBtn.disabled = false;
      }
    });
    return wrap;
  }

  if (currentTab === "friends") {
    wrap.innerHTML = `<button class="btn danger">Remove</button>`;
    const rBtn = wrap.querySelector("button");
    rBtn.addEventListener("click", async () => {
      rBtn.disabled = true;
      try {
        await postAction(`/remove_friend/${u.id}`);
        if (selectedFriend && selectedFriend.id === u.id) selectedFriend = null;
        renderHeader();
        renderChat();
        await refreshAll();
      } catch (e) {
        alert(e.message);
        rBtn.disabled = false;
      }
    });
    return wrap;
  }

  return null; // sent tab
}

function renderList() {
  const items = cache[currentTab] || [];
  peopleList.innerHTML = "";

  if (!items.length) {
    peopleList.innerHTML = `<div class="empty muted">No items.</div>`;
    listStatus.textContent = "";
    return;
  }
  listStatus.textContent = `${items.length} item(s)`;

  items.forEach((u) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img class="avatar" alt="" src="${safeAvatar(u.profile_pic_url)}" />
      <div class="meta">
        <p class="name">${escapeHtml(u.name || "")}</p>
        <p class="user">@${escapeHtml(u.username || "")}</p>
      </div>
    `;

    const actions = makeActionsForUser(u);
    if (actions) card.appendChild(actions);

    if (currentTab === "friends") {
      card.addEventListener("click", async (e) => {
        if (e.target.closest("button")) return;
        selectedFriend = u;
        renderHeader();

        // IMPORTANT: fetch offline messages from DB for this friend
        try {
          await fetchUndeliveredForFriend(u);
        } catch (err) {
          console.warn("undelivered fetch failed:", err);
        }

        renderChat();
      });
    }

    peopleList.appendChild(card);
  });
}

// ---- Load lists ----
async function refreshAll() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";

  try {
    const [friendsRes, pendingRes, sentRes] = await Promise.all([
      fetchJSON("/list_friends"),
      fetchJSON("/get_pending_requests"),
      fetchJSON("/sent_requests"),
    ]);

    cache.friends = Array.isArray(friendsRes.data) ? friendsRes.data : [];
    cache.pending = Array.isArray(pendingRes.data) ? pendingRes.data : [];
    cache.sent = Array.isArray(sentRes.data) ? sentRes.data : [];

    renderCounts();
    renderList();
  } catch (e) {
    console.error(e);
    peopleList.innerHTML = `<div class="empty muted">${escapeHtml(e.message)}</div>`;
    listStatus.textContent = "";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
  }
}

// ---- Offline messages ----
// Calls your endpoint GET /undelivered_msg/<friend_id>
// Expected response: { data: [ {from: <sender_id>, message: "..."} ] } or {error:"No messages found"}
async function fetchUndeliveredForFriend(friend) {
  if (!friend || !friend.id) return;

  const res = await fetchJSON(`/undelivered_msg/${friend.id}`);
  if (!res.data || !Array.isArray(res.data) || res.data.length === 0) return;

  const msgs = loadMsgs(friend.username);
  for (const m of res.data) {
    msgs.push({
      who: "them",
      from: friend.username,
      text: m.message,
      ts: Date.now(),
    });
  }
  saveMsgs(friend.username, msgs);
}

// ---- Search + Add friend ----
async function doSearch() {
  const u = searchInput.value.trim();
  if (!u) {
    searchResult.innerHTML = `<span class="muted">Type a username.</span>`;
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "Searching...";

  try {
    const data = await fetchJSON(`/search/${encodeURIComponent(u)}`);
    const isMe = me && String(data.id) === String(me.id);

    searchResult.innerHTML = `
      <img class="avatar" alt="" src="${safeAvatar(data.profile_pic)}" />
      <div class="meta">
        <p class="name">${escapeHtml(data.name || "")}</p>
        <p class="user">@${escapeHtml(data.username || "")} <span class="muted">(id: ${escapeHtml(
      String(data.id)
    )})</span></p>
      </div>
      <div class="row-actions">
        <button id="addBtn" class="btn primary" ${isMe ? "disabled" : ""}>
          ${isMe ? "That’s you" : "Send Request"}
        </button>
      </div>
    `;

    const addBtn = $("#addBtn");
    if (!isMe) {
      addBtn.addEventListener("click", async () => {
        addBtn.disabled = true;
        addBtn.textContent = "Sending...";
        try {
          const resp = await postAction(`/addfriend/${data.id}`);
          addBtn.classList.remove("primary");
          addBtn.classList.add("ok");
          addBtn.textContent = resp.status === "accepted" ? "Accepted ✅" : "Sent ✅";
          await refreshAll();
        } catch (e) {
          alert(e.message);
          addBtn.disabled = false;
          addBtn.textContent = "Send Request";
        }
      });
    }
  } catch (e) {
    searchResult.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Search";
  }
}

// ---- Socket.IO ----
async function initSocket() {
  socket = io();

  socket.on("connect", () => {
    sockStatus.textContent = "connected";
    // register by username so server can map username -> sid
    socket.emit("register", { username: me.username });
  });

  socket.on("disconnect", () => {
    sockStatus.textContent = "disconnected";
  });

  socket.on("error_message", (data) => {
    alert(data?.error || "Socket error");
  });

  // Optional status event if you implement it server-side
  socket.on("message_status", (data) => {
    // {status:'stored'|'delivered', to:'username'}
    // You can display this somewhere if you want. For now just log.
    console.log("message_status:", data);
  });

  // Receive a private message
  socket.on("private_message", async (data) => {
    // expected: { from: "<username>", message: "<text>" }
    const from = data?.from;
    const text = data?.message;

    if (!from || typeof text !== "string") return;

    // IMPORTANT: your server echoes the message back to sender too.
    // Since we already do optimistic UI on send, ignore our own echo.
    if (me && from === me.username) return;

    // store locally under that sender username
    const msgs = loadMsgs(from);
    msgs.push({ who: "them", from, text, ts: Date.now() });
    saveMsgs(from, msgs);

    // If currently chatting with that person, show it
    if (selectedFriend && selectedFriend.username === from) {
      renderChat();
    }
  });
}

function sendMessage() {
  if (!socket || !selectedFriend || !me) return;
  const text = msgInput.value.trim();
  if (!text) return;

  const friendU = selectedFriend.username;

  // optimistic local store
  const msgs = loadMsgs(friendU);
  msgs.push({ who: "me", from: me.username, text, ts: Date.now() });
  saveMsgs(friendU, msgs);

  // send through socket
  socket.emit("private_message", { to: friendU, message: text });

  msgInput.value = "";
  renderChat();
}

// Clear local chat (demo)
clearBtn.addEventListener("click", () => {
  if (!selectedFriend) return;
  localStorage.removeItem(msgKey(selectedFriend.username));
  renderChat();
});

// ---- Events ----
refreshBtn.addEventListener("click", refreshAll);
tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

// ---- Boot ----
(async function boot() {
  setTab("friends");

  try {
    me = await fetchJSON("/me"); // must exist (you have it)
  } catch (e) {
    sockStatus.textContent = "error";
    alert("Cannot load /me. Are you logged in?");
    return;
  }

  await refreshAll();

  try {
    await initSocket();
  } catch (e) {
    console.error(e);
    sockStatus.textContent = "error";
    alert("Socket init failed.");
  }
})();
