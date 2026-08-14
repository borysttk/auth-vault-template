#!/usr/bin/env node

/**
 * generate-ssh-key — CLI tool for generating a new SSH key pair and storing in vault.
 *
 * Usage:
 *   npx tsx src/cli/generate-ssh-key.ts
 *   npm run generate-ssh-key
 *
 * Interactive walkthrough: key type, host, username, then generation + storage.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { storeSSHKey } from "../ssh/vault.js";
import { generateSSHKeyPair } from "../ssh/generator.js";
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
  getConfig();

  console.log(
    `\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`
  );
  console.log(
    `${BOLD}${CYAN}║    mcp-auth-vault — Generate SSH Key      ║${RESET}`
  );
  console.log(
    `${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`
  );

  // ── Step 1: Key Type ───────────────────────────────────────────────────
  header("Step 1: Key Type");
  dim("Supported algorithms:");
  dim("  ed25519   — Modern, fast, recommended (default)");
  dim("  rsa       — RSA, choose 2048 or 4096 bits for extra security");

  const keyTypeInput = await ask("Key algorithm", "ed25519");
  const keyType = keyTypeInput === "rsa" ? "rsa" : "ed25519";

  let rsaBits: number | undefined;
  if (keyType === "rsa") {
    const bitsStr = await ask("RSA bits", "4096");
    rsaBits = bitsStr === "2048" ? 2048 : 4096;
  }

  // ── Step 2: Label ──────────────────────────────────────────────────────
  header("Step 2: Key Label");
  dim("A short, memorable name (e.g. 'prod-web-2024').");
  let label = "";
  while (!label) {
    label = await ask("Label");
    if (!label) warn("Label is required.");
  }

  // ── Step 3: Connection details ─────────────────────────────────────────
  header("Step 3: Connection Details");

  let host = "";
  while (!host) {
    host = await ask("Host (alias or hostname)");
    if (!host) warn("Host is required.");
  }

  const portStr = await ask("Port", "22");
  const port = parseInt(portStr, 10) || 22;

  let username = "";
  while (!username) {
    username = await ask("Username (remote user)");
    if (!username) warn("Username is required.");
  }

  const hostname = await ask("Full hostname/IP (if host is an alias)");

  // ── Step 4: Optional Settings ──────────────────────────────────────────
  header("Step 4: Optional Settings");

  const passphrase = await ask("Passphrase (leave empty for no passphrase)");
  const comment = await ask("Comment (embedded in public key)", `${username}@${host}`);

  const tagsInput = await ask("Tags (comma-separated, e.g. production,web)");
  const tags = tagsInput
    ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  // ── Step 5: Review & Confirm ──────────────────────────────────────────
  header("Step 5: Review");

  console.log(`${BOLD}Label:${RESET}        ${label}`);
  console.log(`${BOLD}Key type:${RESET}     ${keyType}${rsaBits ? ` (${rsaBits} bit)` : ""}`);
  console.log(`${BOLD}Host:${RESET}         ${host}:${port}`);
  console.log(`${BOLD}Username:${RESET}     ${username}`);
  console.log(`${BOLD}Hostname:${RESET}     ${hostname || "(same as host)"}`);
  console.log(`${BOLD}Comment:${RESET}      ${comment}`);
  if (passphrase) console.log(`${BOLD}Passphrase:${RESET}  ${"•".repeat(passphrase.length)}`);
  if (tags?.length) console.log(`${BOLD}Tags:${RESET}        ${tags.join(", ")}`);

  console.log();
  const proceed = await confirm("Generate and save this SSH key?");
  if (!proceed) {
    warn("Aborted.");
    rl.close();
    return;
  }

  // ── Generate & Save ────────────────────────────────────────────────────
  try {
    header("Generating key pair...");
    dim("This may take a moment (especially for RSA-4096)...");

    const generated = await generateSSHKeyPair(
      keyType,
      rsaBits ? { rsaBits: rsaBits as 2048 | 4096, passphrase: passphrase || undefined, comment } : { passphrase: passphrase || undefined, comment }
    );

    success(`${keyType.toUpperCase()} key pair generated.`);

    const keyTypeStr = keyType === "rsa" ? `rsa-${rsaBits || 4096}` : "ed25519";
    const entry = await storeSSHKey(
      label,
      keyTypeStr,
      host,
      port,
      username,
      {
        privateKey: generated.privateKey,
        passphrase: passphrase || undefined,
        publicKey: generated.publicKey,
        comment,
      },
      tags,
      hostname || undefined
    );

    console.log();
    success(`SSH key saved successfully!`);
    console.log();
    console.log(`  ${BOLD}ID:${RESET}          ${entry.id}`);
    console.log(`  ${BOLD}Fingerprint:${RESET}  ${entry.fingerprint}`);
    console.log(`  ${BOLD}Private key:${RESET}  ${generated.privateKey.length} bytes`);
    console.log(`  ${BOLD}Public key:${RESET}`);
    console.log(`    ${generated.publicKey}`);
    console.log();
    dim("You can retrieve full details with:");
    dim(`  npm run get-ssh-key -- ${entry.id}`);
    dim("Export SSH config with:");
    dim(`  curl http://localhost:5600/api/ssh/${entry.id}/config`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed: ${msg}`);
    process.exit(1);
  }

  rl.close();
}

main().catch((err) => {
  error(`Unexpected: ${err instanceof Error ? err.message : String(err)}`);
  rl.close();
  process.exit(1);
});
