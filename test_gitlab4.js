import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("470640eed5d9463d15953b7d01bc8d5f");
  const fields = cred.fields;
  
  const session = await browser.launchBrowser("gitlab", true);
  const page = browser.getPage(session.id);
  
  console.log("1. Loading GitLab login...");
  await page.goto("https://gitlab.com/users/sign_in", { waitUntil: "load", timeout: 30000 });
  
  // Wait and poll for Cloudflare to resolve
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    const title = await page.title();
    const url = page.url();
    console.log("   Try", i+1, "- Title:", title, "URL:", url.substring(0, 60));
    if (!title.includes("Just a moment") && url.includes("sign_in")) {
      console.log("   Page loaded!");
      break;
    }
  }
  
  const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("   Content:", text.replace(/\n/g, " ").substring(0, 300));
  
  // Try credentials if on sign in page
  if (page.url().includes("sign_in")) {
    console.log("\n2. Filling credentials...");
    try {
      await page.fill("input#user_login, input[name=\"user[login]\"]", fields.username, { timeout: 5000 });
      await page.fill("input#user_password, input[name=\"user[password]\"]", fields.password, { timeout: 5000 });
      await page.click("button[type=submit]", { timeout: 5000 });
      await page.waitForTimeout(10000);
      console.log("   URL after:", page.url().substring(0, 120));
    } catch(e) {
      console.log("   Form error:", e.message.substring(0, 100));
    }
  }
  
  console.log("\n3. Final state:");
  console.log("   URL:", page.url().substring(0, 120));
  console.log("   Title:", await page.title());
  const finalText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("   Content:", finalText.replace(/\n/g, " ").substring(0, 300));
  
  await page.screenshot({ path: "/tmp/gitlab_final.png" });
  await browser.closeBrowser(session.id);
}
main().catch(e => console.error("FATAL:", e.message));
