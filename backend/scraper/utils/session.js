const { chromium } = require("playwright");
const fs = require("fs");
require("dotenv").config();

const SESSION_FILE = "./auth/session.json";

const URL_NOTAS =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentGrades?termCode=202610";

const URL_ASISTENCIA =
    "https://campusvirtual.upao.edu.pe/StudentSelfService/ssb/studentAttendanceTracking#!/";

function asegurarCarpetaAuth() {
    if (!fs.existsSync("./auth")) {
        fs.mkdirSync("./auth");
    }
}

async function crearSesionAutomatica() {
    const usuario = process.env.UPAO_ID;
    const password = process.env.UPAO_PASSWORD;

    if (!usuario || !password) {
        throw new Error("Faltan UPAO_ID o UPAO_PASSWORD en .env");
    }

    asegurarCarpetaAuth();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("🔐 Creando sesión automática UPAO...");

    await page.goto(URL_NOTAS, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    await page.waitForTimeout(3000);

    if (!(await estaEnLogin(page))) {
        const storage = await context.storageState();
        fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));
        await browser.close();
        console.log("✅ Ya había sesión activa");
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
        await browser.close();
        throw new Error("No se pudo iniciar sesión automáticamente");
    }

    const storage = await context.storageState();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));

    await browser.close();

    console.log("✅ Sesión automática guardada");
}

async function crearSesionManual() {
    asegurarCarpetaAuth();

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
    fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));

    await browser.close();

    console.log("✅ Sesión manual guardada");
}

async function crearContextoConSesion(browser) {
    if (!fs.existsSync(SESSION_FILE)) {
        await crearSesionAutomatica();
    }

    const storage = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));

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
    URL_NOTAS,
    URL_ASISTENCIA
};