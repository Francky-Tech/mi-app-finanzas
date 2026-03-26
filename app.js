// ============================================================
// VARIABLES GLOBALES
// ============================================================
let gastos = [];
let grafica = null;
let graficaCategoriasChart = null;
let alertaMostrada = false;
let indexEditando = null; // índice del gasto que se está editando

// ============================================================
// 1. AGREGAR / GUARDAR GASTO (también maneja edición)
// ============================================================
function agregarGasto() {
  const descripcion = document.getElementById("descripcion").value.trim();
  const monto = Number(document.getElementById("monto").value);
  const tipo = document.getElementById("tipo").value;
  const categoria = document.getElementById("categoria").value;
  const fecha = document.getElementById("fecha").value;
  const limite = Number(localStorage.getItem("limiteOcio")) || 1000000;

  // Validación completa
  if (!descripcion || isNaN(monto) || monto <= 0 || !tipo || !categoria || !fecha) {
    alert("Por favor completa todos los campos correctamente.");
    return;
  }

  if (indexEditando !== null) {
    // ✏️ MODO EDICIÓN: reemplazar el gasto existente
    gastos[indexEditando] = { descripcion, monto, tipo, categoria, fecha };
    indexEditando = null;
    document.getElementById("btnAgregar").textContent = "Agregar";
    document.getElementById("btnCancelarEdicion").style.display = "none";
  } else {
    // ➕ MODO NORMAL: agregar nuevo gasto
    gastos.push({ descripcion, monto, tipo, categoria, fecha });

    // Alerta de ocio con límite
    if (categoria.toLowerCase() === "ocio" && tipo === "gasto") {
      const totalOcio = gastos
        .filter(g => g.categoria.toLowerCase() === "ocio" && g.tipo === "gasto")
        .reduce((sum, g) => sum + g.monto, 0);

      if (totalOcio >= limite && !alertaMostrada) {
        alert(`⚠️ Has superado tu límite de ocio de $${limite.toLocaleString()}`);
        alertaMostrada = true;
      }
    }
  }

  mostrarGastos();
  calcularTotal();
  limpiarCampos();
  guardarDatos();
  actualizarGrafica();
  graficaCategorias();
}

// ============================================================
// 2. ELIMINAR GASTO
// ============================================================
function eliminarGasto(index) {
  gastos.splice(index, 1);

  // Resetear alerta de ocio si ya no se supera el límite
  const limite = Number(localStorage.getItem("limiteOcio")) || 1000000;
  const totalOcio = gastos
    .filter(g => g.categoria.toLowerCase() === "ocio" && g.tipo === "gasto")
    .reduce((sum, g) => sum + g.monto, 0);
  if (totalOcio < limite) alertaMostrada = false;

  guardarDatos();
  mostrarGastos();
  calcularTotal();
  actualizarGrafica();
  graficaCategorias();
}

// ============================================================
// 3. EDITAR GASTO
// ============================================================
function editarGasto(index) {
  const gasto = gastos[index];

  // Cargar datos del gasto en el formulario
  document.getElementById("descripcion").value = gasto.descripcion;
  document.getElementById("monto").value = gasto.monto;
  document.getElementById("tipo").value = gasto.tipo;
  document.getElementById("categoria").value = gasto.categoria;
  document.getElementById("fecha").value = gasto.fecha;

  // Cambiar botón a modo edición
  document.getElementById("btnAgregar").textContent = "💾 Guardar cambios";
  document.getElementById("btnCancelarEdicion").style.display = "inline-block";

  // Guardar el índice que se está editando
  indexEditando = index;

  // Scroll al formulario
  document.getElementById("descripcion").scrollIntoView({ behavior: "smooth" });
  document.getElementById("descripcion").focus();
}

function cancelarEdicion() {
  indexEditando = null;
  limpiarCampos();
  document.getElementById("btnAgregar").textContent = "Agregar";
  document.getElementById("btnCancelarEdicion").style.display = "none";
}


// ============================================================
// 4. FILTROS (fecha y/o categoría)
// ============================================================
function filtrarPorFecha() { aplicarFiltros(); }
function filtrarPorCategoria() { aplicarFiltros(); }

