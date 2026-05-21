import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as secrets from "../secrets/manager.js";
import { SecretKind } from "../secrets/types.js";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonError(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

const SECRET_KINDS = ["api_key", "bearer_token", "access_token", "refresh_token", "private_key", "generic"] as const;

export function registerSecretTools(server: McpServer): void {
  server.tool(
    "store_secret",
    "Store an API key, access token, or other secret encrypted with AES-256-GCM",
    {
      label: z.string().min(1).max(128).describe("Human-readable label"),
      kind: z.enum(SECRET_KINDS).describe("Type of secret"),
      service: z.string().min(1).describe("Service or system (e.g. 'openai', 'github', 'stripe')"),
      value: z.string().min(1).describe("The secret value (token, API key, etc.)"),
      description: z.string().optional().describe("Optional description"),
      expiresAt: z.string().optional().describe("Optional expiry date (ISO 8601)"),
      scopes: z.array(z.string()).optional().describe("Optional permission scopes"),
      extra: z.record(z.string()).optional().describe("Optional extra metadata"),
      tags: z.array(z.string()).optional().describe("Tags for organization"),
    },
    async (input) => {
      try {
        const entry = await secrets.storeSecret(
          input.label,
          input.kind as SecretKind,
          input.service,
          {
            value: input.value,
            description: input.description,
            expiresAt: input.expiresAt,
            scopes: input.scopes,
            extra: input.extra,
          },
          input.tags
        );
        return jsonOk({
          success: true,
          id: entry.id,
          label: entry.label,
          kind: entry.kind,
          service: entry.service,
          createdAt: entry.createdAt,
          tags: entry.tags,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  server.tool(
    "get_secret",
    "Retrieve a stored secret by ID (returns decrypted value)",
    {
      id: z.string().min(1).describe("Secret ID from store_secret or list_secrets"),
    },
    async (input) => {
      try {
        const result = await secrets.getSecret(input.id);
        if (!result) return jsonError(`Secret not found: ${input.id}`);

        const { entry, fields } = result;
        return jsonOk({
          id: entry.id,
          label: entry.label,
          kind: entry.kind,
          service: entry.service,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          tags: entry.tags,
          secret: {
            value: fields.value,
            description: fields.description,
            expiresAt: fields.expiresAt,
            scopes: fields.scopes,
            extra: fields.extra,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  server.tool(
    "list_secrets",
    "List stored secrets, optionally filtered by service or kind",
    {
      service: z.string().optional().describe("Filter by service/system name"),
      kind: z.enum(SECRET_KINDS).optional().describe("Filter by secret type"),
    },
    async (input) => {
      try {
        const entries = await secrets.listSecrets(input.service, input.kind as SecretKind | undefined);
        return jsonOk({
          count: entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            label: e.label,
            kind: e.kind,
            service: e.service,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
            tags: e.tags,
          })),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  server.tool(
    "delete_secret",
    "Permanently delete a stored secret by ID",
    {
      id: z.string().min(1).describe("Secret ID to delete"),
    },
    async (input) => {
      try {
        const deleted = await secrets.deleteSecret(input.id);
        return jsonOk({ success: deleted, id: input.id });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );
}
