// ============================================================
// spaces.js — Motor de Espacios Compartidos
// NOTA: Este es un módulo ES. Toda función global de app.js
// se accede SIEMPRE via window.X() — nunca directamente.
// ============================================================

import { getFirestore, doc, setDoc, getDoc, collection,
         addDoc, getDocs, onSnapshot, query, orderBy,
         limit, serverTimestamp, deleteDoc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

function getDB() {
  if (window._DEMO_MODE) return null;
  if (window._dbSpaces && window._dbSpaces.db) return window._dbSpaces.db;
  const apps = getApps();
  if (apps.length) return getFirestore(apps[0]);
  return null;
}

async function getDBReady(retries) {
  retries = retries || 20;
  for (var i = 0; i < retries; i++) {
    var db = getDB();
    if (db) return db;
    await new Promise(function(r) { setTimeout(r, 200); });
  }
  throw new Error("Firebase no disponible. Recarga la pagina.");
}

window.SPACE = { current: null, myRole: null, unsubChat: null, unsubTx: null, memberCache: {} };

function getUser() {
  if (window.CURRENT_USER && window.CURRENT_USER.uid) return window.CURRENT_USER;
  if (window._currentUser && window._currentUser.uid) return window._currentUser;
  var apps = getApps();
  if (apps.length) { var u = getAuth(apps[0]).currentUser; if (u && u.uid) return u; }
  return null;
}
function uid()    { var u = getUser(); return u ? u.uid : null; }
function uname()  { var u = getUser(); return u ? (u.displayName || (u.email ? u.email.split("@")[0] : "Yo")) : "Yo"; }
function uavatar(){ return uname().charAt(0).toUpperCase(); }

var ROLES_ORDER = ["owner","admin","member","viewer"];
function canWrite(role) { return ["owner","admin","member"].indexOf(role) >= 0; }
function canAdmin(role) { return ["owner","admin"].indexOf(role) >= 0; }
function canOwner(role) { return role === "owner"; }

function spaceKey(id, k) { return "ap_space_" + id + "_" + k; }
function demoGet(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch(e) { return []; } }
function demoSet(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// ── CRUD Espacios ──────────────────────────────────────────
window.createSpace = async function(name, emoji) {
  emoji = emoji || "💰";
  var currentUid = null;
  for (var i = 0; i < 15; i++) {
    currentUid = uid();
    if (currentUid) break;
    await new Promise(function(r) { setTimeout(r, 200); });
  }
  if (!currentUid) { window.showToast("Error de sesion. Recarga la pagina.", "red"); return null; }

  var id = "sp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  var space = {
    id: id, name: name, emoji: emoji,
    createdBy: currentUid,
    members: {},
    config: { tabs: (window.APP_CONFIG && window.APP_CONFIG.tabs) || [], limiteOcio: (window.APP_CONFIG && window.APP_CONFIG.limiteOcio) || 500000 },
    perfilFinanciero: window.PERFIL ? Object.assign({}, window.PERFIL) : {},
    createdAt: new Date().toISOString()
  };
  space.members[currentUid] = "owner";

  if (window._DEMO_MODE) {
    var list = demoGet("ap_my_spaces_" + currentUid);
    list.push({ id: id, name: name, emoji: emoji, role: "owner" });
    demoSet("ap_my_spaces_" + currentUid, list);
    localStorage.setItem("ap_space_" + id, JSON.stringify(space));
  } else {
    var db = await getDBReady();
    await setDoc(doc(db, "spaces", id), space);
    var userRef = doc(db, "users", currentUid, "data", "spaces");
    var snap = await getDoc(userRef);
    var curr = snap.exists() ? (snap.data().list || []) : [];
    curr.push({ id: id, name: name, emoji: emoji, role: "owner" });
    await setDoc(userRef, { list: curr });
  }

  window.showToast("Espacio creado ✓", "green");
  await window.loadSpace(id);
  return id;
};

window.loadMySpaces = async function() {
  var currentUid = uid();
  if (!currentUid) return [];
  if (window._DEMO_MODE) return demoGet("ap_my_spaces_" + currentUid);
  var db = await getDBReady();
  var snap = await getDoc(doc(db, "users", currentUid, "data", "spaces"));
  return snap.exists() ? (snap.data().list || []) : [];
};

window.loadSpace = async function(spaceId) {
  var spaceData;
  if (window._DEMO_MODE) {
    var raw = localStorage.getItem("ap_space_" + spaceId);
    spaceData = raw ? JSON.parse(raw) : null;
  } else {
    var db = await getDBReady();
    var snap = await getDoc(doc(db, "spaces", spaceId));
    spaceData = snap.exists() ? snap.data() : null;
  }
  if (!spaceData) { window.showToast("Espacio no encontrado", "red"); return false; }

  window.SPACE.current = spaceData;
  window.SPACE.myRole  = (spaceData.members && spaceData.members[uid()]) || null;

  if (spaceData.config && spaceData.config.tabs && spaceData.config.tabs.length) {
    window.APP_CONFIG.tabs = spaceData.config.tabs;
  }
  if (spaceData.perfilFinanciero && typeof spaceData.perfilFinanciero === "object") {
    try { Object.assign(window.PERFIL, spaceData.perfilFinanciero); } catch(e) {}
  }

  await loadSpaceTx(spaceId);
  subscribeSpaceChat(spaceId);
  subscribeSpaceTx(spaceId);
  buildMemberCache();

  window.showToast("Espacio cargado", "blue");
  window.buildNav();
  window.switchTab("dashboard");
  return true;
};

window.leaveSpace = async function() {
  if (!window.SPACE.current) return;
  if (!confirm("¿Salir del espacio?")) return;
  if (canOwner(window.SPACE.myRole)) {
    var others = Object.keys(window.SPACE.current.members).filter(function(m) { return m !== uid(); });
    if (others.length > 0) { alert("Transfiere el ownership antes de salir."); return; }
  }
  if (window.SPACE.unsubChat) window.SPACE.unsubChat();
  if (window.SPACE.unsubTx)   window.SPACE.unsubTx();
  window.SPACE.current = null;
  window.SPACE.myRole  = null;
  var cu = uid();
  var res = await Promise.all([window._db.getGastos(cu), window._db.getMetas(cu)]);
  window.gastos = res[0] || [];
  window.metas  = res[1] || [];
  window.showToast("Saliste del espacio", "yellow");
  window.buildNav();
  window.switchTab("dashboard");
};

// ── Transactions ───────────────────────────────────────────
window.addSpaceTx = async function(entry) {
  if (!window.SPACE.current) return window._db.saveGastos(uid(), window.gastos);
  var enriched = Object.assign({}, entry, {
    id: Date.now(), spaceId: window.SPACE.current.id,
    createdBy: uid(), authorName: uname(), authorAvatar: uavatar(),
    createdAt: new Date().toISOString()
  });
  if (window._DEMO_MODE) {
    var list = demoGet(spaceKey(window.SPACE.current.id, "gastos"));
    list.push(enriched);
    demoSet(spaceKey(window.SPACE.current.id, "gastos"), list);
    window.gastos = list;
  } else {
    await addDoc(collection(getDB(), "spaces", window.SPACE.current.id, "gastos"), enriched);
  }
  var sign = enriched.tipo === "ingreso" ? "+" : "-";
  var fmtFn = window.fmt || function(n) { return "$" + Number(n||0).toLocaleString("es-CO"); };
  postChatActivity("💳 " + uname() + " registró " + sign + fmtFn(enriched.monto) + " en " + enriched.categoria, "tx", enriched);
};

async function loadSpaceTx(spaceId) {
  if (window._DEMO_MODE) { window.gastos = demoGet(spaceKey(spaceId, "gastos")); return; }
  var snap = await getDocs(collection(getDB(), "spaces", spaceId, "gastos"));
  window.gastos = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
}

function subscribeSpaceTx(spaceId) {
  if (window.SPACE.unsubTx) window.SPACE.unsubTx();
  if (window._DEMO_MODE) return;
  window.SPACE.unsubTx = onSnapshot(
    query(collection(getDB(), "spaces", spaceId, "gastos"), orderBy("createdAt", "desc"), limit(200)),
    function(snap) {
      window.gastos = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      var t = document.querySelector(".tab-section.active");
      if (t) t = t.id.replace("tab-", "");
      if (t === "dashboard")    { if (window.renderDashboard)    window.renderDashboard(); }
      if (t === "transactions") { if (window.renderTransactions) window.renderTransactions(); }
      if (t === "reports")      { if (window.renderReports)      window.renderReports(); }
    }
  );
}

// ── Chat ───────────────────────────────────────────────────
function subscribeSpaceChat(spaceId) {
  if (window.SPACE.unsubChat) window.SPACE.unsubChat();
  if (window._DEMO_MODE) { renderChatLocal(); return; }
  window.SPACE.unsubChat = onSnapshot(
    query(collection(getDB(), "spaces", spaceId, "messages"), orderBy("createdAt", "asc"), limit(100)),
    function(snap) {
      var msgs = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      renderChatLocal(msgs);
      var b = document.getElementById("chatNavBadge");
      if (b) b.style.display = msgs.length > 0 ? "inline" : "none";
    }
  );
}

window.postChatMessage = async function(text) {
  if (!text || !text.trim() || !window.SPACE.current) return;
  var msg = { text: text, uid: uid(), authorName: uname(), authorAvatar: uavatar(), type: "message", createdAt: new Date().toISOString() };
  if (window._DEMO_MODE) {
    var msgs = demoGet(spaceKey(window.SPACE.current.id, "messages"));
    msgs.push(Object.assign({ id: Date.now() }, msg));
    demoSet(spaceKey(window.SPACE.current.id, "messages"), msgs);
    renderChatLocal(msgs);
    return;
  }
  await addDoc(collection(getDB(), "spaces", window.SPACE.current.id, "messages"), Object.assign({}, msg, { createdAt: serverTimestamp() }));
};

async function postChatActivity(text, type, attachedTx) {
  type = type || "activity";
  attachedTx = attachedTx || null;
  if (!window.SPACE.current) return;
  var msg = { text: text, uid: uid(), authorName: uname(), authorAvatar: uavatar(), type: type, attachedTx: attachedTx, createdAt: new Date().toISOString() };
  if (window._DEMO_MODE) {
    var msgs = demoGet(spaceKey(window.SPACE.current.id, "messages"));
    msgs.push(Object.assign({ id: Date.now() }, msg));
    demoSet(spaceKey(window.SPACE.current.id, "messages"), msgs);
    renderChatLocal(msgs);
    return;
  }
  await addDoc(collection(getDB(), "spaces", window.SPACE.current.id, "messages"), Object.assign({}, msg, { createdAt: serverTimestamp() }));
}

function renderChatLocal(msgs) {
  var c = document.getElementById("chatMessages");
  if (!c) return;
  var esc = window.esc || function(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); };
  var fmt = window.fmt || function(n) { return "$" + Number(n||0).toLocaleString("es-CO"); };
  if (!msgs) msgs = (window._DEMO_MODE && window.SPACE.current) ? demoGet(spaceKey(window.SPACE.current.id, "messages")) : [];
  c.innerHTML = msgs.length ? "" : "<div style=\"text-align:center;padding:20px;color:var(--text3);font-size:13px\">Sé el primero en escribir algo 👋</div>";
  msgs.forEach(function(m) {
    var isMe = m.uid === uid();
    var div  = document.createElement("div");
    if (["tx","activity","alert"].indexOf(m.type) >= 0) {
      div.style.cssText = "text-align:center;margin:6px 0;font-size:11px;color:var(--text3);font-family:\"DM Mono\",monospace;";
      div.textContent = m.text;
      c.appendChild(div);
      return;
    }
    div.style.cssText = "display:flex;gap:8px;margin-bottom:10px;" + (isMe ? "flex-direction:row-reverse" : "");
    var txHtml = m.attachedTx ? ("<div style=\"margin-top:4px;background:var(--s3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text2);font-family:\'DM Mono\',monospace\">" + (m.attachedTx.tipo==="ingreso"?"+":"-") + fmt(m.attachedTx.monto) + " · " + m.attachedTx.categoria + "</div>") : "";
    div.innerHTML = "<div style=\"width:28px;height:28px;border-radius:50%;background:" + (isMe?"var(--green)":"var(--s3)") + ";display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:" + (isMe?"#051209":"var(--text)") + ";flex-shrink:0\">" + (m.authorAvatar||"?") + "</div>" +
      "<div style=\"max-width:75%\">" +
        "<div style=\"font-size:10px;color:var(--text3);margin-bottom:3px;" + (isMe?"text-align:right":"") + "\">" + (isMe?"Tú":m.authorName) + "</div>" +
        "<div style=\"background:" + (isMe?"var(--green-dim)":"var(--s2)") + ";border:1px solid " + (isMe?"rgba(34,197,94,.3)":"var(--border)") + ";border-radius:" + (isMe?"12px 2px 12px 12px":"2px 12px 12px 12px") + ";padding:8px 12px;font-size:13px;line-height:1.5;color:var(--text)\">" + esc(m.text) + "</div>" +
        txHtml +
      "</div>";
    c.appendChild(div);
  });
  c.scrollTop = c.scrollHeight;
}
window.renderChat = renderChatLocal;

