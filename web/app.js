const API = window.location.protocol.startsWith("http")
    ? window.location.origin
    : "http://localhost:3000";

let currentSection = "dashboard";
let dataCursos = [];
let actualizando = false;

// Al iniciar la página
document.addEventListener("DOMContentLoaded", async () => {
    const savedUser = localStorage.getItem("upao_username");
    if (savedUser) {
        document.getElementById("username").value = savedUser;
    }
    await checkAuthStatus();
});

async function checkAuthStatus() {
    try {
        const res = await fetch(`${API}/auth/status`);
        const json = await res.json();
        if (json.ok && json.authenticated) {
            hideLogin();
            await actualizarDatos(false);
        } else {
            showLogin();
        }
    } catch (e) {
        console.error("Error al verificar sesión:", e);
        showLogin();
    }
}

function showLogin() {
    document.body.classList.add("logged-out");
}

function hideLogin() {
    document.body.classList.remove("logged-out");
}

// Navegación entre pestañas
function showSection(sectionId) {
    currentSection = sectionId;
    
    // Toggle active classes on buttons
    document.querySelectorAll(".menu-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`menu-${sectionId}`);
    if (activeBtn) activeBtn.classList.add("active");
    
    // Toggle visibility of section containers
    document.querySelectorAll(".section-container").forEach(section => {
        section.classList.remove("active-section");
        section.style.display = "none";
    });
    
    const activeSection = document.getElementById(`${sectionId}-section`);
    if (activeSection) {
        activeSection.classList.add("active-section");
        activeSection.style.display = "block";
    }

    // Cambiar títulos y subtítulos
    const titleEl = document.getElementById("title");
    const subtitleEl = document.getElementById("subtitle");
    if (sectionId === "dashboard") {
        titleEl.innerText = "Resumen Académico";
        subtitleEl.innerText = "Estado general de tus calificaciones y rendimiento";
    } else {
        titleEl.innerText = "Detalle de Cursos";
        subtitleEl.innerText = "Desglose completo de calificaciones por componente y calculadora";
    }
}

// Carga global de datos
async function actualizarDatos(force = false) {
    if (actualizando) return;
    actualizando = true;

    const globalStatus = document.getElementById("global-status");
    const containerTabla = document.getElementById("dashboard-tabla-cursos");
    const containerDetalle = document.getElementById("cursos-detalle-list");

    globalStatus.innerText = force ? "🔄 Actualizando UPAO..." : "⚡ Cargando caché...";
    
    if (force || dataCursos.length === 0) {
        containerTabla.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px;">Cargando cursos...</td></tr>`;
        containerDetalle.innerHTML = renderSkeleton();
    }

    try {
        const url = force ? `${API}/notas?force=true` : `${API}/notas`;
        const res = await fetch(url);

        if (res.status === 401) {
            showLogin();
            globalStatus.innerText = "Sesión expirada";
            actualizando = false;
            return;
        }

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || `Error del servidor (Código ${res.status})`);
        }

        const json = await res.json();
        dataCursos = json.data || [];

        // Renderizar vistas
        renderDashboard(dataCursos, json);
        renderCursosDetallados(dataCursos);

        // Cargar alertas
        await fetchAlertas();

        globalStatus.innerText = construirEstado(json, dataCursos.length);

    } catch (error) {
        console.error("Error al actualizar datos:", error);
        globalStatus.innerText = "Error de conexión";
        
        const errorHtml = `
            <div class="error" style="margin: 20px auto; max-width: 600px;">
                ❌ No se pudo conectar con el servidor backend en <b>${API}</b>.
                <br><br>
                Detalles del error: <i>${error.message}</i>
                <br><br>
                Asegúrate de que el servidor esté iniciado ejecutando:
                <br>
                <code>npm run dev</code> o <code>npm start</code> en la carpeta principal.
            </div>
        `;
        containerTabla.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #fca5a5;">Error al cargar datos.</td></tr>`;
        containerDetalle.innerHTML = errorHtml;
    } finally {
        actualizando = false;
    }
}

