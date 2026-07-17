const { chromium } = require("playwright");
const fs = require("fs");
require("dotenv").config();

const SESSION_FILE = "./auth/session.json";
const CREDENTIALS_FILE = "./auth/credentials.json";

const URL_NOTAS =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentGrades?termCode=202610";

const URL_ASISTENCIA =
    "https://ssb.upao.edu.pe/StudentSelfService/ssb/studentAttendanceTracking#!/";

function asegurarCarpetaAuth() {
    if (!fs.existsSync("./auth")) {
        fs.mkdirSync("./auth");
    }
}

async function crearSesionAutomatica() {
    let usuario = process.env.UPAO_ID;
    let password = process.env.UPAO_PASSWORD;

    if (fs.existsSync(CREDENTIALS_FILE)) {
        try {
            const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8"));
            if (creds.usuario && creds.password) {
                usuario = creds.usuario;
                password = creds.password;
            }
        } catch (e) {
            console.error("Error al leer credentials.json", e);
        }
    }

    if (!usuario || !password) {
        throw new Error("UNAUTHORIZED: Faltan credenciales de UPAO");
    }

    asegurarCarpetaAuth();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("🔐 Creando sesión automática UPAO...");

    try {
        await page.goto(URL_NOTAS, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        if (!(await estaEnLogin(page))) {
            const storage = await context.storageState();
            fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));
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
            throw new Error("UNAUTHORIZED: No se pudo iniciar sesión automáticamente");
        }

        const storage = await context.storageState();
        fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));

        console.log("✅ Sesión automática guardada");
    } finally {
        await browser.close();
    }
}

async function loginConCredenciales(usuario, password, remember) {
    if (!usuario || !password) {
        throw new Error("Usuario y contraseña son requeridos");
    }

    asegurarCarpetaAuth();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`🔐 Intentando inicio de sesión para el usuario ${usuario}...`);

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
        fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));

        if (remember) {
            fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ usuario, password }, null, 2));
        } else {
            if (fs.existsSync(CREDENTIALS_FILE)) {
                fs.unlinkSync(CREDENTIALS_FILE);
            }
        }

        console.log("✅ Sesión creada y guardada con éxito");
    } finally {
        await browser.close();
    }
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
    loginConCredenciales,
    SESSION_FILE,
    CREDENTIALS_FILE,
    URL_NOTAS,
    URL_ASISTENCIA
};