// ── Invitaciones ───────────────────────────────────────────
window.generateInviteLink = async function(role) {
  role = role || "member";
  if (!window.SPACE.current || !canAdmin(window.SPACE.myRole)) { window.showToast("Solo admins pueden invitar", "red"); return null; }
  var token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var invite = { token: token, spaceId: window.SPACE.current.id, spaceName: window.SPACE.current.name, spaceEmoji: window.SPACE.current.emoji, role: role, createdBy: uid(), createdByName: uname(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7*24*60*60*1000).toISOString(), used: false };
  if (window._DEMO_MODE) localStorage.setItem("ap_invite_" + token, JSON.stringify(invite));
  else { var db = await getDBReady(); await setDoc(doc(db, "invites", token), invite); }
  return location.origin + location.pathname + "?invite=" + token;
};

window.acceptInvite = async function(token) {
  var invite;
  if (window._DEMO_MODE) { var r = localStorage.getItem("ap_invite_" + token); invite = r ? JSON.parse(r) : null; }
  else { var db = await getDBReady(); var s = await getDoc(doc(db, "invites", token)); invite = s.exists() ? s.data() : null; }
  if (!invite) { window.showToast("Invitación no válida", "red"); return false; }
  if (invite.used) { window.showToast("Invitación ya usada", "red"); return false; }
  if (new Date(invite.expiresAt) < new Date()) { window.showToast("Invitación expirada", "red"); return false; }
  if (window.SPACE.current && window.SPACE.current.id === invite.spaceId) { window.showToast("Ya eres miembro", "yellow"); return false; }
  var cu = uid();
  if (window._DEMO_MODE) {
    var raw = localStorage.getItem("ap_space_" + invite.spaceId);
    if (!raw) { window.showToast("Espacio no encontrado", "red"); return false; }
    var sp = JSON.parse(raw); sp.members[cu] = invite.role;
    localStorage.setItem("ap_space_" + invite.spaceId, JSON.stringify(sp));
    localStorage.setItem("ap_invite_" + token, JSON.stringify(Object.assign({}, invite, { used: true })));
    var list = demoGet("ap_my_spaces_" + cu);
    if (!list.find(function(x) { return x.id === invite.spaceId; })) { list.push({ id: invite.spaceId, name: invite.spaceName, emoji: invite.spaceEmoji, role: invite.role }); demoSet("ap_my_spaces_" + cu, list); }
  } else {
    var db2 = await getDBReady();
    var upd = {}; upd["members." + cu] = invite.role;
    await updateDoc(doc(db2, "spaces", invite.spaceId), upd);
    await updateDoc(doc(db2, "invites", token), { used: true });
    var userRef = doc(db2, "users", cu, "data", "spaces");
    var sn = await getDoc(userRef);
    var curr = sn.exists() ? (sn.data().list || []) : [];
    if (!curr.find(function(x) { return x.id === invite.spaceId; })) { curr.push({ id: invite.spaceId, name: invite.spaceName, emoji: invite.spaceEmoji, role: invite.role }); await setDoc(userRef, { list: curr }); }
  }
  window.showToast("Te uniste a \"" + invite.spaceName + "\" ✓", "green");
  await window.loadSpace(invite.spaceId);
  postChatActivity("👋 " + uname() + " se unió como " + invite.role, "activity");
  return true;
};

