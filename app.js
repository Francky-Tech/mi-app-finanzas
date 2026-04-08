// ============================================================
// AHORRAPP PRO — Motor principal con IA + Firebase
// ============================================================

// ── ESTADO GLOBAL ──
let CURRENT_USER = null;
let gastos = [], metas = [];
let PERFIL = defaultPerfil();
let APP_CONFIG = { tabs: [], limiteOcio: 500000, aiProvider: 'claude', gastosProgramados: [] };
let chatHistory = [];
let obHistory   = [];
let obStep = 0;
let recognition = null;
let isRecording = false;
let metaEditIdx = null, abonarIdx = null;
let indexEditando = null;
let chartDonut=null, chartBars=null, chartTrend=null;

function defaultPerfil() {
  return {
    nombre: '',
    ingresoMensual: 0,
    moneda: 'COP',
    gastosFijos: {},
    deudas: [],          // array de deudas: [{id,nombre,saldo,cuota,tasa,manejo}]
    cesantias: { hoy: 0, fechaObjetivo: '' },
    metaAhorro: { valor: 0, fecha: '', descripcion: '' },
    objetivos: [],
    contexto: '',
  };
}

// ── TABS DISPONIBLES ──────────────────────────────────────
const ALL_TABS = [
  { id:'dashboard',     label:'📊 Dashboard',       always: true },
  { id:'ai',            label:'🤖 Asesor IA',        always: true },
  { id:'transactions',  label:'💳 Movimientos',      always: true },
  { id:'deuda',         label:'💳 Deuda',         always: false },
  { id:'plan',          label:'🏠 Plan Apartamento', always: false },
  { id:'reports',       label:'📈 Reportes',         always: false },
  { id:'savings',       label:'🎯 Metas',            always: false },
  { id:'gastos-prog',   label:'🔄 Gastos prog.',      always: true },
  { id:'settings',      label:'⚙️ Config',           always: true },
];

// ============================================================
// LIFECYCLE — Auth callback
// ============================================================
window._onUserReady = async function(user) {
  CURRENT_USER = user;
  document.getElementById('authLayer').classList.add('hide');

  // Cargar datos del usuario
  const [profile, gastosList, metasList, config] = await Promise.all([
    window._db.getProfile(user.uid),
    window._db.getGastos(user.uid),
    window._db.getMetas(user.uid),
    window._db.getConfig(user.uid),
  ]);

  gastos = gastosList || [];
  metas  = metasList  || [];

  if (profile) {
    PERFIL = { ...defaultPerfil(), ...profile };
  }

  if (config) {
    APP_CONFIG = { ...APP_CONFIG, ...config };
  }

  // Actualizar UI de usuario
  const initials = (user.displayName||user.email||'?').charAt(0).toUpperCase();
  document.getElementById('uAvatar').textContent = initials;
  document.getElementById('uName').textContent   = user.displayName || user.email.split('@')[0];
  document.getElementById('umAv').textContent    = initials;
  document.getElementById('umName').textContent  = user.displayName || 'Usuario';
  document.getElementById('umEmail').textContent = user.email || '';

  // ¿Nuevo usuario o perfil vacío → onboarding?
  const needsOnboarding = user.isNew || !profile || !profile.ingresoMensual;
  if (needsOnboarding) {
    startOnboarding();
  } else {
    launchApp();
  }
};

window._showAuth = function() {
  // Auth layer ya visible por defecto
};

// ============================================================
// AUTH UI HELPERS
// ============================================================
function showReg()   { document.getElementById('loginCard').style.display='none'; document.getElementById('regCard').style.display='block'; }
function showLogin() { document.getElementById('regCard').style.display='none';  document.getElementById('loginCard').style.display='block'; }

// ============================================================
// ONBOARDING IA
// ============================================================
const OB_QUESTIONS = [
  { key:'intro',    ask: (nombre) => `¡Hola ${nombre}! 👋 Soy tu asesor financiero con IA. Voy a hacerte unas preguntas rápidas para configurar tu app personalizada.\n\n¿Cuánto ganas mensualmente (salario neto que llega a tu cuenta)?` },
  { key:'gastos',   ask: () => `Perfecto. Ahora cuéntame tus **gastos fijos mensuales**: arriendo, comida, servicios, transporte, etc. Puedes escribirlos uno por uno o todos juntos.` },
  { key:'deuda',    ask: () => `¿Tienes alguna deuda activa? Por ejemplo tarjeta de crédito, crédito de consumo, etc. Si sí, dime el saldo aproximado y cuánto pagas al mes.` },
  { key:'ahorro',   ask: () => `¿Tienes algún ahorro acumulado o cesantías? ¿Y cuál es tu meta principal de ahorro — qué quieres lograr con tu dinero?` },
  { key:'objetivo', ask: () => `Última pregunta: ¿cuándo quieres lograr esa meta? ¿Tienes una fecha objetivo? Y ¿qué tan disciplinado/a te consideras con el dinero del 1 al 10?` },
];

let obData = {};

function startOnboarding() {
  document.getElementById('onboardLayer').classList.add('show');
  obStep = 0;
  obData = {};
  obHistory = [];

  const steps = document.getElementById('obSteps');
  steps.innerHTML = OB_QUESTIONS.map((_,i) => `<div class="ob-step ${i===0?'active':''}" id="obs${i}"></div>`).join('');

  const nombre = CURRENT_USER.displayName || 'amigo';
  addObMsg('ai', OB_QUESTIONS[0].ask(nombre));
}