function construirEstado(json, total) {
    const modo = json.cached ? "⚡ Caché" : "🔄 UPAO";
    const actualizandoText = json.updating ? " • actualizando..." : "";
    const fecha = json.updatedAt ? ` • ${formatearFecha(json.updatedAt)}` : "";
    return `Listo • ${modo}${fecha}${actualizandoText}`;
}

// Cargar Alertas
async function fetchAlertas() {
    const panelAlertas = document.getElementById("panel-alertas-container");
    const containerAlertas = document.getElementById("dashboard-alertas");

    try {
        const res = await fetch(`${API}/notas-alertas`);
        const json = await res.json();
        
        if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
            panelAlertas.style.display = "block";
            containerAlertas.innerHTML = json.data.map(alerta => {
                const tipoClase = alerta.tipo && alerta.tipo.toLowerCase().includes("nueva") ? "new-grade" : "";
                return `
                    <div class="dashboard-alert-item ${tipoClase}">
                        ${alerta.mensaje}
                    </div>
                `;
            }).join("");
        } else {
            panelAlertas.style.display = "none";
            containerAlertas.innerHTML = "";
        }
    } catch (e) {
        console.error("Error al cargar alertas:", e);
        panelAlertas.style.display = "none";
    }
}

async function marcarAlertasComoVistas() {
    try {
        const res = await fetch(`${API}/notas-alertas/visto`, { method: "POST" });
        const json = await res.json();
        if (json.ok) {
            document.getElementById("panel-alertas-container").style.display = "none";
            document.getElementById("dashboard-alertas").innerHTML = "";
        }
    } catch (e) {
        console.error("Error al limpiar alertas:", e);
    }
}