// ── Member cache ───────────────────────────────────────────
async function buildMemberCache() {
  if (!window.SPACE.current) return;
  var members = window.SPACE.current.members || {};
  Object.keys(members).forEach(function(id2) {
    if (window.SPACE.memberCache[id2]) return;
    window.SPACE.memberCache[id2] = id2 === uid()
      ? { displayName: uname(), role: members[id2], avatarLetter: uavatar() }
      : { displayName: "Miembro", role: members[id2], avatarLetter: "?" };
  });
}

// ── Save ───────────────────────────────────────────────────
window.saveSpaceData = async function() {
  if (!window.SPACE.current) return window.saveData && window.saveData();
  if (!canWrite(window.SPACE.myRole)) return;
  if (window._DEMO_MODE) { demoSet(spaceKey(window.SPACE.current.id, "metas"), window.metas); return; }
  await setDoc(doc(getDB(), "spaces", window.SPACE.current.id, "data", "metas"), { list: window.metas });
};

window.saveSpacePerfil = async function() {
  if (!window.SPACE.current || !canAdmin(window.SPACE.myRole)) return;
  if (window._DEMO_MODE) {
    var raw = localStorage.getItem("ap_space_" + window.SPACE.current.id);
    if (raw) { var sp = JSON.parse(raw); sp.perfilFinanciero = window.PERFIL; sp.config = window.APP_CONFIG; localStorage.setItem("ap_space_" + window.SPACE.current.id, JSON.stringify(sp)); }
    return;
  }
  await updateDoc(doc(getDB(), "spaces", window.SPACE.current.id), { perfilFinanciero: window.PERFIL, config: window.APP_CONFIG });
  window.showToast("Perfil sincronizado ✓", "green");
};

