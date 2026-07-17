require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const {
    crearSesionAutomatica,
    crearSesionManual,
    loginConCredenciales,
    eliminarSesion,
    hasSession,
    SESSION_FILE,
    CREDENTIALS_FILE
} = require("./scraper/utils/session");
const fs = require("fs");

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
    let authenticated = false;

    if (userId) {
        authenticated = hasSession(userId);
    } else {
        authenticated = fs.existsSync(SESSION_FILE) || fs.existsSync(CREDENTIALS_FILE);
    }

    res.json({
        ok: true,
        authenticated
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
                : "Error al iniciar sesión: " + error.message
        });
    }
});

app.post("/auth/logout", (req, res) => {
    try {
        const userId = req.body.userId || req.query.userId;

        if (userId) {
            eliminarSesion(userId);
            cacheNotas.delete(userId);
            cacheNotasTime.delete(userId);
            cacheAsistencia.delete(userId);
            cacheAsistenciaTime.delete(userId);
            alertasNotas.delete(userId);
        } else {
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
            if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE);
        }

        res.json({
            ok: true,
            message: "Sesión cerrada correctamente"
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error al cerrar sesión",
            error: error.message
        });
    }
});

app.get("/login-auto", async (req, res) => {
    try {
        const userId = req.query.userId || process.env.UPAO_ID;
        await crearSesionAutomatica(userId);
        res.json({ ok: true, message: "Sesión automática creada correctamente" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "No se pudo crear sesión", error: error.message });
    }
});

app.get("/crear-sesion", async (req, res) => {
    try {
        await crearSesionManual();
        res.json({ ok: true, message: "Sesión manual creada correctamente" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "No se pudo crear sesión manual", error: error.message });
    }
});

/* =========================
   NOTAS
========================= */
app.get("/notas", async (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
        return res.status(400).json({
            ok: false,
            message: "Se requiere el parámetro userId"
        });
    }

    try {
        const force = req.query.force === "true";

        if (!force && cacheNotas.has(userId)) {
            return res.json({
                ok: true,
                cached: true,
                updatedAt: cacheNotasTime.get(userId),
                alertas: getAlertas(userId),
                data: cacheNotas.get(userId)
            });
        }

        if (actualizandoNotas.get(userId) && cacheNotas.has(userId)) {
            return res.json({
                ok: true,
                cached: true,
                updating: true,
                updatedAt: cacheNotasTime.get(userId),
                alertas: getAlertas(userId),
                data: cacheNotas.get(userId)
            });
        }

        const data = await actualizarNotas(userId);

        res.json({
            ok: true,
            cached: false,
            updatedAt: cacheNotasTime.get(userId),
            alertas: getAlertas(userId),
            data
        });

    } catch (error) {
        actualizandoNotas.delete(userId);
        const isAuthError = error.message.includes("UNAUTHORIZED");
        res.status(isAuthError ? 401 : 500).json({
            ok: false,
            code: isAuthError ? "UNAUTHORIZED" : "SERVER_ERROR",
            message: isAuthError ? "No hay una sesión activa de UPAO para este usuario" : "Error al obtener notas",
            error: error.message
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
            error: error.message,
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
async function actualizarNotas(userId) {
    if (actualizandoNotas.get(userId)) return cacheNotas.get(userId) || [];

    actualizandoNotas.set(userId, true);

    console.log(`🔄 Actualizando notas desde UPAO para ${userId}...`);

    const notasAnteriores = cacheNotas.get(userId) || null;
    const notasNuevas = await getNotas(userId);

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

    cacheNotas.set(userId, notasNuevas);
    cacheNotasTime.set(userId, new Date().toISOString());
    actualizandoNotas.set(userId, false);

    console.log(`✅ Notas actualizadas en cache para ${userId}`);

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
