require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const {
    crearSesionAutomatica,
    crearSesionManual,
    loginConCredenciales,
    eliminarSesion,
    hasSession
} = require("./scraper/utils/session");

const { getAsistencia } = require("./scraper/attendance");
const { getNotas } = require("./scraper/grades");

const app = express();

app.use(cors());
app.use(express.json());

const cacheNotas = new Map();
const cacheNotasTime = new Map();
const cacheAsistencia = new Map();
const cacheAsistenciaTime = new Map();
const actualizandoNotas = new Map();
const actualizandoAsistencia = new Map();
const alertasNotas = new Map();

const NOTAS_AUTO_MINUTOS = 30;

function getAlertas(userId) {
    if (!alertasNotas.has(userId)) alertasNotas.set(userId, []);
    return alertasNotas.get(userId);
}

app.get("/", (req, res) => {
    res.send("🚀 UPAO PX ACTIVO");
});

app.get("/auth/status", (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
        return res.status(400).json({
            ok: false,
            message: "Se requiere el parámetro userId"
        });
    }

    res.json({
        ok: true,
        authenticated: hasSession(userId)
    });
});

app.post("/auth/login", async (req, res) => {
    const { usuario, password, remember } = req.body;

    if (!usuario || !password) {
        return res.status(400).json({
            ok: false,
            message: "Usuario y contraseña son requeridos"
        });
    }

    try {
        await loginConCredenciales(usuario, password, !!remember);

        cacheNotas.delete(usuario);
        cacheNotasTime.delete(usuario);
        cacheAsistencia.delete(usuario);
        cacheAsistenciaTime.delete(usuario);
        alertasNotas.set(usuario, []);

        res.json({
            ok: true,
            userId: usuario,
            message: "Sesión iniciada correctamente"
        });
    } catch (error) {
        console.error("Error en POST /auth/login:", error.message);
        res.status(401).json({
            ok: false,
            message: error.message.includes("UNAUTHORIZED")
                ? "Código o contraseña incorrectos"
                : "Error al iniciar sesión"
        });
    }
});

app.post("/auth/logout", (req, res) => {
    try {
        const userId = req.body.userId || req.query.userId;

        if (!userId) {
            return res.status(400).json({
                ok: false,
                message: "Se requiere el parámetro userId"
            });
        }

        eliminarSesion(userId);
        cacheNotas.delete(userId);
        cacheNotasTime.delete(userId);
        cacheAsistencia.delete(userId);
        cacheAsistenciaTime.delete(userId);
        alertasNotas.delete(userId);

        res.json({
            ok: true,
            message: "Sesión cerrada correctamente"
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error al cerrar sesión"
        });
    }
});

app.get("/login-auto", async (req, res) => {
    try {
        const userId = req.query.userId;

        if (!userId) {
            return res.status(400).json({
                ok: false,
                message: "Se requiere el parámetro userId"
            });
        }

        await crearSesionAutomatica(userId);
        res.json({ ok: true, message: "Sesión automática creada correctamente" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "No se pudo crear sesión" });
    }
});

app.get("/crear-sesion", async (req, res) => {
    try {
        await crearSesionManual();
        res.json({ ok: true, message: "Sesión manual creada correctamente" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "No se pudo crear sesión manual" });
    }
});

/* =========================
   PERIODOS DISPONIBLES
========================= */
app.get("/notas/periodos", async (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
        return res.status(400).json({
            ok: false,
            message: "Se requiere el parámetro userId"
        });
    }

    if (!hasSession(userId)) {
        return res.status(401).json({
            ok: false,
            code: "UNAUTHORIZED",
            message: "No hay una sesión activa para este usuario"
        });
    }

    // Lista de períodos disponibles.
    // TODO: Cuando se necesite extraer dinámicamente del portal UPAO,
    // implementar un scraper que lea el selector de términos de la página de notas.
    // Por ahora se retorna una lista razonable con el período actual primero.
    const periodos = [
        { codigo: "202610", nombre: "2026 — I (Actual)" },
        { codigo: "202520", nombre: "2025 — II" },
        { codigo: "202510", nombre: "2025 — I" },
        { codigo: "202420", nombre: "2024 — II" },
        { codigo: "202410", nombre: "2024 — I" }
    ];

    res.json({
        ok: true,
        data: periodos
    });
});

