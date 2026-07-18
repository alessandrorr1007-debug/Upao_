const { chromium } = require("playwright");
const { crearContextoConSesion, verificarSesion } = require("./utils/session");

async function getHistorial(userId) {
    if (!userId) return [];

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await crearContextoConSesion(browser, userId);
        const page = await context.newPage();

        await page.goto("https://ssb.upao.edu.pe/StudentSelfService/ssb/academicTranscript",
            { waitUntil: "networkidle" }
        );

        await page.waitForTimeout(8000);

        if (!(await verificarSesion(page))) return [];

        const data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("table tr"))
                .map(r => Array.from(r.querySelectorAll("td"))
                    .map(td => td.innerText.trim())
                )
                .filter(r => r.length > 0);
        });

        return data;
    } catch (error) {
        console.error(`Error obteniendo historial para ${userId}:`, error.message);
        return [];
    } finally {
        await browser.close();
    }
}

module.exports = { getHistorial };
