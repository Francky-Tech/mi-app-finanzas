// ============================================================
// STATE
// ============================================================
let gastos = [];
let metas  = [];
let limiteOcio = 1000000;
let alertaOcioMostrada = false;
let indexEditando = null;

let chartDonut = null;
let chartBars  = null;
let chartTrend = null;

// ============================================================
// PERSISTENCE — localStorage
// ============================================================
function guardar() {
  localStorage.setItem('ahorrapp_gastos',     JSON.stringify(gastos));
  localStorage.setItem('ahorrapp_metas',      JSON.stringify(metas));
  localStorage.setItem('ahorrapp_limiteOcio', String(limiteOcio));
  localStorage.setItem('ahorrapp_lastSaved',  new Date().toISOString());
  actualizarBadge();
}

function cargar() {
  // Gastos — migrate from old key if needed
  const raw = localStorage.getItem('ahorrapp_gastos') || localStorage.getItem('gastos');
  if (raw) gastos = JSON.parse(raw);

  // Metas — migrate single old meta
  const rawMetas = localStorage.getItem('ahorrapp_metas');
  if (rawMetas) {
    metas = JSON.parse(rawMetas);
  } else {
    const oldMeta = localStorage.getItem('metaAhorro');
    if (oldMeta) {
      const m = JSON.parse(oldMeta);
      if (m && m.nombre) {
        metas = [{ id: Date.now(), nombre: m.nombre, total: m.total, ahorrado: m.ahorrado || 0,
                   cuotaSemanal: m.cuotaSemanal || 0, cuotaMensual: m.cuotaMensual || 0,
                   color: '#3b82f6', fechaObjetivo: '', abonos: [] }];
      }
    }
  }

  // Limite
  const rawLimite = localStorage.getItem('ahorrapp_limiteOcio') || localStorage.getItem('limiteOcio');
  if (rawLimite) {
    limiteOcio = Number(rawLimite);
    const el = document.getElementById('inputLimiteOcio');
    if (el) el.value = limiteOcio;
    const lbl = document.getElementById('lblLimiteActual');
    if (lbl) lbl.textContent = fmt(limiteOcio);
  }

  actualizarBadge();
}

function actualizarBadge() {
  const raw = localStorage.getItem('ahorrapp_lastSaved');
  const el  = document.getElementById('lastSaved');
  if (!el) return;
  if (raw) {
    const d = new Date(raw);
    el.textContent = '● Guardado ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }
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
  const now  = new Date();
  const mes  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const totalBalance = gastos.reduce((a, g) => g.tipo === 'ingreso' ? a + g.monto : a - g.monto, 0);

  const gMes        = gastos.filter(g => g.fecha && g.fecha.startsWith(mes));
  const ingresosMes = gMes.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
  const egresosMes  = gMes.filter(g => g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0);
  const balanceMes  = ingresosMes - egresosMes;

  setText('statBalance',    fmt(totalBalance),  totalBalance >= 0 ? 'var(--green)' : 'var(--red)');
  setText('statIngresosMes', fmt(ingresosMes));
  setText('statEgresosMes',  fmt(egresosMes));
  setText('statBalanceMes',  fmt(balanceMes), balanceMes >= 0 ? 'var(--green)' : 'var(--red)');

  // Recent transactions
  const recent = [...gastos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 6);
  const list   = document.getElementById('recentList');
  list.innerHTML = '';

  if (recent.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Sin movimientos aún</p></div>';
  } else {
    recent.forEach(g => list.appendChild(buildTxRow(g, null, true)));
  }

  // Donut
  buildDonut();
}

function buildDonut() {
  const ingresos = gastos.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
  const egresos  = gastos.filter(g => g.tipo === 'gasto').reduce((s, g)  => s + g.monto, 0);
  const ctx = document.getElementById('chartDonut').getContext('2d');
  if (chartDonut) chartDonut.destroy();

  if (ingresos === 0 && egresos === 0) {
    chartDonut = null;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }

  chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Ingresos', 'Gastos'],
      datasets: [{ data: [ingresos, egresos], backgroundColor: ['#10b981','#ef4444'], borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 12 }, padding: 16 } },
        tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } }
      }
    }
  });
}