function addObMsg(role, text) {
  const chat = document.getElementById('obChat');
  const div  = document.createElement('div');
  div.className = `ob-msg ${role}`;
  div.innerHTML  = `<div class="ob-lbl">${role==='ai'?'🤖 Asesor IA':'👤 Tú'}</div>${text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function showObTyping() {
  const chat = document.getElementById('obChat');
  const div = document.createElement('div');
  div.id = 'obTyping';
  div.className = 'ob-dots';
  div.innerHTML = '<div class="ob-dot"></div><div class="ob-dot"></div><div class="ob-dot"></div> Analizando...';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}
function hideObTyping() { const e=document.getElementById('obTyping'); if(e)e.remove(); }

async function sendOb() {
  const input = document.getElementById('obInput');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';

  addObMsg('user', msg);
  obHistory.push({ role:'user', content: msg });
  obData[OB_QUESTIONS[obStep].key] = msg;

  // Marcar paso completado
  const stepEl = document.getElementById('obs'+obStep);
  if (stepEl) { stepEl.classList.remove('active'); stepEl.classList.add('done'); }

  obStep++;

  if (obStep >= OB_QUESTIONS.length) {
    // Todos los pasos completados → generar configuración con IA
    await finalizarOnboarding();
    return;
  }

  // Marcar siguiente paso activo
  const nextEl = document.getElementById('obs'+obStep);
  if (nextEl) nextEl.classList.add('active');

  showObTyping();
  await delay(700);
  hideObTyping();
  addObMsg('ai', OB_QUESTIONS[obStep].ask());
}

function obEnter(e) { if(e.key==='Enter') sendOb(); }

async function finalizarOnboarding() {
  showObTyping();
  addObMsg('ai', '✨ Perfecto, ya tengo todo lo que necesito. Estoy analizando tu situación y configurando tu app...');

  try {
    const systemPrompt = `Eres un asesor financiero experto. Analiza las respuestas de onboarding y devuelve SOLO un JSON válido (sin markdown, sin explicaciones):

{
  "perfil": {
    "ingresoMensual": number,
    "gastosFijos": { "nombre_gasto": number },
    "deudas": [],
    "cesantias": { "hoy": number, "fechaObjetivo": "" },
    "metaAhorro": { "valor": number, "fecha": "", "descripcion": "" },
    "objetivos": ["objetivo1"],
    "contexto": "resumen breve"
  },
  "tabs": ["dashboard", "ai", "transactions", "reports", "savings", "settings"],
  "mensaje_bienvenida": "mensaje personalizado 2-3 oraciones",
  "alertas_iniciales": ["alerta1"],
  "ahorro_recomendado": number
}

Reglas:
- Interpreta montos en texto (ej: "2 millones" = 2000000, "500 mil" = 500000)
- Si menciona deuda → incluir tab "deuda" en tabs
- Si menciona meta de ahorro grande (casa, carro, viaje) → incluir tab "plan"
- Siempre incluir: dashboard, ai, transactions, settings
- NO inventes datos que el usuario no mencionó`;

    const userMsg = `Datos del onboarding:
Ingreso: ${obData.intro}
Gastos fijos: ${obData.gastos}
Deuda: ${obData.deuda}
Ahorros/Cesantías/Meta: ${obData.ahorro}
Objetivo/Fecha/Disciplina: ${obData.objetivo}
Nombre del usuario: ${CURRENT_USER.displayName || 'Usuario'}`;

    const data = await callAI({
      messages: [{ role:'user', content: systemPrompt + '\n\n' + userMsg }],
      max_tokens: 1000,
    });

    hideObTyping();

    if (data.content?.[0]?.text) {
      let raw = data.content[0].text.trim();
      // Limpiar markdown si hay
      raw = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const parsed = JSON.parse(raw);

      // Aplicar perfil
      if (parsed.perfil) {
        PERFIL = { ...defaultPerfil(), ...PERFIL, ...parsed.perfil };
        PERFIL.nombre = CURRENT_USER.displayName || '';
      }

      // Aplicar tabs
      if (parsed.tabs) {
        APP_CONFIG.tabs = parsed.tabs;
      }

      // Guardar
      await Promise.all([
        window._db.saveProfile(CURRENT_USER.uid, PERFIL),
        window._db.saveConfig(CURRENT_USER.uid, APP_CONFIG),
      ]);

      // Mensaje final
      const bienvenida = parsed.mensaje_bienvenida || '¡Tu app está lista!';
      const alertas = (parsed.alertas_iniciales||[]).map(a => `• ${a}`).join('<br>');

      addObMsg('ai', `🎉 <strong>¡Listo, ${PERFIL.nombre || 'crack'}!</strong><br><br>${bienvenida}${alertas ? '<br><br>📌 <strong>Puntos clave detectados:</strong><br>'+alertas : ''}<br><br>Tu dashboard ya está configurado con los módulos que necesitas. ¡Empecemos! 🚀`);

      await delay(2200);
    }
  } catch(e) {
    hideObTyping();
    console.warn('Onboarding IA error:', e);
    addObMsg('ai', 'Tuve un pequeño problema al conectarme, pero no hay problema — voy a configurar tu app con los datos que me diste. ¡Ya casi estamos!');
    // Configuración manual básica
    APP_CONFIG.tabs = ['dashboard','ai','transactions','savings','settings'];
    if (PERFIL.deuda?.saldo > 0) APP_CONFIG.tabs.splice(3,0,'deuda');
    await delay(1500);
  }

  document.getElementById('onboardLayer').classList.remove('show');
  launchApp();
}

function skipOnboarding() {
  document.getElementById('onboardLayer').classList.remove('show');
  APP_CONFIG.tabs = ['dashboard','ai','transactions','savings','settings'];
  launchApp();
}

function rerunOnboarding() {
  closeUserMenu();
  CURRENT_USER.isNew = true;
  startOnboarding();
}

// ── VOICE ────────────────────────────────────────────────
function toggleMic() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('Tu navegador no soporta reconocimiento de voz','red'); return;
  }
  if (isRecording) {
    recognition?.stop();
    isRecording = false;
    document.getElementById('micBtn').classList.remove('rec');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'es-CO';
  recognition.interimResults = false;
  recognition.onresult = e => {
    const text = e.results[0][0].transcript;
    document.getElementById('obInput').value = text;
    sendOb();
  };
  recognition.onend = () => { isRecording=false; document.getElementById('micBtn').classList.remove('rec'); };
  recognition.start();
  isRecording = true;
  document.getElementById('micBtn').classList.add('rec');
  showToast('🎤 Escuchando...','blue');
}

// ============================================================
// APP LAUNCH
// ============================================================
function launchApp() {
  verificarGastosProgramados();
  buildNav();
  document.getElementById('appLayer').classList.add('show');
  switchTab('dashboard');
}

function buildNav() {
  const nav   = document.getElementById('mainNav');
  const tabs  = APP_CONFIG.tabs?.length ? APP_CONFIG.tabs : ALL_TABS.filter(t=>t.always).map(t=>t.id);
  const defs  = Object.fromEntries(ALL_TABS.map(t=>[t.id,t]));

  nav.innerHTML = tabs.map(id => {
    const t = defs[id];
    if (!t) return '';
    return `<div class="nav-tab" data-tab="${id}" onclick="switchTab('${id}')">${t.label}</div>`;
  }).join('');
}

function buildTabContent(tab) {
  const main = document.getElementById('mainContent');
  // Remove old section if exists
  const old = document.getElementById('tab-'+tab);
  if (old) old.remove();

  const sec = document.createElement('section');
  sec.className = 'tab-section';
  sec.id = 'tab-'+tab;
  sec.innerHTML = getTabHTML(tab);
  main.appendChild(sec);
}

function switchTab(tab) {
  // Build content lazily
  if (!document.getElementById('tab-'+tab)) buildTabContent(tab);

  document.querySelectorAll('.tab-section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+tab)?.classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

  if (tab==='dashboard')    renderDashboard();
  if (tab==='transactions') renderTransactions();
  if (tab==='reports')      renderReports();
  if (tab==='savings')      renderSavings();
  if (tab==='deuda')        renderDeuda();
  if (tab==='plan')         renderPlan();
  if (tab==='settings')     renderSettings();
  if (tab==='gastos-prog')  renderGastosProg();
  if (tab==='ai')           initAITab();
}

// ── TAB HTML TEMPLATES ───────────────────────────────────
function getTabHTML(tab) {
  switch(tab) {
    case 'dashboard': return `
      <div class="stats-grid">
        <div class="stat-card sc-blue"><div class="stat-label">Balance total</div><div class="stat-value" id="stBalance">$0</div></div>
        <div class="stat-card sc-green"><div class="stat-label">Ingresos este mes</div><div class="stat-value" style="color:var(--green)" id="stIng">$0</div></div>
        <div class="stat-card sc-red"><div class="stat-label">Gastos este mes</div><div class="stat-value" style="color:var(--red)" id="stEg">$0</div></div>
        <div class="stat-card sc-yellow"><div class="stat-label">Disponible</div><div class="stat-value" id="stDisp">$0</div></div>
        <div class="stat-card sc-purple"><div class="stat-label">Ahorro metas</div><div class="stat-value" style="color:var(--purple)" id="stAhorro">$0</div></div>
        <div class="stat-card sc-red"><div class="stat-label">Deuda TC</div><div class="stat-value" style="color:var(--red)" id="stDeuda">-</div></div>
      </div>
      <div id="dashAlertas"></div>
      <div class="two-col">
        <div class="card"><div class="card-title">Ingresos vs Gastos</div><div class="chart-wrap" style="max-height:220px"><canvas id="chartDonut"></canvas></div></div>
        <div class="card"><div class="card-title">Últimos movimientos</div><div id="recentList"></div></div>
      </div>
      <div class="card" id="dashMetaCard" style="display:none"><div class="card-title">🏠 Progreso — Meta de ahorro principal</div><div id="dashMetaContent"></div></div>
      <div style="text-align:center;margin-top:8px">
        <button class="btn btn-primary" onclick="switchTab('transactions')">+ Agregar movimiento</button>
        <button class="btn btn-ai" style="margin-left:8px" onclick="switchTab('ai')">🤖 Consultar IA</button>
      </div>`;

    case 'ai': return `
      <div class="ai-panel">
        <div class="ai-ph">
          <div class="ai-title">🤖 Asesor Financiero IA</div>
          <button class="btn btn-ghost btn-sm" onclick="clearChat()">🗑 Limpiar</button>
        </div>
        <div class="q-btns">
          <button class="q-btn" onclick="qAsk('Analiza mi situación financiera completa')">📊 Análisis completo</button>
          <button class="q-btn" onclick="qAsk('Dame un plan de ahorro para este mes')">💡 Plan mensual</button>
          <button class="q-btn" onclick="qAsk('¿Cuándo termino de pagar mi deuda?')">💳 Estado deuda</button>
          <button class="q-btn" onclick="qAsk('¿Cómo voy con mi meta principal?')">🎯 Estado meta</button>
          <button class="q-btn" onclick="qAsk('¿Qué gastos puedo reducir?')">✂️ Reducir gastos</button>
          <button class="q-btn" onclick="qAsk('Dame estrategias para ahorrar más agresivamente')">🚀 Ahorro agresivo</button>
        </div>
        <div class="ai-msgs" id="aiMsgs"><div class="ai-msg assistant"><div class="ai-ml">🤖 Asesor IA</div>Hola! Tengo acceso a todos tus datos financieros. ¿Qué quieres analizar?</div></div>
        <div class="ai-ir">
          <textarea id="aiInput" placeholder="Pregunta sobre tus finanzas..." rows="1" onkeydown="aiEnter(event)"></textarea>
          <button class="btn btn-ai" onclick="sendAI()">Enviar</button>
        </div>
      </div>`;

    case 'transactions': return `
      <div class="card">
        <div class="card-title" id="formTitle">Agregar movimiento</div>
        <div class="form-grid">
          <div class="form-group" style="grid-column:span 2"><label class="form-label">Descripción</label><input type="text" id="txDesc" placeholder="Ej: Supermercado, Sueldo..."></div>
          <div class="form-group"><label class="form-label">Monto</label><input type="number" id="txMonto" min="0"></div>
          <div class="form-group"><label class="form-label">Fecha</label><input type="date" id="txFecha"></div>
          <div class="form-group"><label class="form-label">Tipo</label>
            <select id="txTipo"><option value="">Seleccionar...</option><option value="ingreso">Ingreso</option><option value="gasto">Egreso</option></select></div>
          <div class="form-group"><label class="form-label">Categoría</label>
            <select id="txCat"><option value="">Seleccionar...</option>
              <option value="sueldo">Sueldo</option><option value="comida">Comida</option><option value="transporte">Transporte</option>
              <option value="servicios">Servicios</option><option value="arriendo">Arriendo</option><option value="deuda">Deuda/TC</option>
              <option value="ahorro">Ahorro</option><option value="educacion">Educación</option><option value="salud">Salud</option>
              <option value="familia">Familia</option><option value="mascota">Mascota</option><option value="ocio">Ocio</option>
              <option value="otros">Otros</option></select></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="btnGuardar" onclick="addTx()">+ Agregar</button>
          <button class="btn btn-danger btn-sm" id="btnCancelarEdit" onclick="cancelEdit()" style="display:none">✕ Cancelar</button>
        </div>
      </div>
      <div class="card"><div class="card-title">Filtrar</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Fecha</label><input type="date" id="filtFecha" onchange="applyFilters()"></div>
          <div class="form-group"><label class="form-label">Categoría</label>
            <select id="filtCat" onchange="applyFilters()"><option value="">Todas</option>
              <option value="sueldo">Sueldo</option><option value="comida">Comida</option><option value="transporte">Transporte</option>
              <option value="servicios">Servicios</option><option value="arriendo">Arriendo</option><option value="deuda">Deuda/TC</option>
              <option value="ahorro">Ahorro</option><option value="educacion">Educación</option><option value="salud">Salud</option>
              <option value="familia">Familia</option><option value="mascota">Mascota</option><option value="ocio">Ocio</option>
              <option value="otros">Otros</option></select></div>
          <div class="form-group"><label class="form-label">Tipo</label>
            <select id="filtTipo" onchange="applyFilters()"><option value="">Todos</option><option value="ingreso">Ingresos</option><option value="gasto">Egresos</option></select></div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="clearFilters()">🧹 Limpiar</button>
      </div>
      <div class="card"><div class="sec-hdr"><div class="card-title" style="margin-bottom:0">Movimientos</div><span id="txCount" style="font-size:12px;color:var(--text2)"></span></div><div id="txList"></div></div>`;

    case 'deuda': return `
      <div class="card">
        <div class="sec-hdr">
          <div class="card-title" style="margin-bottom:0">💳 Mis deudas</div>
          <button class="btn btn-primary btn-sm" onclick="abrirModalDeuda()">+ Nueva deuda</button>
        </div>
        <div id="deudaListado" style="margin-top:12px"></div>
      </div>
      <div id="deudaDetalle"></div>`;

    case 'plan': return `
      <div class="card"><div class="card-title">🏠 Parámetros Plan Apartamento</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Cesantías hoy ($)</label><input type="number" id="pCesH" onchange="recalcPlan()"></div>
          <div class="form-group"><label class="form-label">Cesantías objetivo ($)</label><input type="number" id="pCesF" onchange="recalcPlan()"></div>
          <div class="form-group"><label class="form-label">Ahorro fase 1 ($/mes)</label><input type="number" id="pAF1" onchange="recalcPlan()"></div>
          <div class="form-group"><label class="form-label">Ahorro fase 2 ($/mes)</label><input type="number" id="pAF2" onchange="recalcPlan()"></div>
          <div class="form-group"><label class="form-label">Meses fase 1</label><input type="number" id="pMF1" onchange="recalcPlan()"></div>
          <div class="form-group"><label class="form-label">Valor apartamento ($)</label><input type="number" id="pValor" onchange="recalcPlan()"></div>
        </div>
      </div>
      <div id="planRes"></div>
      <div class="card"><div class="card-title">📅 Proyección mes a mes</div><div style="overflow-x:auto"><table class="plan-t" id="planT"></table></div></div>
      <div class="card"><div class="card-title">🗺️ Hoja de ruta</div><div id="planTL"></div></div>`;

    case 'reports': return `
      <div class="card">
        <div class="sec-hdr">
          <div class="card-title" style="margin-bottom:0">Resumen mensual</div>
          <div class="btn-row"><input type="month" id="repMes" onchange="renderResumenMes(this.value)" style="width:auto"><button class="btn btn-success btn-sm" onclick="exportCSV()">⬇ CSV</button></div>
        </div>
        <div id="resumenMes"></div>
      </div>
      <div class="card"><div class="card-title">Tendencia — 6 meses</div><div class="chart-wrap"><canvas id="chartTrend"></canvas></div></div>
      <div class="card"><div class="card-title">Gastos por categoría</div><div class="chart-wrap"><canvas id="chartBars"></canvas></div></div>`;

    case 'savings': return `
      <div class="sec-hdr"><div class="sec-title">Metas de ahorro</div><button class="btn btn-primary" onclick="openModalMeta()">+ Nueva meta</button></div>
      <div id="metasList"></div>`;

    case 'gastos-prog': return `
      <div class="card">
        <div class="sec-hdr">
          <div class="card-title" style="margin-bottom:0">🔄 Gastos programados</div>
          <button class="btn btn-primary btn-sm" onclick="abrirModalGastoProg()">+ Agregar</button>
        </div>
        <p style="font-size:12px;color:var(--text3);margin:8px 0 16px">Se ejecutan automáticamente en la fecha configurada y se registran como movimientos.</p>
        <div id="gastoProgList"></div>
      </div>
      <div class="card" id="gastoProgProxCard" style="display:none">
        <div class="card-title">📅 Próximas ejecuciones</div>
        <div id="gastoProgProx"></div>
      </div>`;

    case 'settings': return `
      <div class="card"><div class="card-title">Perfil financiero</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Ingreso mensual neto ($)</label><input type="number" id="cfgIngreso" onchange="saveConfig()"></div>
          <div class="form-group"><label class="form-label">Límite de ocio mensual ($)</label><input type="number" id="cfgOcio" onchange="saveConfig()"></div>
        </div>
        <div id="cfgGastosFijos"></div>
      </div>
      <div class="card"><div class="card-title">🤖 Motor de Inteligencia Artificial</div>
        <p style="color:var(--text2);font-size:13px;margin-bottom:14px">Elige qué IA responde en el asesor y el onboarding.</p>
        <div class="form-group" style="margin-bottom:16px">
          <label class="form-label">Proveedor de IA activo</label>
          <select id="cfgAiProvider" onchange="saveConfig()" style="width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg2);color:var(--text);font-size:14px;cursor:pointer">
            <option value="claude">🟣 Claude (Anthropic) — Sonnet 4</option>
            <option value="openai">🟢 ChatGPT (OpenAI) — GPT-4o</option>
          </select>
        </div>
        <div id="aiProviderBadge" style="font-size:12px;color:var(--text2);margin-bottom:16px"></div>
        <button class="btn btn-ai" onclick="rerunOnboarding()">🤖 Re-configurar app</button>
      </div>
      <div class="card"><div class="card-title">Datos</div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="exportJSON()">⬇ Backup</button>
          <button class="btn btn-ghost" onclick="importJSON()">⬆ Importar</button>
          <button class="btn btn-success btn-sm" onclick="exportCSV()">⬇ CSV</button>
        </div>
        <input type="file" id="impFile" accept=".json" onchange="importJSONFile(event)" style="display:none">
      </div>
      <div class="card" style="border-color:rgba(255,79,109,.3)"><div class="card-title" style="color:var(--red)">Zona de peligro</div>
        <button class="btn btn-danger" onclick="clearAll()">🗑 Eliminar todos los datos</button>
      </div>`;

    default: return '<p style="color:var(--text2);padding:20px">Módulo en construcción.</p>';
  }
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const mes = mesActual();
  const gMes = gastos.filter(g=>g.fecha?.startsWith(mes));
  const ing  = gMes.filter(g=>g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0);
  const eg   = gMes.filter(g=>g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);
  const bal  = gastos.reduce((a,g)=>g.tipo==='ingreso'?a+g.monto:a-g.monto,0);
  const totalAhorro = metas.reduce((s,m)=>s+m.ahorrado,0);
  const disponible  = (PERFIL.ingresoMensual||0) - Object.values(PERFIL.gastosFijos||{}).reduce((a,b)=>a+b,0) - (PERFIL.deuda?.cuota||0);

  setText('stBalance', fmt(bal), bal>=0?'var(--green)':'var(--red)');
  setText('stIng',     fmt(ing));
  setText('stEg',      fmt(eg));
  setText('stDisp',    fmt(disponible>0?disponible:0), disponible>=0?'var(--green)':'var(--red)');
  setText('stAhorro',  fmt(totalAhorro));
  if (PERFIL.deuda?.saldo > 0) setText('stDeuda', fmt(PERFIL.deuda.saldo), 'var(--red)');
  else setText('stDeuda', '✓ Sin deuda', 'var(--green)');

  renderAlertas();
  buildDonut();

  const recent = [...gastos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).slice(0,6);
  const rl = document.getElementById('recentList');
  if(rl) { rl.innerHTML = recent.length?'':'<div class="empty-st"><div class="empty-icon">📋</div><p>Sin movimientos</p></div>'; recent.forEach(g=>rl.appendChild(buildTxRow(g,null,true))); }

  // Meta principal
  const metaCard = document.getElementById('dashMetaCard');
  const metaContent = document.getElementById('dashMetaContent');
  if (metas.length && metaCard && metaContent) {
    metaCard.style.display = 'block';
    const m = metas[0];
    const pct = Math.min(Math.round(m.ahorrado/m.total*100),100);
    metaContent.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:500">${esc(m.nombre)}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--blue)">${pct}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--blue),var(--green))"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-top:6px">
        <span>${fmt(m.ahorrado)} ahorrados</span><span>Meta: ${fmt(m.total)}</span>
      </div>`;
  }
}

