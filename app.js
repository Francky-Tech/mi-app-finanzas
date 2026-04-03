// ============================================================
// AHORRAPP PRO — Motor IA Financiero
// ============================================================

// ── STATE ──
let gastos = [];
let metas  = [];
let limiteOcio = 500000;
let alertaOcioMostrada = false;
let indexEditando = null;
let chatHistory = [];

let chartDonut = null;
let chartBars  = null;
let chartTrend = null;

// ── PERFIL FINANCIERO FIJO ──
const PERFIL = {
  ingresoMensual: 6428000,
  gastosFijos: {
    'Arriendo':           700000,
    'Comida':            1200000,
    'Servicios':          450000,
    'Gasolina':           140000,
    'Alimento perrita':   120000,
    'Pensión mamá':       200000,
    'Parqueadero':         80000,
    'Escuela fútbol':      20000,
  },
  deuda: {
    saldoInicial: 5760736,
    tasaMensual:  0.01546,
    cuotaManejo:  36000,
  },
  cesantias: {
    hoy:    18800000,
    feb2027: 6570000,
  },
  metaApartamento: {
    valor:        250000000,
    fechaObjetivo: '2027-02',
  }
};

function totalGastosFijos() {
  return Object.values(PERFIL.gastosFijos).reduce((a,b) => a+b, 0);
}

// ============================================================
// PERSISTENCE
// ============================================================
function guardar() {
  localStorage.setItem('ahorrapp_gastos',    JSON.stringify(gastos));
  localStorage.setItem('ahorrapp_metas',     JSON.stringify(metas));
  localStorage.setItem('ahorrapp_limite',    String(limiteOcio));
  localStorage.setItem('ahorrapp_perfil',    JSON.stringify(PERFIL));
  localStorage.setItem('ahorrapp_lastSaved', new Date().toISOString());
  actualizarBadge();
}

function cargar() {
  const raw = localStorage.getItem('ahorrapp_gastos') || localStorage.getItem('gastos');
  if (raw) gastos = JSON.parse(raw);

  const rawM = localStorage.getItem('ahorrapp_metas');
  if (rawM) metas = JSON.parse(rawM);

  const rawL = localStorage.getItem('ahorrapp_limite') || localStorage.getItem('ahorrapp_limiteOcio');
  if (rawL) { limiteOcio = Number(rawL); }

  const rawP = localStorage.getItem('ahorrapp_perfil');
  if (rawP) {
    const p = JSON.parse(rawP);
    if (p.ingresoMensual) PERFIL.ingresoMensual = p.ingresoMensual;
    if (p.gastosFijos) Object.assign(PERFIL.gastosFijos, p.gastosFijos);
    if (p.deuda) Object.assign(PERFIL.deuda, p.deuda);
    if (p.metaApartamento) Object.assign(PERFIL.metaApartamento, p.metaApartamento);
  }

  const limEl = document.getElementById('inputLimiteOcio');
  if (limEl) limEl.value = limiteOcio;

  const ingEl = document.getElementById('cfgIngreso');
  if (ingEl) ingEl.value = PERFIL.ingresoMensual;

  actualizarBadge();
}

function actualizarBadge() {
  const raw = localStorage.getItem('ahorrapp_lastSaved');
  const el  = document.getElementById('lastSaved');
  if (!el || !raw) return;
  const d = new Date(raw);
  el.textContent = '● ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// TABS
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  if (tab === 'dashboard')    renderDashboard();
  if (tab === 'transactions') renderTransactions();
  if (tab === 'reports')      renderReports();
  if (tab === 'savings')      renderSavings();
  if (tab === 'deuda')        renderDeuda();
  if (tab === 'plan')         renderPlan();
  if (tab === 'settings')     renderSettings();
}

// ============================================================
// TOAST
// ============================================================
let _toastTimer;
function showToast(msg, type = 'green') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const mes = mesActual();
  const totalBalance = gastos.reduce((a, g) => g.tipo === 'ingreso' ? a + g.monto : a - g.monto, 0);
  const gMes = gastos.filter(g => g.fecha && g.fecha.startsWith(mes));
  const ingresosMes = gMes.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
  const egresosMes  = gMes.filter(g => g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0);
  const balanceMes  = ingresosMes - egresosMes;
  const totalAhorro = metas.reduce((s, m) => s + m.ahorrado, 0);

  setText('statBalance',    fmt(totalBalance),  totalBalance >= 0 ? 'var(--green)' : 'var(--red)');
  setText('statIngresosMes', fmt(ingresosMes));
  setText('statEgresosMes',  fmt(egresosMes));
  setText('statBalanceMes',  fmt(balanceMes), balanceMes >= 0 ? 'var(--green)' : 'var(--red)');
  setText('statAhorro', fmt(totalAhorro));

  // Deuda TC proyectada
  const deudaRestante = calcDeudaRestante();
  setText('statDeuda', fmt(deudaRestante), deudaRestante > 0 ? 'var(--red)' : 'var(--green)');

  // Alertas inteligentes
  renderAlertasDashboard();

  // Recent
  const recent = [...gastos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 6);
  const list = document.getElementById('recentList');
  list.innerHTML = recent.length === 0
    ? '<div class="empty-state"><div class="empty-icon">📋</div><p>Sin movimientos aún</p></div>'
    : '';
  recent.forEach(g => list.appendChild(buildTxRow(g, null, true)));

  buildDonut();
  renderMetaAptoCard();
}

function calcDeudaRestante() {
  const pagosMes = gastos.filter(g => g.categoria === 'deuda' && g.tipo === 'gasto');
  const pagado = pagosMes.reduce((s,g) => s + g.monto, 0);
  const saldoInicial = PERFIL.deuda.saldoInicial;
  // Simulación simple
  let saldo = saldoInicial;
  const cuota = document.getElementById('deudaCuota') ? Number(document.getElementById('deudaCuota').value) : 750000;
  const mesesPagados = Math.floor(pagado / cuota);
  for (let i = 0; i < mesesPagados; i++) {
    const int = Math.round(saldo * PERFIL.deuda.tasaMensual);
    saldo = Math.max(0, saldo + int + PERFIL.deuda.cuotaManejo - cuota);
  }
  return Math.max(0, saldo);
}

function renderAlertasDashboard() {
  const container = document.getElementById('alertasDashboard');
  if (!container) return;
  const alertas = generarAlertas();
  container.innerHTML = alertas.slice(0, 3).map(a => `
    <div class="alerta-item ${a.tipo}">
      <div class="alerta-icon">${a.icono}</div>
      <div class="alerta-body">
        <div class="alerta-title">${a.titulo}</div>
        <div class="alerta-desc">${a.desc}</div>
      </div>
    </div>
  `).join('');
}

