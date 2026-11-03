import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { getConfig } from "../config.js";
import { CredentialEntry, CredentialStatus, EncryptedData, ServiceCredentialFields } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const INDEX_FILE = "index.json";

interface VaultIndex {
  entries: CredentialEntry[];
}

function getKey(): Buffer {
  const key = getConfig().VAULT_ENCRYPTION_KEY!;
  return Buffer.from(key, "hex");
}

function encrypt(plaintext: string): EncryptedData {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    authTag,
  };
}

function decrypt(data: EncryptedData): string {
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(data.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(data.authTag, "hex"));

  let decrypted = decipher.update(data.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function vaultPath(): string {
  return getConfig().VAULT_ROOT;
}

async function ensureVaultDir(): Promise<void> {
  const dir = vaultPath();
  await fs.mkdir(dir, { recursive: true });
}

async function readIndex(): Promise<VaultIndex> {
  const file = path.join(vaultPath(), INDEX_FILE);
  let data: string;
  try {
    data = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { entries: [] };
    throw err;
  }
  return JSON.parse(data) as VaultIndex;
}

async function writeIndex(index: VaultIndex): Promise<void> {
  await ensureVaultDir();
  const file = path.join(vaultPath(), INDEX_FILE);
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

export async function storeCredentials(
  service: string,
  label: string,
  fields: ServiceCredentialFields,
  tags?: string[]
): Promise<CredentialEntry> {
  const plaintext = JSON.stringify(fields);
  const encrypted = encrypt(plaintext);
  const now = new Date().toISOString();

  const entry: CredentialEntry = {
    id: generateId(),
    service,
    label,
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

export async function getCredentials(
  id: string
): Promise<{ entry: CredentialEntry; fields: ServiceCredentialFields } | null> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return null;

  const plaintext = decrypt(entry.data);
  const fields = JSON.parse(plaintext) as ServiceCredentialFields;
  return { entry, fields };
}

export async function getCredentialsForService(
  service: string
): Promise<Array<{ entry: CredentialEntry; fields: ServiceCredentialFields }>> {
  const index = await readIndex();
  const matching = index.entries.filter((e) => e.service === service);
  return matching.map((entry) => {
    const plaintext = decrypt(entry.data);
    const fields = JSON.parse(plaintext) as ServiceCredentialFields;
    return { entry, fields };
  });
}

export async function listCredentials(
  service?: string
): Promise<CredentialEntry[]> {
  const index = await readIndex();
  // The index also holds secret records, whose payload lives in secrets.json —
  // listing them offers rows whose detail view cannot decrypt anything.
  const credentials = index.entries.filter((e) => Boolean(e.data?.iv));
  if (service) {
    return credentials.filter((e) => e.service === service);
  }
  return credentials;
}

export async function deleteCredentials(id: string): Promise<boolean> {
  const index = await readIndex();
  const before = index.entries.length;
  index.entries = index.entries.filter((e) => e.id !== id);
  if (index.entries.length === before) return false;
  await writeIndex(index);
  return true;
}

export async function updateCredentials(
  id: string,
  fields: ServiceCredentialFields,
  entryUpdates?: Partial<
    Pick<CredentialEntry, "label" | "tags" | "status" | "notes">
  >
): Promise<boolean> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return false;

  const plaintext = JSON.stringify(fields);
  entry.data = encrypt(plaintext);
  entry.updatedAt = new Date().toISOString();

  await writeIndex(index);
  return true;
}

// Metadane (label / service / tags / status / notes) są na obiekcie wpisu, nie
// w kopercie `data`. Osobna funkcja — scalona z updateCredentials() przywróci
// ciche gubienie etykiet.
export async function updateCredentialMeta(
  id: string,
  meta: {
    label?: string;
    service?: string;
    tags?: string[];
    status?: CredentialStatus;
    notes?: string;
  }
): Promise<boolean> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return false;

  if (meta.label !== undefined) entry.label = meta.label;
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