function renderAlertas() {
  const c = document.getElementById('dashAlertas'); if(!c) return;
  const alertas = [];
  const mes = mesActual();
  const gMes = gastos.filter(g=>g.fecha?.startsWith(mes));
  const ocio = gMes.filter(g=>g.categoria==='ocio'&&g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);

  if (PERFIL.deuda?.saldo > 0) alertas.push({ tipo:'danger', ico:'💳', t:`Deuda activa: ${fmt(PERFIL.deuda.saldo)}`, d:`Paga ${fmt(PERFIL.deuda.cuota||0)}/mes. Cada mes en intereses: ~${fmt(Math.round((PERFIL.deuda.saldo||0)*0.01546))}.` });
  if (ocio > (APP_CONFIG.limiteOcio||500000)) alertas.push({ tipo:'warning', ico:'⚠️', t:'Límite de ocio superado', d:`Gastaste ${fmt(ocio)} en ocio este mes (límite: ${fmt(APP_CONFIG.limiteOcio||500000)}).` });
  const ahorroMes = gMes.filter(g=>g.categoria==='ahorro').reduce((s,g)=>s+g.monto,0);
  if (ahorroMes>0) alertas.push({ tipo:'success', ico:'✅', t:`Ahorraste ${fmt(ahorroMes)} este mes`, d:'¡Vas bien! Sigue así.' });
  else if (new Date().getDate()>10) alertas.push({ tipo:'info', ico:'🎯', t:'Sin ahorro registrado este mes', d:'Recuerda abonar a tu meta de ahorro.' });

  c.innerHTML = alertas.slice(0,3).map(a=>`
    <div class="al-item ${a.tipo}">
      <span>${a.ico}</span>
      <div><div class="al-t">${a.t}</div><div class="al-d">${a.d}</div></div>
    </div>`).join('');
}

