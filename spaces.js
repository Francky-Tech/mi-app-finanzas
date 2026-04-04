// ============================================================
// spaces.js — Motor de Espacios Compartidos
// Importar en index.html después de firebase.js y app.js
// ============================================================

import { getFirestore, doc, setDoc, getDoc, collection,
         addDoc, getDocs, onSnapshot, query, orderBy,
         limit, serverTimestamp, deleteDoc, updateDoc,
         where }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeApp, getApps }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

// ── Re-use existing Firebase instance ──
function getDB() {
  if (window._DEMO_MODE) return null;
  const apps = getApps();
  if (!apps.length) {
    console.warn('Firebase no inicializado aún');
    return null;
  }
  return getFirestore(apps[0]);
}

async function getDBReady(retries = 10) {
  for (let i = 0; i < retries; i++) {
    const db = getDB();
    if (db) return db;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Firebase no disponible después de esperar');
}

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
window.SPACE = {
  current:    null,   // { id, name, emoji, members, config, perfilFinanciero }
  myRole:     null,   // 'owner'|'admin'|'member'|'viewer'
  unsubChat:  null,   // unsubscribe fn for realtime chat
  unsubTx:    null,   // unsubscribe fn for realtime transactions
  memberCache:{},     // uid → { displayName, email, avatarLetter }
};

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════
function uid()   { return window.CURRENT_USER?.uid; }
function uname() { return window.CURRENT_USER?.displayName || window.CURRENT_USER?.email?.split('@')[0] || 'Yo'; }
function uavatar(){ return (uname()).charAt(0).toUpperCase(); }

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
  const id = 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  const space = {
    id, name, emoji,
    createdBy: uid(),
    members: { [uid()]: 'owner' },
    config: { tabs: APP_CONFIG?.tabs || [], limiteOcio: APP_CONFIG?.limiteOcio || 500000 },
    perfilFinanciero: { ...window.PERFIL },
    createdAt: new Date().toISOString(),
  };

  if (window._DEMO_MODE) {
    const spaces = demoGetList('ap_my_spaces_' + uid());
    spaces.push({ id, name, emoji, role: 'owner' });
    demoSaveList('ap_my_spaces_' + uid(), spaces);
    localStorage.setItem('ap_space_' + id, JSON.stringify(space));
  } else {
    const db = await getDBReady();
    await setDoc(doc(db, 'spaces', id), space);
    // Add to user's space list
    const userRef = doc(db, 'users', uid(), 'data', 'spaces');
    const curr = (await getDoc(userRef)).data()?.list || [];
    curr.push({ id, name, emoji, role: 'owner' });
    await setDoc(userRef, { list: curr });
  }

  showToast(`Espacio "${name}" creado ✓`, 'green');
  await loadSpace(id);
  return id;
};

window.loadMySpaces = async function() {
  if (window._DEMO_MODE) {
    return demoGetList('ap_my_spaces_' + uid());
  }
  const db = await getDBReady();
  const snap = await getDoc(doc(db, 'users', uid(), 'data', 'spaces'));
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

  // Merge space config into app
  if (spaceData.config?.tabs?.length) APP_CONFIG.tabs = spaceData.config.tabs;
  if (spaceData.perfilFinanciero)     Object.assign(window.PERFIL, spaceData.perfilFinanciero);

  // Load transactions from space
  await loadSpaceTx(spaceId);

  // Subscribe realtime
  subscribeSpaceChat(spaceId);
  subscribeSpaceTx(spaceId);

  // Build member cache
  buildMemberCache();

  showToast(`Espacio "${spaceData.name}" cargado`, 'blue');
  buildNav();
  switchTab('dashboard');
  return true;
};

