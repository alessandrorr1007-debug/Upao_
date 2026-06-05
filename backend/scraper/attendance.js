const { chromium } = require("playwright");
const {
    crearSesionAutomatica,
    crearContextoConSesion,
    verificarSesion
} = require("./utils/session");

const URL_ASISTENCIA =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentAttendanceTracking#!/";

const NRC_PERMITIDOS = [
    "3233",
    "5585",
    "5592",
    "5598",
    "5636",
    "6645"
];

async function getAsistencia() {
    let browser = await chromium.launch({ headless: true });
    let context = await crearContextoConSesion(browser);
    let page = await context.newPage();

    console.log("✅ Abriendo asistencia...");

    await page.goto(URL_ASISTENCIA, { waitUntil: "networkidle" });

    if (!(await verificarSesion(page))) {
        console.log("⚠️ Sesión expirada. Reintentando login automático...");
        await browser.close();

        await crearSesionAutomatica();

        browser = await chromium.launch({ headless: true });
        context = await crearContextoConSesion(browser);
        page = await context.newPage();

        await page.goto(URL_ASISTENCIA, { waitUntil: "networkidle" });
    }

    await page.waitForTimeout(8000);

    const data = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("table tr"));

        return rows.map(row => {
            const cols = Array.from(row.querySelectorAll("td"))
                .map(td => td.innerText.trim())
                .filter(Boolean);

            if (cols.length < 6) return null;

            return {
                term: cols[0] || "",
                crn: cols[1] || "",
                subject: cols[2] || "",
                course: cols[3] || "",
                section: cols[4] || "",
                title: cols[5] || "",
                percentage: cols[cols.length - 1] || ""
            };
        }).filter(Boolean);
    });

    await browser.close();

    return limpiarAsistencia(data);
}

function limpiarAsistencia(data) {
    return data.filter(item => {
        const term = item.term || "";
        const nrc = item.crn || "";
        const title = item.title || "";

        if (!term.includes("202610")) return false;
        if (!title) return false;
        if (!NRC_PERMITIDOS.includes(nrc)) return false;

        return true;
    });
}

module.exports = {
    getAsistencia
};