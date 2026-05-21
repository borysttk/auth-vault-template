#!/usr/bin/env node

import { getConfig } from "../config.js";
import * as vault from "../credentials/vault.js";
import * as browser from "../browser/manager.js";
import { getServiceTemplate } from "../services/definitions.js";

getConfig();

const credentialId = process.argv[2];
if (!credentialId) {
  console.error("Usage: npx tsx src/cli/test-login.ts <credential-id>");
  process.exit(1);
}

const cred = await vault.getCredentials(credentialId);
if (!cred) {
  console.error(`Credential not found: ${credentialId}`);
  process.exit(1);
}

const template = getServiceTemplate(cred.entry.service);
if (!template) {
  console.error(`No template for service: ${cred.entry.service}`);
  process.exit(1);
}

console.log(`Logging into ${template.label} as ${cred.fields.username}...`);

const session = await browser.launchBrowser(cred.entry.service, true);

await browser.navigateTo(session.id, template.loginUrl);
console.log("1. Navigated to login page");

await browser.fillLoginForm(
  session.id,
  template,
  cred.fields.username,
  cred.fields.password,
  cred.fields.extra
);
console.log("2. Login form filled");

await browser.clickSubmit(session.id, template);
console.log("3. Login form submitted");

const totpSecret = cred.fields.extra?.totp_secret;
if (totpSecret) {
  const handled = await browser.handle2FAChallenge(session.id, template, totpSecret);
  console.log(`4. 2FA challenge handled: ${handled}`);
} else {
  console.log("4. No TOTP secret stored — skipping 2FA");
}

const isLoggedIn = await browser.verifyLogin(session.id, template);
console.log(`5. Login verified: ${isLoggedIn}`);
console.log(`   Final URL: ${browser.getPage(session.id)?.url() ?? "N/A"}`);

await browser.closeBrowser(session.id);
console.log("6. Browser closed");
