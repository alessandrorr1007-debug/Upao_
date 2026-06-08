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

        await seleccionar25PorPagina(page);

        console.log("📍 URL actual:", page.url());
        console.log("📄 Título:", await page.title());

        const bodyText = await page.locator("body").innerText().catch(() => "");
        console.log("📝 Texto página:", bodyText.slice(0, 2500));

        const data = await extraerAsistencia(page);
        const limpio = limpiarAsistencia(data);

        console.log("📌 Filas leídas:", data.length);
        console.log("📌 Asistencia encontrada:", limpio.length);

        return limpio;

    } finally {
        await browser.close();
    }
}

async function seleccionar25PorPagina(page) {
    try {
        console.log("🔽 Intentando cambiar Por página a 25...");

        const bodyAntes = await page.locator("body").innerText().catch(() => "");

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
                        console.log("✅ Seleccionado 25 por página");
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
                console.log("✅ Seleccionado 25 usando selectOption");
                return;
            } catch (_) {}

            try {
                await select.selectOption({ label: "25" });
                await page.waitForTimeout(5000);
                console.log("✅ Seleccionado 25 usando label");
                return;
            } catch (_) {}
        }

        const botonSiguiente = page.locator(
            "button:has-text('›'), button:has-text('>'), [aria-label*='next' i], [title*='next' i]"
        );

        if (await botonSiguiente.count() > 0) {
            const habilitado = await botonSiguiente.first().isEnabled().catch(() => false);

            if (habilitado) {
                console.log("➡️ No se pudo seleccionar 25. Se intentará leer página 1 y luego página 2.");
            }
        }

        const bodyDespues = await page.locator("body").innerText().catch(() => "");
        if (bodyAntes !== bodyDespues) {
            console.log("✅ La página cambió después del intento de paginación");
        } else {
            console.log("⚠️ No se pudo cambiar a 25 automáticamente");
        }

    } catch (error) {
        console.log("⚠️ Error intentando seleccionar 25:", error.message);
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
                    console.log("➡️ Pasando a la siguiente página de asistencia...");
                    await boton.click({ timeout: 5000 }).catch(() => {});
                    await page.waitForTimeout(6000);
                    return true;
                }
            }
        }

        console.log("ℹ️ No se encontró botón de siguiente página habilitado");
        return false;

    } catch (error) {
        console.log("⚠️ Error intentando pasar página:", error.message);
        return false;
    }
}

async function extraerAsistenciaPaginaActual(page) {
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
            materia: item.materia || obtenerMateria(item),
            codigoCurso: item.codigoCurso || obtenerCodigoCurso(item),
            seccion: item.seccion || obtenerSeccion(item),
            curso: limpiarCurso(item),
            asistencia: item.asistencia || obtenerPorcentaje(item) || "--",
            ausencias: obtenerAusencias(item),
            raw: item.raw
        }));
}

function obtenerMateria(item) {
    const raw = Array.isArray(item.raw) ? item.raw : [];
    const texto = raw.join(" ");

    if (texto.includes("HUMANIDADES")) return "HUMANIDADES";
    if (texto.includes("ING SISTEM E INTELIG ARTIFIC")) return "ING SISTEM E INTELIG ARTIFIC";

    return "";
}

function obtenerCodigoCurso(item) {
    const raw = Array.isArray(item.raw) ? item.raw : [];

    if (raw.includes("1185")) return "1185";
    if (raw.includes("109")) return "109";
    if (raw.includes("107")) return "107";
    if (raw.includes("108")) return "108";
    if (raw.includes("127")) return "127";
    if (raw.includes("103")) return "103";

    return item.codigoCurso || "";
}

function obtenerSeccion(item) {
    const raw = Array.isArray(item.raw) ? item.raw : [];

    const seccion = raw.find(v => /^[A-Z]\d{2}$/.test(v) || /^[A-Z]\d{1}$/.test(v));
    return seccion || item.seccion || "";
}

function obtenerPorcentaje(item) {
    const raw = Array.isArray(item.raw) ? item.raw : [];
    return raw.find(v => /^\d{1,3}%$/.test(v)) || "";
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