// ============================================================
// TRANSACTIONS
// ============================================================
function renderTransactions() {
  // Set default date if empty
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
    showToast('Completa todos los campos correctamente', 'red');
    return;
  }

  const entrada = { descripcion, monto, tipo, categoria, fecha };

  if (indexEditando !== null) {
    gastos[indexEditando] = entrada;
    indexEditando = null;
    document.getElementById('btnGuardar').textContent = 'Agregar';
    document.getElementById('btnCancelarEdicion').style.display = 'none';
    document.getElementById('formTitle').textContent = 'Agregar movimiento';
    showToast('Movimiento actualizado', 'blue');
  } else {
    gastos.push(entrada);

    // Ocio alert
    if (categoria === 'ocio' && tipo === 'gasto' && !alertaOcioMostrada) {
      const totalOcio = gastos.filter(g => g.categoria === 'ocio' && g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0);
      if (totalOcio >= limiteOcio) {
        showToast(`⚠️ Superaste el límite de ocio (${fmt(limiteOcio)})`, 'red');
        alertaOcioMostrada = true;
      }
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
  document.getElementById('btnGuardar').textContent          = '💾 Guardar cambios';
  document.getElementById('btnCancelarEdicion').style.display = 'inline-flex';
  document.getElementById('formTitle').textContent           = 'Editar movimiento';

  document.getElementById('txDescripcion').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('txDescripcion').focus();
}

function cancelarEdicion() {
  indexEditando = null;
  limpiarFormTx();
  document.getElementById('btnGuardar').textContent          = 'Agregar';
  document.getElementById('btnCancelarEdicion').style.display = 'none';
  document.getElementById('formTitle').textContent           = 'Agregar movimiento';
}

function eliminarGasto(index) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  gastos.splice(index, 1);

  const totalOcio = gastos.filter(g => g.categoria === 'ocio' && g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0);
  if (totalOcio < limiteOcio) alertaOcioMostrada = false;

  guardar();
  renderTransactions();
  showToast('Movimiento eliminado', 'red');
}

function limpiarFormTx() {
  document.getElementById('txDescripcion').value = '';
  document.getElementById('txMonto').value       = '';
  document.getElementById('txTipo').value        = '';
  document.getElementById('txCategoria').value   = '';
  document.getElementById('txFecha').value       = todayStr();
}

function aplicarFiltrosTx() {
  const porFecha     = document.getElementById('filtroFecha').value;
  const porCategoria = document.getElementById('filtroCategoria').value;
  const porTipo      = document.getElementById('filtroTipo').value;

  const results = gastos
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => {
      if (porFecha     && g.fecha      !== porFecha)     return false;
      if (porCategoria && g.categoria  !== porCategoria) return false;
      if (porTipo      && g.tipo       !== porTipo)      return false;
      return true;
    })
    .sort((a, b) => new Date(b.g.fecha) - new Date(a.g.fecha));

  const lista = document.getElementById('txLista');
  const count = document.getElementById('txCount');
  lista.innerHTML = '';
  count.textContent = results.length + ' movimiento' + (results.length !== 1 ? 's' : '');

  if (results.length === 0) {
    lista.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>Sin movimientos con esos filtros</p></div>';
    return;
  }

  results.forEach(({ g, i }) => lista.appendChild(buildTxRow(g, i, false)));
}

function limpiarFiltrosTx() {
  document.getElementById('filtroFecha').value     = '';
  document.getElementById('filtroCategoria').value = '';
  document.getElementById('filtroTipo').value      = '';
  aplicarFiltrosTx();
}

