const { chromium } = require("playwright");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const AUTH_DIR = "./auth";
const SESSIONS_DIR = path.join(AUTH_DIR, "sessions");

const URL_NOTAS =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentGrades?termCode=202610";

const URL_ASISTENCIA =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentAttendanceTracking#!/";

const USER_ID_REGEX = /^[a-zA-Z0-9._-]{1,50}$/;

function validarUserId(userId) {
    if (!userId || typeof userId !== "string") return false;
    return USER_ID_REGEX.test(userId.trim());
}

async function asegurarDirectorios() {
    try {
        await fs.access(AUTH_DIR);
    } catch {
        await fs.mkdir(AUTH_DIR, { recursive: true });
    }
    try {
        await fs.access(SESSIONS_DIR);
    } catch {
        await fs.mkdir(SESSIONS_DIR, { recursive: true });
    }
}

function getSessionFile(userId) {
    return path.join(SESSIONS_DIR, `${userId}.json`);
}

async function hasSession(userId) {
    if (!validarUserId(userId)) return false;
    try {
        await fs.access(getSessionFile(userId));
        return true;
    } catch {
        return false;
    }
}

function hasSessionSync(userId) {
    if (!validarUserId(userId)) return false;
    return fsSync.existsSync(getSessionFile(userId));
}

async function eliminarSesion(userId) {
    if (!validarUserId(userId)) return;
    try {
        await fs.unlink(getSessionFile(userId));
    } catch {}
}

async function crearSesionAutomatica(userId) {
    if (!userId) {
        throw new Error("UNAUTHORIZED: Se requiere userId para crear sesión");
    }

    if (!(await hasSession(userId))) {
        throw new Error("UNAUTHORIZED: No hay credenciales guardadas. Debe iniciar sesión primero.");
    }

    const sessionData = JSON.parse(await fs.readFile(getSessionFile(userId), "utf-8"));
    const cookies = sessionData.cookies || [];
    if (cookies.length === 0) {
        throw new Error("UNAUTHORIZED: La sesión guardada está vacía. Inicie sesión de nuevo.");
    }

    await asegurarDirectorios();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: sessionData });
    const page = await context.newPage();

    console.log(`Verificando sesión UPAO para ${userId}...`);

    try {
        await page.goto(URL_NOTAS, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        if (await estaEnLogin(page)) {
            throw new Error("UNAUTHORIZED: La sesión ha expirado. Inicie sesión de nuevo.");
        }

        console.log(`Sesión verificada para ${userId}`);
    } finally {
        await browser.close();
    }
}

async function loginConCredenciales(usuario, password, remember) {
    if (!usuario || !password) {
        throw new Error("Usuario y contraseña son requeridos");
    }

    if (!validarUserId(usuario)) {
        throw new Error("Formato de usuario inválido");
    }

    const userId = usuario.trim();
    await asegurarDirectorios();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`Intentando inicio de sesión para ${userId}...`);

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
        await fs.writeFile(getSessionFile(userId), JSON.stringify(storage, null, 2));

        console.log(`Sesión creada y guardada para ${userId}`);
    } finally {
        await browser.close();
    }
}

async function crearContextoConSesion(browser, userId) {
    if (!(await hasSession(userId))) {
        await crearSesionAutomatica(userId);
    }

    const storage = JSON.parse(await fs.readFile(getSessionFile(userId), "utf-8"));

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
    crearContextoConSesion,
    verificarSesion,
    loginConCredenciales,
    eliminarSesion,
    hasSession,
    hasSessionSync,
    getSessionFile,
    validarUserId,
    URL_NOTAS,
    URL_ASISTENCIA
};