function generarAlertas() {
  const alertas = [];
  const mes = mesActual();
  const gMes = gastos.filter(g => g.fecha && g.fecha.startsWith(mes));
  const egresosMes = gMes.filter(g => g.tipo === 'gasto').reduce((s,g) => s + g.monto, 0);
  const ingresosMes = gMes.filter(g => g.tipo === 'ingreso').reduce((s,g) => s + g.monto, 0);

  const disponible = PERFIL.ingresoMensual - totalGastosFijos();
  const cuotaTC = Number(document.getElementById('deudaCuota')?.value || 750000);
  const disponibleReal = disponible - cuotaTC;

  // Alerta deuda TC
  const deuda = calcDeudaRestante();
  if (deuda > 0) {
    alertas.push({ tipo: 'danger', icono: '💳', titulo: `Deuda TC: ${fmt(deuda)}`, desc: `Paga mínimo ${fmt(cuotaTC)}/mes para liquidarla. Cada mes de intereses te cuesta ~${fmt(Math.round(deuda * PERFIL.deuda.tasaMensual))}.` });
  }

  // Alerta ocio
  const totalOcio = gMes.filter(g => g.categoria === 'ocio' && g.tipo === 'gasto').reduce((s,g) => s + g.monto, 0);
  if (totalOcio > limiteOcio) {
    alertas.push({ tipo: 'warning', icono: '⚠️', titulo: 'Límite de ocio superado', desc: `Gastaste ${fmt(totalOcio)} en ocio este mes. Tu límite es ${fmt(limiteOcio)}.` });
  }

  // Alerta ahorro mensual
  const ahorro = gastos.filter(g => g.fecha && g.fecha.startsWith(mes) && g.categoria === 'ahorro').reduce((s,g) => s + g.monto, 0);
  if (ahorro === 0 && new Date().getDate() > 10) {
    alertas.push({ tipo: 'warning', icono: '🎯', titulo: 'Sin ahorro registrado este mes', desc: `Deberías ahorrar al menos ${fmt(disponibleReal > 0 ? Math.round(disponibleReal * 0.5) : 1268000)} este mes para tu meta del apartamento.` });
  } else if (ahorro > 0) {
    alertas.push({ tipo: 'success', icono: '✅', titulo: `Ahorraste ${fmt(ahorro)} este mes`, desc: `¡Bien hecho! Sigue así para alcanzar tu meta en febrero 2027.` });
  }

  // Alerta gastos altos
  if (egresosMes > PERFIL.ingresoMensual * 0.7) {
    alertas.push({ tipo: 'danger', icono: '🔴', titulo: 'Gastos muy altos este mes', desc: `Tus egresos (${fmt(egresosMes)}) superan el 70% de tu ingreso. Revisa en qué estás gastando.` });
  }

  return alertas;
}

function renderMetaAptoCard() {
  const container = document.getElementById('dashboardMetaApto');
  if (!container) return;

  const cesantiasHoy = Number(document.getElementById('planCesantiasHoy')?.value || PERFIL.cesantias.hoy);
  const cesantiasFeb = Number(document.getElementById('planCesantiasFeb')?.value || PERFIL.cesantias.feb2027);
  const totalAhorro  = metas.reduce((s,m) => s + m.ahorrado, 0);
  const totalCesantias = cesantiasHoy + cesantiasFeb;
  const totalAcumulado = totalCesantias + totalAhorro;
  const valorApto = PERFIL.metaApartamento.valor;
  const cuotaInicial = valorApto * 0.3;
  const pct = Math.min(Math.round((totalAcumulado / cuotaInicial) * 100), 100);

  // Meses restantes hasta feb 2027
  const ahora = new Date();
  const objetivo = new Date(2027, 1, 1);
  const mesesRestantes = Math.max(0, (objetivo.getFullYear() - ahora.getFullYear()) * 12 + (objetivo.getMonth() - ahora.getMonth()));

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px">
      <div>
        <div style="font-size:22px;font-weight:600;font-family:'DM Mono',monospace;color:var(--blue)">${fmt(totalAcumulado)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">de ${fmt(cuotaInicial)} necesarios (30% cuota inicial)</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:20px;font-weight:600;color:var(--green)">${pct}%</div>
        <div style="font-size:11px;color:var(--text2)">${mesesRestantes} meses restantes</div>
      </div>
    </div>
    <div class="progress-bar" style="height:10px">
      <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--blue),var(--green))"></div>
    </div>
    <div style="display:flex;gap:16px;margin-top:12px;font-size:12px;color:var(--text2)">
      <span>🏦 Cesantías: <strong style="color:var(--text)">${fmt(totalCesantias)}</strong></span>
      <span>💰 Ahorros: <strong style="color:var(--text)">${fmt(totalAhorro)}</strong></span>
      <span>📅 Meta: <strong style="color:var(--blue)">Feb 2027</strong></span>
    </div>
  `;
}

function buildDonut() {
  const ingresos = gastos.filter(g => g.tipo === 'ingreso').reduce((s,g) => s + g.monto, 0);
  const egresos  = gastos.filter(g => g.tipo === 'gasto').reduce((s,g) => s + g.monto, 0);
  const ctx = document.getElementById('chartDonut')?.getContext('2d');
  if (!ctx) return;
  if (chartDonut) chartDonut.destroy();
  if (ingresos === 0 && egresos === 0) return;
  chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['Ingresos', 'Gastos'], datasets: [{ data: [ingresos, egresos], backgroundColor: ['#00d68f','#ff5c6c'], borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: true, cutout: '68%',
      plugins: { legend: { position: 'bottom', labels: { color: '#7b9fc0', font: { size: 12 }, padding: 16 } },
        tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } } }
  });
}

// ============================================================
// DEUDA TC
// ============================================================
function renderDeuda() {
  recalcDeuda();
}

function recalcDeuda() {
  const saldo   = Number(document.getElementById('deudaSaldo')?.value  || PERFIL.deuda.saldoInicial);
  const cuota   = Number(document.getElementById('deudaCuota')?.value  || 750000);
  const tasa    = Number(document.getElementById('deudaTasa')?.value   || 1.546) / 100;
  const manejo  = Number(document.getElementById('deudaManejo')?.value || 36000);

  // ── Calcular amortización ──
  const filas = [];
  let s = saldo;
  const mesesNombres = ['Abr 2025','May 2025','Jun 2025','Jul 2025','Ago 2025','Sep 2025','Oct 2025','Nov 2025','Dic 2025','Ene 2026'];
  let totalIntereses = 0;
  let totalManejo = 0;

  for (let i = 0; i < 24 && s > 0; i++) {
    const interes = Math.round(s * tasa);
    const abono   = Math.max(0, cuota - interes - manejo);
    totalIntereses += interes;
    totalManejo    += manejo;
    s = Math.max(0, s - abono);
    filas.push({ mes: mesesNombres[i] || `Mes ${i+1}`, saldoInicio: s + abono, interes, manejo, abono, saldoFin: s });
    if (s === 0) break;
  }

  const mesesLiquidar = filas.length;
  const costoTotal = totalIntereses + totalManejo;

  // ── Resumen ──
  const resumen = document.getElementById('deudaResumen');
  if (resumen) {
    resumen.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card red"><div class="stat-label">Saldo actual</div><div class="stat-value" style="color:var(--red)">${fmt(saldo)}</div></div>
        <div class="stat-card yellow"><div class="stat-label">Tasa mensual</div><div class="stat-value" style="color:var(--yellow)">${(tasa*100).toFixed(3)}%</div><div class="stat-sub">${((Math.pow(1+tasa,12)-1)*100).toFixed(1)}% EA</div></div>
        <div class="stat-card blue"><div class="stat-label">Meses para liquidar</div><div class="stat-value" style="color:var(--blue)">${mesesLiquidar}</div><div class="stat-sub">${filas[mesesLiquidar-1]?.mes || ''}</div></div>
        <div class="stat-card red"><div class="stat-label">Costo total (int+manejo)</div><div class="stat-value" style="color:var(--red)">${fmt(costoTotal)}</div></div>
      </div>
      <div class="box-yellow">⚡ <strong>Recomendación:</strong> Subir el pago de ${fmt(cuota)} a ${fmt(cuota+50000)}/mes te ahorra aproximadamente ${fmt(Math.round(costoTotal*0.15))} en intereses y liquida la deuda ~1 mes antes. Con ${fmt(cuota+250000)}/mes la liquidas ${Math.max(1,Math.round(mesesLiquidar*0.25))} meses antes.</div>
    `;
  }

  // ── Tabla ──
  const tabla = document.getElementById('amortTable');
  if (tabla) {
    tabla.innerHTML = `
      <thead><tr>
        <th>Mes</th><th>Saldo inicio</th><th>Interés</th><th>C. Manejo</th><th>Abono capital</th><th>Saldo final</th>
      </tr></thead>
      <tbody>${filas.map(f => `
        <tr class="${f.saldoFin === 0 ? 'highlight' : ''}">
          <td>${f.mes}</td>
          <td>${fmt(f.saldoInicio)}</td>
          <td style="color:var(--red)">-${fmt(f.interes)}</td>
          <td style="color:var(--yellow)">-${fmt(f.manejo)}</td>
          <td style="color:var(--green)">+${fmt(f.abono)}</td>
          <td style="color:${f.saldoFin === 0 ? 'var(--green)' : 'var(--red)'}">${f.saldoFin === 0 ? '✓ $0' : fmt(f.saldoFin)}</td>
        </tr>`).join('')}
      </tbody>`;
  }

  // ── Escenarios ──
  const esc = document.getElementById('escenarios');
  if (esc) {
    const escenarios = [
      { label: 'Pago mínimo actual', cuota, color: 'var(--red)' },
      { label: 'Recomendado (+50K)', cuota: cuota+50000, color: 'var(--yellow)' },
      { label: 'Acelerado (+250K)', cuota: cuota+250000, color: 'var(--green)' },
    ].map(e => {
      let s2 = saldo, meses2 = 0, intTotal = 0;
      for (let i = 0; i < 36 && s2 > 0; i++) {
        const int = Math.round(s2 * tasa);
        intTotal += int + manejo;
        s2 = Math.max(0, s2 - Math.max(0, e.cuota - int - manejo));
        meses2++;
      }
      return { ...e, meses: meses2, intTotal };
    });

    esc.innerHTML = `
      <table class="amort-table">
        <thead><tr><th>Escenario</th><th>Cuota</th><th>Meses</th><th>Costo total</th><th>Ahorro vs actual</th></tr></thead>
        <tbody>${escenarios.map((e,i) => `
          <tr class="${i===0 ? '' : 'highlight'}">
            <td style="color:${e.color}">${e.label}</td>
            <td>${fmt(e.cuota)}</td>
            <td>${e.meses}</td>
            <td style="color:var(--red)">-${fmt(e.intTotal)}</td>
            <td style="color:var(--green)">${i===0 ? '—' : '+' + fmt(escenarios[0].intTotal - e.intTotal)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }
}

