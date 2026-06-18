import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("b04a3ba48c8426b63294a1e2c6a9c970");
  const fields = cred.fields;
  
  const session = await browser.launchBrowser("google", true);
  const page = browser.getPage(session.id);
  
  // Login up to password
  await page.goto("https://accounts.google.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.fill("input[type=email]", fields.username);
  await page.click("#identifierNext");
  await page.waitForTimeout(3000);
  await page.waitForSelector("input[type=password]", { state: "visible", timeout: 15000 });
  await page.fill("input[type=password]", fields.password);
  await page.click("#passwordNext");
  await page.waitForTimeout(8000);
  
  console.log("URL:", page.url().substring(0, 80));
  
  // Click "Try another way"
  const btn = page.locator("button:has-text(\"Try another way\")").first();
  if (await btn.isVisible()) {
    console.log("Clicking Try another way");
    await btn.click();
    await page.waitForTimeout(3000);
    
    // Dump what appeared
    const elements = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll("div[role=button], li, a[role=link], [role=menuitem]").forEach(el => {
        const text = el.textContent?.trim() || "";
        if (text && text.length > 3 && text.length < 200) items.push(text);
      });
      return [...new Set(items)];
    });
    console.log("Available options:");
    elements.forEach(e => console.log("  -", e.substring(0, 100)));
  } else {
    console.log("Try another way not found");
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log("Page text:", pageText.substring(0, 500));
  }
  
  await browser.closeBrowser(session.id);
}
main().catch(e => console.error(e));
