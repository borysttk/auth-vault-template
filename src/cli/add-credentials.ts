#!/usr/bin/env node

/**
 * add-credentials — interactive CLI tool for storing login credentials in the vault.
 *
 * Usage:
 *   npx tsx src/cli/add-credentials.ts
 *   npm run add-creds
 *
 * Walks the user through service selection, credential input, extra fields, and tags,
 * then persists everything via the vault module (AES-256-GCM encrypted).
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { listServiceTemplates } from "../services/definitions.js";
import { storeCredentials } from "../credentials/vault.js";
import { isValidTOTPSecret } from "../credentials/totp.js";
import {
  generateTOTPSecret,
  buildOTPAuthURL,
  renderQRCode,
  saveQRPNG,
  qrFileName,
} from "../credentials/qr.js";
import { getConfig } from "../config.js";

// ── ANSI helpers (zero dependencies) ───────────────────────────────────────
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function header(text: string): void {
  console.log(`\n${BOLD}${CYAN}═══ ${text} ═══${RESET}\n`);
}

function success(text: string): void {
  console.log(`${GREEN}✔ ${text}${RESET}`);
}

function warn(text: string): void {
  console.log(`${YELLOW}⚠ ${text}${RESET}`);
}

function error(text: string): void {
  console.log(`${RED}✖ ${text}${RESET}`);
}

function dim(text: string): void {
  console.log(`${DIM}${text}${RESET}`);
}

// ── Readline wrapper ───────────────────────────────────────────────────────
const rl = readline.createInterface({ input, output });

async function ask(question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal !== undefined ? ` [${defaultVal}]: ` : ": ";
  const answer = await rl.question(`${BOLD}${question}${RESET}${suffix}`);
  return answer.trim() || defaultVal || "";
}

async function confirm(question: string): Promise<boolean> {
  const answer = await rl.question(`${BOLD}${question}${RESET} (y/N): `);
  return answer.trim().toLowerCase() === "y";
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Bootstrap config once (loads .env, resolves paths, generates key if needed)
  getConfig();

  console.log(
    `\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`
  );
  console.log(
    `${BOLD}${CYAN}║        mcp-auth-vault — Add Credentials    ║${RESET}`
  );
  console.log(
    `${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`
  );

  // ── Step 1: Service ────────────────────────────────────────────────────
  header("Step 1: Select Service");

  const templates = listServiceTemplates();
  const knownServices = templates.map((t) => t.id);

  if (knownServices.length > 0) {
    console.log("Available services:");
    for (const t of templates) {
      dim(`  ${t.id.padEnd(12)} — ${t.label}`);
    }
    console.log();
  } else {
    dim("(No built-in service templates — you can type any service ID)\n");
  }

  dim("Tip: You can type a custom service ID not listed above.");
  let service = await ask("Service identifier", knownServices[0] || "");

  while (!service) {
    warn("Service identifier cannot be empty.");
    service = await ask("Service identifier");
  }

  const template = templates.find((t) => t.id === service);
  const labelHint = template ? template.label : service;

  // ── Step 2: Label ──────────────────────────────────────────────────────
  header("Step 2: Credential Label");

  dim("A short, memorable name to distinguish this credential entry.");
  const autoLabel = `${labelHint} (${new Date().toLocaleDateString()})`;
  const label = await ask("Label", autoLabel);

  // ── Step 3: Username / Password ────────────────────────────────────────
  header("Step 3: Login Credentials");

  let username = await ask("Username / Email");
  while (!username) {
    warn("Username is required.");
    username = await ask("Username / Email");
  }

  warn("Password will be visible as you type (stdin echo).");
  let password = await ask("Password");
  while (!password) {
    warn("Password is required.");
    password = await ask("Password");
  }

  // ── Step 4: TOTP / 2FA Secret (optional) ────────────────────────────
  header("Step 4: TOTP / 2FA (optional)");

  dim("Set up two-factor authentication. The secret will be stored and used");
  dim("to auto-generate login codes. A QR code can be saved for your phone.");
  let totpSecret = "";
  const setupTOTP = await confirm("Set up TOTP two-factor authentication");
  if (setupTOTP) {
    const hasExisting = await confirm("Do you have an existing TOTP secret (from a service setup page)");
    if (hasExisting) {
      dim("Enter the base32-encoded secret shown during service setup.");
      dim("Example: JBSWY3DPEHPK3PXP");
      totpSecret = await ask("Base32 TOTP secret");
      while (totpSecret && !isValidTOTPSecret(totpSecret)) {
        warn("Invalid base32 secret. It should be 16+ characters (A-Z, 2-7).");
        totpSecret = await ask("Base32 TOTP secret (or leave empty to cancel)");
      }
    } else {
      totpSecret = generateTOTPSecret();
      success("Generated a new TOTP secret for you!");
    }

    if (totpSecret) {
      const account = username || label;
      const issuer = template?.label || service;
      const otpUrl = buildOTPAuthURL(totpSecret, account, issuer);

      const qrText = await renderQRCode(otpUrl);
      console.log(`\n${BOLD}Scan this QR code with Google Authenticator:${RESET}`);
      console.log(qrText);
      console.log(`${DIM}Secret (manual entry): ${totpSecret}${RESET}\n`);

      const savePng = await confirm("Save QR code as a PNG file");
      if (savePng) {
        const fileName = qrFileName(service, label);
        const filePath = await saveQRPNG(otpUrl, fileName);
        success(`QR code saved: ${filePath}`);
      }
    }
  }

  // ── Step 5: Extra Fields ───────────────────────────────────────────────
  header("Step 5: Extra Fields (optional)");

  const extra: Record<string, string> = {};
  if (totpSecret) extra.totp_secret = totpSecret;

  if (template?.extraFields && template.extraFields.length > 0) {
    dim(
      `This service supports extra fields: ${template.extraFields.map((f) => f.label).join(", ")}`
    );
    for (const field of template.extraFields) {
      const val = await ask(`${field.label} (${field.name})`);
      if (val) extra[field.name] = val;
    }
  }

  // Allow arbitrary extra fields
  if (await confirm("Add custom extra fields (e.g. organization, TOTP secret)")) {
    let more = true;
    while (more) {
      const key = await ask("  Field name (e.g. 'organization')");
      const val = await ask(`  Value for '${key || "(skip)"}'`);
      if (key && val) {
        extra[key] = val;
      }
      more = await confirm("  Add another field?");
    }
  }

  // ── Step 6: Tags ───────────────────────────────────────────────────────
  header("Step 6: Tags (optional)");

  const tagsInput = await ask("Tags (comma-separated, e.g. work,production)");
  const tags = tagsInput
    ? tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  // ── Step 7: Review & Confirm ──────────────────────────────────────────
  header("Step 7: Review");

  console.log(`${BOLD}Service:${RESET}      ${service}`);
  console.log(`${BOLD}Label:${RESET}        ${label}`);
  console.log(`${BOLD}Username:${RESET}     ${username}`);
  console.log(`${BOLD}Password:${RESET}     ${"•".repeat(Math.min(password.length, 12))}`);
  if (totpSecret) {
    console.log(`${BOLD}TOTP secret:${RESET}  ${totpSecret.slice(0, 4)}...${totpSecret.slice(-4)}`);
  }
  if (Object.keys(extra).length > 0) {
    console.log(`${BOLD}Extra fields:${RESET} ${JSON.stringify(extra)}`);
  }
  if (tags && tags.length > 0) {
    console.log(`${BOLD}Tags:${RESET}          ${tags.join(", ")}`);
  }

  console.log();
  const proceed = await confirm("Save these credentials to the vault?");

  if (!proceed) {
    warn("Aborted — no credentials were saved.");
    rl.close();
    return;
  }

  // ── Save ───────────────────────────────────────────────────────────────
  try {
    const entry = await storeCredentials(
      service,
      label,
      { username, password, extra: Object.keys(extra).length > 0 ? extra : undefined },
      tags
    );

    console.log();
    success(`Credentials saved successfully!`);
    console.log();
    console.log(`  ${BOLD}ID:${RESET}      ${entry.id}`);
    console.log(`  ${BOLD}Service:${RESET}  ${entry.service}`);
    console.log(`  ${BOLD}Label:${RESET}    ${entry.label}`);
    console.log(`  ${BOLD}Created:${RESET}  ${entry.createdAt}`);
    console.log();
    dim("You can reference this ID later to retrieve or delete the credentials.");
    dim("Use: npm run list-creds  — to view all stored credentials");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to save credentials: ${msg}`);
    process.exit(1);
  }

  rl.close();
}

main().catch((err) => {
  error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  rl.close();
  process.exit(1);
});