// Renderizado de Dashboard (Resumen General)
function renderDashboard(data, json) {
    const containerTabla = document.getElementById("dashboard-tabla-cursos");
    
    let totalCreditos = 0;
    let sumaPonderada = 0;
    let cursosAprobados = 0;
    let cursosRiesgo = 0;

    if (data.length === 0) {
        containerTabla.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 30px;">
                    Sin cursos disponibles. Presiona <b>Actualizar</b> para consultar UPAO.
                </td>
            </tr>
        `;
        return;
    }

    const tableRowsHtml = data.map(curso => {
        const creditos = parseInt(curso.creditos) || 0;
        const promedio = parseFloat(calcularPromedioPonderadoCurso(curso)) || 0;
        
        totalCreditos += creditos;
        sumaPonderada += promedio * creditos;

        let estadoLabel = "Pendiente";
        let estadoClass = "warn";

        if (promedio >= 10.5) {
            estadoLabel = "Aprobado";
            estadoClass = "ok";
            cursosAprobados++;
        } else if (promedio > 0) {
            estadoLabel = "En Riesgo";
            estadoClass = "danger";
            cursosRiesgo++;
        } else {
            cursosRiesgo++;
        }

        const notaEP1 = obtenerPuntajeFormateado(curso.ep1);
        const notaParcial = obtenerPuntajeFormateado(curso.parcial);
        const notaEP2 = obtenerPuntajeFormateado(curso.ep2);
        const notaFinal = obtenerPuntajeFormateado(curso.final);

        return `
            <tr class="clickable-row" onclick="openCourseModal('${curso.nrc}')" title="Ver detalle de ${curso.course || 'curso'}">
                <td class="bold">📘 ${curso.course || "Curso"}</td>
                <td>${curso.nrc || "--"}</td>
                <td>${creditos}</td>
                <td>${notaEP1}</td>
                <td>${notaParcial}</td>
                <td>${notaEP2}</td>
                <td>${notaFinal}</td>
                <td class="avg-cell ${estadoClass}">${promedio > 0 ? promedio.toFixed(2) : "--"}</td>
                <td><span class="badge-status ${estadoClass}">${estadoLabel}</span></td>
            </tr>
        `;
    }).join("");

    containerTabla.innerHTML = tableRowsHtml;

    // Calcular Promedio General Ponderado
    const promedioGeneral = totalCreditos > 0 ? (sumaPonderada / totalCreditos) : 0;

    // Actualizar tarjetas de métricas
    document.getElementById("metric-promedio").innerText = promedioGeneral > 0 ? promedioGeneral.toFixed(2) : "--";
    document.getElementById("metric-creditos").innerText = totalCreditos > 0 ? totalCreditos : "--";
    document.getElementById("metric-aprobados").innerText = cursosAprobados;
    document.getElementById("metric-riesgo").innerText = cursosRiesgo;
}

// Renderizado Detallado de Cursos
function renderCursosDetallados(data) {
    const containerDetalle = document.getElementById("cursos-detalle-list");

    if (data.length === 0) {
        containerDetalle.innerHTML = `
            <div class="empty">
                ⚠️ Sin cursos detallados. Presiona <b>Actualizar</b> para consultar UPAO.
            </div>
        `;
        return;
    }

    containerDetalle.innerHTML = data.map(curso => {
        const promedioActual = calcularPromedioActual(curso);
        const promedioPonderado = calcularPromedioPonderadoCurso(curso);
        const finalNecesario = calcularFinalNecesario(curso);
        const estadoCurso = obtenerEstadoCurso(promedioPonderado);

        return `
            <div class="nota-card">
                <div class="nota-header">
                    <div>
                        <div class="nota-title">📘 ${curso.course || "Curso"}</div>
                        <div class="nota-meta">
                            NRC ${curso.nrc || "--"} • Código ${curso.codigo || "--"} • ${curso.creditos || 0} Créditos
                        </div>
                    </div>

                    <div class="nota-promedio ${estadoCurso.clase}">
                        <span>Promedio Ponderado</span>
                        <strong>${promedioPonderado > 0 ? promedioPonderado.toFixed(2) : "--"}</strong>
                    </div>
                </div>

                <div class="nota-grid">
                    ${renderComponente("EP1", curso.ep1, "20%")}
                    ${renderComponente("Parcial", curso.parcial, "30%")}
                    ${renderComponente("EP2", curso.ep2, "20%")}
                    ${renderComponente("Final", curso.final, "30%")}
                </div>

                <div class="nota-footer ${estadoCurso.clase}">
                    ${finalNecesario}
                </div>
            </div>
        `;
    }).join("");
}

function renderComponente(nombre, componente, pesoDefault) {
    const puntaje = componente?.puntaje || "";
    const calificacion = componente?.calificacion || "";
    const peso = componente?.peso || pesoDefault;
    const porcentaje = componente?.porcentaje || "";
    const subcomponentes = componente?.subcomponentes || [];

    const estado = puntaje ? "completo" : "pendiente";
    const valor = puntaje ? `${normalizarDecimal(puntaje)}/20` : "Pendiente";

    return `
        <div class="nota-box ${estado}">
            <div class="nota-box-top">
                <span>${nombre}</span>
                <small>${peso}%</small>
            </div>

            <div class="nota-value">${valor}</div>

            ${calificacion ? `
                <div class="nota-mini">
                    Redondeada: <b>${calificacion}</b>
                    ${porcentaje ? ` • ${porcentaje}%` : ""}
                </div>
            ` : `
                <div class="nota-mini muted">Sin nota registrada</div>
            `}

            ${subcomponentes.length > 0 ? `
                <div class="sub-list">
                    ${subcomponentes.map(sub => `
                        <div class="sub-item">
                            <span>${limpiarNombreSub(sub.nombre)} • ${sub.peso || "--"}%</span>
                            <b>${sub.puntaje ? `${normalizarDecimal(sub.puntaje)}/20` : "--"}</b>
                        </div>
                    `).join("")}
                </div>
            ` : ""}
        </div>
    `;
}

// Helpers Matemáticos y Formato
function calcularPromedioActual(curso) {
    const ep1 = obtenerNumero(curso.ep1?.puntaje);
    const parcial = obtenerNumero(curso.parcial?.puntaje);
    const ep2 = obtenerNumero(curso.ep2?.puntaje);
    const final = obtenerNumero(curso.final?.puntaje);

    let suma = 0;
    let peso = 0;

    if (ep1 !== null) {
        suma += ep1 * 0.20;
        peso += 0.20;
    }
    if (parcial !== null) {
        suma += parcial * 0.30;
        peso += 0.30;
    }
    if (ep2 !== null) {
        suma += ep2 * 0.20;
        peso += 0.20;
    }
    if (final !== null) {
        suma += final * 0.30;
        peso += 0.30;
    }

    if (peso === 0) return 0;
    return parseFloat((suma / peso).toFixed(2));
}

function calcularPromedioPonderadoCurso(curso) {
    const ep1 = obtenerNumero(curso.ep1?.puntaje) || 0;
    const parcial = obtenerNumero(curso.parcial?.puntaje) || 0;
    const ep2 = obtenerNumero(curso.ep2?.puntaje) || 0;
    const final = obtenerNumero(curso.final?.puntaje) || 0;

    return (ep1 * 0.20) + (parcial * 0.30) + (ep2 * 0.20) + (final * 0.30);
}

function calcularFinalNecesario(curso) {
    const ep1 = obtenerNumero(curso.ep1?.puntaje);
    const parcial = obtenerNumero(curso.parcial?.puntaje);
    const ep2 = obtenerNumero(curso.ep2?.puntaje);
    const final = obtenerNumero(curso.final?.puntaje);

    if (final !== null) {
        const promedio = (ep1 || 0) * 0.20 + (parcial || 0) * 0.30 + (ep2 || 0) * 0.20 + final * 0.30;
        return promedio >= 10.5
            ? `✅ Curso aprobado con promedio final de ${promedio.toFixed(2)}`
            : `🚨 Promedio final de ${promedio.toFixed(2)}. Curso reprobado`;
    }

    if (ep1 === null || parcial === null || ep2 === null) {
        return `ℹ️ Para calcular el examen final necesario falta completar EP1, Parcial y EP2.`;
    }

    const acumulado = (ep1 * 0.20) + (parcial * 0.30) + (ep2 * 0.20);
    const necesario = (10.5 - acumulado) / 0.30;

    if (necesario <= 0) return `✅ Ya estás aprobado antes del examen final.`;
    if (necesario > 20) return `🚨 Necesitarías ${necesario.toFixed(2)} en el examen final. No alcanza con nota 20.`;

    return `🎯 Necesitas obtener ${necesario.toFixed(2)} en el examen final para aprobar.`;
}

function obtenerEstadoCurso(promedio) {
    if (promedio >= 10.5) {
        return { label: "Aprobado", clase: "ok" };
    }
    if (promedio > 0) {
        return { label: "En riesgo", clase: "warn" };
    }
    return { label: "Pendiente", clase: "neutral" };
}

function obtenerNumero(valor) {
    if (!valor) return null;
    const numero = parseFloat(String(valor).replace(",", ".").replace("/20", "").trim());
    return Number.isNaN(numero) ? null : numero;
}

function obtenerPuntajeFormateado(componente) {
    if (!componente || !componente.puntaje) return "--";
    return normalizarDecimal(componente.puntaje);
}

function normalizarDecimal(valor) {
    if (!valor) return "--";
    return String(valor).replace(".", ",");
}

function limpiarNombreSub(nombre) {
    if (!nombre) return "Subcomponente";
    return nombre
        .replace(/^\d+_SUB-/i, "")
        .replace(/SUBCOMPONENTE/i, "Sub")
        .replace(/\s+/g, " ")
        .trim();
}

function formatearFecha(fechaIso) {
    const fecha = new Date(fechaIso);
    return fecha.toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function renderSkeleton() {
    return `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
    `;
}

// Lógica de Login/Logout
async function handleLogin(event) {
    event.preventDefault();
    
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const rememberCheckbox = document.getElementById("remember");
    const loginError = document.getElementById("login-error");
    const btnText = document.getElementById("btn-text");
    const btnLoader = document.getElementById("btn-loader");
    const loginBtn = document.getElementById("login-btn");
    
    const usuario = usernameInput.value.trim();
    const password = passwordInput.value;
    const remember = rememberCheckbox.checked;
    
    if (!usuario || !password) return;
    
    loginError.style.display = "none";
    loginError.innerText = "";
    
    loginBtn.disabled = true;
    btnText.innerText = "Sincronizando UPAO...";
    btnLoader.style.display = "inline-block";
    
    try {
        const res = await fetch(`${API}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ usuario, password, remember })
        });
        
        const json = await res.json();
        
        if (!res.ok || !json.ok) {
            throw new Error(json.message || "Error al iniciar sesión");
        }
        
        localStorage.setItem("upao_username", usuario);
        passwordInput.value = "";
        hideLogin();
        
        showSection("dashboard");
        await actualizarDatos(false);
    } catch (error) {
        console.error("Error en inicio de sesión:", error);
        loginError.innerText = error.message;
        loginError.style.display = "block";
    } finally {
        loginBtn.disabled = false;
        btnText.innerText = "Iniciar Sesión";
        btnLoader.style.display = "none";
    }
}

