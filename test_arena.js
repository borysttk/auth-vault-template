import * as browser from "./dist/browser/manager.js";
import { getConfig } from "./dist/config.js";
getConfig();

async function main() {
  const session = await browser.launchBrowser("arena", true);
  const page = browser.getPage(session.id);
  
  console.log("1. Loading arena.ai main page...");
  await page.goto("https://arena.ai/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  console.log("   Title:", await page.title());
  console.log("   URL:", page.url().substring(0, 80));
  
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a, button, [role=button]")).map(el => ({
      tag: el.tagName,
      text: (el.textContent || "").trim().substring(0, 80),
      href: el.href || el.getAttribute("href") || ""
    }));
  });
  console.log("\nAll interactive:");
  allLinks.filter(l => l.text).forEach(l => console.log("  -", l.tag, "|", l.text.substring(0, 60), "|", l.href.substring(0, 60)));
  
  // Look for login/signin
  const signedOut = await page.evaluate(() => document.body.innerText.includes("Sign") || document.body.innerText.includes("Log in"));
  console.log("\nHas sign-in text:", signedOut);
  
  await browser.closeBrowser(session.id);
  console.log("\n=== DONE ===");
}
main().catch(e => console.error("ERROR:", e.message));
