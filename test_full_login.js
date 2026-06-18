import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
import { generateTOTP } from "./dist/credentials/totp.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("b04a3ba48c8426b63294a1e2c6a9c970");
  const fields = cred.fields;
  const totpSecret = fields.extra.totp_secret.replace(/ /g, "");
  
  const session = await browser.launchBrowser("google", true);
  const page = browser.getPage(session.id);
  
  // Step 1: Navigate to Google login
  console.log("1. Navigating to Google login...");
  await page.goto("https://accounts.google.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  
  // Step 2: Fill email
  console.log("2. Filling email...");
  await page.fill("input[type=email]", fields.username);
  await page.click("#identifierNext");
  await page.waitForTimeout(3000);
  
  // Step 3: Fill password
  console.log("3. Filling password...");
  await page.waitForSelector("input[type=password]", { state: "visible", timeout: 15000 });
  await page.fill("input[type=password]", fields.password);
  await page.click("#passwordNext");
  await page.waitForTimeout(8000);
  
  console.log("   URL:", page.url().substring(0, 100));
  
  // Step 4: Handle 2FA - Click "Try another way"
  console.log("4. Clicking Try another way...");
  await page.locator("button:has-text(\"Try another way\")").first().click();
  await page.waitForTimeout(2000);
  
  // Step 5: Select Google Authenticator option
  console.log("5. Selecting Google Authenticator...");
  const authOption = page.locator("text=Get a verification code from the Google Authenticator app").first();
  await authOption.click();
  await page.waitForTimeout(3000);
  
  console.log("   URL:", page.url().substring(0, 120));
  
  // Step 6: Generate and fill TOTP code
  console.log("6. Filling TOTP code...");
  const code = generateTOTP(totpSecret);
  console.log("   Generated code:", code);
  
  // Try to find the input
  const inputVisible = await page.locator("input[type=tel]").first().isVisible().catch(() => false);
  console.log("   Input[type=tel] visible:", inputVisible);
  
  if (inputVisible) {
    await page.locator("input[type=tel]").first().fill(code);
    await page.waitForTimeout(500);
    
    // Click Next
    console.log("7. Clicking Next...");
    const nextBtn = page.locator("button:has-text(\"Next\")").first();
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
    } else {
      await page.press("input[type=tel]", "Enter");
    }
    await page.waitForTimeout(5000);
    console.log("   After 2FA URL:", page.url().substring(0, 120));
  }
  
  // Step 8: Test URLs
  const urls = [
    ["https://gemini.google.com/app", "Gemini_App"],
    ["https://aistudio.google.com/prompts/new_chat", "AI_Studio_Chat"],
    ["https://aistudio.google.com/apps", "AI_Studio_Apps"]
  ];
  
  for (const [url, label] of urls) {
    console.log("\n=== Testing " + label + " ===");
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await new Promise(r => setTimeout(r, 4000));
      console.log("  URL:", page.url().substring(0, 130));
      console.log("  Title:", await page.title());
      const text = await page.evaluate(() => document.body.innerText.substring(0, 400));
      console.log("  Content:", text.replace(/\n/g, " ").substring(0, 300));
      await page.screenshot({ path: "/tmp/" + label + ".png" });
    } catch(e) {
      console.log("  ERROR:", e.message.substring(0, 150));
    }
  }
  
  await browser.closeBrowser(session.id);
  console.log("\n=== DONE ===");
}
main().catch(e => console.error(e));
