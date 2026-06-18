import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("3e4e8e3d36f8ffa682174e16bf699f4a");
  const fields = cred.fields;
  
  const session = await browser.launchBrowser("captchaplugin", true);
  const page = browser.getPage(session.id);
  
  console.log("1. Loading CaptchaPlugin login...");
  await page.goto("https://captchaplugin.com/login.php", { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(2000);
  console.log("   Title:", await page.title());
  
  // Fill login form
  console.log("2. Filling login...");
  await page.fill("input[type=email], input[name=email]", fields.username);
  await page.fill("input[type=password], input[name=password]", fields.password);
  
  // Check for CSRF token
  const csrf = await page.evaluate(() => {
    const m = document.body.innerHTML.match(/name=["\"]csrf_token["\"] value=["\"](\w+)["\"]/);
    return m ? m[1] : null;
  });
  console.log("   CSRF token:", csrf);
  
  await page.click("button:has-text(\"Sign in\"), input[type=submit]");
  await page.waitForTimeout(5000);
  
  console.log("   After login URL:", page.url().substring(0, 100));
  console.log("   Title:", await page.title());
  
  // Check page content
  const text = await page.evaluate(() => document.body.innerText.substring(0, 1000));
  console.log("   Content:", text.replace(/\n/g, " ").substring(0, 500));
  
  // Look for API/token sections
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a")).map(a => ({ href: a.href, text: a.textContent?.trim() })).filter(l => l.text);
  });
  console.log("   Links:", JSON.stringify(links.filter(l => l.text.length > 0 && l.text.length < 50)));
  
  await page.screenshot({ path: "/tmp/captchaplugin_dashboard.png" });
  await browser.closeBrowser(session.id);
}
main().catch(e => console.error("ERROR:", e.message));