function aplicarFiltros() {
  const fechaFiltro = document.getElementById("filtroFecha").value;
  const categoriaFiltro = document.getElementById("filtroCategoria").value;
  const lista = document.getElementById("lista");
  lista.innerHTML = "";

  const resultados = gastos
    .map((gasto, indexOriginal) => ({ gasto, indexOriginal }))
    .filter(({ gasto }) => {
      const coincideFecha = !fechaFiltro || gasto.fecha === fechaFiltro;
      const coincideCategoria = !categoriaFiltro || gasto.categoria === categoriaFiltro;
      return coincideFecha && coincideCategoria;
    });

  if (resultados.length === 0) {
    const msg = document.createElement("li");
    msg.textContent = "No hay movimientos con esos filtros.";
    msg.style.color = "#9ca3af";
    lista.appendChild(msg);
    return;
  }

  resultados.forEach(({ gasto, indexOriginal }) => {
    const item = document.createElement("li");
    item.textContent = `${gasto.fecha} | ${gasto.descripcion} - $${gasto.monto.toLocaleString()} [${gasto.categoria}]`;
    item.style.color = gasto.tipo === "ingreso" ? "green" : "red";

    const btnEditar = document.createElement("button");
    btnEditar.textContent = " ✏️";
    btnEditar.onclick = () => editarGasto(indexOriginal);

    const btnEliminar = document.createElement("button");
    btnEliminar.textContent = " ❌";
    btnEliminar.onclick = () => eliminarGasto(indexOriginal);

    item.appendChild(btnEditar);
    item.appendChild(btnEliminar);
    lista.appendChild(item);
  });
}

function limpiarFiltros() {
  document.getElementById("filtroFecha").value = "";
  document.getElementById("filtroCategoria").value = "";
  mostrarGastos();
}

// ============================================================
// 5. MOSTRAR GASTOS
// ============================================================
function mostrarGastos() {
  const lista = document.getElementById("lista");
  lista.innerHTML = "";

  gastos.forEach((gasto, index) => {
    const item = document.createElement("li");
    item.textContent = `${gasto.fecha} | ${gasto.descripcion} - $${gasto.monto.toLocaleString()} [${gasto.categoria}]`;
    item.style.color = gasto.tipo === "ingreso" ? "green" : "red";

    const btnEditar = document.createElement("button");
    btnEditar.textContent = " ✏️";
    btnEditar.onclick = () => editarGasto(index);

    const btnEliminar = document.createElement("button");
    btnEliminar.textContent = " ❌";
    btnEliminar.onclick = () => eliminarGasto(index);

    item.appendChild(btnEditar);
    item.appendChild(btnEliminar);
    lista.appendChild(item);
  });
}

// ============================================================
// 5. CALCULAR TOTAL
// ============================================================
function calcularTotal() {
  const total = gastos.reduce((acc, gasto) => {
    return gasto.tipo === "ingreso" ? acc + gasto.monto : acc - gasto.monto;
  }, 0);

  document.getElementById("total").textContent = `$${total.toLocaleString()}`;
}

// ============================================================
// 6. RESUMEN MENSUAL
// ============================================================
function mostrarResumenMensual() {
  const mesFiltro = document.getElementById("filtroMes").value;
  if (!mesFiltro) {
    alert("Por favor selecciona un mes.");
    return;
  }

  // Filtrar gastos del mes seleccionado (formato: YYYY-MM)
  const gastosMes = gastos.filter(g => g.fecha && g.fecha.startsWith(mesFiltro));

  const ingresos = gastosMes
    .filter(g => g.tipo === "ingreso")
    .reduce((sum, g) => sum + g.monto, 0);

  const egresos = gastosMes
    .filter(g => g.tipo === "gasto")
    .reduce((sum, g) => sum + g.monto, 0);

  const balance = ingresos - egresos;

  // Resumen por categoría
  const porCategoria = {};
  gastosMes
    .filter(g => g.tipo === "gasto")
    .forEach(g => {
      if (!porCategoria[g.categoria]) porCategoria[g.categoria] = 0;
      porCategoria[g.categoria] += g.monto;
    });

  // Construir HTML del resumen
  const contenedor = document.getElementById("resumenMensual");

  let categoriasHTML = Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, total]) => `<li><strong>${cat}:</strong> $${total.toLocaleString()}</li>`)
    .join("");

  if (!categoriasHTML) categoriasHTML = "<li>Sin gastos registrados</li>";

  const colorBalance = balance >= 0 ? "#22c55e" : "#ef4444";
  const [anio, mes] = mesFiltro.split("-");
  const nombreMes = new Date(anio, mes - 1).toLocaleString("es", { month: "long", year: "numeric" });

  contenedor.innerHTML = `
    <h4>📅 ${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</h4>
    <p>✅ Ingresos: <strong style="color:#22c55e">$${ingresos.toLocaleString()}</strong></p>
    <p>❌ Egresos: <strong style="color:#ef4444">$${egresos.toLocaleString()}</strong></p>
    <p>💰 Balance: <strong style="color:${colorBalance}">$${balance.toLocaleString()}</strong></p>
    <p>📦 Total movimientos: <strong>${gastosMes.length}</strong></p>
    <p><strong>Gastos por categoría:</strong></p>
    <ul style="padding-left:20px">${categoriasHTML}</ul>
  `;
  contenedor.style.display = "block";
}

