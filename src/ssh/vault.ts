import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "path";
import { getConfig } from "../config.js";
import {
  SSHKeyEntry,
  SSHKeyFields,
  SSHIndex,
  EncryptedPayload,
} from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const INDEX_FILE = "ssh.json";

// ── Encryption helpers ───────────────────────────────────────────────────────

function getKey(): Buffer {
  const config = getConfig();
  if (!config.VAULT_ENCRYPTION_KEY) {
    throw new Error("VAULT_ENCRYPTION_KEY is not configured");
  }
  return Buffer.from(config.VAULT_ENCRYPTION_KEY, "hex");
}

function encrypt(plaintext: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

function decrypt(data: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(data.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(data.authTag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

// ── Vault I/O ─────────────────────────────────────────────────────────────────

function vaultPath(): string {
  return getConfig().VAULT_ROOT;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(vaultPath(), { recursive: true });
}

async function readIndex(): Promise<SSHIndex> {
  const filePath = path.join(vaultPath(), INDEX_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { entries: [] };
    throw err;
  }
  return JSON.parse(raw) as SSHIndex;
}

async function writeIndex(index: SSHIndex): Promise<void> {
  await ensureDir();
  const filePath = path.join(vaultPath(), INDEX_FILE);
  const tmp = `${filePath}.${process.pid}.tmp`;
  const handle = await fs.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(index, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, filePath);
}

function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute SHA256 fingerprint from an OpenSSH public key line.
 * Returns "SHA256:<base64hash>" (matches `ssh-keygen -lf` output).
 */
export function computeFingerprint(publicKey: string): string {
  // Parse OpenSSH format: "algorithm base64key comment"
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error("Invalid public key format — expected 'algorithm base64 [comment]'");
  }
  const keyBytes = Buffer.from(parts[1], "base64");
  const hash = crypto.createHash("sha256").update(keyBytes).digest("base64");
  return `SHA256:${hash}`;
}

/**
 * Store a new SSH key entry in the vault.
 */
export async function storeSSHKey(
  label: string,
  keyType: string,
  host: string,
  port: number,
  username: string,
  fields: SSHKeyFields,
  tags?: string[],
  hostname?: string
): Promise<SSHKeyEntry> {
  const index = await readIndex();

  const existingPublicKey = fields.publicKey;
  const fingerprint = existingPublicKey
    ? computeFingerprint(existingPublicKey)
    : "unknown";

  const entry: SSHKeyEntry = {
    id: generateId(),
    label,
    keyType,
    fingerprint,
    bits: fields.extra?.bits ? parseInt(fields.extra.bits, 10) : undefined,
    host,
    port,
    username,
    hostname,
    publicKey: existingPublicKey || undefined,
    data: encrypt(JSON.stringify(fields)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags,
  };

  index.entries.push(entry);
  await writeIndex(index);
  return entry;
}

/**
 * Retrieve a decrypted SSH key by ID.
 */
export async function getSSHKey(
  id: string
): Promise<{ entry: SSHKeyEntry; fields: SSHKeyFields } | null> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return null;

  const decrypted = decrypt(entry.data);
  const fields = JSON.parse(decrypted) as SSHKeyFields;
  return { entry, fields };
}

/**
 * List SSH keys (metadata only — no decryption).
 */
export async function listSSHKeys(
  host?: string,
  keyType?: string
): Promise<SSHKeyEntry[]> {
  const index = await readIndex();
  let entries = index.entries;

  if (host) {
    entries = entries.filter((e) => e.host === host);
  }
  if (keyType) {
    entries = entries.filter((e) => e.keyType === keyType);
  }

  // Return metadata only (no decrypted data)
  return entries.map(({ data, ...meta }) => meta as SSHKeyEntry);
}

/**
 * Delete an SSH key by ID.
 */
export async function deleteSSHKey(id: string): Promise<boolean> {
  const index = await readIndex();
  const idx = index.entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  index.entries.splice(idx, 1);
  await writeIndex(index);
  return true;
}

/**
 * Update an existing SSH key's fields.
 */
export async function updateSSHKey(
  id: string,
  fields: Partial<SSHKeyFields> & {
    label?: string;
    host?: string;
    port?: number;
    username?: string;
    hostname?: string;
    tags?: string[];
  }
): Promise<boolean> {
  const index = await readIndex();
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return false;

  // Update metadata fields if provided
  if (fields.label !== undefined) entry.label = fields.label;
  if (fields.host !== undefined) entry.host = fields.host;
  if (fields.port !== undefined) entry.port = fields.port;
  if (fields.username !== undefined) entry.username = fields.username;
  if (fields.hostname !== undefined) entry.hostname = fields.hostname;
  if (fields.tags !== undefined) entry.tags = fields.tags;

  // Re-encrypt data if private key material changed
  const cryptoFields: SSHKeyFields = {
    privateKey: fields.privateKey ?? "",
    passphrase: fields.passphrase,
    publicKey: fields.publicKey,
    comment: fields.comment,
    extra: fields.extra,
  };
  const hasKeyChange =
    fields.privateKey !== undefined ||
    fields.passphrase !== undefined ||
    fields.publicKey !== undefined ||
    fields.comment !== undefined;

  if (hasKeyChange) {
    // Merge with existing fields
    const existing = decrypt(entry.data);
    const existingFields = JSON.parse(existing) as SSHKeyFields;
    const merged: SSHKeyFields = {
      privateKey: fields.privateKey ?? existingFields.privateKey,
      passphrase: fields.passphrase ?? existingFields.passphrase,
      publicKey: fields.publicKey ?? existingFields.publicKey,
      comment: fields.comment ?? existingFields.comment,
      extra: fields.extra ?? existingFields.extra,
    };
    entry.data = encrypt(JSON.stringify(merged));

    // Recompute fingerprint if public key changed
    if (merged.publicKey) {
      entry.fingerprint = computeFingerprint(merged.publicKey);
    }
    entry.publicKey = merged.publicKey || undefined;
  }

  entry.updatedAt = new Date().toISOString();
  await writeIndex(index);
  return true;
}
