// ============================================================
// spaces-ui.js — Tabs y UI para espacios compartidos
// Se carga después de spaces.js
// ============================================================

// ══════════════════════════════════════════
// NAV: añadir tabs de espacio
// ══════════════════════════════════════════
const SPACE_TABS = [
  { id:'team',    label:'👥 Equipo' },
  { id:'chat',    label:'💬 Chat',  badge:'chatNavBadge' },
  { id:'shared-reports', label:'📊 Reportes equipo' },
];

// Patch buildNav to include space tabs
const _origBuildNav = window.buildNav;
window.buildNav = function() {
  _origBuildNav?.();
  if (!window.SPACE?.current) return;

  const nav = document.getElementById('mainNav');
  const spaceDivider = document.createElement('div');
  spaceDivider.style.cssText = 'width:1px;background:var(--border);margin:8px 6px;align-self:stretch;flex-shrink:0';
  nav.appendChild(spaceDivider);

  SPACE_TABS.forEach(t => {
    const el = document.createElement('div');
    el.className = 'nav-tab';
    el.dataset.tab = t.id;
    el.onclick = () => switchTab(t.id);
    el.innerHTML = t.label + (t.badge ? ` <span id="${t.badge}" style="display:none;background:var(--red);color:#fff;font-size:10px;font-weight:600;padding:1px 5px;border-radius:99px;min-width:16px;text-align:center">●</span>` : '');
    nav.appendChild(el);
  });
};

// Patch getTabHTML to handle space tabs
const _origGetTabHTML = window.getTabHTML;
window.getTabHTML = function(tab) {
  if (tab === 'team')           return getTeamTabHTML();
  if (tab === 'chat')           return getChatTabHTML();
  if (tab === 'shared-reports') return getSharedReportsTabHTML();
  return _origGetTabHTML?.(tab) || '';
};

// Patch switchTab renders
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  _origSwitchTab?.(tab);
  if (tab === 'team')           renderTeamTab();
  if (tab === 'chat')           { renderChat(); focusChatInput(); }
  if (tab === 'shared-reports') renderSharedReports();
};

// ══════════════════════════════════════════
// TEAM TAB
// ══════════════════════════════════════════
function getTeamTabHTML() {
  return `
    <div id="spaceHeaderTeam"></div>

    <div class="two-col" style="margin-bottom:16px">
      <div class="stat-card sc-blue"><div class="stat-label">Miembros</div><div class="stat-value" id="teamMemberCount" style="color:var(--green)">—</div></div>
      <div class="stat-card sc-green"><div class="stat-label">Movimientos equipo</div><div class="stat-value" id="teamTxCount" style="color:var(--green)">—</div></div>
    </div>

    <div class="card">
      <div class="card-title">👥 Actividad del equipo</div>
      <div id="teamActivity"></div>
    </div>

    <div class="card">
      <div class="card-title">💳 Últimos movimientos del equipo</div>
      <div id="teamTxList"></div>
    </div>
  `;
}

