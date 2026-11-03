import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as vault from "../credentials/vault.js";
import * as secrets from "../secrets/manager.js";
import { ServiceCredentialFields } from "../credentials/types.js";
import { logAction } from "../audit/log.js";

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

  // === get_credentials_envelope ===
  // Q-Envelope v2: ZERO-PLAINTEXT delivery.
  // Node NIE odszyfrowuje credentiala — envelope.py czyta z vault.db/JSON samodzielnie,
  // szyfruje do odbiorcy (X25519+ChaCha20Poly1305) i zwraca TYLKO ciphertext.
  // Plaintext istnieje wyłącznie wewnatrz procesu envelope.py (przed encrypt).
  server.tool(
    "get_credentials_envelope",
    "Retrieve credentials ENCRYPTED in Q-Envelope to a recipient node (X25519+ChaCha20Poly1305). The plaintext credential is NEVER decoded in the Node process — the Python backend reads it from the vault and encrypts in-place. Use instead of get_credentials for cross-service secret delivery.",
    {
      cred_id: z.string().min(1).describe("Credential ID, service, or label to deliver (resolved by envelope backend)"),
      recipient: z.string().min(1).describe("Recipient node name from q-env.json (e.g. 'q-predator', VPS uuid)"),
    },
    async (input) => {
      try {
        const { spawnSync } = await import("node:child_process");
        const proc = spawnSync(
          "python3",
          ["/opt/q-envelope/envelope.py", "deliver", input.cred_id, input.recipient],
          { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
        );
        if (proc.status !== 0) {
          return jsonError(`Envelope delivery failed: ${proc.stderr || proc.error}`);
        }
        const envelope = JSON.parse(proc.stdout.trim());
        return jsonOk({
          id: input.cred_id,
          recipient: input.recipient,
          envelope,
          note: "Decrypt with your private key via Q-Envelope (envelope.py decrypt). Plaintext never left the vault backend process.",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );


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
      await logAction({
        timestamp: new Date().toISOString(),
        action: "delete_key",
        credentialId: input.id,
        metadata: { kind: "credential", deleted },
      });
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

  // === generate_totp ===
  server.tool(
    "generate_totp",
    "Generate a 6-digit TOTP code from a stored credential's totp_secret",
    {
      credentialId: z.string().min(1).describe("Credential ID with totp_secret"),
    },
    async (input) => {
      try {
        let result = null;
        try { result = await vault.getCredentials(input.credentialId); } catch {}
        if (!result || !result.fields) {
          // Fallback: secret may live in secrets vault (secrets.json), e.g. TOTP secrets
          const sec = await secrets.getSecret(input.credentialId);
          if (!sec) return jsonError("Not found: " + input.credentialId);
          let s = sec.fields.value ?? sec.fields.extra?.totp_secret;
          if (typeof s === "string" && s.trim().startsWith("{")) {
            try { s = JSON.parse(s).value ?? s; } catch {}
          }
          if (!s) return jsonError("No totp_secret in " + input.credentialId);
          const m = await import("../credentials/totp.js");
          const code = m.generateTOTP(s);
          const now = Math.floor(Date.now() / 1000);
          return jsonOk({success:true, code, service:sec.entry.service, label:sec.entry.label, windowRemaining:30 - (now % 30), rotateSoon:m.needsRotation()});
        }
        const s = result.fields.extra?.totp_secret;
        if (!s) return jsonError("No totp_secret in " + input.credentialId);
        const m = await import("../credentials/totp.js");
        const code = m.generateTOTP(s);
        const now = Math.floor(Date.now() / 1000);
        return jsonOk({success:true, code, service:result.entry.service, label:result.entry.label, username:result.fields.username, windowRemaining:30 - (now % 30), rotateSoon:m.needsRotation()});
      } catch(err) { return jsonError(err instanceof Error ? err.message : String(err)); }
    }
  );

  // === generate_totp_by_service ===
  server.tool(
    "generate_totp_by_service",
    "Generate TOTP for a service's first credential with totp_secret",
    {
      service: z.string().min(1).describe("Service identifier (e.g. github)"),
    },
    async (input) => {
      try {
        const results = await vault.getCredentialsForService(input.service);
        if (!results || !results.length) return jsonError("No creds for " + input.service);
        const wt = results.find(r => r.fields.extra?.totp_secret);
        if (!wt) return jsonError("No totp_secret for service " + input.service);
        const m = await import("../credentials/totp.js");
        const code = m.generateTOTP(wt.fields.extra!.totp_secret);
        const now = Math.floor(Date.now() / 1000);
        return jsonOk({success:true, code, credentialId:wt.entry.id, service:input.service, username:wt.fields.username, windowRemaining:30 - (now % 30), rotateSoon:m.needsRotation()});
      } catch(err) { return jsonError(err instanceof Error ? err.message : String(err)); }
    }
  );

}