function buildDonut() {
  const ctx = document.getElementById('chartDonut')?.getContext('2d'); if(!ctx)return;
  const ing = gastos.filter(g=>g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0);
  const eg  = gastos.filter(g=>g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);
  if(chartDonut)chartDonut.destroy();
  if(!ing&&!eg)return;
  chartDonut = new Chart(ctx,{ type:'doughnut', data:{ labels:['Ingresos','Gastos'], datasets:[{data:[ing,eg],backgroundColor:['#00e5a0','#ff4f6d'],borderWidth:0,hoverOffset:6}] },
    options:{ responsive:true, maintainAspectRatio:true, cutout:'68%',
      plugins:{ legend:{position:'bottom',labels:{color:'#8892c4',font:{size:12},padding:16}}, tooltip:{callbacks:{label:c=>' '+fmt(c.raw)}} } } });
}

// ============================================================
// DEUDA TC
// ============================================================
function renderDeuda() {
  // Populate inputs from perfil
  const d = PERFIL.deuda || {};
  setVal('dSaldo',  d.saldo||0);
  setVal('dCuota',  d.cuota||750000);
  setVal('dTasa',   ((d.tasa||0.01546)*100).toFixed(3));
  setVal('dManejo', d.manejo||36000);
  recalcDeuda();
}

function recalcDeuda() {
  const saldo  = +getVal('dSaldo')  || 0;
  const cuota  = +getVal('dCuota')  || 750000;
  const tasa   = (+getVal('dTasa')  || 1.546)/100;
  const manejo = +getVal('dManejo') || 36000;

  // Amortizar
  const rows = []; let s=saldo, intTotal=0, manejoTotal=0;
  const mLabels = ['Abr 2025','May 2025','Jun 2025','Jul 2025','Ago 2025','Sep 2025','Oct 2025','Nov 2025','Dic 2025','Ene 2026','Feb 2026','Mar 2026'];
  for(let i=0;i<24&&s>0;i++){
    const int=Math.round(s*tasa);
    const abono=Math.max(0,cuota-int-manejo);
    intTotal+=int; manejoTotal+=manejo;
    s=Math.max(0,s-abono);
    rows.push({ mes:mLabels[i]||`Mes ${i+1}`, si:s+abono, int, manejo, abono, sf:s });
    if(s===0)break;
  }

  const res = document.getElementById('deudaRes');
  if(res) res.innerHTML = `
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-card sc-red"><div class="stat-label">Saldo</div><div class="stat-value" style="color:var(--red)">${fmt(saldo)}</div></div>
      <div class="stat-card sc-yellow"><div class="stat-label">Tasa mensual</div><div class="stat-value" style="color:var(--yellow)">${(tasa*100).toFixed(3)}%</div><div class="stat-sub">${((Math.pow(1+tasa,12)-1)*100).toFixed(1)}% EA</div></div>
      <div class="stat-card sc-blue"><div class="stat-label">Meses para liquidar</div><div class="stat-value" style="color:var(--blue)">${rows.length}</div><div class="stat-sub">${rows[rows.length-1]?.mes||''}</div></div>
      <div class="stat-card sc-red"><div class="stat-label">Costo total</div><div class="stat-value" style="color:var(--red)">${fmt(intTotal+manejoTotal)}</div></div>
    </div>
    <div class="box-y">⚡ Subir el pago a ${fmt(cuota+50000)}/mes te ahorra ~${fmt(Math.round((intTotal+manejoTotal)*0.12))} y liquida ~1 mes antes.</div>`;

  const t = document.getElementById('amortT');
  if(t) t.innerHTML = `<thead><tr><th>Mes</th><th>Saldo inicio</th><th>Interés</th><th>Manejo</th><th>Abono capital</th><th>Saldo final</th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="${r.sf===0?'hl':''}">
      <td>${r.mes}</td><td>${fmt(r.si)}</td>
      <td style="color:var(--red)">-${fmt(r.int)}</td>
      <td style="color:var(--yellow)">-${fmt(r.manejo)}</td>
      <td style="color:var(--green)">+${fmt(r.abono)}</td>
      <td style="color:${r.sf===0?'var(--green)':'var(--red)'}">${r.sf===0?'✓ $0':fmt(r.sf)}</td>
    </tr>`).join('')}</tbody>`;

  const esc = document.getElementById('escenarios');
  if(esc){
    const scenarios=[{l:'Actual',c:cuota},{l:`+${fmt(50000)}`,c:cuota+50000},{l:`+${fmt(250000)}`,c:cuota+250000}].map(sc=>{
      let s2=saldo,m2=0,ci=0; for(let i=0;i<36&&s2>0;i++){const int=Math.round(s2*tasa);ci+=int+manejo;s2=Math.max(0,s2-Math.max(0,sc.c-int-manejo));m2++;}
      return {...sc,meses:m2,costo:ci};
    });
    esc.innerHTML=`<table class="amort-t"><thead><tr><th>Escenario</th><th>Cuota</th><th>Meses</th><th>Costo total</th><th>Ahorro</th></tr></thead>
      <tbody>${scenarios.map((sc,i)=>`<tr class="${i>0?'hl':''}">
        <td>${sc.l}</td><td>${fmt(sc.c)}</td><td>${sc.meses}</td>
        <td style="color:var(--red)">-${fmt(sc.costo)}</td>
        <td style="color:var(--green)">${i===0?'—':'+'+fmt(scenarios[0].costo-sc.costo)}</td>
      </tr>`).join('')}</tbody></table>`;
  }
}

// ============================================================
// PLAN APARTAMENTO
// ============================================================
function renderPlan() {
  const ces = PERFIL.cesantias||{};
  const ap  = PERFIL.metaApartamento||{};
  const d   = PERFIL.deuda||{};
  const disp = Math.max(0,(PERFIL.ingresoMensual||0) - Object.values(PERFIL.gastosFijos||{}).reduce((a,b)=>a+b,0) - (d.cuota||0));
  const aF2  = Math.round(disp * 0.7);

  setVal('pCesH',  ces.hoy||18800000);
  setVal('pCesF',  ces.feb2027||6570000);
  setVal('pAF1',   Math.max(0, disp - (d.cuota||750000)));
  setVal('pAF2',   aF2);
  setVal('pMF1',   8);
  setVal('pValor', ap.valor||250000000);
  recalcPlan();
}

function recalcPlan() {
  const cesH  = +getVal('pCesH')  || 18800000;
  const cesF  = +getVal('pCesF')  || 6570000;
  const aF1   = +getVal('pAF1')   || 1268000;
  const aF2   = +getVal('pAF2')   || 2018000;
  const mF1   = +getVal('pMF1')   || 8;
  const valor = +getVal('pValor') || 250000000;
  const ci30  = valor * 0.3;
  const mF2   = 22-mF1;
  const totalA= metas.reduce((s,m)=>s+m.ahorrado,0);
  const totalFinal = cesH+cesF+(aF1*mF1)+(aF2*mF2)+totalA;
  const falta = Math.max(0,ci30-totalFinal);
  const pct   = Math.min(100,Math.round(totalFinal/ci30*100));

  const res = document.getElementById('planRes');
  if(res) res.innerHTML=`
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-card sc-blue"><div class="stat-label">Cesantías</div><div class="stat-value" style="color:var(--blue)">${fmt(cesH+cesF)}</div></div>
      <div class="stat-card sc-green"><div class="stat-label">Ahorro proyectado</div><div class="stat-value" style="color:var(--green)">${fmt(aF1*mF1+aF2*mF2)}</div></div>
      <div class="stat-card sc-purple"><div class="stat-label">Total feb 2027</div><div class="stat-value" style="color:var(--purple)">${fmt(totalFinal)}</div></div>
      <div class="stat-card ${falta<=0?'sc-green':'sc-yellow'}"><div class="stat-label">Meta 30% cuota inicial</div><div class="stat-value" style="color:${falta<=0?'var(--green)':'var(--yellow)'}">${falta<=0?'✓ OK':'-'+fmt(falta)}</div></div>
    </div>
    <div class="progress-bar" style="height:10px;margin-bottom:8px"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--blue),var(--green))"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:12px"><span>${pct}% de cuota inicial</span><span>Apartamento: ${fmt(valor)}</span></div>
    ${falta<=0?`<div class="box-g">✅ ¡Meta alcanzable! Tendrás ${fmt(totalFinal)} para febrero 2027.</div>`
              :`<div class="box-y">⚠️ Te faltan ${fmt(falta)} para la cuota del 30%. Considera un apartamento de ${fmt(Math.round(totalFinal/0.3))} o aumenta el ahorro en fase 2.</div>`}`;

  // Tabla
  const t = document.getElementById('planT');
  if(t){
    const meses=['Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene'];
    const años  =[2025,2025,2025,2025,2025,2025,2025,2025,2025,2026,2026,2026,2026,2026,2026,2026,2026,2026,2026,2026,2026,2027];
    let acum=cesH+totalA;
    t.innerHTML=`<thead><tr><th>Mes</th><th>Fase</th><th>Ahorro</th><th>Acumulado</th><th>Nota</th></tr></thead><tbody>`+
      Array.from({length:22},(_,i)=>{
        const f=i<mF1?1:2; const a=f===1?aF1:aF2; acum+=a;
        const nota=i===mF1-1?'🎉 TC liquidada':i===21?'🏠 Compra':'';
        return `<tr><td style="font-family:'DM Mono',monospace;font-size:11px">${meses[i]} ${años[i]}</td>
          <td><span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${f===1?'var(--red-dim)':'var(--green-dim)'};color:${f===1?'var(--red)':'var(--green)'}">F${f}</span></td>
          <td style="color:var(--green);font-family:'DM Mono',monospace">+${fmt(a)}</td>
          <td style="font-family:'DM Mono',monospace">${fmt(acum)}</td>
          <td style="font-size:12px;color:var(--text2)">${nota}</td></tr>`;
      }).join('')+`<tr><td style="font-family:'DM Mono',monospace;font-size:11px">Feb 2027</td><td>—</td><td style="color:var(--blue);font-family:'DM Mono',monospace">+${fmt(cesF)} ces.</td><td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--blue)">${fmt(acum+cesF)}</td><td>🏆 Total</td></tr></tbody>`;
  }

  // Timeline
  const tl = document.getElementById('planTL');
  if(tl) tl.innerHTML=`<div class="tl">
    <div class="tl-i"><div class="tl-d" style="background:var(--red)"></div><div class="tl-mo">Ahora → Mes ${mF1}</div><div class="tl-t">Fase 1 — Liquidar la Deuda</div><div class="tl-desc">Paga religiosamente la TC cada mes · Ahorra ${fmt(aF1)}/mes aparte · No uses la tarjeta</div></div>
    <div class="tl-i"><div class="tl-d" style="background:var(--yellow)"></div><div class="tl-mo">Mes ${mF1+1} → Mes 18</div><div class="tl-t">Fase 2 — Turbo Ahorro</div><div class="tl-desc">Deuda liquidada · Ahorra ${fmt(aF2)}/mes · Investiga proyectos y zonas</div></div>
    <div class="tl-i"><div class="tl-d" style="background:var(--blue)"></div><div class="tl-mo">Mes 18 → 22</div><div class="tl-t">Fase 3 — Pre-compra</div><div class="tl-desc">Pre-aprobación bancaria · Reúne documentos · Visita apartamentos · Negocia</div></div>
    <div class="tl-i"><div class="tl-d" style="background:var(--green)"></div><div class="tl-mo">Febrero 2027</div><div class="tl-t">🏠 ¡Compra del Apartamento!</div><div class="tl-desc">Total disponible: ${fmt(acum+cesF)} · Cuota inicial (30%): ${fmt(ci30)} · Gastos notariales ~1.5%: ${fmt(Math.round(valor*0.015))}</div></div>
  </div>`;
}

