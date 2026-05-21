import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import { SecretEntry, SecretFields, SecretKind, EncryptedPayload } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const INDEX_FILE = "secrets.json";

interface SecretsIndex {
  entries: SecretEntry[];
}

function getKey(): Buffer {
  const key = getConfig().VAULT_ENCRYPTION_KEY!;
  return Buffer.from(key, "hex");
}

function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return { ciphertext: encrypted, iv: iv.toString("hex"), authTag };
}

function decrypt(data: EncryptedPayload): string {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(data.iv, "hex"));
  decipher.setAuthTag(Buffer.from(data.authTag, "hex"));

  let decrypted = decipher.update(data.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function secretsPath(): string {
  return getConfig().VAULT_ROOT;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(secretsPath(), { recursive: true });
}

async function readIndex(): Promise<SecretsIndex> {
  const file = path.join(secretsPath(), INDEX_FILE);
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data) as SecretsIndex;
  } catch {
    return { entries: [] };
  }
}

async function writeIndex(index: SecretsIndex): Promise<void> {
  await ensureDir();
  await fs.writeFile(path.join(secretsPath(), INDEX_FILE), JSON.stringify(index, null, 2), "utf8");
}

function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function storeSecret(
  label: string,
  kind: SecretKind,
  service: string,
  fields: SecretFields,
  tags?: string[]
): Promise<SecretEntry> {
  const plaintext = JSON.stringify(fields);
  const encrypted = encrypt(plaintext);
  const now = new Date().toISOString();

  const entry: SecretEntry = {
    id: generateId(),
    label,
    kind,
    service,
    data: encrypted,
    createdAt: now,
    updatedAt: now,
    tags,
  };

  const index = await readIndex();
  index.entries.push(entry);
  await writeIndex(index);

  return entry;
}

export async function getSecret(
  id: string
): Promise<{ entry: SecretEntry; fields: SecretFields } | null> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return null;

  const plaintext = decrypt(entry.data);
  const fields = JSON.parse(plaintext) as SecretFields;
  return { entry, fields };
}

export async function listSecrets(
  service?: string,
  kind?: SecretKind
): Promise<SecretEntry[]> {
  const index = await readIndex();
  let entries = index.entries;

  if (service) entries = entries.filter((e) => e.service === service);
  if (kind) entries = entries.filter((e) => e.kind === kind);

  return entries;
}

export async function deleteSecret(id: string): Promise<boolean> {
  const index = await readIndex();
  const before = index.entries.length;
  index.entries = index.entries.filter((e) => e.id !== id);
  if (index.entries.length === before) return false;
  await writeIndex(index);
  return true;
}

export async function updateSecret(
  id: string,
  fields: SecretFields
): Promise<boolean> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return false;

  entry.data = encrypt(JSON.stringify(fields));
  entry.updatedAt = new Date().toISOString();
  await writeIndex(index);
  return true;
}