function buildTxRow(g, index, readonly) {
  const div = document.createElement('div');
  div.className = 'tx-item';

  const isIngreso = g.tipo === 'ingreso';
  const color     = isIngreso ? 'var(--green)' : 'var(--red)';
  const signo     = isIngreso ? '+' : '−';

  div.innerHTML = `
    <div class="tx-dot" style="background:${color}"></div>
    <div class="tx-info">
      <div class="tx-desc">${esc(g.descripcion)}</div>
      <div class="tx-meta">${g.fecha} · <span style="text-transform:capitalize">${g.categoria}</span></div>
    </div>
    <div class="tx-amount" style="color:${color}">${signo}${fmt(g.monto)}</div>
    ${readonly ? '' : `
    <div class="tx-actions">
      <button class="btn-icon" onclick="editarGasto(${index})" title="Editar">✏️</button>
      <button class="btn-icon" onclick="eliminarGasto(${index})" title="Eliminar">🗑️</button>
    </div>`}
  `;
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
  const ingresos = gm.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0);
  const egresos  = gm.filter(g => g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0);
  const balance  = ingresos - egresos;

  const porCat = {};
  gm.filter(g => g.tipo === 'gasto').forEach(g => {
    porCat[g.categoria] = (porCat[g.categoria] || 0) + g.monto;
  });

  const [y, m] = mes.split('-');
  const nombreMes = new Date(y, m - 1).toLocaleString('es', { month: 'long', year: 'numeric' });
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  const catHTML = Object.entries(porCat).length
    ? Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([cat, total]) => {
        const pct = egresos > 0 ? Math.round((total / egresos) * 100) : 0;
        return `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
              <span style="display:flex;align-items:center;gap:6px">
                <span style="width:9px;height:9px;border-radius:50%;background:${catColor(cat)};display:inline-block"></span>
                ${cap(cat)}
              </span>
              <span>${fmt(total)} <span style="color:var(--text2)">(${pct}%)</span></span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct}%;background:${catColor(cat)}"></div>
            </div>
          </div>`;
      }).join('')
    : '<p style="color:var(--text2);font-size:13px">Sin gastos este mes</p>';

  document.getElementById('resumenMensualContent').innerHTML = `
    <p style="font-size:14px;font-weight:600;margin-bottom:14px;text-transform:capitalize">${nombreMes}</p>
    <div class="stats-grid" style="margin-bottom:18px">
      <div class="stat-card"><div class="stat-label">Ingresos</div><div class="stat-value" style="font-size:19px;color:var(--green)">${fmt(ingresos)}</div></div>
      <div class="stat-card"><div class="stat-label">Egresos</div><div class="stat-value" style="font-size:19px;color:var(--red)">${fmt(egresos)}</div></div>
      <div class="stat-card"><div class="stat-label">Balance</div><div class="stat-value" style="font-size:19px;color:${balance >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(balance)}</div></div>
      <div class="stat-card"><div class="stat-label">Movimientos</div><div class="stat-value" style="font-size:19px">${gm.length}</div></div>
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--text2)">GASTOS POR CATEGORÍA</div>
    ${catHTML}
  `;
}

function buildChartBars() {
  const cats = {};
  gastos.filter(g => g.tipo === 'gasto').forEach(g => {
    cats[g.categoria] = (cats[g.categoria] || 0) + g.monto;
  });

  const labels = Object.keys(cats);
  const data   = Object.values(cats);
  const ctx    = document.getElementById('chartBars').getContext('2d');
  if (chartBars) chartBars.destroy();

  if (labels.length === 0) { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); return; }

  chartBars = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
      datasets: [{ label: 'Total gastos', data, backgroundColor: labels.map(catColor), borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
        y: { ticks: { color: '#94a3b8', callback: v => '$' + v.toLocaleString() }, grid: { color: '#334155' } }
      }
    }
  });
}

