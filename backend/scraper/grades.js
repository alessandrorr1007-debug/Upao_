const { chromium } = require("playwright");
const {
    crearSesionAutomatica,
    crearContextoConSesion,
    verificarSesion,
    URL_NOTAS
} = require("./utils/session");

// Período por defecto (coincide con URL_NOTAS hardcodeada como fallback)
const TERMCODE_ACTUAL = "202610";
const TERMCODE_REGEX = /^\d{6}$/;

function buildNotasUrl(termCode) {
    const code = (termCode && TERMCODE_REGEX.test(termCode)) ? termCode : TERMCODE_ACTUAL;
    return `https://ssb.upao.edu.pe/StudentSelfService/ssb/studentGrades?termCode=${code}`;
}

async function getNotas(userId, termCode = null) {
    const urlNotas = buildNotasUrl(termCode);
    console.log(`Abriendo notas... URL: ${urlNotas}`);

    let browser = await chromium.launch({ headless: true });

    try {
        let context = await crearContextoConSesion(browser, userId);
        let page = await context.newPage();

        await page.goto(urlNotas, { waitUntil: "networkidle" });

        if (!(await verificarSesion(page))) {
            console.log("Sesión expirada. Reintentando login automático...");
            await browser.close();

            await crearSesionAutomatica(userId);

            browser = await chromium.launch({ headless: true });
            context = await crearContextoConSesion(browser, userId);
            page = await context.newPage();

            await page.goto(urlNotas, { waitUntil: "networkidle" });
        }

        await page.waitForSelector("#table1 tbody tr", { timeout: 20000 });

        const cursos = await obtenerCursos(page);
        console.log("Cursos encontrados:", cursos.length);

        const resultado = [];

        for (let i = 0; i < cursos.length; i++) {
            const curso = cursos[i];

            const item = {
                codigo: curso.codigo,
                course: curso.nombre,
                nrc: curso.nrc,
                creditos: curso.creditos,
                periodo: curso.periodo,
                ep1: crearComponenteVacio("EP1"),
                parcial: crearComponenteVacio("Parcial"),
                ep2: crearComponenteVacio("EP2"),
                final: crearComponenteVacio("Final"),
                componentesRaw: [],
                raw: curso.raw
            };

            try {
                await abrirComponentesPorFila(page, i);
                await expandirSubcomponentes(page);

                const componentes = await extraerComponentes(page);

                item.componentesRaw = componentes;

                const estructura = organizarComponentes(componentes);

                item.ep1 = estructura.ep1;
                item.parcial = estructura.parcial;
                item.ep2 = estructura.ep2;
                item.final = estructura.final;

            } catch (error) {
                console.log("Error en curso:", curso.codigo, error.message);
            }

            resultado.push(item);

            // Volver a la página de notas del período correcto entre cada curso
            await page.goto(urlNotas, { waitUntil: "networkidle" });
            await page.waitForSelector("#table1 tbody tr", { timeout: 20000 });
        }

        console.log("Notas procesadas:", resultado.length);

        return resultado;
    } finally {
        await browser.close();
    }
}

async function obtenerCursos(page) {
    return await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#table1 tbody tr"));

        return rows.map(row => {
            const cols = Array.from(row.querySelectorAll("td"))
                .map(td => td.innerText.trim())
                .filter(Boolean);

            return {
                codigo: limpiar(cols[0] || ""),
                nombre: limpiar((cols[1] || "").split("\n")[0]),
                creditos: limpiar(cols[6] || cols[3] || ""),
                nrc: limpiar((cols[10] || cols[4] || "").split("\n")[0]),
                periodo: limpiar(cols[12] || cols[6] || ""),
                raw: cols
            };
        }).filter(curso => curso.codigo && curso.nombre);

        function limpiar(texto) {
            return texto.replace(/\s+/g, " ").trim();
        }
    });
}

