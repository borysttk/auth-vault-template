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
  await page.goto("https://gitlab.com/users/sign_in", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log("   URL:", page.url().substring(0, 80));
  
  // Fill login form
  console.log("2. Filling login form...");
  await page.fill("input[type=email], input[name=user\\[login\\]]", fields.username);
  await page.fill("input[type=password], input[name=user\\[password\\]]", fields.password);
  
  // Click sign in
  console.log("3. Clicking Sign in...");
  await page.click("button[type=submit], input[type=submit]");
  await page.waitForTimeout(8000);
  
  console.log("   Final URL:", page.url().substring(0, 120));
  const title = await page.title();
  console.log("   Title:", title);
  
  // Check if login was successful
  const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("   Content:", text.replace(/\n/g, " ").substring(0, 300));
  
  // Screenshot
  await page.screenshot({ path: "/tmp/gitlab_test.png" });
  console.log("   Screenshot saved");
  
  // Check for 2FA
  if (text.includes("two-factor") || text.includes("2FA") || text.includes("OTP") || text.includes("token")) {
    console.log("   2FA detected!");
  }
  
  // Navigate to profile to verify login
  if (!page.url().includes("sign_in") && !page.url().includes("signin")) {
    console.log("4. Login appears successful, navigating to profile...");
    await page.goto("https://gitlab.com/-/profile", { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(2000);
    console.log("   Profile URL:", page.url().substring(0, 100));
    const profileText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log("   Profile:", profileText.replace(/\n/g, " ").substring(0, 200));
  }
  
  await browser.closeBrowser(session.id);
  console.log("\n=== DONE ===");
}
main().catch(e => console.error("ERROR:", e.message));