/* =========================
   NOTAS
========================= */
app.get("/notas", async (req, res) => {
    const userId = req.query.userId;
    const termCode = req.query.termCode || null; // Opcional: período específico

    if (!userId) {
        return res.status(400).json({
            ok: false,
            message: "Se requiere el parámetro userId"
        });
    }

    try {
        const force = req.query.force === "true";
        // La clave del cache incluye el termCode para aislar períodos
        const cacheKey = termCode ? `${userId}:${termCode}` : userId;

        if (!force && cacheNotas.has(cacheKey)) {
            return res.json({
                ok: true,
                cached: true,
                updatedAt: cacheNotasTime.get(cacheKey),
                alertas: getAlertas(userId),
                data: cacheNotas.get(cacheKey)
            });
        }

        if (actualizandoNotas.get(cacheKey) && cacheNotas.has(cacheKey)) {
            return res.json({
                ok: true,
                cached: true,
                updating: true,
                updatedAt: cacheNotasTime.get(cacheKey),
                alertas: getAlertas(userId),
                data: cacheNotas.get(cacheKey)
            });
        }

        const data = await actualizarNotas(userId, termCode);

        res.json({
            ok: true,
            cached: false,
            termCode: termCode || "202610",
            updatedAt: cacheNotasTime.get(cacheKey),
            alertas: getAlertas(userId),
            data
        });

    } catch (error) {
        const cacheKey = termCode ? `${userId}:${termCode}` : userId;
        actualizandoNotas.delete(cacheKey);
        const isAuthError = error.message.includes("UNAUTHORIZED");
        res.status(isAuthError ? 401 : 500).json({
            ok: false,
            code: isAuthError ? "UNAUTHORIZED" : "SERVER_ERROR",
            message: isAuthError ? "No hay una sesión activa de UPAO para este usuario" : "Error al obtener notas"
        });
    }
});

/* =========================
   ASISTENCIA
========================= */
app.get("/asistencia", async (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
        return res.status(400).json({
            ok: false,
            message: "Se requiere el parámetro userId"
        });
    }

    try {
        const force = req.query.force === "true";

        if (!force && cacheAsistencia.has(userId) && cacheAsistencia.get(userId).length > 0) {
            return res.json({
                ok: true,
                cached: true,
                updatedAt: cacheAsistenciaTime.get(userId),
                data: cacheAsistencia.get(userId)
            });
        }

        if (actualizandoAsistencia.get(userId) && cacheAsistencia.has(userId) && cacheAsistencia.get(userId).length > 0) {
            return res.json({
                ok: true,
                cached: true,
                updating: true,
                updatedAt: cacheAsistenciaTime.get(userId),
                data: cacheAsistencia.get(userId)
            });
        }

        actualizandoAsistencia.set(userId, true);

        const data = await getAsistencia(userId);

        actualizandoAsistencia.set(userId, false);

        if (!data || data.length === 0) {
            return res.json({
                ok: true,
                cached: cacheAsistencia.has(userId),
                warning: "UPAO devolvió asistencia vacía",
                updatedAt: cacheAsistenciaTime.get(userId),
                data: cacheAsistencia.get(userId) || []
            });
        }

        cacheAsistencia.set(userId, data);
        cacheAsistenciaTime.set(userId, new Date().toISOString());

        res.json({
            ok: true,
            cached: false,
            updatedAt: cacheAsistenciaTime.get(userId),
            data
        });

    } catch (error) {
        actualizandoAsistencia.delete(userId);
        const isAuthError = error.message.includes("UNAUTHORIZED");

        res.status(isAuthError ? 401 : 500).json({
            ok: false,
            code: isAuthError ? "UNAUTHORIZED" : "SERVER_ERROR",
            message: isAuthError ? "No hay una sesión activa de UPAO" : "Error al obtener asistencia",
            cached: cacheAsistencia.has(userId),
            updatedAt: cacheAsistenciaTime.get(userId),
            data: cacheAsistencia.get(userId) || []
        });
    }
});

/* =========================
   ALERTAS DE NOTAS
========================= */
app.get("/notas-alertas", (req, res) => {
    const userId = req.query.userId;
    const alertas = userId ? getAlertas(userId) : [];

    res.json({
        ok: true,
        total: alertas.length,
        data: alertas
    });
});

app.post("/notas-alertas/visto", (req, res) => {
    const userId = req.body.userId || req.query.userId;
    if (userId) {
        alertasNotas.set(userId, []);
    }

    res.json({
        ok: true,
        message: "Alertas marcadas como vistas"
    });
});

