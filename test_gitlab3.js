import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("470640eed5d9463d15953b7d01bc8d5f");
  const fields = cred.fields;
  
  const session = await browser.launchBrowser("gitlab", false);  // non-headless to see if CF passes
  const page = browser.getPage(session.id);
  
  console.log("1. Navigating to GitLab login...");
  await page.goto("https://gitlab.com/users/sign_in", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(15000);  // Wait for Cloudflare to resolve
  
  console.log("   URL:", page.url().substring(0, 100));
  console.log("   Title:", await page.title());
  
  // Check current page
  const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("   Content:", text.replace(/\n/g, " ").substring(0, 300));
  
  // Try to fill credentials if page loaded
  if (page.url().includes("sign_in")) {
    console.log("\n2. Trying to fill login...");
    try {
      await page.fill("input[name=user\\[login\\]]", fields.username, { timeout: 5000 });
      await page.fill("input[name=user\\[password\\]]", fields.password, { timeout: 5000 });
      await page.click("button[type=submit], input[type=submit]", { timeout: 5000 });
      await page.waitForTimeout(10000);
      console.log("   URL after login:", page.url().substring(0, 120));
      console.log("   Title:", await page.title());
    } catch(e) {
      console.log("   Error filling form:", e.message.substring(0, 100));
    }
  }
  
  await page.screenshot({ path: "/tmp/gitlab_result.png" });
  await browser.closeBrowser(session.id);
  console.log("\n=== DONE ===");
}
main().catch(e => console.error("ERROR:", e.message));