function renderTeamTab() {
  const sh = document.getElementById('spaceHeaderTeam');
  if (sh) sh.innerHTML = window.getSpaceHeader?.() || '';

  if (!SPACE.current) return;

  const members = Object.keys(SPACE.current.members || {});
  setText('teamMemberCount', members.length);
  setText('teamTxCount', window.gastos?.length || 0);

  // Activity: last 10 transactions by anyone
  const actEl = document.getElementById('teamActivity');
  if (actEl) {
    const recent = [...(window.gastos||[])].sort((a,b)=>new Date(b.createdAt||b.fecha)-new Date(a.createdAt||a.fecha)).slice(0,8);
    if (!recent.length) { actEl.innerHTML = '<div class="empty-st"><div class="empty-icon">📋</div><p>Sin actividad</p></div>'; }
    else {
      actEl.innerHTML = recent.map(g => {
        const isMe = g.createdBy === window.CURRENT_USER?.uid;
        const author = g.authorName || (isMe ? 'Tú' : 'Miembro');
        const av = g.authorAvatar || author.charAt(0).toUpperCase();
        const color = g.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="width:28px;height:28px;border-radius:50%;background:${isMe?'var(--green)':'var(--s3)'};color:${isMe?'#051209':'var(--text)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${av}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500">${esc(g.descripcion)}</div>
            <div style="font-size:11px;color:var(--text2);font-family:'DM Mono',monospace">${g.fecha} · ${g.categoria} · <strong>${isMe?'Tú':author}</strong></div>
          </div>
          <div style="font-size:13px;font-weight:600;font-family:'DM Mono',monospace;color:${color}">${g.tipo==='ingreso'?'+':'−'}${fmt(g.monto)}</div>
        </div>`;
      }).join('');
    }
  }

  // Full tx list grouped by author
  const txEl = document.getElementById('teamTxList');
  if (txEl) {
    const byAuthor = {};
    (window.gastos||[]).filter(g=>g.tipo==='gasto').forEach(g => {
      const key = g.authorName || 'Sin nombre';
      byAuthor[key] = (byAuthor[key]||0) + g.monto;
    });

    if (!Object.keys(byAuthor).length) {
      txEl.innerHTML = '<div class="empty-st" style="padding:20px"><p>Sin egresos registrados</p></div>';
      return;
    }

    const total = Object.values(byAuthor).reduce((a,b)=>a+b,0);
    txEl.innerHTML = Object.entries(byAuthor).sort((a,b)=>b[1]-a[1]).map(([name,amt]) => {
      const pct = total > 0 ? Math.round(amt/total*100) : 0;
      const isMe = name === (window.CURRENT_USER?.displayName || window.CURRENT_USER?.email?.split('@')[0]);
      return `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span style="display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${isMe?'var(--blue)':'var(--green)'};display:inline-block"></span>
            ${esc(name)}${isMe?' <span style="font-size:10px;color:var(--text3)">(tú)</span>':''}
          </span>
          <span style="font-family:'DM Mono',monospace">${fmt(amt)} <span style="color:var(--text3)">(${pct}%)</span></span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${isMe?'var(--blue)':'var(--green)'}"></div></div>
      </div>`;
    }).join('');
  }
}

// ══════════════════════════════════════════
// CHAT TAB
// ══════════════════════════════════════════
function getChatTabHTML() {
  return `
    <div id="spaceHeaderChat" style="margin-bottom:16px"></div>
    <div class="card" style="padding:0">
      <div id="chatMessages" style="padding:16px;min-height:300px;max-height:480px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"></div>
      <div style="border-top:1px solid var(--border);padding:12px 16px;display:flex;gap:8px">
        <input type="text" id="chatInput" placeholder="Escribe un mensaje al equipo..." style="flex:1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMsg()}">
        <button class="btn btn-primary btn-sm" onclick="sendChatMsg()">Enviar</button>
      </div>
    </div>
  `;
}

window.sendChatMsg = function() {
  const input = document.getElementById('chatInput');
  const text  = input?.value.trim();
  if (!text) return;
  input.value = '';
  postChatMessage(text);
};

function focusChatInput() {
  setTimeout(() => document.getElementById('chatInput')?.focus(), 100);
}

// ══════════════════════════════════════════
// SHARED REPORTS
// ══════════════════════════════════════════
function getSharedReportsTabHTML() {
  return `
    <div id="spaceHeaderReports" style="margin-bottom:16px"></div>

    <div class="stats-grid">
      <div class="stat-card sc-green"><div class="stat-label">Ingresos equipo</div><div class="stat-value" style="color:var(--green)" id="srIng">$0</div></div>
      <div class="stat-card sc-red"><div class="stat-label">Egresos equipo</div><div class="stat-value" style="color:var(--red)" id="srEg">$0</div></div>
      <div class="stat-card sc-blue"><div class="stat-label">Balance equipo</div><div class="stat-value" id="srBal">$0</div></div>
      <div class="stat-card sc-purple"><div class="stat-label">Ahorro metas</div><div class="stat-value" style="color:var(--purple)" id="srAhorro">$0</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">Gastos por categoría — equipo</div>
        <div id="srCatChart" style="position:relative;height:260px"><canvas id="chartSharedCat"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Aporte por miembro</div>
        <div id="srMemberBreakdown"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🤖 Análisis IA del equipo</div>
      <div class="q-btns">
        <button class="q-btn" onclick="aiTeamAnalysis('Analiza los gastos del equipo y detecta patrones')">📊 Análisis equipo</button>
        <button class="q-btn" onclick="aiTeamAnalysis('¿Cómo optimizar los gastos compartidos?')">💡 Optimizar gastos</button>
        <button class="q-btn" onclick="aiTeamAnalysis('¿Cómo vamos con las metas del equipo?')">🎯 Estado metas</button>
      </div>
      <div id="srAiResult" style="margin-top:10px"></div>
    </div>
  `;
}

let sharedCatChart = null;

function renderSharedReports() {
  const sh = document.getElementById('spaceHeaderReports');
  if (sh) sh.innerHTML = window.getSpaceHeader?.() || '';

  const ing = (window.gastos||[]).filter(g=>g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0);
  const eg  = (window.gastos||[]).filter(g=>g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);
  const bal = ing - eg;
  const ahorroTotal = (window.metas||[]).reduce((s,m)=>s+m.ahorrado,0);

  setText('srIng',    fmt(ing));
  setText('srEg',     fmt(eg));
  setText('srBal',    fmt(bal), bal>=0?'var(--green)':'var(--red)');
  setText('srAhorro', fmt(ahorroTotal));

  // Cat chart
  const cats = {};
  (window.gastos||[]).filter(g=>g.tipo==='gasto').forEach(g=>{cats[g.categoria]=(cats[g.categoria]||0)+g.monto;});
  const ctx = document.getElementById('chartSharedCat')?.getContext('2d');
  if (ctx && Object.keys(cats).length) {
    if (sharedCatChart) sharedCatChart.destroy();
    sharedCatChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor: Object.keys(cats).map(catColor), borderWidth:0, hoverOffset:6 }] },
      options: { responsive:true, maintainAspectRatio:false, cutout:'60%',
        plugins: { legend:{position:'bottom',labels:{color:'#8892c4',font:{size:11},padding:10}}, tooltip:{callbacks:{label:c=>' '+fmt(c.raw)}} } }
    });
  }

  // Member breakdown
  const mbEl = document.getElementById('srMemberBreakdown');
  if (mbEl) {
    const byMember = {};
    (window.gastos||[]).forEach(g => {
      const key = g.authorName || 'Sin nombre';
      if (!byMember[key]) byMember[key] = { ing:0, eg:0, avatar: g.authorAvatar||'?' };
      if (g.tipo==='ingreso') byMember[key].ing += g.monto;
      else byMember[key].eg += g.monto;
    });

    if (!Object.keys(byMember).length) { mbEl.innerHTML = '<div class="empty-st" style="padding:16px"><p>Sin movimientos</p></div>'; return; }

    mbEl.innerHTML = Object.entries(byMember).map(([name, data]) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--purple));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${data.avatar}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;margin-bottom:4px">${esc(name)}</div>
          <div style="display:flex;gap:12px;font-size:11px;font-family:'DM Mono',monospace">
            <span style="color:var(--green)">+${fmt(data.ing)}</span>
            <span style="color:var(--red)">-${fmt(data.eg)}</span>
            <span style="color:${data.ing-data.eg>=0?'var(--green)':'var(--red)'}">= ${fmt(data.ing-data.eg)}</span>
          </div>
        </div>
      </div>`).join('');
  }
}

window.aiTeamAnalysis = async function(prompt) {
  const el = document.getElementById('srAiResult');
  if (!el) return;
  el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:12px;color:var(--text3);font-size:13px"><div style="display:flex;gap:3px"><span style="width:5px;height:5px;border-radius:50%;background:var(--blue);animation:bounce .7s infinite inline-block"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--blue);animation:bounce .7s .15s infinite inline-block"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--blue);animation:bounce .7s .3s infinite inline-block"></span></div> Analizando equipo...</div>';

  try {
    const members = Object.keys(SPACE.current?.members||{}).length;
    const ing = (window.gastos||[]).filter(g=>g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0);
    const eg  = (window.gastos||[]).filter(g=>g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);
    const cats = {};
    (window.gastos||[]).filter(g=>g.tipo==='gasto').forEach(g=>{cats[g.categoria]=(cats[g.categoria]||0)+g.monto;});
    const byMember = {};
    (window.gastos||[]).forEach(g=>{ const k=g.authorName||'?'; byMember[k]=(byMember[k]||0)+g.monto; });

    const data = await callAI({
      max_tokens: 600,
      messages:[{ role:'user', content:`Eres asesor financiero de un equipo/pareja en Colombia. Analiza estos datos y responde: "${prompt}"\n\nDATA:\nEspacio: ${SPACE.current?.name}\nMiembros: ${members}\nIngresos totales: ${fmt(ing)}\nEgresos totales: ${fmt(eg)}\nBalance: ${fmt(ing-eg)}\nGastos por categoría: ${JSON.stringify(cats)}\nAportes por miembro: ${JSON.stringify(byMember)}\n\nResponde en español, máximo 200 palabras, con emojis y recomendaciones concretas.` }]
    });
    const text = data.content?.[0]?.text || 'No se pudo obtener el análisis.';
    el.innerHTML = `<div style="background:rgba(79,142,255,.07);border:1px solid rgba(79,142,255,.15);border-radius:10px;padding:14px;font-size:13px;line-height:1.65;color:var(--text)">${text.replace(/\n/g,'<br>')}</div>`;
  } catch(e) {
    el.innerHTML = '<div class="box-r">Error al conectar con la IA.</div>';
  }
};

// ══════════════════════════════════════════
// PATCH addTx to use space when active
// ══════════════════════════════════════════
const _origAddTx = window.addTx;
window.addTx = async function() {
  if (!SPACE.current) { return _origAddTx?.(); }
  if (!canWrite(SPACE.myRole)) { showToast('No tienes permisos para escribir en este espacio', 'red'); return; }

  const desc  = document.getElementById('txDesc')?.value.trim();
  const monto = +document.getElementById('txMonto')?.value;
  const tipo  = document.getElementById('txTipo')?.value;
  const cat   = document.getElementById('txCat')?.value;
  const fecha = document.getElementById('txFecha')?.value;
  if (!desc||!monto||monto<=0||!tipo||!cat||!fecha){ showToast('Completa todos los campos','red'); return; }

  const entry = { descripcion:desc, monto, tipo, categoria:cat, fecha };
  await addSpaceTx(entry);

  // Reset form
  ['txDesc','txMonto','txTipo','txCat'].forEach(id => { const el=document.getElementById(id); if(el)el.value=''; });
  const fd = document.getElementById('txFecha'); if(fd) fd.value = todayStr();

  showToast('Movimiento agregado al espacio ✓','green');
  applyFilters?.();
};

// Patch saveData to use space
const _origSaveData = window.saveData;
window.saveData = async function() {
  if (SPACE.current) return window.saveSpaceData?.();
  return _origSaveData?.();
};

// ══════════════════════════════════════════
// SPACE PANEL MODAL (inject into DOM)
// ══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  // Inject space panel modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'spacePanelModal';
  modal.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div class="modal-title" style="margin-bottom:0" id="spacePanelTitle">⚙️ Gestionar espacio</div>
        <button class="btn-icon" onclick="closeSpacePanel()">✕</button>
      </div>
      <div id="spacePanelContent"></div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) closeSpacePanel(); });
  document.body.appendChild(modal);

  // Inject space selector in user menu (after DOM ready)
  setTimeout(() => {
    const umModal = document.getElementById('userMenu');
    if (!umModal) return;
    const modal2 = umModal.querySelector('.modal');
    if (!modal2) return;
    const div = document.createElement('div');
    div.id = 'spaceMenuSection';
    div.style.cssText = 'margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)';
    div.innerHTML = `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px">Espacios compartidos</div>
      <div id="spaceList" style="margin-bottom:8px"></div>
      <button class="btn btn-ghost btn-sm" style="width:100%" onclick="openCreateSpaceModal()">+ Crear espacio</button>`;
    modal2.insertBefore(div, modal2.firstChild);
  }, 800);

  // Create space modal
  const csm = document.createElement('div');
  csm.className = 'modal-overlay';
  csm.id = 'createSpaceModal';
  csm.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-title">Nuevo espacio compartido</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.6">Crea un espacio para gestionar finanzas con tu pareja, familia o equipo. Cada movimiento registra quién lo hizo.</p>
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label">Nombre del espacio</label>
        <input type="text" id="newSpaceName" placeholder="Ej: Hogar, Pareja 2025, Equipo...">
      </div>
      <div class="form-group" style="margin-bottom:20px">
        <label class="form-label">Emoji</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap" id="emojiPicker">
          ${['💰','🏠','❤️','👨‍👩‍👧','👥','🚀','💼','🌱'].map(e=>`<button onclick="selectEmoji('${e}')" style="font-size:22px;padding:6px 10px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .15s" class="emoji-opt">${e}</button>`).join('')}
        </div>
        <input type="hidden" id="selectedEmoji" value="💰">
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="doCreateSpace()">Crear espacio</button>
        <button class="btn btn-ghost" onclick="closeCreateSpaceModal()">Cancelar</button>
      </div>
    </div>`;
  csm.addEventListener('click', e => { if(e.target===csm) closeCreateSpaceModal(); });
  document.body.appendChild(csm);
});

window.openCreateSpaceModal = function() {
  closeUserMenu?.();
  document.getElementById('createSpaceModal')?.classList.add('open');
};
window.closeCreateSpaceModal = function() {
  document.getElementById('createSpaceModal')?.classList.remove('open');
};
window.selectEmoji = function(e) {
  document.getElementById('selectedEmoji').value = e;
  document.querySelectorAll('.emoji-opt').forEach(b => { b.style.borderColor = 'var(--border)'; b.style.background = 'var(--s2)'; });
  event.target.style.borderColor = 'var(--blue)';
  event.target.style.background  = 'var(--green-dim)';
};
window.doCreateSpace = async function() {
  const name  = document.getElementById('newSpaceName')?.value.trim();
  const emoji = document.getElementById('selectedEmoji')?.value || '💰';
  if (!name) { showToast('Ponle un nombre al espacio','red'); return; }
  closeCreateSpaceModal();
  await createSpace(name, emoji);
  // Refresh space list in menu
  refreshSpaceList();
};

window.refreshSpaceList = async function() {
  const el = document.getElementById('spaceList');
  if (!el) return;
  const spaces = await loadMySpaces();
  if (!spaces.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text3);text-align:center;padding:8px">Sin espacios aún</div>'; return; }
  el.innerHTML = spaces.map(s => `
    <div onclick="loadSpaceFromMenu('${s.id}')" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;background:${SPACE.current?.id===s.id?'var(--green-dim)':'var(--s2)'};border:1px solid ${SPACE.current?.id===s.id?'rgba(34,197,94,.3)':'var(--border)'};margin-bottom:5px;transition:all .15s">
      <span style="font-size:16px">${s.emoji||'💰'}</span>
      <div style="flex:1"><div style="font-size:13px;font-weight:500">${esc(s.name)}</div><div style="font-size:11px;color:var(--text3)">${s.role}</div></div>
      ${SPACE.current?.id===s.id?'<span style="font-size:10px;color:var(--green)">activo</span>':''}
    </div>`).join('');
};

window.loadSpaceFromMenu = async function(id) {
  closeUserMenu?.();
  try {
    const ok = await loadSpace(id);
    if (!ok) showToast('No se pudo cargar el espacio. Intenta de nuevo.', 'red');
  } catch(e) {
    console.error('loadSpace error:', e);
    showToast('Error al cargar el espacio: ' + e.message, 'red');
  }
};

// Load spaces when user menu opens
const _origOpenUserMenu = window.openUserMenu;
window.openUserMenu = function() {
  _origOpenUserMenu?.();
  refreshSpaceList();
};

// Check invite on user ready
const _origOnUserReady = window._onUserReady;
window._onUserReady = async function(user) {
  await _origOnUserReady?.(user);
  // Esperar a que la app esté lista antes de procesar invites
  setTimeout(async () => {
    await checkPendingInvite?.();
    await checkInviteParam?.();
  }, 500);
};