// ============================================================
// TRANSACTIONS
// ============================================================
function renderTransactions() {
  const f = document.getElementById('txFecha'); if(f&&!f.value) f.value=todayStr();
  applyFilters();
}
async function addTx() {
  const desc = document.getElementById('txDesc')?.value.trim();
  const monto= +document.getElementById('txMonto')?.value;
  const tipo = document.getElementById('txTipo')?.value;
  const cat  = document.getElementById('txCat')?.value;
  const fecha= document.getElementById('txFecha')?.value;
  if(!desc||!monto||monto<=0||!tipo||!cat||!fecha){ showToast('Completa todos los campos','red'); return; }
  const entry = { id: Date.now(), descripcion:desc, monto, tipo, categoria:cat, fecha };
  if(indexEditando!==null){ gastos[indexEditando]=entry; indexEditando=null; resetTxForm(); }
  else { gastos.push(entry); }
  try {
    await saveData();
    showToast(indexEditando!==null?'Actualizado ✓':'Agregado ✓', indexEditando!==null?'blue':'green');
  } catch(e) {
    console.error('Error guardando:', e);
    showToast('Error al guardar. Revisa la consola.','red');
    return;
  }
  applyFilters();
}
function editTx(i){ const g=gastos[i]; setVal('txDesc',g.descripcion); setVal('txMonto',g.monto); setVal('txTipo',g.tipo); setVal('txCat',g.categoria); setVal('txFecha',g.fecha); indexEditando=i; document.getElementById('btnGuardar').textContent='💾 Guardar'; document.getElementById('btnCancelarEdit').style.display='inline-flex'; document.getElementById('formTitle').textContent='Editar movimiento'; document.getElementById('txDesc')?.focus(); }
function deleteTx(i){ if(!confirm('¿Eliminar?'))return; gastos.splice(i,1); saveData(); applyFilters(); showToast('Eliminado','red'); }
function cancelEdit(){ indexEditando=null; resetTxForm(); }
function resetTxForm(){ ['txDesc','txMonto','txTipo','txCat'].forEach(id=>setVal(id,'')); setVal('txFecha',todayStr()); if(document.getElementById('btnGuardar'))document.getElementById('btnGuardar').textContent='+ Agregar'; if(document.getElementById('btnCancelarEdit'))document.getElementById('btnCancelarEdit').style.display='none'; if(document.getElementById('formTitle'))document.getElementById('formTitle').textContent='Agregar movimiento'; }
function applyFilters(){
  const ff=document.getElementById('filtFecha')?.value; const fc=document.getElementById('filtCat')?.value; const ft=document.getElementById('filtTipo')?.value;
  const res=gastos.map((g,i)=>({g,i})).filter(({g})=>{if(ff&&g.fecha!==ff)return false;if(fc&&g.categoria!==fc)return false;if(ft&&g.tipo!==ft)return false;return true;}).sort((a,b)=>new Date(b.g.fecha)-new Date(a.g.fecha));
  const list=document.getElementById('txList'); const count=document.getElementById('txCount');
  if(!list)return;
  if(count)count.textContent=res.length+' movimiento'+(res.length!==1?'s':'');
  list.innerHTML='';
  if(!res.length){ list.innerHTML='<div class="empty-st"><div class="empty-icon">🔍</div><p>Sin movimientos</p></div>'; return; }
  res.forEach(({g,i})=>list.appendChild(buildTxRow(g,i,false)));
}
function clearFilters(){ ['filtFecha','filtCat','filtTipo'].forEach(id=>setVal(id,'')); applyFilters(); }
function buildTxRow(g,index,readonly){
  const div=document.createElement('div'); div.className='tx-item';
  const isI=g.tipo==='ingreso'; const color=isI?'var(--green)':'var(--red)';
  div.innerHTML=`<div class="tx-dot" style="background:${catColor(g.categoria)}"></div>
    <div class="tx-info"><div class="tx-desc">${esc(g.descripcion)}</div><div class="tx-meta">${g.fecha} · ${g.categoria}</div></div>
    <div class="tx-amount" style="color:${color}">${isI?'+':'−'}${fmt(g.monto)}</div>
    ${readonly?'':`<div class="tx-actions"><button class="btn-icon" onclick="editTx(${index})">✏️</button><button class="btn-icon" onclick="deleteTx(${index})">🗑️</button></div>`}`;
  return div;
}

