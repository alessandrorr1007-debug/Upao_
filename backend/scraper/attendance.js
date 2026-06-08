const { chromium } = require("playwright");
const {
    crearSesionAutomatica,
    crearContextoConSesion,
    verificarSesion
} = require("./utils/session");

const URL_ASISTENCIA =
    "https://campusvirtual.upao.edu.pe/StudentSelfService/ssb/studentAttendanceTracking#!/";

const NRC_PERMITIDOS = ["3233", "5585", "5592", "5598", "5636", "6645"];

async function getAsistencia() {
    let browser = await chromium.launch({ headless: true });
    let context = await crearContextoConSesion(browser);
    let page = await context.newPage();

    try {
        console.log("✅ Abriendo asistencia...");

        await page.goto(URL_ASISTENCIA, {
            waitUntil: "networkidle",
            timeout: 60000
        });

        if (!(await verificarSesion(page))) {
            console.log("⚠️ Sesión expirada. Reintentando login automático...");

            await browser.close();
            await crearSesionAutomatica();

            browser = await chromium.launch({ headless: true });
            context = await crearContextoConSesion(browser);
            page = await context.newPage();

            await page.goto(URL_ASISTENCIA, {
                waitUntil: "networkidle",
                timeout: 60000
            });
        }

        await page.waitForTimeout(10000);

        await page.waitForSelector("body", { timeout: 30000 });

        const data = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("table tbody tr, table tr"));

            return rows.map(row => {
                const cols = Array.from(row.querySelectorAll("td"))
                    .map(td => td.innerText.trim())
                    .filter(Boolean);

                if (cols.length < 5) return null;

                return {
                    term: cols[0] || "",
                    crn: cols[1] || "",
                    subject: cols[2] || "",
                    courseCode: cols[3] || "",
                    section: cols[4] || "",
                    course: cols[5] || "",
                    porcentaje: cols[cols.length - 1] || "",
                    raw: cols
                };
            }).filter(Boolean);
        });

        console.log("📌 Asistencia encontrada:", data.length);

        return limpiarAsistencia(data);

    } finally {
        await browser.close();
    }
}

function limpiarAsistencia(data) {
    return data
        .filter(item => {
            const term = item.term || "";
            const nrc = item.crn || "";
            const course = item.course || "";

            if (!term.includes("202610")) return false;
            if (!NRC_PERMITIDOS.includes(nrc)) return false;
            if (!course) return false;

            return true;
        })
        .map(item => ({
            periodo: item.term,
            nrc: item.crn,
            materia: item.subject,
            codigoCurso: item.courseCode,
            seccion: item.section,
            curso: item.course,
            asistencia: item.porcentaje,
            raw: item.raw
        }));
}

module.exports = {
    getAsistencia
};