window.leaveSpace = async function() {
  if (!SPACE.current) return;
  if (!confirm('¿Salir del espacio compartido? Volverás a tu cuenta personal.')) return;

  if (canOwner(SPACE.myRole)) {
    const others = Object.keys(SPACE.current.members).filter(m => m !== uid());
    if (others.length > 0) {
      alert('Transfiere el ownership a otro miembro antes de salir.');
      return;
    }
  }

  SPACE.unsubChat?.();
  SPACE.unsubTx?.();
  SPACE.current = null;
  SPACE.myRole  = null;

  // Reload personal data
  const [g, m] = await Promise.all([
    window._db.getGastos(uid()),
    window._db.getMetas(uid()),
  ]);
  window.gastos = g || [];
  window.metas  = m || [];

  showToast('Saliste del espacio compartido', 'yellow');
  buildNav();
  switchTab('dashboard');
};

// ══════════════════════════════════════════
// TRANSACTIONS (espacio)
// ══════════════════════════════════════════
window.addSpaceTx = async function(entry) {
  if (!SPACE.current) return window._db.saveGastos(uid(), window.gastos);

  const enriched = {
    ...entry,
    id: Date.now(),
    spaceId: SPACE.current.id,
    createdBy: uid(),
    authorName: uname(),
    authorAvatar: uavatar(),
    createdAt: new Date().toISOString(),
  };

  if (window._DEMO_MODE) {
    const list = demoGetList(spaceKey(SPACE.current.id, 'gastos'));
    list.push(enriched);
    demoSaveList(spaceKey(SPACE.current.id, 'gastos'), list);
    window.gastos = list;
  } else {
    const db = getDB();
    await addDoc(collection(db, 'spaces', SPACE.current.id, 'gastos'), enriched);
  }

  // Post to chat
  postChatActivity(`💳 ${uname()} registró ${enriched.tipo === 'ingreso' ? '+' : '-'}${fmt(enriched.monto)} en ${enriched.categoria}`, 'tx', enriched);
};

async function loadSpaceTx(spaceId) {
  if (window._DEMO_MODE) {
    window.gastos = demoGetList(spaceKey(spaceId, 'gastos'));
    return;
  }
  const db = getDB();
  const snap = await getDocs(collection(db, 'spaces', spaceId, 'gastos'));
  window.gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function subscribeSpaceTx(spaceId) {
  SPACE.unsubTx?.();
  if (window._DEMO_MODE) return;
  const db = getDB();
  SPACE.unsubTx = onSnapshot(
    query(collection(db, 'spaces', spaceId, 'gastos'), orderBy('createdAt', 'desc'), limit(200)),
    snap => {
      window.gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Refresh visible tab
      const activeTab = document.querySelector('.tab-section.active')?.id?.replace('tab-','');
      if (activeTab === 'dashboard')    renderDashboard();
      if (activeTab === 'transactions') renderTransactions();
      if (activeTab === 'reports')      renderReports();
    }
  );
}

// ══════════════════════════════════════════
// CHAT EN TIEMPO REAL
// ══════════════════════════════════════════
function subscribeSpaceChat(spaceId) {
  SPACE.unsubChat?.();
  if (window._DEMO_MODE) {
    // Demo: just render static messages
    renderChat();
    return;
  }
  const db = getDB();
  SPACE.unsubChat = onSnapshot(
    query(collection(db, 'spaces', spaceId, 'messages'), orderBy('createdAt', 'asc'), limit(100)),
    snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderChat(msgs);
      updateChatBadge(msgs.length);
    }
  );
}

window.postChatMessage = async function(text) {
  if (!text?.trim() || !SPACE.current) return;
  const msg = {
    text, uid: uid(), authorName: uname(), authorAvatar: uavatar(),
    type: 'message', createdAt: new Date().toISOString(),
  };

  if (window._DEMO_MODE) {
    const msgs = demoGetList(spaceKey(SPACE.current.id, 'messages'));
    msgs.push({ ...msg, id: Date.now() });
    demoSaveList(spaceKey(SPACE.current.id, 'messages'), msgs);
    renderChat(msgs);
    return;
  }
  const db = getDB();
  await addDoc(collection(db, 'spaces', SPACE.current.id, 'messages'),
    { ...msg, createdAt: serverTimestamp() });
};

