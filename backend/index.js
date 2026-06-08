require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
    crearSesionAutomatica,
    crearSesionManual
} = require("./scraper/utils/session");

const { getAsistencia } = require("./scraper/attendance");
const { getNotas } = require("./scraper/grades");

const app = express();

app.use(cors());
app.use(express.json());

let cacheNotas = null;
let cacheNotasTime = null;
let cacheAsistencia = null;
let cacheAsistenciaTime = null;

let actualizandoNotas = false;
let actualizandoAsistencia = false;

let alertasNotas = [];

const NOTAS_AUTO_MINUTOS = 30;

app.get("/", (req, res) => {
    res.send("🚀 UPAO PX ACTIVO");
});

app.get("/login-auto", async (req, res) => {
    try {
        await crearSesionAutomatica();
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
    try {
        const force = req.query.force === "true";

        if (!force && cacheNotas) {
            return res.json({
                ok: true,
                cached: true,
                updatedAt: cacheNotasTime,
                alertas: alertasNotas,
                data: cacheNotas
            });
        }

        if (actualizandoNotas && cacheNotas) {
            return res.json({
                ok: true,
                cached: true,
                updating: true,
                updatedAt: cacheNotasTime,
                alertas: alertasNotas,
                data: cacheNotas
            });
        }

        const data = await actualizarNotas();

        res.json({
            ok: true,
            cached: false,
            updatedAt: cacheNotasTime,
            alertas: alertasNotas,
            data
        });

    } catch (error) {
        actualizandoNotas = false;
        res.status(500).json({
            ok: false,
            message: "Error al obtener notas",
            error: error.message
        });
    }
});

/* =========================
   ASISTENCIA
========================= */
app.get("/asistencia", async (req, res) => {
    try {
        const force = req.query.force === "true";

        if (!force && cacheAsistencia && cacheAsistencia.length > 0) {
            return res.json({
                ok: true,
                cached: true,
                updatedAt: cacheAsistenciaTime,
                data: cacheAsistencia
            });
        }

        if (actualizandoAsistencia && cacheAsistencia && cacheAsistencia.length > 0) {
            return res.json({
                ok: true,
                cached: true,
                updating: true,
                updatedAt: cacheAsistenciaTime,
                data: cacheAsistencia
            });
        }

        actualizandoAsistencia = true;

        const data = await getAsistencia();

        actualizandoAsistencia = false;

        if (!data || data.length === 0) {
            return res.json({
                ok: true,
                cached: !!cacheAsistencia,
                warning: "UPAO devolvió asistencia vacía",
                updatedAt: cacheAsistenciaTime,
                data: cacheAsistencia || []
            });
        }

        cacheAsistencia = data;
        cacheAsistenciaTime = new Date().toISOString();

        res.json({
            ok: true,
            cached: false,
            updatedAt: cacheAsistenciaTime,
            data
        });

    } catch (error) {
        actualizandoAsistencia = false;

        res.status(500).json({
            ok: false,
            message: "Error al obtener asistencia",
            error: error.message,
            cached: !!cacheAsistencia,
            updatedAt: cacheAsistenciaTime,
            data: cacheAsistencia || []
        });
    }
});

/* =========================
   ALERTAS DE NOTAS
========================= */
app.get("/notas-alertas", (req, res) => {
    res.json({
        ok: true,
        total: alertasNotas.length,
        data: alertasNotas
    });
});

app.post("/notas-alertas/visto", (req, res) => {
    alertasNotas = [];
    res.json({
        ok: true,
        message: "Alertas marcadas como vistas"
    });
});

/* =========================
   FUNCIONES
========================= */
async function actualizarNotas() {
    if (actualizandoNotas) return cacheNotas || [];

    actualizandoNotas = true;

    console.log("🔄 Actualizando notas desde UPAO...");

    const notasAnteriores = cacheNotas;
    const notasNuevas = await getNotas();

    if (notasAnteriores) {
        const cambios = detectarCambiosNotas(notasAnteriores, notasNuevas);

        if (cambios.length > 0) {
            alertasNotas.push(...cambios);
            console.log(`🔔 ${cambios.length} cambios nuevos en notas`);
        } else {
            console.log("✅ No hay cambios nuevos en notas");
        }
    }

    cacheNotas = notasNuevas;
    cacheNotasTime = new Date().toISOString();
    actualizandoNotas = false;

    console.log("✅ Notas actualizadas en cache");

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
   AUTO UPDATE SOLO NOTAS
========================= */
setInterval(() => {
    actualizarNotas().catch(error => {
        actualizandoNotas = false;
        console.log("❌ Error auto actualizando notas:", error.message);
    });
}, NOTAS_AUTO_MINUTOS * 60 * 1000);

/* =========================
   START
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🔥 Servidor iniciado en puerto ${PORT}`);
    console.log(`⏱️ Notas se actualizarán cada ${NOTAS_AUTO_MINUTOS} minutos`);
});