function buildChartTrend() {
  const now    = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const lbl = d.toLocaleString('es', { month: 'short', year: '2-digit' });
    months.push({ key, lbl });
  }

  const ing = months.map(({ key }) =>
    gastos.filter(g => g.fecha && g.fecha.startsWith(key) && g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0));
  const eg  = months.map(({ key }) =>
    gastos.filter(g => g.fecha && g.fecha.startsWith(key) && g.tipo === 'gasto').reduce((s, g) => s + g.monto, 0));

  const ctx = document.getElementById('chartTrend').getContext('2d');
  if (chartTrend) chartTrend.destroy();

  chartTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map(m => m.lbl),
      datasets: [
        { label: 'Ingresos', data: ing, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.1)', fill: true, tension: .35, pointBackgroundColor: '#10b981', pointRadius: 4 },
        { label: 'Gastos',   data: eg,  borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.1)',  fill: true, tension: .35, pointBackgroundColor: '#ef4444', pointRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 12 } } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
        y: { ticks: { color: '#94a3b8', callback: v => '$' + v.toLocaleString() }, grid: { color: '#334155' } }
      }
    }
  });
}

// ============================================================
// CSV EXPORT
// ============================================================
function exportarCSV() {
  if (gastos.length === 0) { showToast('No hay datos para exportar', 'red'); return; }

  const rows = [['Fecha', 'Descripcion', 'Tipo', 'Categoria', 'Monto']];
  [...gastos]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .forEach(g => rows.push([g.fecha, `"${g.descripcion.replace(/"/g, '""')}"`, g.tipo, g.categoria, g.monto]));

  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `ahorrapp_${todayStr()}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado ✓', 'green');
}

// ============================================================
// JSON BACKUP / RESTORE
// ============================================================
function exportarJSON() {
  const payload = JSON.stringify({ version: 2, gastos, metas, limiteOcio, exportDate: new Date().toISOString() }, null, 2);
  const blob    = new Blob([payload], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = Object.assign(document.createElement('a'), {
    href: url, download: `ahorrapp_backup_${todayStr()}.json`
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exportado ✓', 'green');
}

function importarJSON() {
  document.getElementById('inputImportJSON').click();
}

function procesarImportJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.gastos)) throw new Error('Formato inválido');

      if (!confirm(`¿Importar backup con ${data.gastos.length} movimientos y ${(data.metas || []).length} metas?\nEsto reemplazará los datos actuales.`)) return;

      gastos     = data.gastos;
      metas      = data.metas  || [];
      limiteOcio = data.limiteOcio || 1000000;

      guardar();
      switchTab('dashboard');
      showToast('Datos importados correctamente ✓', 'green');
    } catch {
      showToast('Error al leer el archivo', 'red');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ============================================================
// SAVINGS
// ============================================================
function renderSavings() {
  const container = document.getElementById('metasList');
  container.innerHTML = '';

  if (metas.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <p>No tienes metas de ahorro todavía</p>
        <p style="font-size:12px;margin-top:8px">Crea tu primera meta con el botón de arriba</p>
      </div>`;
    return;
  }

  metas.forEach((meta, i) => {
    const pct       = Math.min(Math.round((meta.ahorrado / meta.total) * 100), 100);
    const restante  = Math.max(meta.total - meta.ahorrado, 0);
    const barColor  = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)';
    const proyeccion = calcProyeccion(meta);

    const div = document.createElement('div');
    div.className = 'meta-card';
    div.innerHTML = `
      <div class="meta-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="width:12px;height:12px;border-radius:50%;background:${meta.color || '#3b82f6'};display:inline-block;flex-shrink:0"></span>
            <strong style="font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(meta.nombre)}</strong>
            ${pct >= 100 ? '<span style="color:var(--green);font-size:13px;flex-shrink:0">🎉 ¡Lograda!</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text2)">
            ${fmt(meta.ahorrado)} de ${fmt(meta.total)}
            ${meta.cuotaMensual ? ` · Cuota ${fmt(meta.cuotaMensual)}/mes` : ''}
            ${meta.fechaObjetivo ? ` · Objetivo: ${meta.fechaObjetivo}` : ''}
          </div>
          ${proyeccion ? `<div style="font-size:11px;color:var(--blue);margin-top:3px">${proyeccion}</div>` : ''}
        </div>
        <div class="tx-actions" style="margin-left:10px">
          <button class="btn-icon" onclick="abrirAbonar(${i})"  title="Abonar">💰</button>
          <button class="btn-icon" onclick="editarMeta(${i})"   title="Editar">✏️</button>
          <button class="btn-icon" onclick="eliminarMeta(${i})" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="progress-bar" style="height:12px">
        <div class="progress-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-top:4px">
        <span>${pct}% completado</span>
        <span>${restante > 0 ? 'Faltan ' + fmt(restante) : '¡Meta alcanzada!'}</span>
      </div>
      ${meta.abonos && meta.abonos.length > 0 ? `
        <div style="margin-top:8px;font-size:11px;color:var(--text2)">
          Último abono: <strong style="color:var(--text)">${fmt(meta.abonos[meta.abonos.length - 1].monto)}</strong>
          el ${meta.abonos[meta.abonos.length - 1].fecha}
          · Total abonos: ${meta.abonos.length}
        </div>` : ''}
    `;
    container.appendChild(div);
  });
}