// ============================================================
// PLAN APARTAMENTO
// ============================================================
function renderPlan() {
  recalcPlan();
}

function recalcPlan() {
  const cesHoy  = Number(document.getElementById('planCesantiasHoy')?.value || PERFIL.cesantias.hoy);
  const cesFeb  = Number(document.getElementById('planCesantiasFeb')?.value || PERFIL.cesantias.feb2027);
  const aF1     = Number(document.getElementById('planAhorroF1')?.value     || 1268000);
  const aF2     = Number(document.getElementById('planAhorroF2')?.value     || 2018000);
  const mF1     = Number(document.getElementById('planMesesF1')?.value      || 8);
  const valApto = Number(document.getElementById('planValorApto')?.value    || 250000000);
  const cuotaIni= valApto * 0.3;

  const totalAhorro  = metas.reduce((s,m) => s + m.ahorrado, 0);
  const totalCes     = cesHoy + cesFeb;
  const ahorroF1     = aF1 * mF1;
  const mF2          = 22 - mF1;
  const ahorroF2     = aF2 * mF2;
  const totalFinal   = totalCes + ahorroF1 + ahorroF2 + totalAhorro;
  const pct          = Math.min(100, Math.round((totalFinal / cuotaIni) * 100));
  const faltante     = Math.max(0, cuotaIni - totalFinal);

  // Resumen
  const resumen = document.getElementById('planResumen');
  if (resumen) {
    resumen.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card blue"><div class="stat-label">Cesantías acumuladas</div><div class="stat-value" style="color:var(--blue)">${fmt(totalCes)}</div></div>
        <div class="stat-card green"><div class="stat-label">Ahorro proyectado</div><div class="stat-value" style="color:var(--green)">${fmt(ahorroF1+ahorroF2)}</div></div>
        <div class="stat-card purple"><div class="stat-label">Total feb 2027</div><div class="stat-value" style="color:var(--purple)">${fmt(totalFinal)}</div></div>
        <div class="stat-card ${faltante <= 0 ? 'green' : 'yellow'}"><div class="stat-label">Meta cuota inicial (30%)</div><div class="stat-value" style="color:${faltante<=0?'var(--green)':'var(--yellow)'}">${faltante<=0 ? '✓ Alcanzada' : '-' + fmt(faltante)}</div></div>
      </div>
      <div class="progress-bar" style="height:12px;margin-bottom:8px">
        <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--blue),var(--green))"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:16px">
        <span>${pct}% de la cuota inicial</span>
        <span>Apartamento: ${fmt(valApto)}</span>
      </div>
      ${faltante <= 0
        ? `<div class="box-green">✅ <strong>¡Meta alcanzable!</strong> Con este plan tienes ${fmt(totalFinal)} para febrero 2027, suficiente para la cuota inicial del 30% de un apartamento de ${fmt(valApto)}.</div>`
        : `<div class="box-yellow">⚠️ Con este plan llegas a ${fmt(totalFinal)}, te faltan ${fmt(faltante)} para el 30% de cuota inicial. Considera aumentar el ahorro mensual en fase 2 o apuntar a un apartamento de ${fmt(Math.round(totalFinal/0.3))}.</div>`}
    `;
  }

  // Tabla mes a mes
  const tabla = document.getElementById('planTable');
  if (tabla) {
    const filas = [];
    let acum = cesHoy + totalAhorro;
    const meses = ['Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene'];
    const anios =  [2025,2025,2025,2025,2025,2025,2025,2025,2025,2026,2026,2026,2026,2026,2026,2026,2026,2026,2026,2026,2026,2027];

    for (let i = 0; i < 22; i++) {
      const fase    = i < mF1 ? 1 : 2;
      const ahorro  = fase === 1 ? aF1 : aF2;
      const nota    = i === mF1 - 1 ? '🎉 TC liquidada' : i === 21 ? '🏠 Compra' : '';
      if (i === mF1) acum += cesFeb * 0; // cesantias feb 2027 al final
      acum += ahorro;
      filas.push({ mes: `${meses[i]} ${anios[i]}`, fase, ahorro, acum: acum, nota });
    }
    acum += cesFeb;

    tabla.innerHTML = `
      <thead><tr><th>Mes</th><th>Fase</th><th>Ahorro del mes</th><th>Acumulado</th><th>Nota</th></tr></thead>
      <tbody>${filas.map(f => `
        <tr>
          <td style="font-family:'DM Mono',monospace;font-size:12px">${f.mes}</td>
          <td><span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${f.fase===1?'var(--red-dim)':'var(--green-dim)'};color:${f.fase===1?'var(--red)':'var(--green)'}">Fase ${f.fase}</span></td>
          <td style="color:var(--green);font-family:'DM Mono',monospace">+${fmt(f.ahorro)}</td>
          <td style="font-family:'DM Mono',monospace;font-weight:500">${fmt(f.acum)}</td>
          <td style="font-size:12px;color:var(--text2)">${f.nota}</td>
        </tr>`).join('')}
        <tr style="background:rgba(77,159,255,.08)">
          <td style="font-weight:600">Feb 2027</td><td>—</td>
          <td style="color:var(--blue);font-family:'DM Mono',monospace">+${fmt(cesFeb)} (cesantías)</td>
          <td style="font-family:'DM Mono',monospace;font-weight:700;color:var(--blue)">${fmt(acum)}</td>
          <td>🏆 Total disponible</td>
        </tr>
      </tbody>`;
  }

  // Timeline
  const tl = document.getElementById('planTimeline');
  if (tl) {
    tl.innerHTML = `
      <div class="timeline">
        <div class="tl-item">
          <div class="tl-dot" style="background:var(--red)"></div>
          <div class="tl-month">Ahora → Mes ${mF1} · ${new Date(2025,3+mF1,1).toLocaleString('es',{month:'long',year:'numeric'})}</div>
          <div class="tl-title">Fase 1 — Liquidar la Tarjeta de Crédito</div>
          <div class="tl-desc">Paga la TC religiosamente cada mes 16 · Ahorra ${fmt(aF1)}/mes en cuenta separada · No uses la tarjeta</div>
          <div class="tl-amount" style="color:var(--red)">Ahorro acumulado: ${fmt(aF1*mF1)}</div>
        </div>
        <div class="tl-item">
          <div class="tl-dot" style="background:var(--yellow)"></div>
          <div class="tl-month">Mes ${mF1+1} → Mes 18 · 2026</div>
          <div class="tl-title">Fase 2 — Turbo Ahorro</div>
          <div class="tl-desc">TC liquidada · Los $750K de cuota TC se convierten en ahorro · Guarda ${fmt(aF2)}/mes · Empieza a investigar proyectos y zonas</div>
          <div class="tl-amount" style="color:var(--green)">+${fmt(aF2*(18-mF1))} en esta fase</div>
        </div>
        <div class="tl-item">
          <div class="tl-dot" style="background:var(--blue)"></div>
          <div class="tl-month">Mes 18 → 21 · Sep–Dic 2026</div>
          <div class="tl-title">Fase 3 — Pre-compra</div>
          <div class="tl-desc">Consulta banco para preaprobación hipotecaria · Reúne documentos (extractos 3 meses, desprendibles, certificados) · Visita apartamentos · Negocia precio</div>
        </div>
        <div class="tl-item">
          <div class="tl-dot" style="background:var(--green)"></div>
          <div class="tl-month">Febrero 2027</div>
          <div class="tl-title">🏠 ¡Compra del Apartamento!</div>
          <div class="tl-desc">Cesantías Feb 2027: ${fmt(cesFeb)} · Total disponible: ${fmt(acum)} · Cuota inicial 30%: ${fmt(cuotaIni)} · Gastos notariales ~1.5%: ${fmt(Math.round(valApto*0.015))}</div>
          <div class="tl-amount" style="color:var(--blue)">${fmt(acum)} disponibles</div>
        </div>
      </div>`;
  }
}

// ============================================================
// TRANSACTIONS
// ============================================================
function renderTransactions() {
  const fechaEl = document.getElementById('txFecha');
  if (!fechaEl.value) fechaEl.value = todayStr();
  aplicarFiltrosTx();
}

function agregarGasto() {
  const descripcion = document.getElementById('txDescripcion').value.trim();
  const monto       = Number(document.getElementById('txMonto').value);
  const tipo        = document.getElementById('txTipo').value;
  const categoria   = document.getElementById('txCategoria').value;
  const fecha       = document.getElementById('txFecha').value;

  if (!descripcion || !monto || monto <= 0 || !tipo || !categoria || !fecha) {
    showToast('Completa todos los campos correctamente', 'red'); return;
  }

  const entrada = { descripcion, monto, tipo, categoria, fecha };

  if (indexEditando !== null) {
    gastos[indexEditando] = entrada;
    indexEditando = null;
    document.getElementById('btnGuardar').textContent = '+ Agregar';
    document.getElementById('btnCancelarEdicion').style.display = 'none';
    document.getElementById('formTitle').textContent = 'Agregar movimiento';
    showToast('Movimiento actualizado', 'blue');
  } else {
    gastos.push(entrada);
    if (categoria === 'ocio' && tipo === 'gasto' && !alertaOcioMostrada) {
      const totalOcio = gastos.filter(g => g.categoria === 'ocio' && g.tipo === 'gasto').reduce((s,g) => s+g.monto, 0);
      if (totalOcio >= limiteOcio) { showToast(`⚠️ Superaste el límite de ocio (${fmt(limiteOcio)})`, 'red'); alertaOcioMostrada = true; }
    }
    showToast('Movimiento agregado ✓', 'green');
  }

  limpiarFormTx();
  guardar();
  renderTransactions();
}

function editarGasto(index) {
  const g = gastos[index];
  document.getElementById('txDescripcion').value = g.descripcion;
  document.getElementById('txMonto').value       = g.monto;
  document.getElementById('txTipo').value        = g.tipo;
  document.getElementById('txCategoria').value   = g.categoria;
  document.getElementById('txFecha').value       = g.fecha;
  indexEditando = index;
  document.getElementById('btnGuardar').textContent           = '💾 Guardar cambios';
  document.getElementById('btnCancelarEdicion').style.display = 'inline-flex';
  document.getElementById('formTitle').textContent            = 'Editar movimiento';
  document.getElementById('txDescripcion').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('txDescripcion').focus();
}

function cancelarEdicion() {
  indexEditando = null;
  limpiarFormTx();
  document.getElementById('btnGuardar').textContent           = '+ Agregar';
  document.getElementById('btnCancelarEdicion').style.display = 'none';
  document.getElementById('formTitle').textContent            = 'Agregar movimiento';
}

function eliminarGasto(index) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  gastos.splice(index, 1);
  const totalOcio = gastos.filter(g => g.categoria === 'ocio' && g.tipo === 'gasto').reduce((s,g) => s+g.monto, 0);
  if (totalOcio < limiteOcio) alertaOcioMostrada = false;
  guardar();
  renderTransactions();
  showToast('Movimiento eliminado', 'red');
}

function limpiarFormTx() {
  ['txDescripcion','txMonto','txTipo','txCategoria'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('txFecha').value = todayStr();
}

function aplicarFiltrosTx() {
  const porFecha     = document.getElementById('filtroFecha').value;
  const porCategoria = document.getElementById('filtroCategoria').value;
  const porTipo      = document.getElementById('filtroTipo').value;
  const results = gastos.map((g,i) => ({g,i}))
    .filter(({g}) => {
      if (porFecha && g.fecha !== porFecha) return false;
      if (porCategoria && g.categoria !== porCategoria) return false;
      if (porTipo && g.tipo !== porTipo) return false;
      return true;
    })
    .sort((a,b) => new Date(b.g.fecha) - new Date(a.g.fecha));

  const lista = document.getElementById('txLista');
  const count = document.getElementById('txCount');
  lista.innerHTML = '';
  count.textContent = results.length + ' movimiento' + (results.length !== 1 ? 's' : '');

  if (results.length === 0) {
    lista.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>Sin movimientos con esos filtros</p></div>';
    return;
  }
  results.forEach(({g,i}) => lista.appendChild(buildTxRow(g, i, false)));
}

function limpiarFiltrosTx() {
  ['filtroFecha','filtroCategoria','filtroTipo'].forEach(id => { document.getElementById(id).value = ''; });
  aplicarFiltrosTx();
}

function buildTxRow(g, index, readonly) {
  const div = document.createElement('div');
  div.className = 'tx-item';
  const isIngreso = g.tipo === 'ingreso';
  const color = isIngreso ? 'var(--green)' : 'var(--red)';
  const signo = isIngreso ? '+' : '−';
  div.innerHTML = `
    <div class="tx-dot" style="background:${catColor(g.categoria)}"></div>
    <div class="tx-info">
      <div class="tx-desc">${esc(g.descripcion)}</div>
      <div class="tx-meta">${g.fecha} · ${g.categoria}</div>
    </div>
    <div class="tx-amount" style="color:${color}">${signo}${fmt(g.monto)}</div>
    ${readonly ? '' : `<div class="tx-actions">
      <button class="btn-icon" onclick="editarGasto(${index})">✏️</button>
      <button class="btn-icon" onclick="eliminarGasto(${index})">🗑️</button>
    </div>`}`;
  return div;
}

// ============================================================
// REPORTS
// ============================================================
function renderReports() {
  const el = document.getElementById('reportMes');
  if (!el.value) el.value = mesActual();
  renderResumenMes(el.value);
  buildChartBars();
  buildChartTrend();
}

function renderResumenMes(mes) {
  if (!mes) return;
  const gm       = gastos.filter(g => g.fecha && g.fecha.startsWith(mes));
  const ingresos = gm.filter(g => g.tipo === 'ingreso').reduce((s,g) => s+g.monto, 0);
  const egresos  = gm.filter(g => g.tipo === 'gasto').reduce((s,g) => s+g.monto, 0);
  const balance  = ingresos - egresos;
  const [y,m]    = mes.split('-');
  const nombreMes = new Date(y, m-1).toLocaleString('es', { month: 'long', year: 'numeric' });

  const porCat = {};
  gm.filter(g => g.tipo === 'gasto').forEach(g => { porCat[g.categoria] = (porCat[g.categoria]||0) + g.monto; });

  const catHTML = Object.entries(porCat).length
    ? Object.entries(porCat).sort((a,b) => b[1]-a[1]).map(([cat, total]) => {
        const pct = egresos > 0 ? Math.round((total/egresos)*100) : 0;
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
            <span style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${catColor(cat)};display:inline-block"></span>${cat}</span>
            <span>${fmt(total)} <span style="color:var(--text2)">(${pct}%)</span></span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${catColor(cat)}"></div></div>
        </div>`;
      }).join('')
    : '<p style="color:var(--text2);font-size:13px">Sin gastos este mes</p>';

  document.getElementById('resumenMensualContent').innerHTML = `
    <p style="font-size:14px;font-weight:600;margin-bottom:14px;text-transform:capitalize">${nombreMes}</p>
    <div class="stats-grid" style="margin-bottom:18px">
      <div class="stat-card green"><div class="stat-label">Ingresos</div><div class="stat-value" style="font-size:19px;color:var(--green)">${fmt(ingresos)}</div></div>
      <div class="stat-card red"><div class="stat-label">Egresos</div><div class="stat-value" style="font-size:19px;color:var(--red)">${fmt(egresos)}</div></div>
      <div class="stat-card blue"><div class="stat-label">Balance</div><div class="stat-value" style="font-size:19px;color:${balance>=0?'var(--green)':'var(--red)'}">${fmt(balance)}</div></div>
      <div class="stat-card"><div class="stat-label">Movimientos</div><div class="stat-value" style="font-size:19px">${gm.length}</div></div>
    </div>
    <div style="font-size:12px;font-weight:600;margin-bottom:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">GASTOS POR CATEGORÍA</div>
    ${catHTML}`;
}

