require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const path = require("path");

const {
    crearSesionAutomatica,
    loginConCredenciales,
    eliminarSesion,
    hasSession
} = require("./scraper/utils/session");

const { getAsistencia } = require("./scraper/attendance");
const { getNotas } = require("./scraper/grades");

const app = express();

// ── Seguridad ──────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ── Rate limiting general: 30 req/min por IP ───────────────
const generalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: "Demasiadas solicitudes. Intenta de nuevo en un minuto." }
});

// ── Rate limiting login: 5 intentos/min por IP ─────────────
const loginLimiter = rateLimit({
    windowMs: 60000,
    max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: "Demasiados intentos de login. Espera un minuto." }
});

app.use(generalLimiter);

// ── JWT Helpers ────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_cambiar";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "7d";

function generateToken(userId) {
    return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "Token requerido" });
    }

    try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.sub;
        next();
    } catch (error) {
        return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "Token inválido o expirado" });
    }
}

// ── Validación de userId ───────────────────────────────────
const USER_ID_REGEX = /^[a-zA-Z0-9._-]{1,50}$/;

function sanitizeUserId(userId) {
    if (!userId || typeof userId !== "string") return null;
    const cleaned = userId.trim();
    if (!USER_ID_REGEX.test(cleaned)) return null;
    return cleaned;
}

// ── Cache en memoria ───────────────────────────────────────
const cacheNotas = new Map();
const cacheNotasTime = new Map();
const cacheAsistencia = new Map();
const cacheAsistenciaTime = new Map();
const actualizandoNotas = new Map();
const actualizandoAsistencia = new Map();
const alertasNotas = new Map();

function getAlertas(userId) {
    if (!alertasNotas.has(userId)) alertasNotas.set(userId, []);
    return alertasNotas.get(userId);
}

function limpiarCacheUsuario(userId) {
    for (const [key] of cacheNotas) {
        if (key === userId || key.startsWith(userId + ":")) cacheNotas.delete(key);
    }
    for (const [key] of cacheNotasTime) {
        if (key === userId || key.startsWith(userId + ":")) cacheNotasTime.delete(key);
    }
    cacheAsistencia.delete(userId);
    cacheAsistenciaTime.delete(userId);
    alertasNotas.delete(userId);
}

// ── Rutas públicas (sin auth) ──────────────────────────────
app.get("/", (req, res) => {
    res.json({ ok: true, message: "UPAO PX ACTIVO", version: "2.0.0" });
});

app.post("/auth/login", loginLimiter, async (req, res) => {
    const { usuario, password, remember } = req.body;

    if (!usuario || !password) {
        return res.status(400).json({ ok: false, message: "Usuario y contraseña son requeridos" });
    }

    const userId = sanitizeUserId(usuario);
    if (!userId) {
        return res.status(400).json({ ok: false, message: "Formato de usuario inválido" });
    }

    try {
        await loginConCredenciales(userId, password, !!remember);
        limpiarCacheUsuario(userId);

        const token = generateToken(userId);

        res.json({
            ok: true,
            token,
            userId,
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

// ── Rutas protegidas (requieren JWT) ───────────────────────
app.use("/notas", verifyToken);
app.use("/asistencia", verifyToken);
app.use("/notas-alertas", verifyToken);
app.use("/auth/logout", verifyToken);
app.use("/auth/status", verifyToken);

app.get("/auth/status", (req, res) => {
    res.json({
        ok: true,
        authenticated: hasSession(req.userId)
    });
});

app.post("/auth/logout", (req, res) => {
    try {
        eliminarSesion(req.userId);
        limpiarCacheUsuario(req.userId);

        res.json({ ok: true, message: "Sesión cerrada correctamente" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Error al cerrar sesión" });
    }
});

app.get("/notas/periodos", (req, res) => {
    if (!hasSession(req.userId)) {
        return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "No hay sesión activa" });
    }

    const periodos = [
        { codigo: "202610", nombre: "2026 — I (Actual)" },
        { codigo: "202520", nombre: "2025 — II" },
        { codigo: "202510", nombre: "2025 — I" },
        { codigo: "202420", nombre: "2024 — II" },
        { codigo: "202410", nombre: "2024 — I" }
    ];

    res.json({ ok: true, data: periodos });
});

app.get("/notas", async (req, res) => {
    const userId = req.userId;
    const termCode = req.query.termCode || null;

    try {
        const force = req.query.force === "true";
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
            message: isAuthError ? "Sesión UPAO expirada" : "Error al obtener notas"
        });
    }
});

app.get("/asistencia", async (req, res) => {
    const userId = req.userId;

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
            message: isAuthError ? "Sesión UPAO expirada" : "Error al obtener asistencia",
            cached: cacheAsistencia.has(userId),
            updatedAt: cacheAsistenciaTime.get(userId),
            data: cacheAsistencia.get(userId) || []
        });
    }
});

