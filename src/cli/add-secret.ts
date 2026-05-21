#!/usr/bin/env node

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { storeSecret } from "../secrets/manager.js";
import { SecretKind } from "../secrets/types.js";
import { getConfig } from "../config.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function header(text: string) {
  console.log(`\n${BOLD}${CYAN}═══ ${text} ═══${RESET}\n`);
}
function success(text: string) {
  console.log(`${GREEN}✔ ${text}${RESET}`);
}
function warn(text: string) {
  console.log(`${YELLOW}⚠ ${text}${RESET}`);
}
function error(text: string) {
  console.log(`${RED}✖ ${text}${RESET}`);
}
function dim(text: string) {
  console.log(`${DIM}${text}${RESET}`);
}

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

const SECRET_KINDS: { id: SecretKind; label: string }[] = [
  { id: "api_key", label: "API Key" },
  { id: "bearer_token", label: "Bearer Token (OAuth/JWT)" },
  { id: "access_token", label: "Access Token" },
  { id: "refresh_token", label: "Refresh Token" },
  { id: "private_key", label: "Private Key" },
  { id: "generic", label: "Generic / Other" },
];

async function main(): Promise<void> {
  getConfig();

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║    mcp-auth-vault — Store a Secret       ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`);

  dim("Store API keys, access tokens, bearer tokens, and other secrets.");
  dim("All values are encrypted with AES-256-GCM at rest.\n");

  header("Step 1: Label");
  dim("A short name to identify this secret.");
  let label = await ask("Label");
  while (!label) {
    warn("Label is required.");
    label = await ask("Label");
  }

  header("Step 2: Secret Type");
  for (let i = 0; i < SECRET_KINDS.length; i++) {
    dim(`  ${i + 1}. ${SECRET_KINDS[i].label}`);
  }
  const kindChoice = await ask("Select type (1-6)", "1");
  const kindIndex = Math.min(Math.max(parseInt(kindChoice) - 1 || 0, 0), SECRET_KINDS.length - 1);
  const kind = SECRET_KINDS[kindIndex].id;
  dim(`Selected: ${SECRET_KINDS[kindIndex].label}`);

  header("Step 3: Service / System");
  dim("Which service or system is this secret for? (e.g. openai, github, stripe, aws)");
  let service = await ask("Service");
  while (!service) {
    warn("Service is required.");
    service = await ask("Service");
  }

  header("Step 4: Secret Value");
  warn("The value will be visible as you type.");
  let value = await ask("Secret value (token, key, etc.)");
  while (!value) {
    warn("Value is required.");
    value = await ask("Secret value");
  }

  header("Step 5: Details (optional)");
  const description = await ask("Description");
  const expiresAt = await ask("Expiry date (ISO 8601, e.g. 2027-01-01)");
  const scopesInput = await ask("Scopes (comma-separated, e.g. read,write)");
  const scopes = scopesInput ? scopesInput.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  header("Step 6: Tags (optional)");
  const tagsInput = await ask("Tags (comma-separated, e.g. production,infra)");
  const tags = tagsInput ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

  header("Step 7: Review");
  console.log(`${BOLD}Label:${RESET}        ${label}`);
  console.log(`${BOLD}Type:${RESET}         ${kind} (${SECRET_KINDS[kindIndex].label})`);
  console.log(`${BOLD}Service:${RESET}      ${service}`);
  console.log(`${BOLD}Value:${RESET}        ${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 4, 16))}`);
  if (description) console.log(`${BOLD}Description:${RESET}  ${description}`);
  if (expiresAt) console.log(`${BOLD}Expires:${RESET}      ${expiresAt}`);
  if (scopes?.length) console.log(`${BOLD}Scopes:${RESET}       ${scopes.join(", ")}`);
  if (tags?.length) console.log(`${BOLD}Tags:${RESET}          ${tags.join(", ")}`);
  console.log();

  if (!(await confirm("Save this secret to the vault (encrypted with AES-256-GCM)"))) {
    warn("Aborted.");
    rl.close();
    return;
  }

  try {
    const entry = await storeSecret(label, kind, service, { value, description, expiresAt, scopes }, tags);
    console.log();
    success("Secret saved and encrypted successfully!");
    console.log();
    console.log(`  ${BOLD}ID:${RESET}      ${entry.id}`);
    console.log(`  ${BOLD}Label:${RESET}    ${entry.label}`);
    console.log(`  ${BOLD}Kind:${RESET}     ${entry.kind}`);
    console.log(`  ${BOLD}Service:${RESET}  ${entry.service}`);
    console.log(`  ${BOLD}Created:${RESET}  ${entry.createdAt}`);
    console.log();
    dim("You can reference this ID to retrieve the value or delete it.");
    dim("Use: npm run list-secrets  — to view all stored secrets");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Failed to save: ${msg}`);
    process.exit(1);
  }

  rl.close();
}

main().catch((err) => {
  error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  rl.close();
  process.exit(1);
});