// ── UI helpers ─────────────────────────────────────────────
window.getSpaceHeader = function() {
  if (!window.SPACE.current) return "";
  var escFn = window.esc || function(s) { return String(s); };
  var members = Object.keys(window.SPACE.current.members || {});
  return "<div style=\"display:flex;align-items:center;gap:10px;background:var(--green-dim);border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:10px 16px;margin-bottom:16px\">" +
    "<span style=\"font-size:20px\">" + (window.SPACE.current.emoji||"👥") + "</span>" +
    "<div style=\"flex:1\"><div style=\"font-family:\'Syne\',sans-serif;font-size:14px;font-weight:700\">" + escFn(window.SPACE.current.name) + "</div>" +
    "<div style=\"font-size:11px;color:var(--text2)\">" + members.length + " miembro" + (members.length!==1?"s":"") + " · rol: <strong style=\"color:var(--green)\">" + window.SPACE.myRole + "</strong></div></div>" +
    "<button class=\"btn-icon\" onclick=\"window.openSpacePanel()\" style=\"font-size:12px;padding:5px 10px\">⚙️ Gestionar</button>" +
    "<button class=\"btn-icon\" onclick=\"window.leaveSpace()\" style=\"font-size:12px;padding:5px 10px;color:var(--red)\">✕ Salir</button></div>";
};