app.get("/notas-alertas", (req, res) => {
    const alertas = getAlertas(req.userId);
    res.json({ ok: true, total: alertas.length, data: alertas });
});

app.post("/notas-alertas/visto", (req, res) => {
    alertasNotas.set(req.userId, []);
    res.json({ ok: true, message: "Alertas marcadas como vistas" });
});

// ── Funciones internas ─────────────────────────────────────
async function actualizarNotas(userId, termCode = null) {
    const cacheKey = termCode ? `${userId}:${termCode}` : userId;
    if (actualizandoNotas.get(cacheKey)) return cacheNotas.get(cacheKey) || [];

    actualizandoNotas.set(cacheKey, true);

    const periodoLog = termCode || "202610 (actual)";
    console.log(`Actualizando notas de ${userId} para periodo ${periodoLog}...`);

    try {
        const notasAnteriores = cacheNotas.get(cacheKey) || null;
        const notasNuevas = await getNotas(userId, termCode);

        if (notasAnteriores) {
            const cambios = detectarCambiosNotas(notasAnteriores, notasNuevas);
            if (cambios.length > 0) {
                const alertas = getAlertas(userId);
                alertas.push(...cambios);
                console.log(`${cambios.length} cambios nuevos en notas de ${userId}`);
            }
        }

        cacheNotas.set(cacheKey, notasNuevas);
        cacheNotasTime.set(cacheKey, new Date().toISOString());

        return notasNuevas;
    } finally {
        actualizandoNotas.set(cacheKey, false);
    }
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
            cambios.push(crearAlerta(nuevoCurso, `${nombrePadre} - ${subNuevo.nombre}`, subNuevo.puntaje, "Nuevo subcomponente"));
        }

        if (subAnterior && subAnterior.puntaje !== subNuevo.puntaje && subNuevo.puntaje) {
            cambios.push(crearAlerta(nuevoCurso, `${nombrePadre} - ${subNuevo.nombre}`, subNuevo.puntaje, "Subcomponente actualizado"));
        }
    });
}

function crearAlerta(curso, componente, puntaje, tipo) {
    return {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tipo,
        curso: curso.course,
        codigo: curso.codigo,
        nrc: curso.nrc,
        componente,
        puntaje,
        mensaje: `${tipo}: ${curso.course} - ${componente}: ${puntaje}/20`,
        fecha: new Date().toISOString(),
        visto: false
    };
}

// ── Archivos estáticos y arranque ──────────────────────────
app.use("/web", express.static(path.join(__dirname, "../web")));

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log(`Servidor v2.0.0 iniciado en puerto ${PORT}`);
});

// ── Graceful shutdown ──────────────────────────────────────
function shutdown(signal) {
    console.log(`\n${signal} recibido. Cerrando servidor...`);
    server.close(() => {
        console.log("Servidor cerrado.");
        process.exit(0);
    });

    setTimeout(() => {
        console.error("Forzando cierre.");
        process.exit(1);
    }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