/* =========================
   FUNCIONES
========================= */
async function actualizarNotas(userId, termCode = null) {
    const cacheKey = termCode ? `${userId}:${termCode}` : userId;
    if (actualizandoNotas.get(cacheKey)) return cacheNotas.get(cacheKey) || [];

    actualizandoNotas.set(cacheKey, true);

    const periodoLog = termCode || "202610 (actual)";
    console.log(`🔄 Actualizando notas de ${userId} para período ${periodoLog}...`);

    const notasAnteriores = cacheNotas.get(cacheKey) || null;
    const notasNuevas = await getNotas(userId, termCode);

    if (notasAnteriores) {
        const cambios = detectarCambiosNotas(notasAnteriores, notasNuevas);

        if (cambios.length > 0) {
            const alertas = getAlertas(userId);
            alertas.push(...cambios);
            console.log(`🔔 ${cambios.length} cambios nuevos en notas de ${userId}`);
        } else {
            console.log(`✅ No hay cambios nuevos en notas de ${userId}`);
        }
    }

    cacheNotas.set(cacheKey, notasNuevas);
    cacheNotasTime.set(cacheKey, new Date().toISOString());
    actualizandoNotas.set(cacheKey, false);

    console.log(`✅ Notas actualizadas en cache para ${userId} (${periodoLog})`);

    return notasNuevas;
}

function detectarCambiosNotas(anteriores, nuevas) {
    const cambios = [];

    nuevas.forEach(cursoNuevo => {
        const cursoAnterior = anteriores.find(c => c.codigo === cursoNuevo.codigo);

        if (!cursoAnterior) return;

        compararComponente(cambios, cursoAnterior, cursoNuevo, "ep1", "EP1");
        compararComponente(cambios, cursoAnterior, cursoNuevo, "parcial", "Parcial");
        compararComponente(cambios, cursoAnterior, cursoNuevo, "ep2", "EP2");
        compararComponente(cambios, cursoAnterior, cursoNuevo, "final", "Final");
    });

    return cambios;
}

function compararComponente(cambios, anteriorCurso, nuevoCurso, key, nombre) {
    const anterior = anteriorCurso[key] || {};
    const nuevo = nuevoCurso[key] || {};

    if (!anterior.puntaje && nuevo.puntaje) {
        cambios.push(crearAlerta(nuevoCurso, nombre, nuevo.puntaje, "Nueva nota"));
    }

    if (anterior.puntaje && nuevo.puntaje && anterior.puntaje !== nuevo.puntaje) {
        cambios.push(crearAlerta(nuevoCurso, nombre, nuevo.puntaje, "Nota actualizada"));
    }

    compararSubcomponentes(cambios, anteriorCurso, nuevoCurso, key, nombre);
}

function compararSubcomponentes(cambios, anteriorCurso, nuevoCurso, key, nombrePadre) {
    const anteriores = anteriorCurso[key]?.subcomponentes || [];
    const nuevos = nuevoCurso[key]?.subcomponentes || [];

    nuevos.forEach(subNuevo => {
        const subAnterior = anteriores.find(s => s.nombre === subNuevo.nombre);

        if (!subAnterior && subNuevo.puntaje) {
            cambios.push(crearAlerta(
                nuevoCurso,
                `${nombrePadre} - ${subNuevo.nombre}`,
                subNuevo.puntaje,
                "Nuevo subcomponente"
            ));
        }

        if (subAnterior && subAnterior.puntaje !== subNuevo.puntaje && subNuevo.puntaje) {
            cambios.push(crearAlerta(
                nuevoCurso,
                `${nombrePadre} - ${subNuevo.nombre}`,
                subNuevo.puntaje,
                "Subcomponente actualizado"
            ));
        }
    });
}

function crearAlerta(curso, componente, puntaje, tipo) {
    return {
        id: Date.now() + Math.random(),
        tipo,
        curso: curso.course,
        codigo: curso.codigo,
        nrc: curso.nrc,
        componente,
        puntaje,
        mensaje: `🔔 ${tipo}: ${curso.course} - ${componente}: ${puntaje}/20`,
        fecha: new Date().toISOString(),
        visto: false
    };
}

/* =========================
   AUTO UPDATE - Deshabilitado
   (El sync lo maneja el cliente Android vía WorkManager)
========================= */
// setInterval(() => {
//     actualizarNotas().catch(error => {
//         actualizandoNotas = false;
//         console.log("❌ Error auto actualizando notas:", error.message);
//     });
// }, NOTAS_AUTO_MINUTOS * 60 * 1000);

/* =========================
   START
   ========================= */
const PORT = process.env.PORT || 3000;

app.use("/web", express.static(path.join(__dirname, "../web")));

app.listen(PORT, () => {
    console.log(`🔥 Servidor iniciado en puerto ${PORT}`);
    console.log("⏱️ Sync de notas manejado por clientes Android");
});
