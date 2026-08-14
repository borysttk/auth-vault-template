import fs from "node:fs/promises";
import path from "path";
import { getConfig } from "../config.js";

const AUDIT_FILE = "audit.log";

/**
 * Supported sensitive action types.
 */
export type AuditAction =
  | "create_token"
  | "rotate_password"
  | "delete_key"
  | "toggle_2fa"
  | "attach_totp"
  | "ssh_keygen"
  | "login_attempt"
  | "trust_device"
  | "remove_device"
  | "login_fallback";

/**
 * A single audit log entry.
 */
export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  credentialId?: string;
  service?: string;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get the directory for audit logs (same as vault root).
 */
function auditDir(): string {
  return getConfig().VAULT_ROOT;
}

/**
 * Get the full path to the audit log file.
 */
function auditPath(): string {
  return path.join(auditDir(), AUDIT_FILE);
}

/**
 * Append a sensitive action to the audit log (JSONL format).
 * Auto-rotates when log exceeds configured size (AUDIT_LOG_MAX_BYTES).
 */
export async function logAction(entry: AuditEntry): Promise<void> {
  const dir = auditDir();
  const filePath = path.join(dir, AUDIT_FILE);

  await fs.mkdir(dir, { recursive: true });

  // Check rotation
  try {
    const stat = await fs.stat(filePath);
    if (stat.size >= getConfig().AUDIT_LOG_MAX_BYTES) {
      const rotated = `${filePath}.${Date.now()}.rotated`;
      await fs.rename(filePath, rotated);
    }
  } catch {
    // File doesn't exist yet — fine
  }

  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(filePath, line, "utf8");
}

/**
 * Read the last N audit log entries (newest first).
 */
export async function readAuditLog(limit: number = 50): Promise<AuditEntry[]> {
  const filePath = auditPath();
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: AuditEntry[] = lines
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as AuditEntry[];

    // Return newest first
    return entries.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Get the total size of the audit log in bytes.
 */
export async function auditLogSize(): Promise<number> {
  try {
    const stat = await fs.stat(auditPath());
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Count entries in the audit log.
 */
export async function auditLogCount(): Promise<number> {
  try {
    const content = await fs.readFile(auditPath(), "utf8");
    return content.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
