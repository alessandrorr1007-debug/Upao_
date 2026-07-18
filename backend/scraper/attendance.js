const { chromium } = require("playwright");
const {
    crearSesionAutomatica,
    crearContextoConSesion,
    verificarSesion,
    URL_ASISTENCIA
} = require("./utils/session");

async function getAsistencia(userId) {
    let browser = await chromium.launch({ headless: true });
    let context = await crearContextoConSesion(browser, userId);
    let page = await context.newPage();

    try {
        console.log(`🧾 Abriendo asistencia para ${userId}...`);

        await page.goto(URL_ASISTENCIA, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(15000);

        if (!(await verificarSesion(page))) {
            console.log("⚠️ Sesión expirada. Reintentando...");
            await browser.close();

            await crearSesionAutomatica(userId);

            browser = await chromium.launch({ headless: true });
            context = await crearContextoConSesion(browser, userId);
            page = await context.newPage();

            await page.goto(URL_ASISTENCIA, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            await page.waitForTimeout(15000);
        }

        if (!(await verificarSesion(page))) {
            throw new Error("UNAUTHORIZED: No se pudo acceder a asistencia");
        }

        await seleccionar25PorPagina(page);

        const data = await extraerAsistencia(page);
        const limpio = limpiarAsistencia(data);

        console.log(`📌 Asistencia encontrada: ${limpio.length}`);

        return limpio;

    } finally {
        await browser.close();
    }
}

async function seleccionar25PorPagina(page) {
    try {
        const selectores = [
            "select",
            "button",
            "[role='button']",
            ".ui-select-match",
            ".ui-grid-pager-row-count-picker select",
            ".ui-grid-pager-row-count-picker",
            ".pagination-page-size",
            ".page-size"
        ];

        for (const selector of selectores) {
            const elementos = page.locator(selector);
            const total = await elementos.count().catch(() => 0);

            for (let i = 0; i < total; i++) {
                const el = elementos.nth(i);
                const texto = await el.innerText().catch(() => "");

                if (
                    texto.includes("10") ||
                    texto.includes("25") ||
                    texto.toLowerCase().includes("por página")
                ) {
                    await el.click({ timeout: 3000 }).catch(() => {});
                    await page.waitForTimeout(1000);

                    const opcion25 = page.locator("text=25").last();
                    if (await opcion25.count() > 0) {
                        await opcion25.click({ timeout: 5000 }).catch(() => {});
                        await page.waitForTimeout(5000);
                        return;
                    }
                }
            }
        }

        const selects = page.locator("select");
        const totalSelects = await selects.count().catch(() => 0);

        for (let i = 0; i < totalSelects; i++) {
            const select = selects.nth(i);

            try {
                await select.selectOption("25");
                await page.waitForTimeout(5000);
                return;
            } catch (_) {}

            try {
                await select.selectOption({ label: "25" });
                await page.waitForTimeout(5000);
                return;
            } catch (_) {}
        }

    } catch (error) {
        console.log("⚠️ Error cambiando paginación:", error.message);
    }
}

async function extraerAsistencia(page) {
    const pagina1 = await extraerAsistenciaPaginaActual(page);

    await irPaginaSiguienteSiExiste(page);

    const pagina2 = await extraerAsistenciaPaginaActual(page);

    return [...pagina1, ...pagina2];
}

async function irPaginaSiguienteSiExiste(page) {
    try {
        const posiblesBotones = [
            "button:has-text('›')",
            "button:has-text('>')",
            "[aria-label*='next' i]",
            "[title*='next' i]",
            ".ui-grid-pager-next button",
            ".ui-grid-pager-control button"
        ];

        for (const selector of posiblesBotones) {
            const botones = page.locator(selector);
            const total = await botones.count().catch(() => 0);

            for (let i = 0; i < total; i++) {
                const boton = botones.nth(i);
                const habilitado = await boton.isEnabled().catch(() => false);

                if (habilitado) {
                    await boton.click({ timeout: 5000 }).catch(() => {});
                    await page.waitForTimeout(6000);
                    return true;
                }
            }
        }

        return false;

    } catch (error) {
        return false;
    }
}

async function extraerAsistenciaPaginaActual(page) {
    return await page.evaluate(() => {
        function limpiar(texto) {
            return (texto || "").replace(/\s+/g, " ").trim();
        }

        const rows = Array.from(
            document.querySelectorAll("table tbody tr, table tr, [role='row']")
        );

        return rows.map(row => {
            const cols = Array.from(
                row.querySelectorAll("td, [role='gridcell'], .ui-grid-cell")
            )
                .map(td => limpiar(td.innerText))
                .filter(Boolean);

            if (cols.length < 3) return null;

            const nrc = cols.find(c => /^\d{4}$/.test(c)) || "";
            const porcentaje = cols.find(c => /^\d{1,3}%$/.test(c)) || "";

            return {
                nrc,
                materia: cols.find(c => c.length > 5 && !/^\d{4}$/.test(c) && !/^\d{1,3}%$/.test(c)) || "",
                curso: cols.join(" "),
                asistencia: porcentaje,
                raw: cols
            };
        }).filter(Boolean);
    });
}

function limpiarAsistencia(data) {
    const vistos = new Set();

    return data
        .filter(item => {
            const nrc = item.nrc || "";
            if (!nrc) return false;
            if (vistos.has(nrc)) return false;

            vistos.add(nrc);
            return true;
        })
        .map(item => {
            const asistencia = item.asistencia || "--";

            return {
                nrc: item.nrc,
                materia: item.materia || "",
                curso: item.curso || "Curso",
                asistencia,
                ausencias: obtenerAusencias(item),
                estado: obtenerEstado(asistencia),
                raw: item.raw
            };
        });
}

function obtenerAusencias(item) {
    const raw = Array.isArray(item.raw) ? item.raw : [];
    const porcentajeIndex = raw.findIndex(v => /^\d{1,3}%$/.test(v));

    if (porcentajeIndex > 0) {
        const posible = raw[porcentajeIndex - 1];
        if (/^\d+$/.test(posible)) return posible;
    }

    return "";
}

function obtenerEstado(asistencia) {
    const num = parseInt(asistencia);
    if (isNaN(num)) return "Sin datos";
    if (num >= 80) return "Aprobado";
    if (num >= 60) return "En riesgo";
    return "Reprobado";
}

module.exports = {
    getAsistencia
};