async function postChatActivity(text, type = 'activity', attachedTx = null) {
  if (!SPACE.current) return;
  const msg = {
    text, uid: uid(), authorName: uname(), authorAvatar: uavatar(),
    type, attachedTx, createdAt: new Date().toISOString(),
  };

  if (window._DEMO_MODE) {
    const msgs = demoGetList(spaceKey(SPACE.current.id, 'messages'));
    msgs.push({ ...msg, id: Date.now() });
    demoSaveList(spaceKey(SPACE.current.id, 'messages'), msgs);
    renderChat(msgs);
    return;
  }
  const db = getDB();
  await addDoc(collection(db, 'spaces', SPACE.current.id, 'messages'),
    { ...msg, createdAt: serverTimestamp() });
}

function renderChat(msgs) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  if (!msgs) {
    if (window._DEMO_MODE && SPACE.current) {
      msgs = demoGetList(spaceKey(SPACE.current.id, 'messages'));
    } else {
      msgs = [];
    }
  }

  container.innerHTML = msgs.length ? '' : '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">Sé el primero en escribir algo 👋</div>';

  msgs.forEach(m => {
    const isMe = m.uid === uid();
    const isActivity = ['tx','activity','alert'].includes(m.type);
    const div = document.createElement('div');

    if (isActivity) {
      div.style.cssText = 'text-align:center;margin:6px 0;font-size:11px;color:var(--text3);font-family:"DM Mono",monospace;';
      div.textContent = m.text;
      container.appendChild(div);
      return;
    }

    div.style.cssText = `display:flex;gap:8px;margin-bottom:10px;${isMe?'flex-direction:row-reverse':''}`;
    div.innerHTML = `
      <div style="width:28px;height:28px;border-radius:50%;background:${isMe?'var(--green)':'var(--s3)'};color:${isMe?'#051209':'var(--text)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${m.authorAvatar||'?'}</div>
      <div style="max-width:75%">
        <div style="font-size:10px;color:var(--text3);margin-bottom:3px;${isMe?'text-align:right':''}">${isMe?'Tú':m.authorName}</div>
        <div style="background:${isMe?'rgba(79,142,255,.15)':'var(--s2)'};border:1px solid ${isMe?'rgba(79,142,255,.25)':'var(--border)'};border-radius:${isMe?'12px 2px 12px 12px':'2px 12px 12px 12px'};padding:8px 12px;font-size:13px;line-height:1.5;color:var(--text)">${esc(m.text)}</div>
        ${m.attachedTx ? `<div style="margin-top:4px;background:var(--s3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text2);font-family:'DM Mono',monospace">${m.attachedTx.tipo==='ingreso'?'+':'-'}${fmt(m.attachedTx.monto)} · ${m.attachedTx.categoria}</div>` : ''}
      </div>`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function updateChatBadge(count) {
  const badge = document.getElementById('chatNavBadge');
  if (badge) badge.style.display = count > 0 ? 'inline' : 'none';
}

// ══════════════════════════════════════════
// INVITACIONES
// ══════════════════════════════════════════
window.generateInviteLink = async function(role = 'member') {
  if (!SPACE.current) return null;
  if (!canAdmin(SPACE.myRole)) { showToast('Solo admins pueden invitar', 'red'); return null; }

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const invite = {
    token, spaceId: SPACE.current.id, spaceName: SPACE.current.name,
    spaceEmoji: SPACE.current.emoji, role,
    createdBy: uid(), createdByName: uname(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7*24*60*60*1000).toISOString(), // 7 días
    used: false,
  };

  if (window._DEMO_MODE) {
    localStorage.setItem('ap_invite_' + token, JSON.stringify(invite));
  } else {
    const db = await getDBReady();
    await setDoc(doc(db, 'invites', token), invite);
  }

  const link = `${location.origin}${location.pathname}?invite=${token}`;
  return link;
};

window.acceptInvite = async function(token) {
  let invite;
  if (window._DEMO_MODE) {
    const raw = localStorage.getItem('ap_invite_' + token);
    invite = raw ? JSON.parse(raw) : null;
  } else {
    const db = await getDBReady();
    const snap = await getDoc(doc(db, 'invites', token));
    invite = snap.exists() ? snap.data() : null;
  }

  if (!invite) { showToast('Invitación no válida o expirada', 'red'); return false; }
  if (invite.used) { showToast('Esta invitación ya fue usada', 'red'); return false; }
  if (new Date(invite.expiresAt) < new Date()) { showToast('Invitación expirada', 'red'); return false; }
  if (invite.spaceId && SPACE.current?.id === invite.spaceId) { showToast('Ya eres miembro de este espacio', 'yellow'); return false; }

  // Add member to space
  if (window._DEMO_MODE) {
    const raw = localStorage.getItem('ap_space_' + invite.spaceId);
    if (!raw) { showToast('Espacio no encontrado', 'red'); return false; }
    const space = JSON.parse(raw);
    space.members[uid()] = invite.role;
    localStorage.setItem('ap_space_' + invite.spaceId, JSON.stringify(space));
    localStorage.setItem('ap_invite_' + token, JSON.stringify({ ...invite, used: true }));

    // Add to user's spaces
    const spaces = demoGetList('ap_my_spaces_' + uid());
    if (!spaces.find(s => s.id === invite.spaceId)) {
      spaces.push({ id: invite.spaceId, name: invite.spaceName, emoji: invite.spaceEmoji, role: invite.role });
      demoSaveList('ap_my_spaces_' + uid(), spaces);
    }
  } else {
    const db = getDB();
    await updateDoc(doc(db, 'spaces', invite.spaceId), { [`members.${uid()}`]: invite.role });
    await updateDoc(doc(db, 'invites', token), { used: true });
    const userRef = doc(db, 'users', uid(), 'data', 'spaces');
    const curr = (await getDoc(userRef)).data()?.list || [];
    if (!curr.find(s => s.id === invite.spaceId)) {
      curr.push({ id: invite.spaceId, name: invite.spaceName, emoji: invite.spaceEmoji, role: invite.role });
      await setDoc(userRef, { list: curr });
    }
  }

  showToast(`Te uniste a "${invite.spaceName}" como ${invite.role} ✓`, 'green');
  await loadSpace(invite.spaceId);
  postChatActivity(`👋 ${uname()} se unió al espacio como ${invite.role}`, 'activity');
  return true;
};

// ══════════════════════════════════════════
// MEMBER CACHE
// ══════════════════════════════════════════
async function buildMemberCache() {
  if (!SPACE.current) return;
  for (const [memberId, role] of Object.entries(SPACE.current.members || {})) {
    if (SPACE.memberCache[memberId]) continue;
    if (memberId === uid()) {
      SPACE.memberCache[memberId] = { displayName: uname(), role, avatarLetter: uavatar() };
      continue;
    }
    // In demo mode we can't fetch other users, so use placeholder
    SPACE.memberCache[memberId] = { displayName: 'Miembro', role, avatarLetter: '?' };
  }
}

// ══════════════════════════════════════════
// SAVE SPACE DATA
// ══════════════════════════════════════════
window.saveSpaceData = async function() {
  if (!SPACE.current) return window.saveData?.();
  if (!canWrite(SPACE.myRole)) return;

  // Save gastos to space (already handled by addSpaceTx)
  // Save metas to space
  if (window._DEMO_MODE) {
    demoSaveList(spaceKey(SPACE.current.id, 'metas'), window.metas);
    return;
  }
  const db = getDB();
  await setDoc(doc(db, 'spaces', SPACE.current.id, 'data', 'metas'), { list: window.metas });
};

window.saveSpacePerfil = async function() {
  if (!SPACE.current || !canAdmin(SPACE.myRole)) return;
  if (window._DEMO_MODE) {
    const raw = localStorage.getItem('ap_space_' + SPACE.current.id);
    if (raw) {
      const sp = JSON.parse(raw);
      sp.perfilFinanciero = window.PERFIL;
      sp.config = APP_CONFIG;
      localStorage.setItem('ap_space_' + SPACE.current.id, JSON.stringify(sp));
    }
    return;
  }
  const db = getDB();
  await updateDoc(doc(db, 'spaces', SPACE.current.id), {
    perfilFinanciero: window.PERFIL,
    config: APP_CONFIG,
  });
  showToast('Perfil del espacio actualizado ✓', 'green');
};

// ══════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════
window.getSpaceHeader = function() {
  if (!SPACE.current) return '';
  const members = Object.keys(SPACE.current.members || {});
  return `
    <div style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(79,142,255,.08),rgba(157,110,255,.08));border:1px solid rgba(79,142,255,.2);border-radius:12px;padding:10px 16px;margin-bottom:16px">
      <span style="font-size:20px">${SPACE.current.emoji || '👥'}</span>
      <div style="flex:1">
        <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:600">${esc(SPACE.current.name)}</div>
        <div style="font-size:11px;color:var(--text2)">${members.length} miembro${members.length!==1?'s':''} · tu rol: <strong style="color:var(--blue)">${SPACE.myRole}</strong></div>
      </div>
      <button class="btn-icon" onclick="openSpacePanel()" style="font-size:12px;padding:5px 10px">⚙️ Gestionar</button>
      <button class="btn-icon" onclick="leaveSpace()" style="font-size:12px;padding:5px 10px;color:var(--red)">✕ Salir</button>
    </div>`;
};

window.openSpacePanel = function() {
  document.getElementById('spacePanelModal')?.classList.add('open');
  renderSpacePanel();
};
window.closeSpacePanel = function() {
  document.getElementById('spacePanelModal')?.classList.remove('open');
};

window.renderSpacePanel = async function() {
  const panel = document.getElementById('spacePanelContent');
  if (!panel || !SPACE.current) return;

  const members = Object.entries(SPACE.current.members || {});
  const isAdmin = canAdmin(SPACE.myRole);
  const isOwner = canOwner(SPACE.myRole);

  panel.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Miembros (${members.length})</div>
      ${members.map(([memberId, role]) => {
        const info = SPACE.memberCache[memberId] || { displayName: memberId === uid() ? uname() : 'Miembro', avatarLetter: '?' };
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="width:32px;height:32px;border-radius:50%;background:${memberId===uid()?'linear-gradient(135deg,var(--blue),var(--purple))':'linear-gradient(135deg,var(--green),#0a8a6a)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${info.avatarLetter}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${esc(info.displayName)}${memberId===uid()?' <span style="font-size:11px;color:var(--text3)">(tú)</span>':''}</div>
          </div>
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${role==='owner'?'rgba(255,204,68,.15)':role==='admin'?'rgba(79,142,255,.15)':'rgba(0,229,160,.1)'};color:${role==='owner'?'var(--yellow)':role==='admin'?'var(--blue)':'var(--green)'}">${role}</span>
          ${isAdmin && memberId !== uid() && role !== 'owner' ? `
            <select onchange="changeRole('${memberId}',this.value)" style="width:90px;font-size:11px;padding:3px 6px">
              ${ROLES_ORDER.filter(r=>r!=='owner').map(r=>`<option value="${r}"${r===role?' selected':''}>${r}</option>`).join('')}
            </select>
            ${isOwner ? `<button class="btn-icon" onclick="removeMember('${memberId}')" style="color:var(--red);font-size:11px">✕</button>` : ''}
          ` : ''}
        </div>`;
      }).join('')}
    </div>

    ${isAdmin ? `
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Invitar miembro</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select id="inviteRole" style="width:110px;font-size:13px">
          <option value="member">member</option>
          <option value="admin">admin</option>
          <option value="viewer">viewer</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="copyInviteLink()">🔗 Generar link</button>
      </div>
      <div id="inviteLinkBox" style="display:none;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;font-family:'DM Mono',monospace;word-break:break-all;color:var(--text2)"></div>
    </div>` : ''}

    ${isAdmin ? `
    <div>
      <div style="font-size:13px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Sincronizar perfil financiero</div>
      <p style="font-size:12px;color:var(--text3);margin-bottom:10px">Comparte tu configuración de ingresos, gastos fijos y metas con todos los miembros del espacio.</p>
      <button class="btn btn-ghost btn-sm" onclick="saveSpacePerfil()">📤 Sincronizar perfil</button>
    </div>` : ''}
  `;
};

window.copyInviteLink = async function() {
  const role = document.getElementById('inviteRole')?.value || 'member';
  const link = await generateInviteLink(role);
  if (!link) return;
  const box = document.getElementById('inviteLinkBox');
  if (box) { box.style.display = 'block'; box.textContent = link; }
  try { await navigator.clipboard.writeText(link); showToast('Link copiado al portapapeles ✓', 'green'); }
  catch { showToast('Link generado — cópialo manualmente', 'blue'); }
};

window.changeRole = async function(memberId, newRole) {
  if (!SPACE.current || !canAdmin(SPACE.myRole)) return;
  if (window._DEMO_MODE) {
    const raw = localStorage.getItem('ap_space_' + SPACE.current.id);
    if (raw) { const sp=JSON.parse(raw); sp.members[memberId]=newRole; localStorage.setItem('ap_space_'+SPACE.current.id,JSON.stringify(sp)); SPACE.current.members[memberId]=newRole; }
  } else {
    const db = getDB();
    await updateDoc(doc(db,'spaces',SPACE.current.id), { [`members.${memberId}`]: newRole });
    SPACE.current.members[memberId] = newRole;
  }
  showToast('Rol actualizado ✓','green');
  renderSpacePanel();
};

window.removeMember = async function(memberId) {
  if (!canOwner(SPACE.myRole)) return;
  if (!confirm('¿Eliminar este miembro del espacio?')) return;
  if (window._DEMO_MODE) {
    const raw = localStorage.getItem('ap_space_' + SPACE.current.id);
    if (raw) { const sp=JSON.parse(raw); delete sp.members[memberId]; localStorage.setItem('ap_space_'+SPACE.current.id,JSON.stringify(sp)); delete SPACE.current.members[memberId]; }
  } else {
    const db = getDB();
    await updateDoc(doc(db,'spaces',SPACE.current.id), { [`members.${memberId}`]: null });
    delete SPACE.current.members[memberId];
  }
  showToast('Miembro eliminado','red');
  renderSpacePanel();
};

// ══════════════════════════════════════════
// CHECK INVITE ON LOAD
// ══════════════════════════════════════════
window.checkInviteParam = async function() {
  const params = new URLSearchParams(location.search);
  const token  = params.get('invite');
  if (!token) return false;

  // Clear URL
  history.replaceState({}, '', location.pathname);

  if (!window.CURRENT_USER) {
    // Store token, will be picked up after login
    sessionStorage.setItem('pending_invite', token);
    return false;
  }

  return await acceptInvite(token);
};

window.checkPendingInvite = async function() {
  const token = sessionStorage.getItem('pending_invite');
  if (!token) return;
  sessionStorage.removeItem('pending_invite');
  await acceptInvite(token);
};

// ══════════════════════════════════════════
// EXPOSE DEMO MODE FLAG
// ══════════════════════════════════════════
// Read from firebase.js
// DEMO_MODE se toma del flag global seteado por firebase.js (false en producción)
window.addEventListener('load', () => {
  if (typeof window._DEMO_MODE === 'undefined') {
    window._DEMO_MODE = false; // default: producción
  }
});