async function abrirComponentesPorFila(page, filaIndex) {
    const botones = page.locator("#table1 tbody tr button.component-button");
    const total = await botones.count();

    if (filaIndex >= total) {
        throw new Error("No existe botón Componentes para la fila " + filaIndex);
    }

    await botones.nth(filaIndex).click();
    await page.waitForSelector("#table2 tbody tr", { timeout: 20000 });
    await page.waitForTimeout(1200);
}

async function expandirSubcomponentes(page) {
    for (let i = 0; i < 6; i++) {
        const flechasCerradas = page.locator("#table2 input.nested-arrow.nested-arrow-closed");
        const total = await flechasCerradas.count();

        if (total === 0) break;

        await flechasCerradas.first().click();
        await page.waitForTimeout(900);
    }
}

async function extraerComponentes(page) {
    return await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#table2 tbody tr"));

        return rows.map(row => {
            const cols = Array.from(row.querySelectorAll("td"))
                .map(td => td.innerText.trim())
                .filter(Boolean);

            const nombre = cols[0] || "";
            const peso = cols[1] || "";
            const puntajeTexto = cols[2] || "";
            const calificacion = cols[3] || "";
            const porcentaje = cols[4] || "";

            return {
                nombre: limpiarNombre(nombre),
                peso,
                puntaje: extraerPuntaje(puntajeTexto),
                puntajeTexto: limpiarValor(puntajeTexto),
                calificacion: limpiarValor(calificacion),
                porcentaje: limpiarValor(porcentaje),
                esSubcomponente: detectarSubcomponente(nombre),
                raw: cols
            };
        }).filter(item => item.nombre);

        function limpiarNombre(nombre) {
            return nombre.replace(/\s+/g, " ").replace(" - ", "-").trim();
        }

        function extraerPuntaje(texto) {
            if (!texto || texto === "No" || texto === "Sí" || texto === "Final") return "";

            if (texto.includes("/")) {
                return texto.split("/")[0].trim();
            }

            return texto.trim();
        }

        function limpiarValor(valor) {
            if (!valor || valor === "No" || valor === "Sí" || valor === "Final") return "";
            return valor.trim();
        }

        function detectarSubcomponente(nombre) {
            const n = nombre.toLowerCase();
            return n.includes("sub") || /^\s*\d+_sub/.test(n);
        }
    });
}

function organizarComponentes(componentes) {
    const ep1 = componentes.find(c => c.nombre.toLowerCase().includes("1_ep1")) || crearComponenteVacio("EP1");
    const parcial = componentes.find(c => c.nombre.toLowerCase().includes("2_evp")) || crearComponenteVacio("Parcial");
    const ep2 = componentes.find(c => c.nombre.toLowerCase().includes("3_ep2")) || crearComponenteVacio("EP2");
    const final = componentes.find(c => c.nombre.toLowerCase().includes("4_evf")) || crearComponenteVacio("Final");

    ep1.subcomponentes = obtenerSubcomponentesDePadre(componentes, "ep1");
    ep2.subcomponentes = obtenerSubcomponentesDePadre(componentes, "ep2");

    return { ep1, parcial, ep2, final };
}

function obtenerSubcomponentesDePadre(componentes, tipoPadre) {
    const resultado = [];
    let dentro = false;

    for (const componente of componentes) {
        const nombre = componente.nombre.toLowerCase();

        if (tipoPadre === "ep1" && nombre.includes("1_ep1")) {
            dentro = true;
            continue;
        }

        if (tipoPadre === "ep2" && nombre.includes("3_ep2")) {
            dentro = true;
            continue;
        }

        if (dentro && (
            nombre.includes("2_evp") ||
            nombre.includes("3_ep2") ||
            nombre.includes("4_evf")
        )) {
            break;
        }

        if (dentro && componente.esSubcomponente) {
            resultado.push(componente);
        }
    }

    return resultado;
}

function crearComponenteVacio(nombre) {
    return {
        nombre,
        peso: "",
        puntaje: "",
        puntajeTexto: "",
        calificacion: "",
        porcentaje: "",
        esSubcomponente: false,
        subcomponentes: [],
        raw: []
    };
}

module.exports = { getNotas };