import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// This is 1a2o's sign-in window. It never opens or reads the user's other browser profiles.
export async function signIn({ browserType = chromium, send = message => { if (process.connected) process.send?.(message); }, lifetimeMs = 900_000 } = {}) {
  let browser;
  const close = () => browser?.close().catch(() => {});
  process.once("disconnect", close);
  try {
    browser = await browserType.launch({ channel: "msedge", headless: false, args: ["--window-size=1000,850"] });
    const context = await browser.newContext();
    const page = await context.newPage();
    let csrf;
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.origin === "https://www.linkedin.com" && url.pathname.startsWith("/voyager/api/")) csrf = request.headers()["csrf-token"] ?? csrf;
    });
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
    send({ type: "opened" });
    const deadline = Date.now() + lifetimeMs;
    while (Date.now() < deadline && browser.isConnected() && !page.isClosed()) {
      const url = new URL(page.url());
      if (url.hostname === "www.linkedin.com" && /^\/(feed|mynetwork)(\/|$)/.test(url.pathname)) {
        const cookies = (await context.cookies("https://www.linkedin.com")).filter(cookie => ["linkedin.com", ".linkedin.com", "www.linkedin.com", ".www.linkedin.com"].includes(cookie.domain));
        if (["li_at", "JSESSIONID"].every(name => cookies.some(cookie => cookie.name === name && cookie.value))) {
          const userAgent = await page.evaluate(() => navigator.userAgent);
          send({ type: "session", session: { userAgent, csrf: csrf ?? cookies.find(cookie => cookie.name === "JSESSIONID").value.replace(/^"|"$/g, ""), cookies: cookies.map(({ name, value, domain, path, expires }) => ({ name, value, domain, path, expires })) } });
          return;
        }
      }
      await delay(1000);
    }
    send({ type: "cancelled" });
  } catch {
    send({ type: "error", message: "The LinkedIn sign-in window could not finish. Try again and complete any LinkedIn verification." });
  } finally {
    process.removeListener("disconnect", close);
    await close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await signIn();
  if (process.connected) process.disconnect?.();
}