function buildChartBars() {
  const cats = {};
  gastos.filter(g => g.tipo === 'gasto').forEach(g => { cats[g.categoria] = (cats[g.categoria]||0) + g.monto; });
  const labels = Object.keys(cats);
  const data   = Object.values(cats);
  const ctx    = document.getElementById('chartBars')?.getContext('2d');
  if (!ctx) return;
  if (chartBars) chartBars.destroy();
  if (!labels.length) return;
  chartBars = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels.map(l => l.charAt(0).toUpperCase()+l.slice(1)), datasets: [{ label: 'Total', data, backgroundColor: labels.map(catColor), borderRadius: 6, borderSkipped: false }] },
    options: { responsive: true, plugins: { legend: { display:false }, tooltip: { callbacks: { label: c => ' '+fmt(c.raw) } } },
      scales: { x: { ticks: {color:'#7b9fc0'}, grid: {color:'#1e2d45'} }, y: { ticks: {color:'#7b9fc0', callback: v => '$'+v.toLocaleString()}, grid: {color:'#1e2d45'} } } }
  });
}

function buildChartTrend() {
  const now = new Date();
  const months = [];
  for (let i=5; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push({ key, lbl: d.toLocaleString('es',{month:'short',year:'2-digit'}) });
  }
  const ing = months.map(({key}) => gastos.filter(g=>g.fecha&&g.fecha.startsWith(key)&&g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0));
  const eg  = months.map(({key}) => gastos.filter(g=>g.fecha&&g.fecha.startsWith(key)&&g.tipo==='gasto').reduce((s,g)=>s+g.monto,0));
  const ctx = document.getElementById('chartTrend')?.getContext('2d');
  if (!ctx) return;
  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(ctx, {
    type: 'line',
    data: { labels: months.map(m=>m.lbl), datasets: [
      { label:'Ingresos', data: ing, borderColor:'#00d68f', backgroundColor:'rgba(0,214,143,.08)', fill:true, tension:.35, pointBackgroundColor:'#00d68f', pointRadius:4 },
      { label:'Gastos',   data: eg,  borderColor:'#ff5c6c', backgroundColor:'rgba(255,92,108,.08)', fill:true, tension:.35, pointBackgroundColor:'#ff5c6c', pointRadius:4 }
    ]},
    options: { responsive:true, interaction:{mode:'index',intersect:false},
      plugins: { legend:{labels:{color:'#7b9fc0',font:{size:12}}}, tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`}} },
      scales: { x:{ticks:{color:'#7b9fc0'},grid:{color:'#1e2d45'}}, y:{ticks:{color:'#7b9fc0',callback:v=>'$'+v.toLocaleString()},grid:{color:'#1e2d45'}} } }
  });
}

// ============================================================
// SAVINGS / METAS
// ============================================================
function renderSavings() {
  const container = document.getElementById('metasList');
  container.innerHTML = '';
  if (metas.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎯</div><p>No tienes metas aún</p><p style="font-size:12px;margin-top:8px">Crea tu primera meta con el botón de arriba</p></div>`;
    return;
  }
  metas.forEach((meta, i) => {
    const pct      = Math.min(Math.round((meta.ahorrado/meta.total)*100), 100);
    const restante = Math.max(meta.total-meta.ahorrado, 0);
    const barColor = pct>=100?'var(--green)':pct>=60?'var(--yellow)':'var(--blue)';
    const div = document.createElement('div');
    div.className = 'meta-card';
    div.innerHTML = `
      <div class="meta-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="width:12px;height:12px;border-radius:50%;background:${meta.color||'#4d9fff'};display:inline-block;flex-shrink:0"></span>
            <strong style="font-size:15px">${esc(meta.nombre)}</strong>
            ${pct>=100?'<span style="color:var(--green);font-size:12px">🎉 ¡Lograda!</span>':''}
          </div>
          <div style="font-size:12px;color:var(--text2)">${fmt(meta.ahorrado)} de ${fmt(meta.total)}${meta.cuotaMensual?` · ${fmt(meta.cuotaMensual)}/mes`:''}${meta.fechaObjetivo?` · ${meta.fechaObjetivo}`:''}</div>
          ${calcProyeccion(meta)?`<div style="font-size:11px;color:var(--blue);margin-top:3px">${calcProyeccion(meta)}</div>`:''}
        </div>
        <div class="tx-actions" style="margin-left:10px">
          <button class="btn-icon" onclick="abrirAbonar(${i})">💰</button>
          <button class="btn-icon" onclick="editarMeta(${i})">✏️</button>
          <button class="btn-icon" onclick="eliminarMeta(${i})">🗑️</button>
        </div>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-top:4px">
        <span>${pct}% completado</span>
        <span>${restante>0?'Faltan '+fmt(restante):'¡Meta alcanzada!'}</span>
      </div>`;
    container.appendChild(div);
  });
}

function calcProyeccion(meta) {
  const restante = meta.total - meta.ahorrado;
  if (restante <= 0) return '';
  let cuota = meta.cuotaMensual > 0 ? meta.cuotaMensual : (meta.abonos?.length >= 2 ? meta.ahorrado/meta.abonos.length : 0);
  if (cuota <= 0) return '';
  const meses = Math.ceil(restante/cuota);
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth()+meses);
  return `📅 Proyección: ${fecha.toLocaleDateString('es',{month:'long',year:'numeric'})} (~${meses} mes${meses!==1?'es':''})`;
}

let _metaEditIdx = null;
function abrirModalMeta(editIdx=null) {
  _metaEditIdx = editIdx;
  if (editIdx !== null) {
    const m = metas[editIdx];
    document.getElementById('metaNombre').value        = m.nombre;
    document.getElementById('metaTotal').value         = m.total;
    document.getElementById('metaCuotaSemanal').value  = m.cuotaSemanal||'';
    document.getElementById('metaCuotaMensual').value  = m.cuotaMensual||'';
    document.getElementById('metaColor').value         = m.color||'#4d9fff';
    document.getElementById('metaFechaObjetivo').value = m.fechaObjetivo||'';
    document.getElementById('modalMetaTitle').textContent = 'Editar meta';
  } else {
    ['metaNombre','metaTotal','metaCuotaSemanal','metaCuotaMensual','metaFechaObjetivo'].forEach(id => { document.getElementById(id).value=''; });
    document.getElementById('metaColor').value = '#4d9fff';
    document.getElementById('modalMetaTitle').textContent = 'Nueva meta de ahorro';
  }
  document.getElementById('modalMeta').classList.add('open');
}
function cerrarModalMeta() { document.getElementById('modalMeta').classList.remove('open'); }
function guardarModalMeta() {
  const nombre       = document.getElementById('metaNombre').value.trim();
  const total        = Number(document.getElementById('metaTotal').value);
  const cuotaSemanal = Number(document.getElementById('metaCuotaSemanal').value)||0;
  const cuotaMensual = Number(document.getElementById('metaCuotaMensual').value)||0;
  const color        = document.getElementById('metaColor').value;
  const fechaObjetivo = document.getElementById('metaFechaObjetivo').value;
  if (!nombre||!total||total<=0) { showToast('Ingresa un nombre y monto válido','red'); return; }
  if (_metaEditIdx!==null) { metas[_metaEditIdx]={...metas[_metaEditIdx],nombre,total,cuotaSemanal,cuotaMensual,color,fechaObjetivo}; showToast('Meta actualizada ✓','blue'); }
  else { metas.push({id:Date.now(),nombre,total,ahorrado:0,cuotaSemanal,cuotaMensual,color,fechaObjetivo,abonos:[]}); showToast('Meta creada ✓','green'); }
  guardar(); cerrarModalMeta(); renderSavings();
}
function editarMeta(i) { abrirModalMeta(i); }
function eliminarMeta(i) { if(!confirm('¿Eliminar?'))return; metas.splice(i,1); guardar(); renderSavings(); showToast('Meta eliminada','red'); }

let _abonarIdx = null;
function abrirAbonar(i) {
  _abonarIdx = i;
  const meta = metas[i];
  document.getElementById('abonarMetaNombre').textContent = meta.nombre;
  document.getElementById('abonarMetaInfo').textContent   = `Ahorrado: ${fmt(meta.ahorrado)} de ${fmt(meta.total)} · Faltan: ${fmt(Math.max(meta.total-meta.ahorrado,0))}`;
  document.getElementById('abonarMonto').value            = meta.cuotaMensual||'';
  document.getElementById('modalAbonar').classList.add('open');
}
function cerrarAbonar() { document.getElementById('modalAbonar').classList.remove('open'); }
function confirmarAbono() {
  const monto = Number(document.getElementById('abonarMonto').value);
  if (!monto||monto<=0) { showToast('Ingresa un monto válido','red'); return; }
  const meta = metas[_abonarIdx];
  const prev = meta.ahorrado;
  meta.ahorrado = Math.min(meta.ahorrado+monto, meta.total);
  if (!meta.abonos) meta.abonos = [];
  meta.abonos.push({ fecha: todayStr(), monto });
  guardar(); cerrarAbonar(); renderSavings();
  showToast(`Abono de ${fmt(monto)} registrado ✓`,'green');
  if (prev<meta.total && meta.ahorrado>=meta.total) setTimeout(()=>showToast(`🎉 ¡Meta "${meta.nombre}" alcanzada!`,'green'),600);
}

// ============================================================
// SETTINGS
// ============================================================
function renderSettings() {
  const el = document.getElementById('inputLimiteOcio');
  if (el) el.value = limiteOcio;
  const ingEl = document.getElementById('cfgIngreso');
  if (ingEl) ingEl.value = PERFIL.ingresoMensual;

  const gfEl = document.getElementById('gastosFijosConfig');
  if (gfEl) {
    gfEl.innerHTML = Object.entries(PERFIL.gastosFijos).map(([nombre,valor]) => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span style="color:var(--text2)">${nombre}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--red)">-${fmt(valor)}</span>
      </div>`).join('') + `
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:600">
        <span>Total fijos</span><span style="font-family:'DM Mono',monospace;color:var(--red)">-${fmt(totalGastosFijos())}</span>
      </div>`;
  }
}

function guardarConfig() {
  const v = Number(document.getElementById('cfgIngreso')?.value);
  if (v > 0) { PERFIL.ingresoMensual = v; guardar(); showToast('Ingreso actualizado ✓','green'); }
}

function guardarLimiteOcio() {
  const val = Number(document.getElementById('inputLimiteOcio').value);
  if (!val||val<=0) { showToast('Ingresa un límite válido','red'); return; }
  limiteOcio = val; alertaOcioMostrada = false; guardar(); showToast('Límite guardado ✓','green');
}

function editarGastosFijos() {
  showToast('Edita los valores directamente en app.js en el objeto PERFIL.gastosFijos','blue');
}

function limpiarTodos() {
  if (!confirm('¿Eliminar TODOS los datos? Irreversible.')) return;
  if (!confirm('Última confirmación: ¿estás seguro?')) return;
  gastos=[]; metas=[]; alertaOcioMostrada=false;
  ['ahorrapp_gastos','ahorrapp_metas','ahorrapp_lastSaved','ahorrapp_perfil','gastos','metaAhorro'].forEach(k => localStorage.removeItem(k));
  switchTab('dashboard');
  showToast('Datos eliminados','red');
}

// ============================================================
// EXPORTS
// ============================================================
function exportarCSV() {
  if (!gastos.length) { showToast('No hay datos','red'); return; }
  const rows = [['Fecha','Descripcion','Tipo','Categoria','Monto']];
  [...gastos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).forEach(g => rows.push([g.fecha,`"${g.descripcion.replace(/"/g,'""')}"`,g.tipo,g.categoria,g.monto]));
  const blob = new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\n')],{type:'text/csv;charset=utf-8;'});
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`ahorrapp_${todayStr()}.csv`});
  a.click();
  showToast('CSV exportado ✓','green');
}

