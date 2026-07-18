const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AUTH_DIR = "./auth";
const SESSIONS_DIR = path.join(AUTH_DIR, "sessions");

const URL_NOTAS =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentGrades?termCode=202610";

const URL_ASISTENCIA =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentAttendanceTracking#!/";

function asegurarDirectorios() {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function getSessionFile(userId) {
    return path.join(SESSIONS_DIR, `${userId}.json`);
}

function hasSession(userId) {
    return fs.existsSync(getSessionFile(userId));
}

function eliminarSesion(userId) {
    const sessionFile = getSessionFile(userId);
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
}

async function crearSesionAutomatica(userId) {
    if (!userId) {
        throw new Error("UNAUTHORIZED: Se requiere userId para crear sesión");
    }

    if (!hasSession(userId)) {
        throw new Error("UNAUTHORIZED: No hay credenciales guardadas para este usuario. Debe iniciar sesión primero.");
    }

    const sessionData = JSON.parse(fs.readFileSync(getSessionFile(userId), "utf-8"));
    const cookies = sessionData.cookies || [];
    if (cookies.length === 0) {
        throw new Error("UNAUTHORIZED: La sesión guardada para este usuario está vacía. Debe iniciar sesión de nuevo.");
    }

    asegurarDirectorios();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: sessionData });
    const page = await context.newPage();

    console.log(`🔐 Verificando sesión UPAO para ${userId}...`);

    try {
        await page.goto(URL_NOTAS, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        if (await estaEnLogin(page)) {
            throw new Error("UNAUTHORIZED: La sesión ha expirado. Inicie sesión de nuevo.");
        }

        console.log(`✅ Sesión verificada para ${userId}`);
    } finally {
        await browser.close();
    }
}

async function loginConCredenciales(usuario, password, remember) {
    if (!usuario || !password) {
        throw new Error("Usuario y contraseña son requeridos");
    }

    const userId = usuario;
    asegurarDirectorios();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`🔐 Intentando inicio de sesión para ${userId}...`);

    try {
        await page.goto(URL_NOTAS, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        const inputUsuario = page.locator('input[type="text"], input[type="email"]').first();
        const inputPassword = page.locator('input[type="password"]').first();

        await inputUsuario.fill(usuario);
        await inputPassword.fill(password);

        const boton = page.locator('input[type="submit"], button[type="submit"]').first();

        if (await boton.count() > 0) {
            await boton.click();
        } else {
            await inputPassword.press("Enter");
        }

        await page.waitForTimeout(12000);

        await page.goto(URL_NOTAS, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(5000);

        if (await estaEnLogin(page)) {
            throw new Error("UNAUTHORIZED: Código o contraseña incorrectos");
        }

        const storage = await context.storageState();
        fs.writeFileSync(getSessionFile(userId), JSON.stringify(storage, null, 2));

        console.log(`✅ Sesión creada y guardada para ${userId}`);
    } finally {
        await browser.close();
    }
}

async function crearSesionManual() {
    asegurarDirectorios();

    const browser = await chromium.launch({
        headless: false
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(URL_NOTAS, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    console.log("🔐 Inicia sesión manualmente.");
    console.log("Cuando ya veas tus notas, vuelve a la terminal y presiona ENTER.");

    process.stdin.resume();

    await new Promise(resolve => {
        process.stdin.once("data", resolve);
    });

    const storage = await context.storageState();
    const tempFile = path.join(SESSIONS_DIR, "_manual.json");
    fs.writeFileSync(tempFile, JSON.stringify(storage, null, 2));

    await browser.close();

    console.log("✅ Sesión manual guardada en", tempFile);
}

async function crearContextoConSesion(browser, userId) {
    const sessionFile = getSessionFile(userId);

    if (!fs.existsSync(sessionFile)) {
        await crearSesionAutomatica(userId);
    }

    const storage = JSON.parse(fs.readFileSync(getSessionFile(userId), "utf-8"));

    return await browser.newContext({
        storageState: storage
    });
}

async function verificarSesion(page) {
    await page.waitForTimeout(2500);
    return !(await estaEnLogin(page));
}

async function estaEnLogin(page) {
    const url = page.url().toLowerCase();

    if (url.includes("account/login")) return true;
    if (url.includes("login.aspx")) return true;
    if (url.includes("returnurl")) return true;

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const texto = bodyText.toLowerCase();

    if (texto.includes("código de verificación")) return true;
    if (texto.includes("ingrese código de verificación")) return true;
    if (texto.includes("iniciar sesión")) return true;
    if (texto.includes("olvidé mi contraseña")) return true;

    return false;
}

module.exports = {
    crearSesionAutomatica,
    crearSesionManual,
    crearContextoConSesion,
    verificarSesion,
    loginConCredenciales,
    eliminarSesion,
    hasSession,
    getSessionFile,
    URL_NOTAS,
    URL_ASISTENCIA
};