window.openSpacePanel  = function() { var m = document.getElementById("spacePanelModal"); if(m) m.classList.add("open"); window.renderSpacePanel(); };
window.closeSpacePanel = function() { var m = document.getElementById("spacePanelModal"); if(m) m.classList.remove("open"); };

window.renderSpacePanel = async function() {
  var panel = document.getElementById("spacePanelContent");
  if (!panel || !window.SPACE.current) return;
  var escFn = window.esc || function(s) { return String(s); };
  var members = Object.entries(window.SPACE.current.members || {});
  var isAdmin = canAdmin(window.SPACE.myRole);
  var isOwner = canOwner(window.SPACE.myRole);
  var rows = members.map(function(entry) {
    var mid = entry[0], role = entry[1];
    var info = window.SPACE.memberCache[mid] || { displayName: mid === uid() ? uname() : "Miembro", avatarLetter: "?" };
    var selects = "";
    if (isAdmin && mid !== uid() && role !== "owner") {
      selects = "<select onchange=\"window.changeRole('" + mid + "',this.value)\" style=\"width:90px;font-size:11px;padding:3px 6px\">" +
        ROLES_ORDER.filter(function(r){return r!=="owner";}).map(function(r){return "<option value=\""+r+"\"" + (r===role?" selected":"") + ">" + r + "</option>";}).join("") + "</select>";
      if (isOwner) selects += "<button class=\"btn-icon\" onclick=\"window.removeMember('" + mid + "')\" style=\"color:var(--red);font-size:11px\">✕</button>";
    }
    return "<div style=\"display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)\">" +
      "<div style=\"width:32px;height:32px;border-radius:50%;background:" + (mid===uid()?"var(--green)":"var(--s3)") + ";display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:" + (mid===uid()?"#051209":"var(--text)") + ";flex-shrink:0\">" + info.avatarLetter + "</div>" +
      "<div style=\"flex:1\"><div style=\"font-size:13px;font-weight:500\">" + escFn(info.displayName) + (mid===uid()?"<span style=\"font-size:11px;color:var(--text3)\"> (tú)</span>":"") + "</div></div>" +
      "<span style=\"font-size:11px;padding:2px 8px;border-radius:99px;background:" + (role==="owner"?"var(--yellow-dim)":role==="admin"?"var(--blue-dim)":"var(--green-dim)") + ";color:" + (role==="owner"?"var(--yellow)":role==="admin"?"var(--blue)":"var(--green)") + "\">" + role + "</span>" +
      selects + "</div>";
  }).join("");
  var inviteHtml = "";
  if (isAdmin) {
    inviteHtml = "<div style=\"margin-bottom:20px\"><div style=\"font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px\">Invitar miembro</div>" +
      "<div style=\"display:flex;gap:8px;margin-bottom:8px\"><select id=\"inviteRole\" style=\"width:110px;font-size:13px\"><option value=\"member\">member</option><option value=\"admin\">admin</option><option value=\"viewer\">viewer</option></select>" +
      "<button class=\"btn btn-primary btn-sm\" onclick=\"window.copyInviteLink()\">🔗 Generar link</button></div>" +
      "<div id=\"inviteLinkBox\" style=\"display:none;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;font-family:\'DM Mono\',monospace;word-break:break-all;color:var(--text2)\"></div></div>" +
      "<div><div style=\"font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px\">Sincronizar perfil</div>" +
      "<button class=\"btn btn-ghost btn-sm\" onclick=\"window.saveSpacePerfil()\">📤 Sincronizar</button></div>";
  }
  panel.innerHTML = "<div style=\"margin-bottom:20px\"><div style=\"font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px\">Miembros (" + members.length + ")</div>" + rows + "</div>" + inviteHtml;
};

