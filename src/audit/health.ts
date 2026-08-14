/**
 * Vault health and integrity check module.
 *
 * Exportable `integrityCheck()` for use by both the web server endpoint
 * and the periodic timer. Avoids duplicating the vault-file validation logic.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import { readAuditLog, auditLogSize, auditLogCount } from "./log.js";

// ── File-based vault integrity ─────────────────────────────────────────────

export interface VaultFileStatus {
  exists: boolean;
  valid: boolean;
  size: number;
}

export interface IntegrityResult {
  status: "healthy" | "degraded";
  vaultRoot: string;
  files: Record<string, VaultFileStatus>;
  checkedAt: string;
}

/**
 * Verify that all vault files exist and contain valid JSON with `entries` array.
 */
export async function integrityCheck(): Promise<IntegrityResult> {
  const vaultRoot = getConfig().VAULT_ROOT;
  const files = ["index.json", "secrets.json", "ssh.json"];
  const results: Record<string, VaultFileStatus> = {};
  let allOk = true;

  for (const file of files) {
    const filePath = path.join(vaultRoot, file);
    try {
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      results[file] = { exists: true, valid: Array.isArray(parsed.entries), size: stat.size };
      if (!Array.isArray(parsed.entries)) allOk = false;
    } catch {
      results[file] = { exists: false, valid: false, size: 0 };
      allOk = false;
    }
  }

  return {
    status: allOk ? "healthy" : "degraded",
    vaultRoot,
    files: results,
    checkedAt: new Date().toISOString(),
  };
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface HealthSummary {
  integrity: IntegrityResult;
  storage: {
    credentialCount: number;
    secretCount: number;
    sshKeyCount: number;
  };
  audit: {
    logSize: number;
    logCount: number;
    lastEntry: unknown | null;
  };
}

/**
 * Combined health summary: integrity + storage counts + audit stats.
 */
export async function healthSummary(): Promise<HealthSummary> {
  const intResult = await integrityCheck();

  // Count vault entries from file metadata (no decrypt)
  const credList = await getEntryCount(path.join(getConfig().VAULT_ROOT, "index.json"));
  const secList = await getEntryCount(path.join(getConfig().VAULT_ROOT, "secrets.json"));
  const sshList = await getEntryCount(path.join(getConfig().VAULT_ROOT, "ssh.json"));

  const logSize = await auditLogSize();
  const logCount = await auditLogCount();
  const lastEntries = await readAuditLog(1);
  const lastEntry = lastEntries.length > 0 ? lastEntries[0] : null;

  return {
    integrity: intResult,
    storage: {
      credentialCount: credList,
      secretCount: secList,
      sshKeyCount: sshList,
    },
    audit: {
      logSize,
      logCount,
      lastEntry,
    },
  };
}

async function getEntryCount(filePath: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.entries)) return parsed.entries.length;
    return 0;
  } catch {
    return 0;
  }
}
