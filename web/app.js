const API = "http://localhost:3000";

let currentModule = null;

const titles = {
    notas: "Notas",
    asistencia: "Asistencia",
    horario: "Horario",
    historial: "Historial",
    cuenta: "Cuenta"
};

const subtitles = {
    notas: "EP1, Parcial, EP2, Final y subcomponentes en tiempo real",
    asistencia: "Porcentaje de asistencia por curso",
    horario: "Horario académico del ciclo",
    historial: "Historial académico",
    cuenta: "Estado de cuenta"
};

async function openModule(type) {
    currentModule = type;

    document.getElementById("home").style.display = "none";
    document.getElementById("view").style.display = "block";
    document.getElementById("title").innerText = titles[type] || type;
    document.getElementById("subtitle").innerText = subtitles[type] || "Consulta académica";

    await loadModule(type, false);
}

async function loadModule(type, force = false) {
    const status = document.getElementById("status");
    const content = document.getElementById("content");

    status.innerText = force
        ? "🔄 Actualizando desde UPAO..."
        : "⚡ Cargando datos guardados...";

    if (!force) {
        content.innerHTML = renderSkeleton();
    }

    try {
        const url = force ? `${API}/${type}?force=true` : `${API}/${type}`;
        const res = await fetch(url);
        const json = await res.json();

        if (!json.ok) {
            content.innerHTML = `<div class="error">❌ ${json.message || "Error en el servidor"}</div>`;
            status.innerText = "Error";
            return;
        }

        const data = json.data || [];

        if (!Array.isArray(data) || data.length === 0) {
            content.innerHTML = `
                <div class="empty">
                    ⚠️ Sin datos disponibles.
                    <br><br>
                    Presiona <b>Actualizar</b> para consultar UPAO.
                </div>
            `;
            status.innerText = "Sin datos";
            return;
        }

        status.innerText = construirEstado(json, data.length);

        if (type === "notas") {
            renderNotas(data);
            return;
        }

        if (type === "asistencia") {
            renderAsistencia(data);
            return;
        }

        renderGeneric(data);

    } catch (error) {
        status.innerText = "Error de conexión";
        content.innerHTML = `
            <div class="error">
                ❌ No se pudo conectar con el backend.
                <br><br>
                Asegúrate de tener corriendo:
                <br>
                <b>node index.js</b>
            </div>
        `;
    }
}

function construirEstado(json, total) {
    const modo = json.cached ? "⚡ Caché" : "🔄 UPAO";
    const actualizando = json.updating ? " • actualizando en segundo plano" : "";
    const fecha = json.updatedAt ? ` • ${formatearFecha(json.updatedAt)}` : "";

    return `✅ ${total} registros • ${modo}${fecha}${actualizando}`;
}

/* =========================
   NOTAS PREMIUM
========================= */
function renderNotas(data) {
    const content = document.getElementById("content");

    content.innerHTML = data.map(curso => {
        const promedioActual = calcularPromedioActual(curso);
        const promedioPonderado = calcularPromedioPonderado(curso);
        const finalNecesario = calcularFinalNecesario(curso);
        const estadoCurso = obtenerEstadoCurso(promedioPonderado);

        return `
            <div class="nota-card">
                <div class="nota-header">
                    <div>
                        <div class="nota-title">📘 ${curso.course || "Curso"}</div>
                        <div class="nota-meta">
                            NRC ${curso.nrc || "--"} • ${curso.codigo || "--"}
                        </div>
                    </div>

                    <div class="nota-promedio ${estadoCurso.clase}">
                        <span>${estadoCurso.label}</span>
                        <strong>${promedioActual || "--"}</strong>
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

    if (peso === 0) return "";

    return (suma / peso).toFixed(2);
}

function calcularPromedioPonderado(curso) {
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
        const promedio = (
            (ep1 || 0) * 0.20 +
            (parcial || 0) * 0.30 +
            (ep2 || 0) * 0.20 +
            final * 0.30
        );

        return promedio >= 10.5
            ? `✅ Curso aprobado con promedio final ${promedio.toFixed(2)}`
            : `⚠️ Promedio final ${promedio.toFixed(2)}. Curso en riesgo`;
    }

    if (ep1 === null || parcial === null || ep2 === null) {
        return `ℹ️ Para calcular el final necesario falta completar EP1, Parcial y EP2.`;
    }

    const acumulado = (ep1 * 0.20) + (parcial * 0.30) + (ep2 * 0.20);
    const necesario = (10.5 - acumulado) / 0.30;

    if (necesario <= 0) return `✅ Ya estás aprobado antes del final.`;
    if (necesario > 20) return `🚨 Necesitarías ${necesario.toFixed(2)} en el final. No alcanza con 20.`;

    return `🎯 Necesitas ${necesario.toFixed(2)} en el final para aprobar.`;
}

function obtenerEstadoCurso(promedio) {
    if (promedio >= 10.5) {
        return {
            label: "Aprobado",
            clase: "ok"
        };
    }

    if (promedio > 0) {
        return {
            label: "En proceso",
            clase: "warn"
        };
    }

    return {
        label: "Pendiente",
        clase: "neutral"
    };
}

/* =========================
   ASISTENCIA
========================= */
function renderAsistencia(data) {
    const content = document.getElementById("content");

    content.innerHTML = data.map(item => {
        const curso = item.title || item.course || item.curso || "Curso";
        const porcentaje = item.percentage || item.porcentaje || item.asistencia || "--";
        const nrc = item.crn || "--";
        const seccion = item.section || "--";

        return `
            <div class="item asistencia-card">
                <div class="item-title">✅ ${curso}</div>
                <div class="item-line"><b>Asistencia:</b> ${porcentaje}</div>
                <div class="item-line"><b>NRC:</b> ${nrc}</div>
                <div class="item-line"><b>Sección:</b> ${seccion}</div>
            </div>
        `;
    }).join("");
}

/* =========================
   GENERIC
========================= */
function renderGeneric(data) {
    const content = document.getElementById("content");

    content.innerHTML = data.map(item => {
        if (typeof item !== "object") return `<div class="item">${item}</div>`;

        return `
            <div class="item">
                ${Object.entries(item)
                    .map(([key, value]) => `<div class="item-line"><b>${key}:</b> ${value}</div>`)
                    .join("")}
            </div>
        `;
    }).join("");
}

/* =========================
   SKELETON
========================= */
function renderSkeleton() {
    return `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
    `;
}

/* =========================
   UTILS
========================= */
function obtenerNumero(valor) {
    if (!valor) return null;

    const numero = parseFloat(
        String(valor)
            .replace(",", ".")
            .replace("/20", "")
            .trim()
    );

    return Number.isNaN(numero) ? null : numero;
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

async function reloadCurrent() {
    if (!currentModule) return;

    if (currentModule === "notas" || currentModule === "asistencia") {
        await loadModule(currentModule, true);
        return;
    }

    await loadModule(currentModule, false);
}

function backHome() {
    currentModule = null;

    document.getElementById("home").style.display = "block";
    document.getElementById("view").style.display = "none";
    document.getElementById("title").innerText = "Dashboard";
    document.getElementById("subtitle").innerText = "Visualiza tus datos académicos desde UPAO PX";
}