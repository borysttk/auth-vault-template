import * as browser from "./dist/browser/manager.js";
import * as vault from "./dist/credentials/vault.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const cred = await vault.getCredentials("3e4e8e3d36f8ffa682174e16bf699f4a");
  const fields = cred.fields;
  
  const session = await browser.launchBrowser("captchaplugin", true);
  const page = browser.getPage(session.id);
  
  // Login
  await page.goto("https://captchaplugin.com/login.php", { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.fill("input[type=email], input[name=email]", fields.username);
  await page.fill("input[type=password], input[name=password]", fields.password);
  await page.click("button:has-text(\"Sign in\"), input[type=submit]");
  await page.waitForTimeout(3000);
  
  // Go to keys page
  await page.goto("https://captchaplugin.com/en/keys.php", { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(2000);
  
  console.log("=== Keys page loaded ===");
  
  // Check current state and enable options
  const checkboxes = await page.evaluate(() => {
    const inputs = document.querySelectorAll("input[type=checkbox]");
    const result = [];
    inputs.forEach((inp, i) => {
      result.push({
        index: i,
        id: inp.id,
        name: inp.name,
        checked: inp.checked,
        parentText: inp.closest("label, div, td")?.textContent?.trim()?.substring(0, 60) || ""
      });
    });
    return result;
  });
  console.log("Checkboxes:", JSON.stringify(checkboxes, null, 2));
  
  // Enable the options if needed
  for (const cb of checkboxes) {
    if (!cb.checked) {
      // Try to check it
      const el = page.locator(`input[type=checkbox]`).nth(cb.index);
      await el.check();
      console.log("Checked checkbox", cb.index, cb.parentText);
    }
  }
  await page.waitForTimeout(500);
  
  // Find save button and click
  const btns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, input[type=submit]")).map(b => ({
      text: b.textContent?.trim() || (b).value || "",
      type: b.getAttribute("type")
    }));
  });
  console.log("Buttons:", JSON.stringify(btns));
  
  // Save
  const saveBtn = page.locator("button:has-text(\"Save\")").first();
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
    await page.waitForTimeout(2000);
    console.log("Saved!");
  }
  
  await page.screenshot({ path: "/tmp/keys_page.png" });
  await browser.closeBrowser(session.id);
}
main().catch(e => console.error("ERROR:", e.message));
