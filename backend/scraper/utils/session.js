const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const AUTH_DIR = "./auth";
const SESSIONS_DIR = path.join(AUTH_DIR, "sessions");
const CREDENTIALS_DIR = path.join(AUTH_DIR, "credentials");

const LEGACY_SESSION_FILE = "./auth/session.json";
const LEGACY_CREDENTIALS_FILE = "./auth/credentials.json";

const URL_NOTAS =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentGrades?termCode=202610";

const URL_ASISTENCIA =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentAttendanceTracking#!/";

function asegurarDirectorios(userId) {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    if (!fs.existsSync(CREDENTIALS_DIR)) fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
}

function getSessionFile(userId) {
    return path.join(SESSIONS_DIR, `${userId}.json`);
}

function getCredentialsFile(userId) {
    return path.join(CREDENTIALS_DIR, `${userId}.json`);
}

function hasSession(userId) {
    return fs.existsSync(getSessionFile(userId));
}

function hasCredentials(userId) {
    return fs.existsSync(getCredentialsFile(userId));
}

function eliminarSesion(userId) {
    const sessionFile = getSessionFile(userId);
    const credsFile = getCredentialsFile(userId);
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    if (fs.existsSync(credsFile)) fs.unlinkSync(credsFile);
}

async function crearSesionAutomatica(userId) {
    let usuario = userId;
    let password = process.env.UPAO_PASSWORD;

    const credsFile = getCredentialsFile(userId);
    if (fs.existsSync(credsFile)) {
        try {
            const creds = JSON.parse(fs.readFileSync(credsFile, "utf-8"));
            if (creds.usuario && creds.password) {
                usuario = creds.usuario;
                password = creds.password;
            }
        } catch (e) {
            console.error(`Error al leer credenciales de ${userId}`, e);
        }
    }

    if (!usuario || !password) {
        throw new Error("UNAUTHORIZED: Faltan credenciales de UPAO");
    }

    asegurarDirectorios(userId);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`🔐 Creando sesión automática UPAO para ${userId}...`);

    try {
        await page.goto(URL_NOTAS, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        if (!(await estaEnLogin(page))) {
            const storage = await context.storageState();
            fs.writeFileSync(getSessionFile(userId), JSON.stringify(storage, null, 2));
            console.log(`✅ Ya había sesión activa para ${userId}`);
            return;
        }

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
            throw new Error("UNAUTHORIZED: No se pudo iniciar sesión automáticamente");
        }

        const storage = await context.storageState();
        fs.writeFileSync(getSessionFile(userId), JSON.stringify(storage, null, 2));

        console.log(`✅ Sesión automática guardada para ${userId}`);
    } finally {
        await browser.close();
    }
}

async function loginConCredenciales(usuario, password, remember) {
    if (!usuario || !password) {
        throw new Error("Usuario y contraseña son requeridos");
    }

    const userId = usuario;
    asegurarDirectorios(userId);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`🔐 Intentando inicio de sesión para el usuario ${userId}...`);

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

        if (remember) {
            fs.writeFileSync(getCredentialsFile(userId), JSON.stringify({ usuario, password }, null, 2));
        } else {
            const credsFile = getCredentialsFile(userId);
            if (fs.existsSync(credsFile)) {
                fs.unlinkSync(credsFile);
            }
        }

        console.log(`✅ Sesión creada y guardada con éxito para ${userId}`);
    } finally {
        await browser.close();
    }
}

async function crearSesionManual() {
    asegurarDirectorios("_manual");

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
    fs.writeFileSync(LEGACY_SESSION_FILE, JSON.stringify(storage, null, 2));

    await browser.close();

    console.log("✅ Sesión manual guardada");
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
    hasCredentials,
    getSessionFile,
    getCredentialsFile,
    SESSION_FILE: LEGACY_SESSION_FILE,
    CREDENTIALS_FILE: LEGACY_CREDENTIALS_FILE,
    URL_NOTAS,
    URL_ASISTENCIA
};