function exportarJSON() {
  const payload = JSON.stringify({version:3,gastos,metas,limiteOcio,PERFIL,exportDate:new Date().toISOString()},null,2);
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([payload],{type:'application/json'})),download:`ahorrapp_backup_${todayStr()}.json`});
  a.click();
  showToast('Backup exportado ✓','green');
}

function importarJSON() { document.getElementById('inputImportJSON').click(); }
function procesarImportJSON(event) {
  const file = event.target.files[0]; if(!file)return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.gastos)) throw new Error('Formato inválido');
      if (!confirm(`¿Importar ${data.gastos.length} movimientos?`)) return;
      gastos=data.gastos; metas=data.metas||[]; limiteOcio=data.limiteOcio||500000;
      if (data.PERFIL) Object.assign(PERFIL, data.PERFIL);
      guardar(); switchTab('dashboard'); showToast('Datos importados ✓','green');
    } catch { showToast('Error al leer el archivo','red'); }
  };
  reader.readAsText(file);
  event.target.value='';
}

// ============================================================
// IA FINANCIERO — Anthropic API
// ============================================================
function buildContextoFinanciero() {
  const mes = mesActual();
  const gMes = gastos.filter(g => g.fecha && g.fecha.startsWith(mes));
  const ingresosMes = gMes.filter(g => g.tipo==='ingreso').reduce((s,g)=>s+g.monto,0);
  const egresosMes  = gMes.filter(g => g.tipo==='gasto').reduce((s,g)=>s+g.monto,0);
  const totalAhorro = metas.reduce((s,m)=>s+m.ahorrado,0);
  const deudaRestante = calcDeudaRestante();

  const cuotaTC = Number(document.getElementById('deudaCuota')?.value || 750000);
  const disponible = PERFIL.ingresoMensual - totalGastosFijos() - cuotaTC;

  // Ultimas 20 transacciones
  const ultimasTx = [...gastos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).slice(0,20)
    .map(g=>`${g.fecha} | ${g.tipo==='ingreso'?'+':'-'}${fmt(g.monto)} | ${g.categoria} | ${g.descripcion}`).join('\n');

  return `
PERFIL FINANCIERO DEL USUARIO:
- Ingreso mensual neto: ${fmt(PERFIL.ingresoMensual)}
- Moneda: Pesos colombianos (COP)
- Ciudad: Bogotá, Colombia

GASTOS FIJOS MENSUALES:
${Object.entries(PERFIL.gastosFijos).map(([k,v])=>`  - ${k}: ${fmt(v)}`).join('\n')}
  TOTAL FIJOS: ${fmt(totalGastosFijos())}

DEUDA TARJETA DE CRÉDITO:
- Saldo actual: ${fmt(deudaRestante)} (inicial: ${fmt(PERFIL.deuda.saldoInicial)})
- Tasa mensual: ${(PERFIL.deuda.tasaMensual*100).toFixed(3)}% (~${((Math.pow(1+PERFIL.deuda.tasaMensual,12)-1)*100).toFixed(1)}% EA)
- Cuota mensual: ${fmt(cuotaTC)} (día 16 de cada mes)
- Cuota de manejo: ${fmt(PERFIL.deuda.cuotaManejo)}/mes
- Intereses registrados este periodo: $89.000

DISPONIBLE PARA AHORRO (post fijos + TC): ${fmt(Math.max(0,disponible))}

CESANTÍAS:
- Actuales (disponibles): ${fmt(PERFIL.cesantias.hoy)}
- Proyectadas febrero 2027: ${fmt(PERFIL.cesantias.feb2027)}
- Total cesantías: ${fmt(PERFIL.cesantias.hoy + PERFIL.cesantias.feb2027)}

META PRINCIPAL — APARTAMENTO:
- Fecha objetivo: Febrero 2027 (~22 meses restantes)
- Valor estimado apartamento: ${fmt(PERFIL.metaApartamento.valor)}
- Cuota inicial necesaria (30%): ${fmt(PERFIL.metaApartamento.valor * 0.3)}
- Total ahorros en metas: ${fmt(totalAhorro)}
- Meses restantes: ~${Math.max(0, (new Date(2027,1,1).getFullYear()-new Date().getFullYear())*12 + (new Date(2027,1,1).getMonth()-new Date().getMonth()))}

RESUMEN MES ACTUAL:
- Ingresos registrados: ${fmt(ingresosMes)}
- Egresos registrados: ${fmt(egresosMes)}
- Balance: ${fmt(ingresosMes-egresosMes)}

METAS DE AHORRO ACTIVAS:
${metas.length ? metas.map(m=>`  - ${m.nombre}: ${fmt(m.ahorrado)} / ${fmt(m.total)} (${Math.round(m.ahorrado/m.total*100)}%)`).join('\n') : '  Sin metas registradas'}

ÚLTIMOS 20 MOVIMIENTOS:
${ultimasTx || '  Sin movimientos registrados'}

PLAN DE AHORRO RECOMENDADO:
- Fase 1 (meses 1-8, mientras paga TC): Ahorro mínimo $1.268.000/mes
- Fase 2 (meses 9-22, post TC): Ahorro mínimo $2.018.000/mes
- Total proyectado feb 2027: ~$63.766.000
`;
}

