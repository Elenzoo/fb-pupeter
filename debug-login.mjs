import fs from "fs/promises";
import puppeteer from "puppeteer";

const email = process.env.FB_EMAIL;
const pass = process.env.FB_PASSWORD;

if (!email || !pass) {
  console.log("Brak FB_EMAIL/FB_PASSWORD w env (.env lub zmienne).");
  process.exit(1);
}

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser";

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-notifications",
    "--lang=en-US,en",
  ],
});

const page = await browser.newPage();
page.setDefaultTimeout(60000);

await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#email", { timeout: 60000 });
await page.type("#email", email, { delay: 30 });
await page.type("#pass", pass, { delay: 30 });

await Promise.all([
  page.click('button[name="login"]'),
  page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
]);

const url = page.url();
const title = await page.title().catch(() => "");
const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");

await page.screenshot({ path: "/tmp/fb-login.png", fullPage: true }).catch(() => null);

console.log("URL:", url);
console.log("TITLE:", title);
console.log("BODY_SNIPPET:\n", bodyText);

await browser.close();
