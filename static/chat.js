const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---- Elements ---- */
const friendsWrap = $("#friendsWrap");
const friendsList = $("#friendsList");
const friendsEmpty = $("#friendsEmpty");

const searchWrap = $("#searchWrap");
const searchList = $("#searchList");
const searchEmpty = $("#searchEmpty");
const searchHint = $("#searchHint");

const searchInput = $("#searchInput");
const searchBtn = $("#searchBtn");

const requestsBtn = $("#requestsBtn");
const reqBadge = $("#reqBadge");

const requestsPage = $("#requestsPage");
const reqBackBtn = $("#reqBackBtn");
const reqTabs = $$(".seg-btn");
const reqSearchInput = $("#reqSearchInput");
const reqSearchBtn = $("#reqSearchBtn");
const reqList = $("#reqList");
const reqEmpty = $("#reqEmpty");

const meAvatar = $("#meAvatar");

const whoAvatar = $("#whoAvatar");
const whoName = $("#whoName");
const whoUser = $("#whoUser");

const messagesEl = $("#messages");
const chatEmpty = $("#chatEmpty");
const msgInput = $("#msgInput");
const sendBtn = $("#sendBtn");
const clearBtn = $("#clearBtn");

const sockStatus = $("#sockStatus");
const sockDot = $("#sockDot");

const settingsBtn = $("#settingsBtn");
const closeSettingsBtn = $("#closeSettingsBtn");
const modalBackdrop = $("#modalBackdrop");
const settingsModal = $("#settingsModal");

/* ---- Helpers ---- */
const PLACEHOLDER_AVATAR =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="48" fill="rgba(22,52,58,0.06)"/>
    <circle cx="48" cy="38" r="16" fill="rgba(22,52,58,0.22)"/>
    <path d="M18 84c6-16 18-24 30-24s24 8 30 24" fill="rgba(22,52,58,0.14)"/>
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

/* ---- State ---- */
let me = null;              // {id, username, name, profile_pic_url}
let socket = null;

let friends = [];           // [{id,name,username,profile_pic_url}]
let pending = [];           // received requests
let sent = [];              // sent requests

let selectedFriend = null;  // friend object
let reqTab = "received";    // 'received' | 'sent'

/* ---- Local message storage ---- */
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