// ============================================================
// 6. LIMPIAR CAMPOS
// ============================================================
function limpiarCampos() {
  document.getElementById("descripcion").value = "";
  document.getElementById("monto").value = "";
  document.getElementById("tipo").value = "";
  document.getElementById("categoria").value = "";
  document.getElementById("fecha").value = "";
  document.getElementById("descripcion").focus();
}

// ============================================================
// 7. GRÁFICA INGRESOS VS GASTOS
// ============================================================
function actualizarGrafica() {
  const ingresos = gastos
    .filter(g => g.tipo === "ingreso")
    .reduce((sum, g) => sum + g.monto, 0);

  const gastosTotal = gastos
    .filter(g => g.tipo === "gasto")
    .reduce((sum, g) => sum + g.monto, 0);

  const ctx = document.getElementById("grafica").getContext("2d");

  if (grafica) grafica.destroy();

  grafica = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Ingresos", "Gastos"],
      datasets: [{
        data: [ingresos, gastosTotal],
        backgroundColor: ["#22c55e", "#f97316"]
      }]
    }
  });
}

// ============================================================
// 8. GRÁFICA POR CATEGORÍAS
// ============================================================
function graficaCategorias() {
  const categorias = {};

  gastos
    .filter(g => g.tipo === "gasto")
    .forEach(gasto => {
      if (!categorias[gasto.categoria]) categorias[gasto.categoria] = 0;
      categorias[gasto.categoria] += gasto.monto;
    });

  const labels = Object.keys(categorias);
  const data = Object.values(categorias);

  const ctx = document.getElementById("graficaCategorias").getContext("2d");

  if (graficaCategoriasChart) graficaCategoriasChart.destroy();

  graficaCategoriasChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Gastos por categoría",
        data: data,
        backgroundColor: labels.map(cat => {
          if (cat === "ocio") return "#ef4444";
          if (cat === "comida") return "#22c55e";
          if (cat === "transporte") return "#3b82f6";
          return "#f97316";
        })
      }]
    }
  });
}

// ============================================================
// 9. GUARDAR Y CARGAR (localStorage)
// ============================================================
function guardarDatos() {
  localStorage.setItem("gastos", JSON.stringify(gastos));
}

function cargarDatos() {
  const datos = localStorage.getItem("gastos");
  if (datos) {
    gastos = JSON.parse(datos);
    mostrarGastos();
    calcularTotal();
    actualizarGrafica();
    graficaCategorias();
  }

  const limiteGuardado = localStorage.getItem("limiteOcio");
  if (limiteGuardado) {
    document.getElementById("limiteOcio").value = limiteGuardado;
  }
}

// ============================================================
// 10. MOSTRAR / GUARDAR LÍMITE DE OCIO
// ============================================================
function mostrarLimite() {
  const limite = localStorage.getItem("limiteOcio");
  const input = document.getElementById("limiteOcio");
  const span = document.getElementById("mostrarLimite");
  if (limite) {
    if (input) input.value = limite;
    if (span) span.textContent = Number(limite).toLocaleString();
  }
}

function guardarLimite() {
  const limite = document.getElementById("limiteOcio").value;
  if (limite && Number(limite) > 0) {
    localStorage.setItem("limiteOcio", limite);
    alertaMostrada = false;
    document.getElementById("mostrarLimite").textContent = Number(limite).toLocaleString();
    alert(`✅ Límite de ocio guardado: $${Number(limite).toLocaleString()}`);
  } else {
    alert("Por favor ingresa un límite válido.");
  }
}

// ============================================================
// 11. META DE AHORRO
// ============================================================
function guardarMeta() {
  const nombre     = document.getElementById("metaNombre").value.trim();
  const total      = Number(document.getElementById("metaTotal").value);
  const cuotaSem   = Number(document.getElementById("metaCuotaSemanal").value);
  const cuotaMes   = Number(document.getElementById("metaCuotaMensual").value);

  if (!nombre || total <= 0) {
    alert("Por favor ingresa un nombre y un monto total para la meta.");
    return;
  }

  const meta = { nombre, total, cuotaSemanal: cuotaSem || 0, cuotaMensual: cuotaMes || 0, ahorrado: 0 };
  localStorage.setItem("metaAhorro", JSON.stringify(meta));
  actualizarMeta();
  alert(`✅ Meta "${nombre}" guardada correctamente.`);
}

