// ============================================================
// spaces.js — Motor de Espacios Compartidos
// ============================================================
// Helpers globales — se usan via window para evitar problemas de scope en módulos ES
const showToast = (...a) => showToast(...a);
const fmt  = (...a) => window.fmt?.(...a)  || '$0';
const esc  = (...a) => window.esc?.(...a)  || String(a[0]||'');
const buildNav    = (...a) => window.buildNav?.(...a);
const switchTab   = (...a) => window.switchTab?.(...a);
const renderDashboard    = () => window.renderDashboard?.();
const renderTransactions = () => window.renderTransactions?.();
const renderReports      = () => window.renderReports?.();

import { getFirestore, doc, setDoc, getDoc, collection,
         addDoc, getDocs, onSnapshot, query, orderBy,
         limit, serverTimestamp, deleteDoc, updateDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getApps }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

// ── Obtener db ──
function getDB() {
  if (window._DEMO_MODE) return null;
  if (window._dbSpaces?.db) return window._dbSpaces.db;
  const apps = getApps();
  if (apps.length) return getFirestore(apps[0]);
  return null;
}

async function getDBReady(retries = 20) {
  for (let i = 0; i < retries; i++) {
    const db = getDB();
    if (db) return db;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Firebase no disponible. Recarga la página.');
}

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
window.SPACE = {
  current: null, myRole: null,
  unsubChat: null, unsubTx: null, memberCache: {},
};

// ══════════════════════════════════════════
// HELPERS DE USUARIO — múltiples fuentes
// ══════════════════════════════════════════
function getUser() {
  if (window.CURRENT_USER?.uid) return window.CURRENT_USER;
  if (window._currentUser?.uid) return window._currentUser;
  const apps = getApps();
  if (apps.length) {
    const auth = getAuth(apps[0]);
    if (auth.currentUser?.uid) return auth.currentUser;
  }
  return null;
}

function uid()    { return getUser()?.uid; }
function uname()  { const u = getUser(); return u?.displayName || u?.email?.split('@')[0] || 'Yo'; }
function uavatar(){ return uname().charAt(0).toUpperCase(); }

const ROLES_ORDER = ['owner','admin','member','viewer'];
function canWrite(role) { return ['owner','admin','member'].includes(role); }
function canAdmin(role) { return ['owner','admin'].includes(role); }
function canOwner(role) { return role === 'owner'; }

function spaceKey(id, k) { return `ap_space_${id}_${k}`; }
function demoGetList(key) { try { return JSON.parse(localStorage.getItem(key)||'[]'); } catch{ return []; } }
function demoSaveList(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// ══════════════════════════════════════════
// CRUD ESPACIOS
// ══════════════════════════════════════════
window.createSpace = async function(name, emoji = '💰') {
  // Esperar hasta 3s a que el usuario esté disponible
  let currentUid = null;
  for (let i = 0; i < 15; i++) {
    currentUid = uid();
    if (currentUid) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (!currentUid) {
    showToast('Error de sesión. Recarga la página.', 'red');
    console.error('[spaces] uid undefined. CURRENT_USER:', window.CURRENT_USER, 'Auth:', getApps().length ? getAuth(getApps()[0]).currentUser : 'no apps');
    return null;
  }

  const id = 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  const space = {
    id, name, emoji,
    createdBy: currentUid,
    members: { [currentUid]: 'owner' },
    config: { tabs: window.APP_CONFIG?.tabs || [], limiteOcio: window.APP_CONFIG?.limiteOcio || 500000 },
    perfilFinanciero: { ...(window.PERFIL || {}) },
    createdAt: new Date().toISOString(),
  };

  if (window._DEMO_MODE) {
    const spaces = demoGetList('ap_my_spaces_' + currentUid);
    spaces.push({ id, name, emoji, role: 'owner' });
    demoSaveList('ap_my_spaces_' + currentUid, spaces);
    localStorage.setItem('ap_space_' + id, JSON.stringify(space));
  } else {
    const db = await getDBReady();
    await setDoc(doc(db, 'spaces', id), space);
    const userRef = doc(db, 'users', currentUid, 'data', 'spaces');
    const snap = await getDoc(userRef);
    const curr = snap.exists() ? (snap.data()?.list || []) : [];
    curr.push({ id, name, emoji, role: 'owner' });
    await setDoc(userRef, { list: curr });
  }

  showToast(`Espacio "${name}" creado ✓`, 'green');
  await loadSpace(id);
  return id;
};

window.loadMySpaces = async function() {
  const currentUid = uid();
  if (!currentUid) return [];
  if (window._DEMO_MODE) return demoGetList('ap_my_spaces_' + currentUid);
  const db = await getDBReady();
  const snap = await getDoc(doc(db, 'users', currentUid, 'data', 'spaces'));
  return snap.exists() ? (snap.data().list || []) : [];
};

window.loadSpace = async function(spaceId) {
  let spaceData;
  if (window._DEMO_MODE) {
    const raw = localStorage.getItem('ap_space_' + spaceId);
    spaceData = raw ? JSON.parse(raw) : null;
  } else {
    const db = await getDBReady();
    const snap = await getDoc(doc(db, 'spaces', spaceId));
    spaceData = snap.exists() ? snap.data() : null;
  }
  if (!spaceData) { showToast('Espacio no encontrado', 'red'); return false; }

  SPACE.current = spaceData;
  SPACE.myRole  = spaceData.members?.[uid()] || null;
  if (spaceData.config?.tabs?.length) window.APP_CONFIG.tabs = spaceData.config.tabs;
  if (spaceData.perfilFinanciero && typeof spaceData.perfilFinanciero === 'object') {
    try { Object.assign(window.PERFIL, spaceData.perfilFinanciero); } catch(e) { console.warn('perfilFinanciero merge error:', e); }
  }

  await loadSpaceTx(spaceId);
  subscribeSpaceChat(spaceId);
  subscribeSpaceTx(spaceId);
  buildMemberCache();

  showToast(`Espacio "${spaceData.name}" cargado`, 'blue');
  buildNav(); switchTab('dashboard');
  return true;
};

window.leaveSpace = async function() {
  if (!SPACE.current) return;
  if (!confirm('¿Salir del espacio compartido?')) return;
  if (canOwner(SPACE.myRole) && Object.keys(SPACE.current.members).filter(m=>m!==uid()).length > 0) {
    alert('Transfiere el ownership antes de salir.'); return;
  }
  SPACE.unsubChat?.(); SPACE.unsubTx?.();
  SPACE.current = null; SPACE.myRole = null;
  const cu = uid();
  const [g,m] = await Promise.all([window._db.getGastos(cu), window._db.getMetas(cu)]);
  window.gastos = g||[]; window.metas = m||[];
  showToast('Saliste del espacio', 'yellow');
  buildNav(); switchTab('dashboard');
};

// ══════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════
window.addSpaceTx = async function(entry) {
  if (!SPACE.current) return window._db.saveGastos(uid(), window.gastos);
  const enriched = { ...entry, id: Date.now(), spaceId: SPACE.current.id, createdBy: uid(), authorName: uname(), authorAvatar: uavatar(), createdAt: new Date().toISOString() };
  if (window._DEMO_MODE) {
    const list = demoGetList(spaceKey(SPACE.current.id, 'gastos'));
    list.push(enriched); demoSaveList(spaceKey(SPACE.current.id, 'gastos'), list); window.gastos = list;
  } else {
    await addDoc(collection(getDB(), 'spaces', SPACE.current.id, 'gastos'), enriched);
  }
  postChatActivity(`💳 ${uname()} registró ${enriched.tipo==='ingreso'?'+':'-'}${fmt(enriched.monto)} en ${enriched.categoria}`, 'tx', enriched);
};

async function loadSpaceTx(spaceId) {
  if (window._DEMO_MODE) { window.gastos = demoGetList(spaceKey(spaceId, 'gastos')); return; }
  const snap = await getDocs(collection(getDB(), 'spaces', spaceId, 'gastos'));
  window.gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function subscribeSpaceTx(spaceId) {
  SPACE.unsubTx?.();
  if (window._DEMO_MODE) return;
  SPACE.unsubTx = onSnapshot(
    query(collection(getDB(), 'spaces', spaceId, 'gastos'), orderBy('createdAt','desc'), limit(200)),
    snap => {
      window.gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const t = document.querySelector('.tab-section.active')?.id?.replace('tab-','');
      if (t==='dashboard') renderDashboard();
      if (t==='transactions') renderTransactions();
      if (t==='reports') renderReports();
    }
  );
}

// ══════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════
function subscribeSpaceChat(spaceId) {
  SPACE.unsubChat?.();
  if (window._DEMO_MODE) { renderChat(); return; }
  SPACE.unsubChat = onSnapshot(
    query(collection(getDB(), 'spaces', spaceId, 'messages'), orderBy('createdAt','asc'), limit(100)),
    snap => { const msgs = snap.docs.map(d=>({id:d.id,...d.data()})); renderChat(msgs); updateChatBadge(msgs.length); }
  );
}

window.postChatMessage = async function(text) {
  if (!text?.trim() || !SPACE.current) return;
  const msg = { text, uid: uid(), authorName: uname(), authorAvatar: uavatar(), type: 'message', createdAt: new Date().toISOString() };
  if (window._DEMO_MODE) {
    const msgs = demoGetList(spaceKey(SPACE.current.id, 'messages'));
    msgs.push({...msg, id: Date.now()}); demoSaveList(spaceKey(SPACE.current.id,'messages'), msgs); renderChat(msgs); return;
  }
  await addDoc(collection(getDB(), 'spaces', SPACE.current.id, 'messages'), {...msg, createdAt: serverTimestamp()});
};

async function postChatActivity(text, type='activity', attachedTx=null) {
  if (!SPACE.current) return;
  const msg = { text, uid: uid(), authorName: uname(), authorAvatar: uavatar(), type, attachedTx, createdAt: new Date().toISOString() };
  if (window._DEMO_MODE) {
    const msgs = demoGetList(spaceKey(SPACE.current.id,'messages'));
    msgs.push({...msg,id:Date.now()}); demoSaveList(spaceKey(SPACE.current.id,'messages'),msgs); renderChat(msgs); return;
  }
  await addDoc(collection(getDB(),'spaces',SPACE.current.id,'messages'), {...msg, createdAt: serverTimestamp()});
}

function renderChat(msgs) {
  const c = document.getElementById('chatMessages'); if (!c) return;
  if (!msgs) msgs = window._DEMO_MODE && SPACE.current ? demoGetList(spaceKey(SPACE.current.id,'messages')) : [];
  c.innerHTML = msgs.length ? '' : '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">Sé el primero en escribir algo 👋</div>';
  msgs.forEach(m => {
    const isMe = m.uid === uid();
    const div = document.createElement('div');
    if (['tx','activity','alert'].includes(m.type)) {
      div.style.cssText='text-align:center;margin:6px 0;font-size:11px;color:var(--text3);font-family:"DM Mono",monospace;';
      div.textContent=m.text; c.appendChild(div); return;
    }
    div.style.cssText=`display:flex;gap:8px;margin-bottom:10px;${isMe?'flex-direction:row-reverse':''}`;
    div.innerHTML=`<div style="width:28px;height:28px;border-radius:50%;background:${isMe?'var(--green)':'var(--s3)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${isMe?'#051209':'var(--text)'};flex-shrink:0">${m.authorAvatar||'?'}</div>
      <div style="max-width:75%"><div style="font-size:10px;color:var(--text3);margin-bottom:3px;${isMe?'text-align:right':''}">${isMe?'Tú':m.authorName}</div>
      <div style="background:${isMe?'var(--green-dim)':'var(--s2)'};border:1px solid ${isMe?'rgba(34,197,94,.3)':'var(--border)'};border-radius:${isMe?'12px 2px 12px 12px':'2px 12px 12px 12px'};padding:8px 12px;font-size:13px;line-height:1.5;color:var(--text)">${esc(m.text)}</div>
      ${m.attachedTx?`<div style="margin-top:4px;background:var(--s3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text2);font-family:'DM Mono',monospace">${m.attachedTx.tipo==='ingreso'?'+':'-'}${fmt(m.attachedTx.monto)} · ${m.attachedTx.categoria}</div>`:''}</div>`;
    c.appendChild(div);
  });
  c.scrollTop = c.scrollHeight;
}

function updateChatBadge(count) { const b=document.getElementById('chatNavBadge'); if(b) b.style.display=count>0?'inline':'none'; }

// ══════════════════════════════════════════
// INVITACIONES
// ══════════════════════════════════════════
window.generateInviteLink = async function(role='member') {
  if (!SPACE.current || !canAdmin(SPACE.myRole)) { showToast('Solo admins pueden invitar','red'); return null; }
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const invite = { token, spaceId: SPACE.current.id, spaceName: SPACE.current.name, spaceEmoji: SPACE.current.emoji, role, createdBy: uid(), createdByName: uname(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+7*24*60*60*1000).toISOString(), used: false };
  if (window._DEMO_MODE) { localStorage.setItem('ap_invite_'+token, JSON.stringify(invite)); }
  else { const db=await getDBReady(); await setDoc(doc(db,'invites',token), invite); }
  return `${location.origin}${location.pathname}?invite=${token}`;
};

window.acceptInvite = async function(token) {
  let invite;
  if (window._DEMO_MODE) { const r=localStorage.getItem('ap_invite_'+token); invite=r?JSON.parse(r):null; }
  else { const db=await getDBReady(); const s=await getDoc(doc(db,'invites',token)); invite=s.exists()?s.data():null; }
  if (!invite) { showToast('Invitación no válida','red'); return false; }
  if (invite.used) { showToast('Invitación ya usada','red'); return false; }
  if (new Date(invite.expiresAt)<new Date()) { showToast('Invitación expirada','red'); return false; }
  if (SPACE.current?.id===invite.spaceId) { showToast('Ya eres miembro','yellow'); return false; }
  const cu = uid();
  if (window._DEMO_MODE) {
    const raw=localStorage.getItem('ap_space_'+invite.spaceId); if(!raw){showToast('Espacio no encontrado','red');return false;}
    const space=JSON.parse(raw); space.members[cu]=invite.role; localStorage.setItem('ap_space_'+invite.spaceId,JSON.stringify(space));
    localStorage.setItem('ap_invite_'+token,JSON.stringify({...invite,used:true}));
    const spaces=demoGetList('ap_my_spaces_'+cu); if(!spaces.find(s=>s.id===invite.spaceId)){spaces.push({id:invite.spaceId,name:invite.spaceName,emoji:invite.spaceEmoji,role:invite.role});demoSaveList('ap_my_spaces_'+cu,spaces);}
  } else {
    const db=await getDBReady();
    await updateDoc(doc(db,'spaces',invite.spaceId),{[`members.${cu}`]:invite.role});
    await updateDoc(doc(db,'invites',token),{used:true});
    const userRef=doc(db,'users',cu,'data','spaces'); const sn=await getDoc(userRef);
    const curr=sn.exists()?(sn.data()?.list||[]):[];
    if(!curr.find(s=>s.id===invite.spaceId)){curr.push({id:invite.spaceId,name:invite.spaceName,emoji:invite.spaceEmoji,role:invite.role});await setDoc(userRef,{list:curr});}
  }
  showToast(`Te uniste a "${invite.spaceName}" ✓`,'green');
  await loadSpace(invite.spaceId);
  postChatActivity(`👋 ${uname()} se unió como ${invite.role}`,'activity');
  return true;
};

// ══════════════════════════════════════════
// MEMBER CACHE
// ══════════════════════════════════════════
async function buildMemberCache() {
  if (!SPACE.current) return;
  for (const [id2, role] of Object.entries(SPACE.current.members||{})) {
    if (SPACE.memberCache[id2]) continue;
    SPACE.memberCache[id2] = id2===uid() ? {displayName:uname(),role,avatarLetter:uavatar()} : {displayName:'Miembro',role,avatarLetter:'?'};
  }
}

// ══════════════════════════════════════════
// SAVE
// ══════════════════════════════════════════
window.saveSpaceData = async function() {
  if (!SPACE.current) return window.saveData?.();
  if (!canWrite(SPACE.myRole)) return;
  if (window._DEMO_MODE) { demoSaveList(spaceKey(SPACE.current.id,'metas'),window.metas); return; }
  await setDoc(doc(getDB(),'spaces',SPACE.current.id,'data','metas'),{list:window.metas});
};

window.saveSpacePerfil = async function() {
  if (!SPACE.current||!canAdmin(SPACE.myRole)) return;
  if (window._DEMO_MODE) { const r=localStorage.getItem('ap_space_'+SPACE.current.id); if(r){const sp=JSON.parse(r);sp.perfilFinanciero=window.PERFIL;sp.config=window.APP_CONFIG;localStorage.setItem('ap_space_'+SPACE.current.id,JSON.stringify(sp));} return; }
  await updateDoc(doc(getDB(),'spaces',SPACE.current.id),{perfilFinanciero:window.PERFIL,config:window.APP_CONFIG});
  showToast('Perfil sincronizado ✓','green');
};

// ══════════════════════════════════════════
// UI
// ══════════════════════════════════════════
window.getSpaceHeader = function() {
  if (!SPACE.current) return '';
  const members = Object.keys(SPACE.current.members||{});
  return `<div style="display:flex;align-items:center;gap:10px;background:var(--green-dim);border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:10px 16px;margin-bottom:16px">
    <span style="font-size:20px">${SPACE.current.emoji||'👥'}</span>
    <div style="flex:1"><div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700">${esc(SPACE.current.name)}</div>
    <div style="font-size:11px;color:var(--text2)">${members.length} miembro${members.length!==1?'s':''} · rol: <strong style="color:var(--green)">${SPACE.myRole}</strong></div></div>
    <button class="btn-icon" onclick="openSpacePanel()" style="font-size:12px;padding:5px 10px">⚙️ Gestionar</button>
    <button class="btn-icon" onclick="leaveSpace()" style="font-size:12px;padding:5px 10px;color:var(--red)">✕ Salir</button>
  </div>`;
};

window.openSpacePanel  = function() { document.getElementById('spacePanelModal')?.classList.add('open'); renderSpacePanel(); };
window.closeSpacePanel = function() { document.getElementById('spacePanelModal')?.classList.remove('open'); };

window.renderSpacePanel = async function() {
  const panel = document.getElementById('spacePanelContent'); if (!panel||!SPACE.current) return;
  const members=Object.entries(SPACE.current.members||{}), isAdmin=canAdmin(SPACE.myRole), isOwner=canOwner(SPACE.myRole);
  panel.innerHTML=`<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Miembros (${members.length})</div>
  ${members.map(([mid,role])=>{const info=SPACE.memberCache[mid]||{displayName:mid===uid()?uname():'Miembro',avatarLetter:'?'};return`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
    <div style="width:32px;height:32px;border-radius:50%;background:${mid===uid()?'var(--green)':'var(--s3)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:${mid===uid()?'#051209':'var(--text)'};flex-shrink:0">${info.avatarLetter}</div>
    <div style="flex:1"><div style="font-size:13px;font-weight:500">${esc(info.displayName)}${mid===uid()?' <span style="font-size:11px;color:var(--text3)">(tú)</span>':''}</div></div>
    <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${role==='owner'?'var(--yellow-dim)':role==='admin'?'var(--blue-dim)':'var(--green-dim)'};color:${role==='owner'?'var(--yellow)':role==='admin'?'var(--blue)':'var(--green)'}">${role}</span>
    ${isAdmin&&mid!==uid()&&role!=='owner'?`<select onchange="changeRole('${mid}',this.value)" style="width:90px;font-size:11px;padding:3px 6px">${ROLES_ORDER.filter(r=>r!=='owner').map(r=>`<option value="${r}"${r===role?' selected':''}>${r}</option>`).join('')}</select>${isOwner?`<button class="btn-icon" onclick="removeMember('${mid}')" style="color:var(--red);font-size:11px">✕</button>`:''}`:''}
  </div>`;}).join('')}</div>
  ${isAdmin?`<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Invitar miembro</div>
  <div style="display:flex;gap:8px;margin-bottom:8px"><select id="inviteRole" style="width:110px;font-size:13px"><option value="member">member</option><option value="admin">admin</option><option value="viewer">viewer</option></select>
  <button class="btn btn-primary btn-sm" onclick="copyInviteLink()">🔗 Generar link</button></div>
  <div id="inviteLinkBox" style="display:none;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;font-family:'DM Mono',monospace;word-break:break-all;color:var(--text2)"></div></div>
  <div><div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Sincronizar perfil</div>
  <button class="btn btn-ghost btn-sm" onclick="saveSpacePerfil()">📤 Sincronizar</button></div>`:''}`;
};

window.copyInviteLink = async function() {
  const link=await generateInviteLink(document.getElementById('inviteRole')?.value||'member'); if(!link)return;
  const box=document.getElementById('inviteLinkBox'); if(box){box.style.display='block';box.textContent=link;}
  try{await navigator.clipboard.writeText(link);showToast('Link copiado ✓','green');}catch{showToast('Link generado','blue');}
};

window.changeRole = async function(memberId,newRole) {
  if(!SPACE.current||!canAdmin(SPACE.myRole))return;
  if(window._DEMO_MODE){const r=localStorage.getItem('ap_space_'+SPACE.current.id);if(r){const sp=JSON.parse(r);sp.members[memberId]=newRole;localStorage.setItem('ap_space_'+SPACE.current.id,JSON.stringify(sp));SPACE.current.members[memberId]=newRole;}}
  else{await updateDoc(doc(getDB(),'spaces',SPACE.current.id),{[`members.${memberId}`]:newRole});SPACE.current.members[memberId]=newRole;}
  showToast('Rol actualizado ✓','green'); renderSpacePanel();
};

window.removeMember = async function(memberId) {
  if(!canOwner(SPACE.myRole)||!confirm('¿Eliminar este miembro?'))return;
  if(window._DEMO_MODE){const r=localStorage.getItem('ap_space_'+SPACE.current.id);if(r){const sp=JSON.parse(r);delete sp.members[memberId];localStorage.setItem('ap_space_'+SPACE.current.id,JSON.stringify(sp));delete SPACE.current.members[memberId];}}
  else{await updateDoc(doc(getDB(),'spaces',SPACE.current.id),{[`members.${memberId}`]:null});delete SPACE.current.members[memberId];}
  showToast('Miembro eliminado','red'); renderSpacePanel();
};

// ══════════════════════════════════════════
// CHECK INVITE
// ══════════════════════════════════════════
window.checkInviteParam = async function() {
  const token=new URLSearchParams(location.search).get('invite'); if(!token)return false;
  history.replaceState({},'',location.pathname);
  if(!uid()){sessionStorage.setItem('pending_invite',token);return false;}
  return await acceptInvite(token);
};

window.checkPendingInvite = async function() {
  const token=sessionStorage.getItem('pending_invite'); if(!token)return;
  sessionStorage.removeItem('pending_invite'); await acceptInvite(token);
};

window.addEventListener('load',()=>{if(typeof window._DEMO_MODE==='undefined')window._DEMO_MODE=false;});