/* ---- UI: header & chat ---- */
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
      <div class="bmeta">${escapeHtml(m.from)} • ${fmtTime(m.ts)}</div>
    `;
    messagesEl.appendChild(div);
  });

  // scroll down
  const area = $("#chatArea");
  area.scrollTop = area.scrollHeight;
}

/* ---- UI: friends list ---- */
function setEmpty(el, show) {
  el.style.display = show ? "block" : "none";
}

function cardEl(user, opts = {}) {
  const {
    rightButton = null,      // { label, className, onClick, disabled }
    subtitle = null,         // string (like @username)
    selectable = true,
    selected = false,
    onClick = null,
  } = opts;

  const card = document.createElement("div");
  card.className = "card" + (selected ? " selected" : "");
  card.setAttribute("role", selectable ? "button" : "group");

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.alt = "";
  avatar.src = safeAvatar(user.profile_pic_url || user.profile_pic);

  const text = document.createElement("div");
  text.className = "card-text";
  text.innerHTML = `
    <div class="card-name">${escapeHtml(user.name || user.username || "")}</div>
    <div class="card-user">${escapeHtml(subtitle ?? ("@" + (user.username || "")))}</div>
  `;

  card.appendChild(avatar);
  card.appendChild(text);

  if (rightButton) {
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const btn = document.createElement("button");
    btn.className = `pill-btn ${rightButton.className || ""}`.trim();
    btn.textContent = rightButton.label;
    btn.disabled = !!rightButton.disabled;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      rightButton.onClick?.(btn);
    });

    actions.appendChild(btn);
    card.appendChild(actions);
  }

  if (selectable) {
    card.addEventListener("click", () => onClick?.());
  }

  return card;
}

function renderFriendsList() {
  friendsList.innerHTML = "";

  if (!friends.length) {
    setEmpty(friendsEmpty, true);
    return;
  }
  setEmpty(friendsEmpty, false);

  friends.forEach((u) => {
    const isSel = selectedFriend && selectedFriend.id === u.id;
    const el = cardEl(u, {
      selected: isSel,
      onClick: async () => {
        selectedFriend = u;
        renderHeader();

        // fetch undelivered from DB for this friend, then show chat
        try {
          await fetchUndeliveredForFriend(u);
        } catch (err) {
          console.warn("undelivered fetch failed:", err);
        }

        renderFriendsList(); // highlight
        renderChat();
      },
    });
    friendsList.appendChild(el);
  });
}

/* ---- Search behavior (like your drawings) ----
   - When search box has text:
     - Hide normal friend list
     - Show results: matching friends + (if not a friend) remote /search/<username> result with Add button
   - Right chat stays as the last selected friend chat
*/
function showSearchMode(on) {
  friendsWrap.classList.toggle("hidden", on);
  searchWrap.classList.toggle("hidden", !on);
}

function findFriendByUsername(username) {
  const u = (username || "").trim().toLowerCase();
  return friends.find((f) => (f.username || "").toLowerCase() === u) || null;
}

function filterFriendsByQuery(q) {
  const s = q.trim().toLowerCase();
  if (!s) return friends.slice();
  return friends.filter((f) => {
    const name = (f.name || "").toLowerCase();
    const un = (f.username || "").toLowerCase();
    return name.includes(s) || un.includes(s);
  });
}

async function runSearch() {
  const q = searchInput.value.trim();
  if (!q) {
    showSearchMode(false);
    return;
  }

  showSearchMode(true);
  searchHint.textContent = "Search results";

  searchList.innerHTML = "";
  setEmpty(searchEmpty, false);

  // 1) matching friends
  const matches = filterFriendsByQuery(q);
  matches.forEach((u) => {
    const isSel = selectedFriend && selectedFriend.id === u.id;
    const el = cardEl(u, {
      selected: isSel,
      onClick: async () => {
        selectedFriend = u;
        renderHeader();
        try { await fetchUndeliveredForFriend(u); } catch {}
        renderChat();
        // keep search results visible (like your drawing), but update highlight
        runSearch().catch(() => {});
      },
    });
    searchList.appendChild(el);
  });

  // 2) if exact username isn't already a friend, try remote /search/<username>
  const exactFriend = findFriendByUsername(q);
  if (!exactFriend) {
    try {
      const found = await fetchJSON(`/search/${encodeURIComponent(q)}`);
      const isMe = me && String(found.id) === String(me.id);

      // show "new user" row with Add button
      const el = cardEl(
        { ...found, profile_pic_url: found.profile_pic },
        {
          subtitle: "@" + found.username,
          selectable: false,
          rightButton: {
            label: isMe ? "That’s you" : "Add",
            className: isMe ? "" : "add",
            disabled: isMe,
            onClick: async (btn) => {
              btn.disabled = true;
              btn.textContent = "Adding...";
              try {
                const resp = await postAction(`/addfriend/${found.id}`);
                btn.classList.remove("add");
                btn.classList.add("ok");
                btn.textContent = resp.status === "accepted" ? "Accepted ✓" : "Sent ✓";
                await refreshAll();
              } catch (e) {
                alert(e.message);
                btn.disabled = false;
                btn.textContent = "Add";
              }
            },
          },
        }
      );
      searchList.appendChild(el);
    } catch {
      // ignore not found; we'll show whatever friend matches exist
    }
  }

  if (!searchList.children.length) {
    setEmpty(searchEmpty, true);
  }
}

/* ---- Friend Requests "Page" ---- */
function openRequestsPage() {
  requestsPage.classList.remove("hidden");
  renderRequestsList();
}

function closeRequestsPage() {
  requestsPage.classList.add("hidden");
}

function setReqTab(tab) {
  reqTab = tab;
  reqTabs.forEach((b) => b.classList.toggle("active", b.dataset.reqtab === tab));
  renderRequestsList();
}

function renderRequestsList() {
  const q = (reqSearchInput.value || "").trim().toLowerCase();
  const src = reqTab === "received" ? pending : sent;

  const items = !q
    ? src
    : src.filter((u) => {
        const name = (u.name || "").toLowerCase();
        const un = (u.username || "").toLowerCase();
        return name.includes(q) || un.includes(q);
      });

  reqList.innerHTML = "";
  setEmpty(reqEmpty, items.length === 0);

  items.forEach((u) => {
    if (reqTab === "received") {
      const el = cardEl(u, {
        selectable: false,
        rightButton: {
          label: "Accept",
          className: "ok",
          onClick: async (btn) => {
            btn.disabled = true;
            try {
              await postAction(`/accept_friends/${u.id}`);
              await refreshAll();
            } catch (e) {
              alert(e.message);
              btn.disabled = false;
            }
          },
        },
      });

      // add Decline button beside Accept
      const actions = el.querySelector(".card-actions");
      const decline = document.createElement("button");
      decline.className = "pill-btn danger";
      decline.textContent = "Decline";
      decline.addEventListener("click", async (e) => {
        e.stopPropagation();
        decline.disabled = true;
        try {
          await postAction(`/decline_friends/${u.id}`);
          await refreshAll();
        } catch (err) {
          alert(err.message);
          decline.disabled = false;
        }
      });
      actions.appendChild(decline);

      reqList.appendChild(el);
      return;
    }

    // sent tab (no actions)
    const el = cardEl(u, { selectable: false });
    reqList.appendChild(el);
  });
}

/* ---- Counts/badges ---- */
function renderBadges() {
  // badge shows received count (like your drawing)
  const n = pending.length;
  reqBadge.textContent = String(n);
  reqBadge.classList.toggle("hidden", n <= 0);
}

/* ---- Offline messages ---- */
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

/* ---- Send message ---- */
function sendMessage() {
  if (!socket || !selectedFriend || !me) return;
  const text = msgInput.value.trim();
  if (!text) return;

  const friendU = selectedFriend.username;

  // optimistic store
  const msgs = loadMsgs(friendU);
  msgs.push({ who: "me", from: me.username, text, ts: Date.now() });
  saveMsgs(friendU, msgs);

  socket.emit("private_message", { to: friendU, message: text });

  msgInput.value = "";
  renderChat();
}

/* ---- Socket.IO ---- */
async function initSocket() {
  socket = io();

  socket.on("connect", () => {
    sockStatus.textContent = "connected";
    sockDot.style.background = "#26b49f";
    socket.emit("register", { username: me.username });
  });

  socket.on("disconnect", () => {
    sockStatus.textContent = "disconnected";
    sockDot.style.background = "#bbb";
  });

  socket.on("error_message", (data) => {
    alert(data?.error || "Socket error");
  });

  socket.on("private_message", (data) => {
    const from = data?.from;
    const text = data?.message;
    if (!from || typeof text !== "string") return;

    // server echoes back to sender too; ignore our own echo (we already rendered)
    if (me && from === me.username) return;

    // store locally under sender username
    const msgs = loadMsgs(from);
    msgs.push({ who: "them", from, text, ts: Date.now() });
    saveMsgs(from, msgs);

    // if chatting with them, show it
    if (selectedFriend && selectedFriend.username === from) {
      renderChat();
    }
  });
}

/* ---- Data refresh ---- */
async function refreshAll() {
  const [friendsRes, pendingRes, sentRes] = await Promise.all([
    fetchJSON("/list_friends"),
    fetchJSON("/get_pending_requests"),
    fetchJSON("/sent_requests"),
  ]);

  friends = Array.isArray(friendsRes.data) ? friendsRes.data : [];
  pending = Array.isArray(pendingRes.data) ? pendingRes.data : [];
  sent = Array.isArray(sentRes.data) ? sentRes.data : [];

  renderBadges();
  renderFriendsList();

  // keep search results updated if currently searching
  if (searchInput.value.trim()) {
    runSearch().catch(() => {});
  }

  // if selected friend was removed, clear selection
  if (selectedFriend) {
    const still = friends.find((f) => f.id === selectedFriend.id);
    if (!still) {
      selectedFriend = null;
      renderHeader();
      renderChat();
    } else {
      selectedFriend = still; // refresh object
      renderHeader();
    }
  }

  // requests page list refresh if open
  if (!requestsPage.classList.contains("hidden")) {
    renderRequestsList();
  }
}

/* ---- Settings modal ---- */
function openSettings() {
  modalBackdrop.classList.remove("hidden");
  settingsModal.classList.remove("hidden");
}
function closeSettings() {
  modalBackdrop.classList.add("hidden");
  settingsModal.classList.add("hidden");
}

/* ---- Events ---- */
searchBtn.addEventListener("click", runSearch);
searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  if (!q) {
    showSearchMode(false);
    return;
  }
  // small debounce feel without timers: just run immediately
  runSearch().catch(() => {});
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

requestsBtn.addEventListener("click", () => {
  openRequestsPage();
});
reqBackBtn.addEventListener("click", closeRequestsPage);

reqTabs.forEach((b) => b.addEventListener("click", () => setReqTab(b.dataset.reqtab)));

reqSearchBtn.addEventListener("click", renderRequestsList);
reqSearchInput.addEventListener("input", renderRequestsList);
reqSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") renderRequestsList();
});

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

clearBtn.addEventListener("click", () => {
  if (!selectedFriend) return;
  localStorage.removeItem(msgKey(selectedFriend.username));
  renderChat();
});

settingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
modalBackdrop.addEventListener("click", closeSettings);

/* ---- Boot ---- */
(async function boot() {
  // load me
  try {
    me = await fetchJSON("/me");
  } catch (e) {
    alert("Cannot load /me. Are you logged in?");
    return;
  }

  // set avatars
  meAvatar.src = safeAvatar(me.profile_pic_url);

  // initial render
  renderHeader();
  renderChat();

  // load lists
  try {
    await refreshAll();
  } catch (e) {
    console.error(e);
    alert(e.message);
  }

  // socket
  try {
    await initSocket();
  } catch (e) {
    console.error(e);
    sockStatus.textContent = "error";
    sockDot.style.background = "#ff4b4b";
  }

  // default requests tab
  setReqTab("received");
})();
