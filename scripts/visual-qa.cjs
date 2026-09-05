const { createRequire } = require("node:module");

const projectRequire = createRequire("/app/apps/whatsapp/package.json");
const whatsappEntry = projectRequire.resolve("whatsapp-web.js");
const puppeteer = createRequire(whatsappEntry)("puppeteer");

(async () => {
  const consoleErrors = [];
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
    acceptInsecureCerts: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"]
  });
  try {
    const page = await browser.newPage();
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const qaUrl = process.env.QA_URL || "https://localhost";
    if (process.env.QA_SESSION_COOKIE) {
      await page.setCookie({ name: "fluxo_session", value: process.env.QA_SESSION_COOKIE, url: qaUrl, httpOnly: true, secure: true, sameSite: "Strict" });
    }
    await page.goto(qaUrl, { waitUntil: "networkidle0" });
    if (await page.$(".auth-panel")) {
      await page.type('input[type="password"]', process.env.QA_PASSWORD || "change-me-12345678");
      await page.click(".auth-panel button");
      await page.waitForSelector(".app-shell", { timeout: 15_000 });
      await page.waitForNetworkIdle();
    }

    const inspect = () => page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      title: document.title,
      visibleHeading: document.querySelector("h1")?.textContent?.trim() || ""
    }));

    const mobile = await inspect();
    await page.screenshot({ path: "/screens/dashboard-mobile.png" });

    const nav = await page.$$(".bottom-nav button");
    await nav[1].click();
    await page.waitForSelector(".reconciliation-screen");
    await page.waitForNetworkIdle();
    const reconciliation = await inspect();
    await page.screenshot({ path: "/screens/reconciliation-mobile.png" });

    const updatedNav = await page.$$(".bottom-nav button");
    await updatedNav[3].click();
    await page.waitForSelector(".sources-screen");
    await page.waitForFunction(() => {
      const select = document.querySelector(".chat-select select");
      return !select || (!select.disabled && select.querySelectorAll("option").length > 1) || Boolean(document.querySelector('.chat-actions [role="alert"]'));
    }, { timeout: 15_000 });
    const sources = {
      ...await inspect(),
      conversationSelector: await page.evaluate(() => {
        const select = document.querySelector(".chat-select select");
        return {
          present: Boolean(select),
          optionCount: select?.querySelectorAll("option").length || 0,
          error: document.querySelector('.chat-actions [role="alert"]')?.textContent?.trim() || null
        };
      }),
      historyChoice: await page.evaluate(() => ({
        present: document.querySelectorAll('input[name="whatsapp-history-mode"]').length === 2,
        selected: document.querySelector('input[name="whatsapp-history-mode"]:checked')?.value || null,
        confirmEnabled: !document.querySelector('.chat-actions .button.primary')?.disabled
      }))
    };
    const latest = await page.$('input[name="whatsapp-history-mode"][value="latest"]');
    const all = await page.$('input[name="whatsapp-history-mode"][value="all"]');
    if (latest && all) {
      await all.click();
      await latest.click();
      sources.historyInteraction = await page.evaluate(() => ({
        selected: document.querySelector('input[name="whatsapp-history-mode"]:checked')?.value || null,
        confirmEnabled: !document.querySelector('.chat-actions .button.primary')?.disabled
      }));
    }
    await page.screenshot({ path: "/screens/sources-mobile.png", fullPage: true });

    const finalNav = await page.$$(".bottom-nav button");
    await finalNav[0].click();
    await page.waitForSelector(".dashboard-screen");
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const desktop = await inspect();
    await page.screenshot({ path: "/screens/dashboard-desktop.png" });

    process.stdout.write(`${JSON.stringify({ mobile, reconciliation, sources, desktop, consoleErrors }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