async function enviarMensajeIA() {
  const input = document.getElementById('aiInput');
  const msg   = input.value.trim();
  if (!msg) return;

  input.value = '';
  agregarMensajeChat('user', msg);
  mostrarTyping();

  chatHistory.push({ role: 'user', content: msg });

  try {
    const contexto = buildContextoFinanciero();
    const systemPrompt = `Eres un asesor financiero personal experto en finanzas personales colombianas. Tienes acceso completo a los datos financieros del usuario. 

Tu rol:
- Analizar la situación financiera del usuario con datos reales
- Detectar problemas y oportunidades específicas
- Dar recomendaciones concretas y accionables (no genéricas)
- Proyectar escenarios con números exactos
- Alertar sobre movimientos financieros riesgosos
- Acompañar el plan de ahorro para comprar apartamento en febrero 2027
- Ser directo, práctico y motivador

CONTEXTO FINANCIERO DEL USUARIO:
${contexto}

Responde siempre en español, con números concretos en COP. Usa emojis para destacar puntos clave. Máximo 350 palabras por respuesta. Si detectas algo preocupante, dilo directamente.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: chatHistory.slice(-10),
      })
    });

    const data = await response.json();
    ocultarTyping();

    if (data.content && data.content[0]) {
      const respuesta = data.content[0].text;
      chatHistory.push({ role: 'assistant', content: respuesta });
      agregarMensajeChat('assistant', respuesta);
    } else {
      agregarMensajeChat('assistant', '⚠️ Hubo un error al conectar con el servicio de IA. Revisa tu conexión.');
    }
  } catch (err) {
    ocultarTyping();
    agregarMensajeChat('assistant', '⚠️ Error de conexión con la IA. Asegúrate de estar usando la app en claude.ai para acceder al servicio.');
  }
}

function agregarMensajeChat(rol, texto) {
  const container = document.getElementById('aiMessages');
  const div = document.createElement('div');
  div.className = `ai-msg ${rol}`;
  div.innerHTML = `<div class="ai-msg-label">${rol==='user'?'👤 Tú':'🤖 Asesor IA'}</div>${texto.replace(/\n/g,'<br>')}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function mostrarTyping() {
  const container = document.getElementById('aiMessages');
  const div = document.createElement('div');
  div.id = 'aiTyping';
  div.className = 'ai-typing';
  div.innerHTML = `<div class="ai-typing-dots"><span></span><span></span><span></span></div> Analizando tus finanzas...`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function ocultarTyping() {
  const el = document.getElementById('aiTyping');
  if (el) el.remove();
}

function quickAsk(msg) {
  document.getElementById('aiInput').value = msg;
  enviarMensajeIA();
}

function aiEnter(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensajeIA(); }
}

function limpiarChat() {
  chatHistory = [];
  const container = document.getElementById('aiMessages');
  container.innerHTML = `<div class="ai-msg assistant"><div class="ai-msg-label">🤖 Asesor IA</div>Chat limpiado. ¿En qué te puedo ayudar?</div>`;
}

// ============================================================
// UTILITIES
// ============================================================
function fmt(n) { return '$' + Number(n||0).toLocaleString('es-CO'); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function mesActual() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function setText(id,txt,color) { const el=document.getElementById(id); if(!el)return; el.textContent=txt; if(color)el.style.color=color; }
function catColor(cat) {
  return { ocio:'#ff5c6c', comida:'#00d68f', transporte:'#4d9fff', servicios:'#b57bee', educacion:'#ffc857', salud:'#22d3ee', deportes:'#fb923c', sueldo:'#00d68f', arriendo:'#f97316', deuda:'#ff5c6c', ahorro:'#4d9fff', familia:'#ec4899', mascota:'#a78bfa', otros:'#7b9fc0' }[cat]||'#7b9fc0';
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  cargar();
  switchTab('dashboard');

  // Cerrar modales al click exterior
  document.getElementById('modalMeta').addEventListener('click', e => { if(e.target===e.currentTarget) cerrarModalMeta(); });
  document.getElementById('modalAbonar').addEventListener('click', e => { if(e.target===e.currentTarget) cerrarAbonar(); });
});