// ============================================================
// REPORTS
// ============================================================
function renderReports(){ const el=document.getElementById('repMes'); if(el&&!el.value)el.value=mesActual(); if(el)renderResumenMes(el.value); buildChartBars(); buildChartTrend(); }
function renderResumenMes(mes){
  if(!mes)return;
  const gm=gastos.filter(g=>g.fecha?.startsWith(mes));
  const ing=gm.filter(g=>g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0);
  const eg=gm.filter(g=>g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);
  const [y,m]=mes.split('-'); const nom=new Date(y,m-1).toLocaleString('es',{month:'long',year:'numeric'});
  const porCat={};gm.filter(g=>g.tipo==='gasto').forEach(g=>{porCat[g.categoria]=(porCat[g.categoria]||0)+g.monto;});
  const catH=Object.entries(porCat).length?Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([cat,tot])=>{const pct=eg>0?Math.round(tot/eg*100):0;return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${catColor(cat)};display:inline-block"></span>${cat}</span><span>${fmt(tot)} <span style="color:var(--text2)">(${pct}%)</span></span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${catColor(cat)}"></div></div></div>`;}).join(''):'<p style="color:var(--text2);font-size:13px">Sin gastos</p>';
  const el=document.getElementById('resumenMes'); if(!el)return;
  el.innerHTML=`<p style="font-size:14px;font-weight:600;margin-bottom:14px;text-transform:capitalize">${nom}</p>
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card sc-green"><div class="stat-label">Ingresos</div><div class="stat-value" style="font-size:19px;color:var(--green)">${fmt(ing)}</div></div>
      <div class="stat-card sc-red"><div class="stat-label">Egresos</div><div class="stat-value" style="font-size:19px;color:var(--red)">${fmt(eg)}</div></div>
      <div class="stat-card sc-blue"><div class="stat-label">Balance</div><div class="stat-value" style="font-size:19px;color:${ing-eg>=0?'var(--green)':'var(--red)'}">${fmt(ing-eg)}</div></div>
      <div class="stat-card"><div class="stat-label">Movimientos</div><div class="stat-value">${gm.length}</div></div>
    </div><div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:12px">Gastos por categoría</div>${catH}`;
}
function buildChartBars(){ const cats={};gastos.filter(g=>g.tipo==='gasto').forEach(g=>{cats[g.categoria]=(cats[g.categoria]||0)+g.monto;});const labels=Object.keys(cats);const data=Object.values(cats);const ctx=document.getElementById('chartBars')?.getContext('2d');if(!ctx)return;if(chartBars)chartBars.destroy();if(!labels.length)return;chartBars=new Chart(ctx,{type:'bar',data:{labels:labels.map(l=>l.charAt(0).toUpperCase()+l.slice(1)),datasets:[{label:'Total',data,backgroundColor:labels.map(catColor),borderRadius:6,borderSkipped:false}]},options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' '+fmt(c.raw)}}},scales:{x:{ticks:{color:'#8892c4'},grid:{color:'#1e2440'}},y:{ticks:{color:'#8892c4',callback:v=>'$'+v.toLocaleString()},grid:{color:'#1e2440'}}}}});}
function buildChartTrend(){ const now=new Date();const months=[];for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;months.push({key,lbl:d.toLocaleString('es',{month:'short',year:'2-digit'})});}const ing=months.map(({key})=>gastos.filter(g=>g.fecha?.startsWith(key)&&g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0));const eg=months.map(({key})=>gastos.filter(g=>g.fecha?.startsWith(key)&&g.tipo==='gasto').reduce((s,g)=>s+g.monto,0));const ctx=document.getElementById('chartTrend')?.getContext('2d');if(!ctx)return;if(chartTrend)chartTrend.destroy();chartTrend=new Chart(ctx,{type:'line',data:{labels:months.map(m=>m.lbl),datasets:[{label:'Ingresos',data:ing,borderColor:'#00e5a0',backgroundColor:'rgba(0,229,160,.07)',fill:true,tension:.35,pointBackgroundColor:'#00e5a0',pointRadius:4},{label:'Gastos',data:eg,borderColor:'#ff4f6d',backgroundColor:'rgba(255,79,109,.07)',fill:true,tension:.35,pointBackgroundColor:'#ff4f6d',pointRadius:4}]},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#8892c4',font:{size:12}}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`}}},scales:{x:{ticks:{color:'#8892c4'},grid:{color:'#1e2440'}},y:{ticks:{color:'#8892c4',callback:v=>'$'+v.toLocaleString()},grid:{color:'#1e2440'}}}}});}

// ============================================================
// SAVINGS
// ============================================================
function renderSavings(){ const c=document.getElementById('metasList');if(!c)return;c.innerHTML='';if(!metas.length){c.innerHTML='<div class="empty-st"><div class="empty-icon">🎯</div><p>Sin metas</p></div>';return;}metas.forEach((m,i)=>{const pct=Math.min(Math.round(m.ahorrado/m.total*100),100);const rest=Math.max(m.total-m.ahorrado,0);const div=document.createElement('div');div.className='meta-card';div.innerHTML=`<div class="meta-header"><div style="flex:1"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="width:10px;height:10px;border-radius:50%;background:${m.color||'#4f8eff'};display:inline-block"></span><strong>${esc(m.nombre)}</strong>${pct>=100?'<span style="color:var(--green);font-size:12px">🎉</span>':''}</div><div style="font-size:12px;color:var(--text2)">${fmt(m.ahorrado)} / ${fmt(m.total)}${m.cuotaMensual?` · ${fmt(m.cuotaMensual)}/mes`:''}</div></div><div class="tx-actions"><button class="btn-icon" onclick="openAbonar(${i})">💰</button><button class="btn-icon" onclick="editMeta(${i})">✏️</button><button class="btn-icon" onclick="deleteMeta(${i})">🗑️</button></div></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${pct>=100?'var(--green)':pct>=60?'var(--yellow)':'var(--blue)'}"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-top:4px"><span>${pct}%</span><span>${rest>0?'Faltan '+fmt(rest):'¡Meta alcanzada!'}</span></div>`;c.appendChild(div);});}
function openModalMeta(e=null){ metaEditIdx=e;if(e!==null){const m=metas[e];setVal('metaNombre',m.nombre);setVal('metaTotal',m.total);setVal('metaCuotaSemanal',m.cuotaSemanal||'');setVal('metaCuotaMensual',m.cuotaMensual||'');setVal('metaColor',m.color||'#4f8eff');setVal('metaFechaObj',m.fechaObjetivo||'');document.getElementById('mmTitle').textContent='Editar meta';}else{['metaNombre','metaTotal','metaCuotaSemanal','metaCuotaMensual','metaFechaObj'].forEach(id=>setVal(id,''));setVal('metaColor','#4f8eff');document.getElementById('mmTitle').textContent='Nueva meta';}document.getElementById('modalMeta').classList.add('open');}
function cerrarModalMeta(){ document.getElementById('modalMeta').classList.remove('open'); }
function guardarMeta(){ const n=document.getElementById('metaNombre')?.value.trim();const tot=+document.getElementById('metaTotal')?.value;if(!n||!tot||tot<=0){showToast('Nombre y monto requeridos','red');return;}const obj={id:Date.now(),nombre:n,total:tot,ahorrado:metaEditIdx!==null?metas[metaEditIdx].ahorrado:0,cuotaSemanal:+document.getElementById('metaCuotaSemanal')?.value||0,cuotaMensual:+document.getElementById('metaCuotaMensual')?.value||0,color:document.getElementById('metaColor')?.value||'#4f8eff',fechaObjetivo:document.getElementById('metaFechaObj')?.value||'',abonos:metaEditIdx!==null?metas[metaEditIdx].abonos||[]:[]}; if(metaEditIdx!==null)metas[metaEditIdx]=obj;else metas.push(obj);saveData();cerrarModalMeta();renderSavings();showToast(metaEditIdx!==null?'Actualizada ✓':'Creada ✓','green');}
function editMeta(i){ openModalMeta(i); }
function deleteMeta(i){ if(!confirm('¿Eliminar?'))return;metas.splice(i,1);saveData();renderSavings();showToast('Eliminada','red');}
function openAbonar(i){ abonarIdx=i;const m=metas[i];document.getElementById('abonarNom').textContent=m.nombre;document.getElementById('abonarInfo').textContent=`Ahorrado: ${fmt(m.ahorrado)} / ${fmt(m.total)}`;setVal('abonarMonto',m.cuotaMensual||'');document.getElementById('modalAbonar').classList.add('open');}
function cerrarAbonar(){ document.getElementById('modalAbonar').classList.remove('open'); }
function confirmarAbono(){ const mon=+document.getElementById('abonarMonto')?.value;if(!mon||mon<=0){showToast('Ingresa monto','red');return;}const m=metas[abonarIdx];const prev=m.ahorrado;m.ahorrado=Math.min(m.ahorrado+mon,m.total);if(!m.abonos)m.abonos=[];m.abonos.push({fecha:todayStr(),monto:mon});saveData();cerrarAbonar();renderSavings();showToast(`+${fmt(mon)} ✓`,'green');if(prev<m.total&&m.ahorrado>=m.total)setTimeout(()=>showToast(`🎉 ¡Meta "${m.nombre}" alcanzada!`,'green'),600);}

// ============================================================
// SETTINGS
// ============================================================
function renderSettings(){
  setVal('cfgIngreso', PERFIL.ingresoMensual||0);
  setVal('cfgOcio', APP_CONFIG.limiteOcio||500000);
  setVal('cfgAiProvider', APP_CONFIG.aiProvider||'claude');
  const badge = document.getElementById('aiProviderBadge');
  if(badge){
    const p = APP_CONFIG.aiProvider||'claude';
    badge.innerHTML = p==='claude'
      ? '✅ Usando <strong>Claude Sonnet 4</strong> (Anthropic) — excelente para finanzas en español'
      : '✅ Usando <strong>GPT-4o</strong> (OpenAI) — modelo más reciente de ChatGPT';
  }
  const gf=document.getElementById('cfgGastosFijos');
  if(gf&&Object.keys(PERFIL.gastosFijos||{}).length){
    gf.innerHTML='<hr class="div"><div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:10px">Gastos fijos configurados</div>'+
      Object.entries(PERFIL.gastosFijos).map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--text2)">${k}</span><span style="font-family:'DM Mono',monospace;color:var(--red)">-${fmt(v)}</span></div>`).join('')+
      `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:600"><span>Total fijos</span><span style="font-family:'DM Mono',monospace;color:var(--red)">-${fmt(Object.values(PERFIL.gastosFijos).reduce((a,b)=>a+b,0))}</span></div>`;
  }
}
async function saveConfig(){
  const ing=+getVal('cfgIngreso'); if(ing>0)PERFIL.ingresoMensual=ing;
  const oc=+getVal('cfgOcio'); if(oc>0)APP_CONFIG.limiteOcio=oc;
  const prov=getVal('cfgAiProvider'); if(prov)APP_CONFIG.aiProvider=prov;
  // Actualizar badge dinámicamente
  const badge=document.getElementById('aiProviderBadge');
  if(badge&&prov){badge.innerHTML=prov==='claude'?'✅ Usando <strong>Claude Sonnet 4</strong> (Anthropic) — excelente para finanzas en español':'✅ Usando <strong>GPT-4o</strong> (OpenAI) — modelo más reciente de ChatGPT';}
  await window._db.saveConfig(CURRENT_USER.uid, APP_CONFIG);
  await window._db.saveProfile(CURRENT_USER.uid, PERFIL);
  showToast('Configuración guardada ✓','green');
}

// ============================================================
// AI CHAT
// ============================================================
function initAITab(){
  const msgs=document.getElementById('aiMsgs');
  if(msgs&&msgs.children.length<=1&&PERFIL.ingresoMensual>0){
    // Auto-mensaje contextual
    const nombre=CURRENT_USER.displayName||'';
    addAIMsg('assistant',`Hola${nombre?', '+nombre:''}! 👋 Tengo acceso a todos tus datos. Tu ingreso es ${fmt(PERFIL.ingresoMensual)} y tienes ${Object.keys(PERFIL.gastosFijos).length} gastos fijos configurados. ¿En qué te ayudo hoy?`);
  }
}

function buildContexto(){
  const mes=mesActual();
  const gMes=gastos.filter(g=>g.fecha?.startsWith(mes));
  const ingMes=gMes.filter(g=>g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0);
  const egMes=gMes.filter(g=>g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);
  const totalAhorro=metas.reduce((s,m)=>s+m.ahorrado,0);
  const ultTx=[...gastos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).slice(0,15).map(g=>`${g.fecha}|${g.tipo==='ingreso'?'+':'-'}${fmt(g.monto)}|${g.categoria}|${g.descripcion}`).join('\n');
  const totalDeudas = (PERFIL.deudas||[]).reduce((s,d)=>s+d.saldo,0);
  const totalCuotas = (PERFIL.deudas||[]).reduce((s,d)=>s+d.cuota,0);
  const gastosFijosTotal = Object.values(PERFIL.gastosFijos||{}).reduce((a,b)=>a+b,0);
  const gastosProg = (APP_CONFIG.gastosProgramados||[]).filter(g=>g.activo).reduce((s,g)=>s+g.monto,0);
  const disponible = Math.max(0,(PERFIL.ingresoMensual||0)-gastosFijosTotal-totalCuotas-gastosProg);
  return `USUARIO: ${CURRENT_USER.displayName||''} (${CURRENT_USER.email||''})
INGRESO MENSUAL NETO: ${fmt(PERFIL.ingresoMensual)}
GASTOS FIJOS: ${JSON.stringify(PERFIL.gastosFijos)} (Total: ${fmt(gastosFijosTotal)})
GASTOS PROGRAMADOS ACTIVOS: ${(APP_CONFIG.gastosProgramados||[]).filter(g=>g.activo).map(g=>`${g.nombre}:${fmt(g.monto)}`).join(', ')||'ninguno'}
DEUDAS: ${(PERFIL.deudas||[]).map(d=>`${d.nombre}: saldo=${fmt(d.saldo)}, cuota=${fmt(d.cuota)}, tasa=${d.tasa}%`).join(' | ')||'ninguna'} (Total cuotas: ${fmt(totalCuotas)})
CESANTÍAS: ${fmt(PERFIL.cesantias?.hoy||0)}
META DE AHORRO: ${PERFIL.metaAhorro?.descripcion||'no definida'} → ${fmt(PERFIL.metaAhorro?.valor||0)} (${PERFIL.metaAhorro?.fecha||'sin fecha'})
DISPONIBLE MENSUAL ESTIMADO: ${fmt(disponible)}
MES ACTUAL: ingresos=${fmt(ingMes)}, egresos=${fmt(egMes)}, balance=${fmt(ingMes-egMes)}
METAS ACTIVAS: ${metas.map(m=>`${m.nombre}:${fmt(m.ahorrado)}/${fmt(m.total)}`).join(', ')||'ninguna'}
TOTAL AHORRADO EN METAS: ${fmt(totalAhorro)}
ÚLTIMAS TRANSACCIONES:\n${ultTx||'ninguna'}`;
}

async function sendAI(){
  const input=document.getElementById('aiInput'); const msg=input?.value.trim(); if(!msg)return;
  input.value='';
  addAIMsg('user',msg);
  chatHistory.push({role:'user',content:msg});
  showAITyping();
  try{
    const data = await callAI({
      system:`Eres un asesor financiero personal. Tienes acceso a los datos completos del usuario. Da consejos concretos con números exactos. Responde en español. Usa emojis. Máximo 300 palabras.

CAPACIDAD ESPECIAL: Puedes registrar movimientos financieros cuando el usuario lo pida. Cuando detectes una intención de registrar un movimiento (ej: "agrega un gasto", "registra un ingreso", "anota que gasté"), responde con un bloque JSON al FINAL de tu mensaje, así:
<ACTION>{"tipo":"gasto","monto":200000,"categoria":"comida","descripcion":"Almuerzo","fecha":"HOY"}</ACTION>

Categorías válidas: comida, transporte, servicios, arriendo, ocio, educacion, salud, deportes, deuda, ahorro, familia, mascota, otros, sueldo.
Si el usuario no especifica fecha, usa "HOY". Si no especifica categoría, infiere la más apropiada.
Solo incluye el bloque ACTION si el usuario explícitamente pide registrar algo.

DATA FINANCIERA:
${buildContexto()}`,
      messages:chatHistory.slice(-8),
      max_tokens:1000,
    });
    hideAITyping();
    if(data.content?.[0]?.text){
      let r = data.content[0].text;
      // Detectar y ejecutar acciones de registro
      const actionMatch = r.match(/<ACTION>(.*?)<\/ACTION>/s);
      if (actionMatch) {
        r = r.replace(/<ACTION>.*?<\/ACTION>/s, '').trim();
        try {
          const action = JSON.parse(actionMatch[1]);
          await ejecutarAccionIA(action);
        } catch(e) { console.warn('Action parse error:', e); }
      }
      chatHistory.push({role:'assistant',content:r});
      addAIMsg('assistant',r);
    }
    else addAIMsg('assistant','⚠️ Respuesta inesperada de la IA.');
  }catch(e){hideAITyping();addAIMsg('assistant','⚠️ '+e.message);}
}

function addAIMsg(role,text){
  const c=document.getElementById('aiMsgs');if(!c)return;
  const div=document.createElement('div');div.className=`ai-msg ${role}`;
  div.innerHTML=`<div class="ai-ml">${role==='user'?'👤 Tú':'🤖 Asesor IA'}</div>${text.replace(/\n/g,'<br>')}`;
  c.appendChild(div);c.scrollTop=c.scrollHeight;
}
function showAITyping(){const c=document.getElementById('aiMsgs');if(!c)return;const d=document.createElement('div');d.id='aiTyp';d.className='ai-typ';d.innerHTML='<div class="ai-typ-d"><span></span><span></span><span></span></div> Analizando...';c.appendChild(d);c.scrollTop=c.scrollHeight;}
function hideAITyping(){document.getElementById('aiTyp')?.remove();}
function qAsk(msg){const i=document.getElementById('aiInput');if(i)i.value=msg;sendAI();}
function aiEnter(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAI();}}
function clearChat(){chatHistory=[];const c=document.getElementById('aiMsgs');if(c)c.innerHTML='<div class="ai-msg assistant"><div class="ai-ml">🤖 Asesor IA</div>Chat limpiado. ¿En qué te ayudo?</div>';}