window.copyInviteLink = async function() {
  var role = (document.getElementById("inviteRole") || {}).value || "member";
  var link = await window.generateInviteLink(role);
  if (!link) return;
  var box = document.getElementById("inviteLinkBox");
  if (box) { box.style.display = "block"; box.textContent = link; }
  try { await navigator.clipboard.writeText(link); window.showToast("Link copiado ✓", "green"); }
  catch(e) { window.showToast("Link generado — cópialo manualmente", "blue"); }
};

window.changeRole = async function(memberId, newRole) {
  if (!window.SPACE.current || !canAdmin(window.SPACE.myRole)) return;
  if (window._DEMO_MODE) {
    var raw = localStorage.getItem("ap_space_" + window.SPACE.current.id);
    if (raw) { var sp = JSON.parse(raw); sp.members[memberId] = newRole; localStorage.setItem("ap_space_" + window.SPACE.current.id, JSON.stringify(sp)); window.SPACE.current.members[memberId] = newRole; }
  } else {
    var upd = {}; upd["members." + memberId] = newRole;
    await updateDoc(doc(getDB(), "spaces", window.SPACE.current.id), upd);
    window.SPACE.current.members[memberId] = newRole;
  }
  window.showToast("Rol actualizado ✓", "green");
  window.renderSpacePanel();
};

window.removeMember = async function(memberId) {
  if (!canOwner(window.SPACE.myRole) || !confirm("¿Eliminar este miembro?")) return;
  if (window._DEMO_MODE) {
    var raw = localStorage.getItem("ap_space_" + window.SPACE.current.id);
    if (raw) { var sp = JSON.parse(raw); delete sp.members[memberId]; localStorage.setItem("ap_space_" + window.SPACE.current.id, JSON.stringify(sp)); delete window.SPACE.current.members[memberId]; }
  } else {
    var upd = {}; upd["members." + memberId] = null;
    await updateDoc(doc(getDB(), "spaces", window.SPACE.current.id), upd);
    delete window.SPACE.current.members[memberId];
  }
  window.showToast("Miembro eliminado", "red");
  window.renderSpacePanel();
};

// ── Check invite ───────────────────────────────────────────
window.checkInviteParam = async function() {
  var token = new URLSearchParams(location.search).get("invite");
  if (!token) return false;
  history.replaceState({}, "", location.pathname);
  if (!uid()) { sessionStorage.setItem("pending_invite", token); return false; }
  return await window.acceptInvite(token);
};

window.checkPendingInvite = async function() {
  var token = sessionStorage.getItem("pending_invite");
  if (!token) return;
  sessionStorage.removeItem("pending_invite");
  await window.acceptInvite(token);
};

window.addEventListener("load", function() {
  if (typeof window._DEMO_MODE === "undefined") window._DEMO_MODE = false;
});