function calcProyeccion(meta) {
  const restante = meta.total - meta.ahorrado;
  if (restante <= 0) return '';
  let cuota = 0;
  if (meta.abonos && meta.abonos.length >= 2) {
    cuota = meta.ahorrado / meta.abonos.length;
  } else if (meta.cuotaMensual > 0) {
    cuota = meta.cuotaMensual;
  }
  if (cuota <= 0) return '';
  const meses = Math.ceil(restante / cuota);
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() + meses);
  return `📅 Proyección: ${fecha.toLocaleDateString('es', { month: 'long', year: 'numeric' })} (~${meses} mes${meses !== 1 ? 'es' : ''})`;
}

let _metaEditIdx = null;

function abrirModalMeta(editIdx = null) {
  _metaEditIdx = editIdx;
  if (editIdx !== null) {
    const m = metas[editIdx];
    document.getElementById('metaNombre').value       = m.nombre;
    document.getElementById('metaTotal').value        = m.total;
    document.getElementById('metaCuotaSemanal').value = m.cuotaSemanal || '';
    document.getElementById('metaCuotaMensual').value = m.cuotaMensual || '';
    document.getElementById('metaColor').value        = m.color || '#3b82f6';
    document.getElementById('metaFechaObjetivo').value = m.fechaObjetivo || '';
    document.getElementById('modalMetaTitle').textContent = 'Editar meta';
  } else {
    ['metaNombre','metaTotal','metaCuotaSemanal','metaCuotaMensual','metaFechaObjetivo'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('metaColor').value = '#3b82f6';
    document.getElementById('modalMetaTitle').textContent = 'Nueva meta de ahorro';
  }
  document.getElementById('modalMeta').classList.add('open');
}

function cerrarModalMeta() {
  document.getElementById('modalMeta').classList.remove('open');
}

function guardarModalMeta() {
  const nombre       = document.getElementById('metaNombre').value.trim();
  const total        = Number(document.getElementById('metaTotal').value);
  const cuotaSemanal = Number(document.getElementById('metaCuotaSemanal').value) || 0;
  const cuotaMensual = Number(document.getElementById('metaCuotaMensual').value) || 0;
  const color        = document.getElementById('metaColor').value;
  const fechaObjetivo = document.getElementById('metaFechaObjetivo').value;

  if (!nombre || !total || total <= 0) { showToast('Ingresa un nombre y monto válido', 'red'); return; }

  if (_metaEditIdx !== null) {
    metas[_metaEditIdx] = { ...metas[_metaEditIdx], nombre, total, cuotaSemanal, cuotaMensual, color, fechaObjetivo };
    showToast('Meta actualizada ✓', 'blue');
  } else {
    metas.push({ id: Date.now(), nombre, total, ahorrado: 0, cuotaSemanal, cuotaMensual, color, fechaObjetivo, abonos: [] });
    showToast('Meta creada ✓', 'green');
  }

  guardar();
  cerrarModalMeta();
  renderSavings();
}

function editarMeta(i) { abrirModalMeta(i); }

function eliminarMeta(i) {
  if (!confirm('¿Eliminar esta meta?')) return;
  metas.splice(i, 1);
  guardar();
  renderSavings();
  showToast('Meta eliminada', 'red');
}

let _abonarIdx = null;

function abrirAbonar(i) {
  _abonarIdx = i;
  const meta = metas[i];
  document.getElementById('abonarMetaNombre').textContent = meta.nombre;
  document.getElementById('abonarMetaInfo').textContent   =
    `Ahorrado: ${fmt(meta.ahorrado)} de ${fmt(meta.total)} · Faltan: ${fmt(Math.max(meta.total - meta.ahorrado, 0))}`;
  document.getElementById('abonarMonto').value = meta.cuotaMensual || '';
  document.getElementById('modalAbonar').classList.add('open');
}

function cerrarAbonar() {
  document.getElementById('modalAbonar').classList.remove('open');
}

function confirmarAbono() {
  const monto = Number(document.getElementById('abonarMonto').value);
  if (!monto || monto <= 0) { showToast('Ingresa un monto válido', 'red'); return; }

  const meta = metas[_abonarIdx];
  const prev = meta.ahorrado;
  meta.ahorrado = Math.min(meta.ahorrado + monto, meta.total);
  if (!meta.abonos) meta.abonos = [];
  meta.abonos.push({ fecha: todayStr(), monto });

  guardar();
  cerrarAbonar();
  renderSavings();
  showToast(`Abono de ${fmt(monto)} registrado ✓`, 'green');

  if (prev < meta.total && meta.ahorrado >= meta.total) {
    setTimeout(() => showToast(`🎉 ¡Meta "${meta.nombre}" alcanzada!`, 'green'), 600);
  }
}

// ============================================================
// SETTINGS
// ============================================================
function guardarLimiteOcio() {
  const val = Number(document.getElementById('inputLimiteOcio').value);
  if (!val || val <= 0) { showToast('Ingresa un límite válido', 'red'); return; }
  limiteOcio = val;
  alertaOcioMostrada = false;
  document.getElementById('lblLimiteActual').textContent = fmt(val);
  guardar();
  showToast('Límite guardado ✓', 'green');
}

function limpiarTodos() {
  if (!confirm('¿Eliminar TODOS los datos de Ahorrapp? Esta acción es irreversible.')) return;
  if (!confirm('Última confirmación: ¿estás seguro?')) return;
  gastos = []; metas = []; alertaOcioMostrada = false;
  ['ahorrapp_gastos','ahorrapp_metas','ahorrapp_lastSaved','gastos','metaAhorro'].forEach(k => localStorage.removeItem(k));
  switchTab('dashboard');
  showToast('Todos los datos fueron eliminados', 'red');
}

// ============================================================
// UTILITIES
// ============================================================
function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('es');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function setText(id, txt, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = txt;
  if (color) el.style.color = color;
}

function catColor(cat) {
  return {
    ocio:       '#ef4444',
    comida:     '#10b981',
    transporte: '#3b82f6',
    servicios:  '#8b5cf6',
    educacion:  '#f59e0b',
    salud:      '#06b6d4',
    deportes:   '#f97316',
    sueldo:     '#22c55e',
    otros:      '#94a3b8'
  }[cat] || '#94a3b8';
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  cargar();
  switchTab('dashboard');
});