async function handleLogout() {
    if (!confirm("¿Estás seguro de que deseas cerrar sesión?")) return;
    
    try {
        await fetch(`${API}/auth/logout`, { method: "POST" });
    } catch (e) {
        console.error("Error al cerrar sesión:", e);
    }
    
    showLogin();
    document.getElementById("password").value = "";
    document.getElementById("dashboard-tabla-cursos").innerHTML = "";
    document.getElementById("cursos-detalle-list").innerHTML = "";
    showSection("dashboard");
}

// Proxies de actualización
async function actualizarDatosConFuerza() {
    await actualizarDatos(true);
}

// ==============================================
// MODAL: Vista de Detalle de Curso
// ==============================================

function openCourseModal(nrc) {
    const curso = dataCursos.find(c => String(c.nrc) === String(nrc));
    if (!curso) return;

    const promedio = calcularPromedioPonderadoCurso(curso);
    const estado = obtenerEstadoCurso(promedio);
    const creditos = parseInt(curso.creditos) || 0;

    // Cabecera
    document.getElementById("modal-course-name").innerText = curso.course || "Curso sin nombre";
    document.getElementById("modal-nrc").innerText = `NRC ${curso.nrc || "--"}`;
    document.getElementById("modal-codigo").innerText = `Código ${curso.codigo || "--"}`;
    document.getElementById("modal-creditos").innerText = `${creditos} Crédito${creditos !== 1 ? "s" : ""}`;

    // KPI: promedio
    document.getElementById("modal-promedio").innerText = promedio > 0 ? promedio.toFixed(2) : "--";

    // KPI: estado (con color dinámico)
    const estadoKpi = document.getElementById("modal-estado-kpi");
    const estadoEl = document.getElementById("modal-estado");
    estadoKpi.className = `modal-kpi ${estado.clase}`;
    estadoEl.innerText = estado.label;

    // KPI: créditos
    document.getElementById("modal-creditos-kpi").innerText = creditos || "--";

    // Cuadrícula de componentes
    const gridEl = document.getElementById("modal-components-grid");
    const componentes = [
        { clave: "ep1",     label: "EP1",    pesoDefault: "20" },
        { clave: "parcial", label: "Parcial", pesoDefault: "30" },
        { clave: "ep2",     label: "EP2",    pesoDefault: "20" },
        { clave: "final",   label: "Final",  pesoDefault: "30" }
    ];

    gridEl.innerHTML = componentes
        .map(comp => renderModalComponente(comp.label, curso[comp.clave], comp.pesoDefault))
        .join("");

    // Pie: calculadora de pronóstico
    const footerEl = document.getElementById("modal-footer");
    const mensaje = calcularFinalNecesario(curso);
    let footerClase = "info";
    if (mensaje.startsWith("✅")) footerClase = "ok";
    else if (mensaje.startsWith("🚨")) footerClase = "danger";
    else if (mensaje.startsWith("🎯")) footerClase = "warn";
    footerEl.className = `modal-footer ${footerClase}`;
    footerEl.innerText = mensaje;

    // Mostrar modal
    document.getElementById("course-detail-modal").classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeCourseModal() {
    document.getElementById("course-detail-modal").classList.remove("active");
    document.body.style.overflow = "";
}

function handleModalOverlayClick(event) {
    // Cerrar solo si se hace clic directamente en el overlay (fuera de la tarjeta)
    if (event.target === document.getElementById("course-detail-modal")) {
        closeCourseModal();
    }
}

// Cerrar modal con tecla Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCourseModal();
});

