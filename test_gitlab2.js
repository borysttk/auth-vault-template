import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("470640eed5d9463d15953b7d01bc8d5f");
  const fields = cred.fields;
  
  const session = await browser.launchBrowser("gitlab", true);
  const page = browser.getPage(session.id);
  
  console.log("1. Navigating to GitLab login...");
  await page.goto("https://gitlab.com/users/sign_in", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(5000);
  console.log("   URL:", page.url().substring(0, 100));
  
  // Check if page loaded
  const html = await page.evaluate(() => document.title);
  console.log("   Title:", html);
  
  // Find login fields
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("input")).map(i => ({ 
      id: i.id, name: i.name, type: i.type, placeholder: i.placeholder 
    }));
  });
  console.log("   Inputs:", JSON.stringify(inputs));
  
  await browser.closeBrowser(session.id);
  console.log("\n=== DONE ===");
}
main().catch(e => console.error("ERROR:", e.message));
