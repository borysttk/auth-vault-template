import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as vault from "../credentials/vault.js";
import { ServiceCredentialFields } from "../credentials/types.js";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonError(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function registerCredentialTools(server: McpServer): void {
  // === store_credentials ===
  server.tool(
    "store_credentials",
    "Store login credentials for a service securely with AES-256-GCM encryption",
    {
      service: z.string().min(1).describe("Service identifier (e.g., 'google', 'arena.ai', 'github')"),
      label: z.string().min(1).max(128).describe("Human-readable label for this credential entry"),
      username: z.string().min(1).describe("Username or email for login"),
      password: z.string().min(1).describe("Password for login"),
      extra: z.record(z.string()).optional().describe("Optional extra fields (e.g., organization, 2FA secret)"),
      tags: z.array(z.string()).optional().describe("Optional tags for organization"),
    },
    async (input) => {
      try {
        const fields: ServiceCredentialFields = {
          username: input.username,
          password: input.password,
        };
        if (input.extra && Object.keys(input.extra).length > 0) {
          fields.extra = input.extra;
        }

        const entry = await vault.storeCredentials(
          input.service,
          input.label,
          fields,
          input.tags
        );

        return jsonOk({
          success: true,
          id: entry.id,
          service: entry.service,
          label: entry.label,
          createdAt: entry.createdAt,
          tags: entry.tags,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === get_credentials ===
  server.tool(
    "get_credentials",
    "Retrieve stored credentials by ID. Returns decrypted username and password.",
    {
      id: z.string().min(1).describe("Credential ID from store_credentials or list_credentials"),
      includePassword: z.boolean().optional().default(false).describe("Include password in response (default: false for security)"),
    },
    async (input) => {
      try {
        const result = await vault.getCredentials(input.id);
        if (!result) {
          return jsonError(`Credential not found: ${input.id}`);
        }

        const { entry, fields } = result;
        return jsonOk({
          id: entry.id,
          service: entry.service,
          label: entry.label,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          tags: entry.tags,
          credentials: {
            username: fields.username,
            password: input.includePassword ? fields.password : "***",
            extra: fields.extra,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === list_credentials ===
  server.tool(
    "list_credentials",
    "List stored credentials, optionally filtered by service",
    {
      service: z.string().optional().describe("Filter by service identifier"),
    },
    async (input) => {
      try {
        const entries = await vault.listCredentials(input.service);
        return jsonOk({
          count: entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            service: e.service,
            label: e.label,
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

  // === delete_credentials ===
  server.tool(
    "delete_credentials",
    "Permanently delete stored credentials by ID",
    {
      id: z.string().min(1).describe("Credential ID to delete"),
    },
    async (input) => {
      try {
        const deleted = await vault.deleteCredentials(input.id);
        return jsonOk({ success: deleted, id: input.id });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === get_credentials_for_service ===
  server.tool(
    "get_credentials_for_service",
    "Get all credentials for a specific service",
    {
      service: z.string().min(1).describe("Service identifier (e.g., 'google', 'arena.ai')"),
      includePasswords: z.boolean().optional().default(false).describe("Include passwords in response"),
    },
    async (input) => {
      try {
        const results = await vault.getCredentialsForService(input.service);
        return jsonOk({
          count: results.length,
          service: input.service,
          entries: results.map(({ entry, fields }) => ({
            id: entry.id,
            label: entry.label,
            createdAt: entry.createdAt,
            tags: entry.tags,
            credentials: {
              username: fields.username,
              password: input.includePasswords ? fields.password : "***",
              extra: fields.extra,
            },
          })),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === generate_qr ===
  server.tool(
    "generate_qr",
    "Generate a Google Authenticator QR code for a stored credential's TOTP secret",
    {
      credentialId: z.string().min(1).describe("Credential ID with a totp_secret extra field"),
    },
    async (input) => {
      try {
        const result = await vault.getCredentials(input.credentialId);
        if (!result) {
          return jsonError(`Credential not found: ${input.credentialId}`);
        }

        const totpSecret = result.fields.extra?.totp_secret;
        if (!totpSecret) {
          return jsonError(`Credential ${input.credentialId} has no TOTP secret.`);
        }

        const account = result.fields.username;
        const issuer = result.entry.service;
        const label = result.entry.label;
        const { buildOTPAuthURL, saveQRPNG, qrFileName } = await import("../credentials/qr.js");

        const otpUrl = buildOTPAuthURL(totpSecret, account, issuer);
        const fileName = qrFileName(issuer, label);
        const filePath = await saveQRPNG(otpUrl, fileName);

        return jsonOk({
          success: true,
          qrFile: filePath,
          credentialId: input.credentialId,
          service: issuer,
          account,
          message: `QR code saved to ${filePath}. Scan with Google Authenticator.`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );
}
