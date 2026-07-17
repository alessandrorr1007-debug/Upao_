const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = "./auth/sessions";

function getSessionFile(userId) {
    return path.join(SESSIONS_DIR, `${userId}.json`);
}

async function getHistorial(userId) {
    if (!userId) return [];

    const sessionFile = getSessionFile(userId);

    const browser = await chromium.launch({ headless: true });

    if (!fs.existsSync(sessionFile)) return [];

    const storage = JSON.parse(fs.readFileSync(sessionFile));

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
