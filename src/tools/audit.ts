import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readAuditLog, logAction } from "../audit/log.js";
import { integrityCheck, healthSummary } from "../audit/health.js";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonError(msg: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }, null, 2) }], isError: true };
}

/**
 * Register MCP tools for audit log and vault health operations.
 */
export function registerAuditTools(server: McpServer): void {
  // === List audit actions ===
  server.tool(
    "list_audit_actions",
    "List recent audit log entries (sensitive action history)",
    {
      limit: z.number().int().positive().max(200).default(50).describe("Max entries to return"),
    },
    async (input) => {
      try {
        const entries = await readAuditLog(input.limit);
        return jsonOk({ count: entries.length, entries });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === Log audit action ===
  server.tool(
    "log_audit_action",
    "Manually record a sensitive action in the audit log",
    {
      action: z.string().min(1).describe("Action type (e.g. ssh_keygen, login_attempt)"),
      credentialId: z.string().optional().describe("Associated credential ID"),
      service: z.string().optional().describe("Associated service name"),
      fingerprint: z.string().optional().describe("Device fingerprint"),
      metadata: z.string().optional().describe("JSON metadata string"),
    },
    async (input) => {
      try {
        await logAction({
          timestamp: new Date().toISOString(),
          action: input.action as any,
          credentialId: input.credentialId,
          service: input.service,
          fingerprint: input.fingerprint,
          metadata: input.metadata ? JSON.parse(input.metadata) : undefined,
        });
        return jsonOk({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === Vault integrity check ===
  server.tool(
    "vault_integrity_check",
    "Check that all vault files exist and contain valid encrypted entries",
    {},
    async () => {
      try {
        const result = await integrityCheck();
        return jsonOk(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === Vault health summary ===
  server.tool(
    "vault_health_summary",
    "Combined vault health: integrity, storage counts, and audit stats",
    {},
    async () => {
      try {
        const result = await healthSummary();
        return jsonOk(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );
}