function renderModalComponente(label, componente, pesoDefault) {
    const puntaje = obtenerNumero(componente?.puntaje);
    const calificacion = componente?.calificacion || "";
    const peso = componente?.peso || pesoDefault;
    const subcomponentes = Array.isArray(componente?.subcomponentes)
        ? componente.subcomponentes
        : [];

    // Determinar color del puntaje
    let scoreClass = "neutral";
    if (puntaje !== null) {
        if (puntaje >= 10.5) scoreClass = "ok";
        else if (puntaje >= 8)  scoreClass = "warn";
        else                    scoreClass = "danger";
    }

    const scoreDisplay = puntaje !== null
        ? `<span class="score-value ${scoreClass}">${normalizarDecimal(componente.puntaje)}</span><span class="score-max">/20</span>${calificacion ? `<span class="score-rounded">≈ ${calificacion}</span>` : ""}`
        : `<span class="score-value neutral">--</span><span class="score-max">/20</span>`;

    // Renderizado de subcomponentes
    let subHtml = "";
    if (subcomponentes.length > 0) {
        subHtml = `<div class="modal-sub-list">${
            subcomponentes.map(sub => {
                const notaSub = obtenerNumero(sub.puntaje);
                let notaClase = "neutral";
                if (notaSub !== null) {
                    if (notaSub >= 10.5)  notaClase = "ok";
                    else if (notaSub >= 8) notaClase = "warn";
                    else                   notaClase = "danger";
                }
                const pesoSub = sub.peso ? `${sub.peso}%` : "";
                const notaSubText = notaSub !== null
                    ? normalizarDecimal(sub.puntaje)
                    : "--";
                return `
                    <div class="modal-sub-item">
                        <span class="modal-sub-item-name">${limpiarNombreSub(sub.nombre)}</span>
                        <div class="modal-sub-item-right">
                            ${pesoSub ? `<span class="modal-sub-item-peso">${pesoSub}</span>` : ""}
                            <span class="modal-sub-item-nota ${notaClase}">${notaSubText}</span>
                        </div>
                    </div>
                `;
            }).join("")
        }</div>`;
    } else {
        subHtml = `<div class="modal-no-sub">Sin subcomponentes registrados</div>`;
    }

    const tieneNota = puntaje !== null;
    return `
        <div class="modal-component-card ${tieneNota ? "has-grade" : ""}">
            <div class="modal-comp-header">
                <span class="modal-comp-title">${label}</span>
                <span class="modal-comp-weight">${peso}%</span>
            </div>
            <div class="modal-comp-score">
                ${scoreDisplay}
            </div>
            ${subHtml}
        </div>
    `;
}