const { chromium } = require("playwright");
const {
    crearSesionAutomatica,
    crearContextoConSesion,
    verificarSesion,
    URL_ASISTENCIA
} = require("./utils/session");

const NRC_PERMITIDOS = ["3233", "5585", "5592", "5598", "5636", "6645"];

async function getAsistencia() {
    let browser = await chromium.launch({ headless: true });
    let context = await crearContextoConSesion(browser);
    let page = await context.newPage();

    try {
        console.log("🧾 Abriendo asistencia...");

        await page.goto(URL_ASISTENCIA, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(15000);

        if (!(await verificarSesion(page))) {
            console.log("⚠️ Sesión expirada o login detectado. Reintentando login automático...");
            await browser.close();

            await crearSesionAutomatica();

            browser = await chromium.launch({ headless: true });
            context = await crearContextoConSesion(browser);
            page = await context.newPage();

            await page.goto(URL_ASISTENCIA, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            await page.waitForTimeout(15000);
        }

        if (!(await verificarSesion(page))) {
            throw new Error("No se pudo entrar a asistencia. UPAO sigue mostrando login.");
        }

        console.log("📍 URL actual:", page.url());
        console.log("📄 Título:", await page.title());

        const bodyText = await page.locator("body").innerText().catch(() => "");
        console.log("📝 Texto página:", bodyText.slice(0, 2000));

        const data = await extraerAsistencia(page);
        const limpio = limpiarAsistencia(data);

        console.log("📌 Filas leídas:", data.length);
        console.log("📌 Asistencia encontrada:", limpio.length);

        return limpio;

    } finally {
        await browser.close();
    }
}

async function extraerAsistencia(page) {
    return await page.evaluate(() => {
        function limpiar(texto) {
            return (texto || "").replace(/\s+/g, " ").trim();
        }

        const textoCompleto = limpiar(document.body.innerText || "");
        const lineas = textoCompleto
            .split(/\n+/)
            .map(l => limpiar(l))
            .filter(Boolean);

        const resultado = [];

        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i];

            if (!linea.includes("202610")) continue;

            const partes = linea.split(/\s+/);
            const nrc = partes.find(p => /^\d{4}$/.test(p)) || "";

            if (!nrc) continue;

            const porcentaje = partes.find(p => /^\d{1,3}%$/.test(p)) || "";

            resultado.push({
                periodo: "202610",
                nrc,
                materia: "",
                codigoCurso: "",
                seccion: "",
                curso: linea,
                asistencia: porcentaje,
                raw: partes
            });
        }

        const rows = Array.from(
            document.querySelectorAll("table tbody tr, table tr, [role='row']")
        );

        const tabla = rows.map(row => {
            const cols = Array.from(
                row.querySelectorAll("td, [role='gridcell'], .ui-grid-cell")
            )
                .map(td => limpiar(td.innerText))
                .filter(Boolean);

            if (cols.length < 5) return null;

            const nrc = cols.find(c => /^\d{4}$/.test(c)) || "";
            const porcentaje = cols.find(c => /^\d{1,3}%$/.test(c)) || cols[cols.length - 1] || "";

            return {
                periodo: cols.find(c => c.includes("202610")) || cols[0] || "",
                nrc,
                materia: cols[2] || "",
                codigoCurso: cols[3] || "",
                seccion: cols[4] || "",
                curso: cols[5] || cols.join(" "),
                asistencia: porcentaje,
                raw: cols
            };
        }).filter(Boolean);

        return [...tabla, ...resultado];
    });
}

function limpiarAsistencia(data) {
    const vistos = new Set();

    return data
        .filter(item => {
            const rawTexto = (item.raw || []).join(" ");
            const nrc = item.nrc || "";

            if (!rawTexto.includes("202610") && item.periodo !== "202610") return false;
            if (!NRC_PERMITIDOS.includes(nrc)) return false;
            if (vistos.has(nrc)) return false;

            vistos.add(nrc);
            return true;
        })
        .map(item => ({
            periodo: "202610",
            nrc: item.nrc,
            materia: item.materia || "",
            codigoCurso: item.codigoCurso || "",
            seccion: item.seccion || "",
            curso: limpiarCurso(item),
            asistencia: item.asistencia || "--",
            raw: item.raw
        }));
}

function limpiarCurso(item) {
    const raw = Array.isArray(item.raw) ? item.raw : [];

    const posiblesCursos = raw.filter(texto =>
        texto.includes("METODOLOG") ||
        texto.includes("AGILE") ||
        texto.includes("INFRAESTRUCTURA") ||
        texto.includes("INTEL") ||
        texto.includes("APLICAC") ||
        texto.includes("DEONTOLOGIA")
    );

    if (posiblesCursos.length > 0) {
        return posiblesCursos[posiblesCursos.length - 1];
    }

    const texto = raw.join(" ");

    if (texto.includes("METODOLOG")) return "METODOLOG INVESTIGAC CIENTIF";
    if (texto.includes("AGILE")) return "AGILE DEVELOPMENT";
    if (texto.includes("INFRAESTRUCTURA")) return "INFRAESTRUCTURA COMO CODIGO";
    if (texto.includes("APLICAC")) return "APLICAC MOVILES PARA NEGOCIOS";
    if (texto.includes("DEONTOLOGIA")) return "DEONTOLOGIA PROFESIONAL";
    if (texto.includes("INTEL")) return "INTEL ART, PRINCIP Y TECNIC";

    return item.curso || texto || "Curso";
}

module.exports = {
    getAsistencia
};