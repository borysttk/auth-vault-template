import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import { SecretEntry, SecretFields, SecretKind, SecretStatus, EncryptedPayload } from "./types.js";

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
  let data: string;
  try {
    data = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { entries: [] };
    throw err;
  }
  return JSON.parse(data) as SecretsIndex;
}

async function writeIndex(index: SecretsIndex): Promise<void> {
  await ensureDir();
  const file = path.join(secretsPath(), INDEX_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(index, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
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

  // PITFALL: nie kazdy wpis jest JSON-em. Stare wpisy (np. z migracji CLI)
  // trzymaja goly sekret jako plaintext — `JSON.parse("vcp_0pOngm...")` rzuca
  // "Unexpected token 'v'" i caly endpoint konczy HTTP 500, przez co wpis
  // wyglada na martwy/niedostepny, a wartosc jest tam i jest poprawna.
  let fields: SecretFields;
  try {
    fields = JSON.parse(plaintext) as SecretFields;
  } catch {
    fields = { value: plaintext } as SecretFields;
  }
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

// Metadane rekordu są poza kopertą `data`, więc updateSecret() ich nie dosięgnie.
// Osobna funkcja — inaczej handler PUT zgłasza "updated", a nazwa zostaje stara.
export async function updateSecretMeta(
  id: string,
  meta: {
    label?: string;
    kind?: SecretKind;
    service?: string;
    tags?: string[];
    status?: SecretStatus;
    notes?: string;
  }
): Promise<boolean> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return false;

  if (meta.label !== undefined) entry.label = meta.label;
  if (meta.kind !== undefined) entry.kind = meta.kind;
  if (meta.service !== undefined) entry.service = meta.service;
  if (meta.tags !== undefined) entry.tags = meta.tags;
  if (meta.notes !== undefined) entry.notes = meta.notes;
  if (meta.status !== undefined) {
    // Zapamiętaj kiedy status się zmienił — "wyłączony od kiedy?" musi mieć odpowiedź.
    if (entry.status !== meta.status) {
      entry.statusChangedAt = new Date().toISOString();
    }
    entry.status = meta.status;
  }
  entry.updatedAt = new Date().toISOString();

  await writeIndex(index);
  return true;
}
