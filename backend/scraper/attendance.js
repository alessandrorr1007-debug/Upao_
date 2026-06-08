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
        }

        await page.waitForTimeout(12000);

        if (!(await verificarSesion(page))) {
            throw new Error("No se pudo entrar a asistencia. UPAO sigue mostrando login.");
        }

        console.log("📍 URL actual:", page.url());
        console.log("📄 Título:", await page.title());

        const bodyText = await page.locator("body").innerText().catch(() => "");
        console.log("📝 Texto página:", bodyText.slice(0, 1500));

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

        const rows = Array.from(
            document.querySelectorAll("table tbody tr, table tr")
        );

        return rows.map(row => {
            const cols = Array.from(row.querySelectorAll("td"))
                .map(td => limpiar(td.innerText))
                .filter(Boolean);

            if (cols.length < 5) return null;

            const nrc = cols.find(c => /^\d{4,6}$/.test(c)) || "";

            const porcentaje = cols.find(c =>
                c.includes("%") ||
                c.toLowerCase().includes("asistencia") ||
                c.toLowerCase().includes("attendance") ||
                c.toLowerCase().includes("absence")
            ) || cols[cols.length - 1] || "";

            return {
                periodo: cols.find(c => c.includes("202610")) || cols[0] || "",
                nrc,
                materia: cols[2] || "",
                codigoCurso: cols[3] || "",
                seccion: cols[4] || "",
                curso: cols[5] || cols[cols.length - 2] || "",
                asistencia: porcentaje,
                raw: cols
            };
        }).filter(Boolean);
    });
}

function limpiarAsistencia(data) {
    return data
        .filter(item => {
            const rawTexto = item.raw.join(" ");
            const nrc = item.nrc || "";

            if (!rawTexto.includes("202610")) return false;
            if (!NRC_PERMITIDOS.includes(nrc)) return false;

            return true;
        })
        .map(item => ({
            periodo: item.periodo,
            nrc: item.nrc,
            materia: item.materia,
            codigoCurso: item.codigoCurso,
            seccion: item.seccion,
            curso: item.curso,
            asistencia: item.asistencia,
            raw: item.raw
        }));
}

module.exports = {
    getAsistencia
};