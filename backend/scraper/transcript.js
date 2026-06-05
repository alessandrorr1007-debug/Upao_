const { chromium } = require("playwright");
const fs = require("fs");

const SESSION_FILE = "./auth/session.json";

async function getHistorial() {

    const browser = await chromium.launch({ headless: true });

    if (!fs.existsSync(SESSION_FILE)) return [];

    const storage = JSON.parse(fs.readFileSync(SESSION_FILE));

    const context = await browser.newContext({ storageState: storage });
    const page = await context.newPage();

    await page.goto("https://ssb.upao.edu.pe/StudentSelfService/ssb/academicTranscript",
        { waitUntil: "networkidle" }
    );

    await page.waitForTimeout(8000);

    const data = await page.evaluate(() => {

        return Array.from(document.querySelectorAll("table tr"))
            .map(r => Array.from(r.querySelectorAll("td"))
                .map(td => td.innerText.trim())
            )
            .filter(r => r.length > 0);
    });

    await browser.close();
    return data;
}

module.exports = { getHistorial };