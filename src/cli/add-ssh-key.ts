#!/usr/bin/env node

/**
 * add-ssh-key — interactive CLI tool for storing SSH keys in the vault.
 *
 * Usage:
 *   npx tsx src/cli/add-ssh-key.ts
 *   npm run add-ssh-key
 *
 * Walks the user through SSH key metadata and private/public key material,
 * then persists everything via the SSH vault module (AES-256-GCM encrypted).
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { storeSSHKey } from "../ssh/vault.js";
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
    `${BOLD}${CYAN}║       mcp-auth-vault — Add SSH Key        ║${RESET}`
  );
  console.log(
    `${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`
  );

  // ── Step 1: Label ──────────────────────────────────────────────────────
  header("Step 1: Key Label");
  dim("A short, memorable name for this SSH key (e.g. 'production-web-1').");
  let label = await ask("Label");
  while (!label) {
    warn("Label is required.");
    label = await ask("Label");
  }

  // ── Step 2: Key Type ───────────────────────────────────────────────────
  header("Step 2: Key Type");
  dim("Supported types: ed25519, rsa-2048, rsa-4096");
  let keyType = await ask("Key type", "ed25519");
  const validTypes = ["ed25519", "rsa-2048", "rsa-4096"];
  while (!validTypes.includes(keyType)) {
    warn("Must be one of: ed25519, rsa-2048, rsa-4096");
    keyType = await ask("Key type", "ed25519");
  }

  // ── Step 3: Connection details ─────────────────────────────────────────
  header("Step 3: Connection Details");
  dim("Host alias or hostname (e.g. 'prod-web' or 'web.example.com').");
  let host = await ask("Host");
  while (!host) {
    warn("Host is required.");
    host = await ask("Host");
  }

  const defaultPort = "22";
  const portStr = await ask("Port", defaultPort);
  const port = parseInt(portStr, 10) || 22;

  let username = await ask("Username (remote user)");
  while (!username) {
    warn("Username is required.");
    username = await ask("Username");
  }

  const hostname = await ask("Full hostname/IP (if host is an alias)", host);

  // ── Step 4: Private Key ────────────────────────────────────────────────
  header("Step 4: Private Key");
  warn("Paste the full private key including BEGIN/END markers.");
  dim("Paste multi-line content, then press Enter twice on an empty line to finish.");
  dim("Or type 'FILE:' followed by a path to read from a file.");

  const firstLine = await ask("Private key (first line or FILE:/path)");
  let privateKey = firstLine;

  if (firstLine.startsWith("FILE:")) {
    const fs = await import("node:fs/promises");
    const filePath = firstLine.slice(5).trim();
    try {
      privateKey = await fs.readFile(filePath, "utf8");
      success(`Read ${privateKey.split("\n").length} lines from ${filePath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`Failed to read file: ${msg}`);
      process.exit(1);
    }
  } else {
    const lines = [firstLine];
    while (true) {
      const line = await ask("  ");
      if (!line.trim()) break;
      lines.push(line);
    }
    privateKey = lines.join("\n");
  }

  if (!privateKey.includes("-----BEGIN") || !privateKey.includes("PRIVATE KEY")) {
    warn("Doesn't look like a valid private key (missing BEGIN/PRIVATE KEY markers).");
    const proceed = await confirm("Continue anyway?");
    if (!proceed) {
      rl.close();
      return;
    }
  }

  // ── Step 5: Public Key (optional) ──────────────────────────────────────
  header("Step 5: Public Key (optional)");
  dim("If you have the public key, paste it here. Leave empty to extract from private key.");

  let publicKey = await ask("Public key");
  if (!publicKey) {
    try {
      const { extractPublicKey } = await import("../ssh/generator.js");
      const extracted = extractPublicKey(privateKey);
      if (extracted) {
        publicKey = extracted.publicKey;
        success("Public key extracted from private key.");
      }
    } catch {
      warn("Could not auto-extract public key — leaving empty.");
      publicKey = "";
    }
  }

  // ── Step 6: Passphrase (optional) ──────────────────────────────────────
  header("Step 6: Passphrase (optional)");
  const passphrase = await ask("Passphrase (if key is passphrase-protected)");

  // ── Step 7: Comment (optional) ─────────────────────────────────────────
  header("Step 7: Comment (optional)");
  const comment = await ask("Comment (e.g. user@host)", `${username}@${host}`);

  // ── Step 8: Tags (optional) ────────────────────────────────────────────
  header("Step 8: Tags (optional)");
  const tagsInput = await ask("Tags (comma-separated, e.g. production,web)");
  const tags = tagsInput
    ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  // ── Step 9: Review & Confirm ──────────────────────────────────────────
  header("Step 9: Review");

  console.log(`${BOLD}Label:${RESET}        ${label}`);
  console.log(`${BOLD}Key type:${RESET}     ${keyType}`);
  console.log(`${BOLD}Host:${RESET}         ${host}`);
  console.log(`${BOLD}Port:${RESET}         ${port}`);
  console.log(`${BOLD}Username:${RESET}     ${username}`);
  console.log(`${BOLD}Hostname:${RESET}     ${hostname}`);
  console.log(`${BOLD}Comment:${RESET}      ${comment}`);
  console.log(`${BOLD}Private key:${RESET}  ${privateKey.length} bytes`);
  console.log(`${BOLD}Public key:${RESET}   ${publicKey ? publicKey.slice(0, 60) + "..." : "(none)"}`);
  if (passphrase) console.log(`${BOLD}Passphrase:${RESET}  ${"•".repeat(passphrase.length)}`);
  if (tags?.length) console.log(`${BOLD}Tags:${RESET}        ${tags.join(", ")}`);

  console.log();
  const proceed = await confirm("Save this SSH key to the vault?");

  if (!proceed) {
    warn("Aborted — no SSH key was saved.");
    rl.close();
    return;
  }

  // ── Save ───────────────────────────────────────────────────────────────
  try {
    const entry = await storeSSHKey(
      label,
      keyType,
      host,
      port,
      username,
      {
        privateKey,
        passphrase: passphrase || undefined,
        publicKey: publicKey || undefined,
        comment: comment || `${username}@${host}`,
      },
      tags,
      hostname || undefined
    );

    console.log();
    success(`SSH key saved successfully!`);
    console.log();
    console.log(`  ${BOLD}ID:${RESET}          ${entry.id}`);
    console.log(`  ${BOLD}Label:${RESET}        ${entry.label}`);
    console.log(`  ${BOLD}Key type:${RESET}     ${entry.keyType}`);
    console.log(`  ${BOLD}Fingerprint:${RESET}  ${entry.fingerprint}`);
    console.log(`  ${BOLD}Host:${RESET}         ${entry.host}:${entry.port}`);
    console.log(`  ${BOLD}Username:${RESET}     ${entry.username}`);
    console.log(`  ${BOLD}Created:${RESET}      ${entry.createdAt}`);
    console.log();
    dim("Use: npm run list-ssh-keys  — to view all stored SSH keys");
    dim("      npm run get-ssh-key -- <id>  — to view full details");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to save SSH key: ${msg}`);
    process.exit(1);
  }

  rl.close();
}

main().catch((err) => {
  error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  rl.close();
  process.exit(1);
});