// ============================================================
// USER MENU
// ============================================================
function openUserMenu(){ document.getElementById('userMenu').classList.add('open'); }
function closeUserMenu(){ document.getElementById('userMenu').classList.remove('open'); }

// ============================================================
// PERSISTENCE
// ============================================================
async function saveData(){
  if(!CURRENT_USER)return;
  await Promise.all([
    window._db.saveGastos(CURRENT_USER.uid, gastos),
    window._db.saveMetas(CURRENT_USER.uid, metas),
  ]);
}

function exportJSON(){
  const payload=JSON.stringify({version:4,gastos,metas,PERFIL,APP_CONFIG,exportDate:new Date().toISOString()},null,2);
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([payload],{type:'application/json'})),download:`ahorrapp_${todayStr()}.json`});
  a.click(); showToast('Backup exportado ✓','green');
}
function importJSON(){ document.getElementById('impFile')?.click(); }
function importJSONFile(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async ev=>{
    try{const d=JSON.parse(ev.target.result);if(!Array.isArray(d.gastos))throw 0;
      if(!confirm(`¿Importar ${d.gastos.length} movimientos?`))return;
      gastos=d.gastos;metas=d.metas||[];if(d.PERFIL)Object.assign(PERFIL,d.PERFIL);if(d.APP_CONFIG)Object.assign(APP_CONFIG,d.APP_CONFIG);
      await saveData();switchTab('dashboard');showToast('Importado ✓','green');
    }catch{showToast('Error al leer archivo','red');}
  };
  r.readAsText(f);e.target.value='';
}
function exportCSV(){
  if(!gastos.length){showToast('Sin datos','red');return;}
  const rows=[['Fecha','Descripcion','Tipo','Categoria','Monto']];
  [...gastos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).forEach(g=>rows.push([g.fecha,`"${g.descripcion?.replace(/"/g,'""')}"`,g.tipo,g.categoria,g.monto]));
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\n')],{type:'text/csv;charset=utf-8;'})),download:`ahorrapp_${todayStr()}.csv`});
  a.click();showToast('CSV exportado ✓','green');
}
async function clearAll(){
  if(!confirm('¿Eliminar TODOS tus datos?'))return;
  if(!confirm('Última confirmación — es irreversible'))return;
  gastos=[];metas=[];
  await saveData();
  switchTab('dashboard');showToast('Datos eliminados','red');
}