function abonarMeta() {
  const meta = JSON.parse(localStorage.getItem("metaAhorro"));
  if (!meta) { alert("Primero configura una meta de ahorro."); return; }

  const abono = Number(document.getElementById("abonoMeta").value);
  if (!abono || abono <= 0) { alert("Ingresa un monto válido para abonar."); return; }

  meta.ahorrado = Math.min(meta.ahorrado + abono, meta.total);
  localStorage.setItem("metaAhorro", JSON.stringify(meta));
  document.getElementById("abonoMeta").value = "";
  actualizarMeta();
}

function verificarAlertaMeta() {
  const meta = JSON.parse(localStorage.getItem("metaAhorro"));
  if (!meta) { alert("No tienes ninguna meta configurada."); return; }

  const hoy        = new Date();
  const diaSemana  = hoy.getDay(); // 0=Dom, 1=Lun...
  const diaMes     = hoy.getDate();
  const porcentaje = Math.round((meta.ahorrado / meta.total) * 100);
  const mensajes   = [];

  // Alerta semanal — revisar los lunes (día 1)
  if (diaSemana === 1 && meta.cuotaSemanal > 0) {
    if (meta.ahorrado < meta.cuotaSemanal) {
      mensajes.push(`⚠️ Esta semana deberías haber ahorrado $${meta.cuotaSemanal.toLocaleString()} pero llevas $${meta.ahorrado.toLocaleString()}.`);
    } else {
      mensajes.push(`✅ ¡Cuota semanal cumplida! Llevas $${meta.ahorrado.toLocaleString()}.`);
    }
  }

  // Alerta mensual — revisar el día 1 del mes
  if (diaMes === 1 && meta.cuotaMensual > 0) {
    if (meta.ahorrado < meta.cuotaMensual) {
      mensajes.push(`⚠️ Este mes deberías haber ahorrado $${meta.cuotaMensual.toLocaleString()} pero llevas $${meta.ahorrado.toLocaleString()}.`);
    } else {
      mensajes.push(`✅ ¡Cuota mensual cumplida! Llevas $${meta.ahorrado.toLocaleString()}.`);
    }
  }

  if (mensajes.length === 0) {
    mensajes.push(`📊 Llevas $${meta.ahorrado.toLocaleString()} de $${meta.total.toLocaleString()} (${porcentaje}%).\n\nLas alertas de cuota se activan los lunes (semanal) y el día 1 de cada mes (mensual).`);
  }

  alert(mensajes.join("\n\n"));
}

function actualizarMeta() {
  const meta = JSON.parse(localStorage.getItem("metaAhorro"));
  const contenedor = document.getElementById("metaPanel");
  if (!meta) { contenedor.style.display = "none"; return; }

  const porcentaje = Math.min(Math.round((meta.ahorrado / meta.total) * 100), 100);
  const color = porcentaje >= 100 ? "#22c55e" : porcentaje >= 50 ? "#f59e0b" : "#ef4444";

  contenedor.style.display = "block";
  contenedor.innerHTML = `
    <h4>🎯 ${meta.nombre}</h4>
    <p>Ahorrado: <strong>$${meta.ahorrado.toLocaleString()}</strong> de <strong>$${meta.total.toLocaleString()}</strong></p>
    ${meta.cuotaSemanal ? `<p>📅 Cuota semanal: <strong>$${meta.cuotaSemanal.toLocaleString()}</strong></p>` : ""}
    ${meta.cuotaMensual ? `<p>🗓️ Cuota mensual: <strong>$${meta.cuotaMensual.toLocaleString()}</strong></p>` : ""}
    <div style="background:#374151; border-radius:999px; height:22px; overflow:hidden; margin:10px 0;">
      <div style="width:${porcentaje}%; background:${color}; height:100%; border-radius:999px; transition:width 0.4s ease; display:flex; align-items:center; justify-content:center;">
        <span style="font-size:12px; font-weight:bold; color:white;">${porcentaje}%</span>
      </div>
    </div>
    ${porcentaje >= 100 ? `<p style="color:#22c55e; font-weight:bold;">🎉 ¡Meta alcanzada!</p>` : ""}
  `;
}

function cargarMeta() {
  const meta = JSON.parse(localStorage.getItem("metaAhorro"));
  if (!meta) return;
  document.getElementById("metaNombre").value        = meta.nombre;
  document.getElementById("metaTotal").value         = meta.total;
  document.getElementById("metaCuotaSemanal").value  = meta.cuotaSemanal || "";
  document.getElementById("metaCuotaMensual").value  = meta.cuotaMensual || "";
  actualizarMeta();
}

// ============================================================
// INICIALIZACIÓN
// ============================================================
cargarDatos();
mostrarLimite();
cargarMeta();