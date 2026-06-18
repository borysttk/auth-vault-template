import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("3e4e8e3d36f8ffa682174e16bf699f4a");
  const fields = cred.fields;
  
  const session = await browser.launchBrowser("captchaplugin", true);
  const page = browser.getPage(session.id);
  
  // Login first
  await page.goto("https://captchaplugin.com/login.php", { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.fill("input[type=email], input[name=email]", fields.username);
  await page.fill("input[type=password], input[name=password]", fields.password);
  await page.click("button:has-text(\"Sign in\"), input[type=submit]");
  await page.waitForTimeout(3000);
  
  // Check API page
  console.log("=== API Page ===");
  await page.goto("https://captchaplugin.com/en/api.php", { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(2000);
  const apiText = await page.evaluate(() => document.body.innerText);
  console.log(apiText.substring(0, 2000));
  
  // Check keys page
  console.log("\n=== Keys/AntiCaptcha Page ===");
  await page.goto("https://captchaplugin.com/en/keys.php", { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(2000);
  const keysText = await page.evaluate(() => document.body.innerText);
  console.log(keysText.substring(0, 2000));
  
  await browser.closeBrowser(session.id);
}
main().catch(e => console.error("ERROR:", e.message));