// ============================================================
// AI PROXY HELPER — usa Cloudflare Worker como proxy seguro
// ⚠️ Reemplaza WORKER_URL con la URL de tu worker desplegado
// ============================================================
async function callAI({ system, messages, max_tokens = 1000 }) {
  const provider = APP_CONFIG.aiProvider || 'claude';
  const resp = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, max_tokens, provider }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Error ${resp.status} del servidor`);
  }
  return resp.json();
}



// ============================================================
// IA ACTIONS — registrar movimientos desde el chat
// ============================================================
async function ejecutarAccionIA(action) {
  if (!action.tipo || !action.monto) return;
  const fecha = action.fecha === 'HOY' ? todayStr() : (action.fecha || todayStr());
  const entry = {
    id: Date.now(),
    descripcion: action.descripcion || action.tipo,
    monto: Math.abs(action.monto),
    tipo: action.tipo === 'ingreso' ? 'ingreso' : 'gasto',
    categoria: action.categoria || 'otros',
    fecha,
  };
  gastos.unshift(entry);
  await saveData();
  showToast(`✅ IA registró: ${entry.tipo === 'ingreso' ? '+' : '-'}${fmt(entry.monto)} en ${entry.categoria}`, 'green');
  // Refrescar si el tab de movimientos está activo
  const activeTab = document.querySelector('.tab-section.active')?.id?.replace('tab-','');
  if (activeTab === 'transactions') renderTransactions();
  if (activeTab === 'dashboard') renderDashboard();
}


// ============================================================
// GASTOS PROGRAMADOS
// ============================================================
let gastoProgEditIdx = null;

function renderGastosProg() {
  const lista = APP_CONFIG.gastosProgramados || [];
  const el = document.getElementById('gastoProgList');
  if (!el) return;

  if (!lista.length) {
    el.innerHTML = '<div class="empty-st"><div class="empty-icon">🔄</div><p>Sin gastos programados</p><p style="font-size:12px;margin-top:6px">Agrega gastos recurrentes como arriendo, suscripciones, etc.</p></div>';
    document.getElementById('gastoProgProxCard').style.display = 'none';
    return;
  }

  const hoy = new Date();
  el.innerHTML = lista.map((g, i) => {
    const proxFecha = calcProxEjecucion(g);
    const diasRestantes = Math.ceil((proxFecha - hoy) / (1000*60*60*24));
    const urgente = diasRestantes <= 3;
    return `<div class="meta-card">
      <div class="meta-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:${g.activo?'var(--green-dim)':'var(--border)'};border:1px solid ${g.activo?'rgba(34,197,94,.3)':'var(--border2)'};display:flex;align-items:center;justify-content:center;font-size:18px">${getCatEmoji(g.categoria)}</div>
          <div>
            <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:14px">${esc(g.nombre)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">${g.frecuencia === 'mensual' ? 'Mensual' : g.frecuencia === 'semanal' ? 'Semanal' : 'Anual'} · día ${g.dia} · ${g.categoria}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--red);font-size:16px">-${fmt(g.monto)}</div>
          <div style="font-size:11px;color:${urgente?'var(--yellow)':'var(--text3)'};margin-top:2px">${urgente?'⚡ ':''}en ${diasRestantes}d</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:10px;height:10px;border-radius:50%;background:${g.activo?'var(--green)':'var(--text3)'}"></div>
          <span style="font-size:12px;color:var(--text3)">${g.activo?'Activo':'Pausado'}</span>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" onclick="toggleGastoProg(${i})">${g.activo?'⏸ Pausar':'▶ Activar'}</button>
          <button class="btn btn-ghost btn-sm" onclick="ejecutarGastoProgManual(${i})">▶ Ejecutar ya</button>
          <button class="btn btn-ghost btn-sm" onclick="abrirModalGastoProg(${i})">✏️</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="eliminarGastoProg(${i})">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Próximas ejecuciones
  const prox = lista.filter(g=>g.activo).map(g=>({...g, fecha: calcProxEjecucion(g)}))
    .sort((a,b)=>a.fecha-b.fecha).slice(0,5);
  const proxCard = document.getElementById('gastoProgProxCard');
  const proxEl   = document.getElementById('gastoProgProx');
  if (proxCard) proxCard.style.display = prox.length ? 'block' : 'none';
  if (proxEl) {
    proxEl.innerHTML = prox.map(g => {
      const dias = Math.ceil((g.fecha - new Date()) / (1000*60*60*24));
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${getCatEmoji(g.categoria)}</span>
          <div><div style="font-size:13px;font-weight:500">${esc(g.nombre)}</div><div style="font-size:11px;color:var(--text3)">${g.fecha.toLocaleDateString('es-CO')}</div></div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'DM Mono',monospace;color:var(--red);font-size:13px">-${fmt(g.monto)}</div>
          <div style="font-size:11px;color:${dias<=3?'var(--yellow)':'var(--text3)'}">${dias <= 0 ? 'Hoy' : `en ${dias}d`}</div>
        </div>
      </div>`;
    }).join('');
  }
}

function calcProxEjecucion(g) {
  const hoy = new Date();
  const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), g.dia || 1);
  if (fecha <= hoy) fecha.setMonth(fecha.getMonth() + 1);
  return fecha;
}

function getCatEmoji(cat) {
  const map = { comida:'🍔', transporte:'🚗', servicios:'💡', arriendo:'🏠', educacion:'📚', salud:'💊', deportes:'⚽', ocio:'🎮', suscripcion:'📱', otros:'💰', deuda:'💳', ahorro:'🎯', familia:'👨‍👩‍👧', mascota:'🐾' };
  return map[cat] || '💰';
}

function abrirModalGastoProg(idx = null) {
  gastoProgEditIdx = idx;
  const g = idx !== null ? (APP_CONFIG.gastosProgramados||[])[idx] : {};
  document.getElementById('gpNombre').value    = g.nombre||'';
  document.getElementById('gpMonto').value     = g.monto||'';
  document.getElementById('gpCategoria').value = g.categoria||'otros';
  document.getElementById('gpFrecuencia').value= g.frecuencia||'mensual';
  document.getElementById('gpDia').value       = g.dia||1;
  document.getElementById('gpDesc').value      = g.descripcion||'';
  document.getElementById('modalGastoProg').classList.add('open');
}

async function guardarGastoProg() {
  const nombre    = document.getElementById('gpNombre')?.value.trim();
  const monto     = +document.getElementById('gpMonto')?.value;
  const categoria = document.getElementById('gpCategoria')?.value;
  const frecuencia= document.getElementById('gpFrecuencia')?.value;
  const dia       = +document.getElementById('gpDia')?.value||1;
  const descripcion= document.getElementById('gpDesc')?.value.trim();
  if (!nombre||!monto) { showToast('Nombre y monto son obligatorios','red'); return; }
  if (!APP_CONFIG.gastosProgramados) APP_CONFIG.gastosProgramados = [];
  const gasto = { id: Date.now(), nombre, monto, categoria, frecuencia, dia, descripcion, activo: true, ultimaEjecucion: null };
  if (gastoProgEditIdx !== null) {
    gasto.activo = APP_CONFIG.gastosProgramados[gastoProgEditIdx].activo;
    APP_CONFIG.gastosProgramados[gastoProgEditIdx] = gasto;
  } else {
    APP_CONFIG.gastosProgramados.push(gasto);
  }
  await window._db.saveConfig(CURRENT_USER.uid, APP_CONFIG);
  document.getElementById('modalGastoProg').classList.remove('open');
  showToast(gastoProgEditIdx!==null?'Gasto actualizado ✓':'Gasto programado agregado ✓','green');
  renderGastosProg();
}

async function toggleGastoProg(idx) {
  APP_CONFIG.gastosProgramados[idx].activo = !APP_CONFIG.gastosProgramados[idx].activo;
  await window._db.saveConfig(CURRENT_USER.uid, APP_CONFIG);
  renderGastosProg();
}

async function eliminarGastoProg(idx) {
  if (!confirm('¿Eliminar este gasto programado?')) return;
  APP_CONFIG.gastosProgramados.splice(idx, 1);
  await window._db.saveConfig(CURRENT_USER.uid, APP_CONFIG);
  showToast('Eliminado','red');
  renderGastosProg();
}

async function ejecutarGastoProgManual(idx) {
  const g = APP_CONFIG.gastosProgramados[idx];
  if (!g) return;
  if (!confirm(`¿Registrar "${g.nombre}" (${fmt(g.monto)}) como movimiento ahora?`)) return;
  const entry = {
    descripcion: g.nombre + (g.descripcion ? ' — '+g.descripcion : ''),
    monto: g.monto, tipo: 'gasto',
    categoria: g.categoria, fecha: todayStr(),
  };
  gastos.unshift({ ...entry, id: Date.now() });
  APP_CONFIG.gastosProgramados[idx].ultimaEjecucion = todayStr();
  await Promise.all([saveData(), window._db.saveConfig(CURRENT_USER.uid, APP_CONFIG)]);
  showToast(`"${g.nombre}" registrado ✓`, 'green');
  renderGastosProg();
}

// Verificar gastos pendientes al abrir la app
function verificarGastosProgramados() {
  const lista = APP_CONFIG.gastosProgramados || [];
  const hoy = new Date();
  const pendientes = lista.filter(g => {
    if (!g.activo) return false;
    const prox = calcProxEjecucion(g);
    const diasRestantes = Math.ceil((prox - hoy) / (1000*60*60*24));
    // Si ya pasó el día de ejecución este mes y no se ejecutó hoy
    const diaHoy = hoy.getDate();
    const ultimaEjec = g.ultimaEjecucion ? new Date(g.ultimaEjecucion) : null;
    const yaEjecutadoEsteMes = ultimaEjec && ultimaEjec.getMonth() === hoy.getMonth() && ultimaEjec.getFullYear() === hoy.getFullYear();
    return diaHoy >= g.dia && !yaEjecutadoEsteMes;
  });
  if (pendientes.length > 0) {
    setTimeout(() => {
      showToast(`${pendientes.length} gasto(s) programado(s) pendiente(s) de ejecutar`, 'yellow');
    }, 2000);
  }
}


// ============================================================
// UTILITIES
// ============================================================
function fmt(n){ return '$'+Number(n||0).toLocaleString('es-CO'); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function todayStr(){ return new Date().toISOString().split('T')[0]; }
function mesActual(){ const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function setText(id,t,c){ const el=document.getElementById(id);if(!el)return;el.textContent=t;if(c)el.style.color=c; }
function getVal(id){ return document.getElementById(id)?.value||''; }
function setVal(id,v){ const el=document.getElementById(id);if(el)el.value=v; }
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
function catColor(c){ return{ocio:'#ff4f6d',comida:'#00e5a0',transporte:'#4f8eff',servicios:'#9d6eff',educacion:'#ffcc44',salud:'#22e5f5',deportes:'#fb923c',sueldo:'#00e5a0',arriendo:'#f97316',deuda:'#ff4f6d',ahorro:'#4f8eff',familia:'#ec4899',mascota:'#a78bfa',otros:'#8892c4'}[c]||'#8892c4'; }

// Modal close on outside click
window.addEventListener('click',e=>{
  ['modalMeta','modalAbonar','userMenu'].forEach(id=>{const el=document.getElementById(id);if(el&&e.target===el)el.classList.remove('open');});
});
