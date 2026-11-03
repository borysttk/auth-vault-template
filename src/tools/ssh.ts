import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as vault from "../ssh/vault.js";
import { generateSSHKeyPair, extractPublicKey } from "../ssh/generator.js";
import { SSHKeyFields, SSHConfigFragment } from "../ssh/types.js";
import { logAction } from "../audit/log.js";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonError(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function registerSSHTools(server: McpServer): void {
  // === store_ssh_key ===
  server.tool(
    "store_ssh_key",
    "Store an SSH private key with connection metadata (AES-256-GCM encrypted)",
    {
      label: z.string().min(1).max(128).describe("Human-readable label"),
      keyType: z.string().describe("SSH key algorithm (e.g. ed25519, rsa-4096)"),
      host: z.string().min(1).describe("Host alias or hostname"),
      port: z.number().int().positive().default(22).describe("SSH port"),
      username: z.string().min(1).describe("Remote username"),
      privateKey: z.string().min(1).describe("Private key material (PEM/OpenSSH format)"),
      publicKey: z.string().optional().describe("Public key in OpenSSH format"),
      passphrase: z.string().optional().describe("Passphrase protecting the private key"),
      comment: z.string().optional().describe("Key comment (e.g. user@host)"),
      hostname: z.string().optional().describe("Full hostname/IP if host is an alias"),
      tags: z.array(z.string()).optional().describe("Organization tags"),
    },
    async (input) => {
      try {
        const fields: SSHKeyFields = {
          privateKey: input.privateKey,
          passphrase: input.passphrase,
          publicKey: input.publicKey,
          comment: input.comment,
        };

        const entry = await vault.storeSSHKey(
          input.label,
          input.keyType,
          input.host,
          input.port,
          input.username,
          fields,
          input.tags,
          input.hostname
        );

        return jsonOk({
          success: true,
          id: entry.id,
          label: entry.label,
          keyType: entry.keyType,
          host: entry.host,
          port: entry.port,
          username: entry.username,
          fingerprint: entry.fingerprint,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === get_ssh_key ===
  server.tool(
    "get_ssh_key",
    "Retrieve stored SSH key details by ID",
    {
      id: z.string().min(1).describe("SSH key ID"),
      includePrivateKey: z.boolean().default(false).describe("Include the private key in the response"),
    },
    async (input) => {
      try {
        const result = await vault.getSSHKey(input.id);
        if (!result) return jsonError("SSH key not found");

        const { entry, fields } = result;
        return jsonOk({
          id: entry.id,
          label: entry.label,
          keyType: entry.keyType,
          fingerprint: entry.fingerprint,
          bits: entry.bits,
          host: entry.host,
          port: entry.port,
          username: entry.username,
          hostname: entry.hostname,
          publicKey: entry.publicKey,
          privateKey: input.includePrivateKey ? fields.privateKey : "***",
          hasPassphrase: !!fields.passphrase,
          comment: fields.comment,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          tags: entry.tags,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === list_ssh_keys ===
  server.tool(
    "list_ssh_keys",
    "List stored SSH keys, optionally filtered by host or key type",
    {
      host: z.string().optional().describe("Filter by host"),
      keyType: z.string().optional().describe("Filter by key algorithm"),
    },
    async (input) => {
      try {
        const entries = await vault.listSSHKeys(input.host, input.keyType);
        return jsonOk({
          count: entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            label: e.label,
            keyType: e.keyType,
            fingerprint: e.fingerprint,
            host: e.host,
            port: e.port,
            username: e.username,
            hostname: e.hostname,
            publicKey: e.publicKey,
            createdAt: e.createdAt,
            tags: e.tags,
          })),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === delete_ssh_key ===
  server.tool(
    "delete_ssh_key",
    "Permanently delete a stored SSH key by ID",
    {
      id: z.string().min(1).describe("SSH key ID to delete"),
    },
    async (input) => {
      try {
        const ok = await vault.deleteSSHKey(input.id);
        if (!ok) return jsonError("SSH key not found");
        await logAction({
          timestamp: new Date().toISOString(),
          action: "delete_key",
          metadata: { kind: "ssh_key", id: input.id },
        });
        return jsonOk({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === generate_ssh_key ===
  server.tool(
    "generate_ssh_key",
    "Generate a new SSH key pair and store it in the vault",
    {
      label: z.string().min(1).max(128).describe("Human-readable label"),
      keyType: z.enum(["ed25519", "rsa"]).default("ed25519").describe("Key algorithm"),
      host: z.string().min(1).describe("Host alias or hostname"),
      port: z.number().int().positive().default(22).describe("SSH port"),
      username: z.string().min(1).describe("Remote username"),
      service: z.string().optional().describe("Associated service id (auto-creates ssh_key_id reference in credential)"),
      format: z.enum(["pkcs8", "pem"]).default("pkcs8").describe("Private key output format"),
      rsaBits: z.union([z.literal(2048), z.literal(4096)]).optional().describe("RSA key size (ignored for ed25519)"),
      passphrase: z.string().optional().describe("Passphrase to protect the private key"),
      comment: z.string().optional().describe("Key comment (e.g. user@host)"),
      hostname: z.string().optional().describe("Full hostname/IP if host is an alias"),
      tags: z.array(z.string()).optional().describe("Organization tags"),
    },
    async (input) => {
      try {
        const comment = input.comment || `${input.username}@${input.host}`;

        // Generate key pair
        const generated = await generateSSHKeyPair(input.keyType, {
          rsaBits: input.rsaBits,
          passphrase: input.passphrase,
          comment,
        });

        // Store in vault
        const fields: SSHKeyFields = {
          privateKey: generated.privateKey,
          passphrase: input.passphrase,
          publicKey: generated.publicKey,
          comment,
        };

        const entry = await vault.storeSSHKey(
          input.label,
          input.keyType === "rsa" ? `rsa-${input.rsaBits || 4096}` : "ed25519",
          input.host,
          input.port,
          input.username,
          fields,
          input.tags,
          input.hostname
        );

        // If service specified, link ssh_key_id to credentials for that service
        if (input.service) {
          const { listCredentials, getCredentials, updateCredentials } = await import("../credentials/vault.js");
          const creds = await listCredentials(input.service);
          for (const cred of creds) {
            const existing = await getCredentials(cred.id);
            if (existing) {
              const extra = existing.fields.extra || {};
              extra.ssh_key_id = entry.id;
              await updateCredentials(cred.id, {
                username: existing.fields.username,
                password: existing.fields.password,
                extra,
                trusted_devices: existing.fields.trusted_devices,
              });
            }
          }
        }

        return jsonOk({
          success: true,
          id: entry.id,
          label: entry.label,
          keyType: entry.keyType,
          fingerprint: entry.fingerprint,
          host: entry.host,
          port: entry.port,
          username: entry.username,
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          format: input.format,
          comment,
          serviceId: input.service || null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === export_ssh_config ===
  server.tool(
    "export_ssh_config",
    "Generate ~/.ssh/config fragment for a stored SSH key",
    {
      id: z.string().min(1).describe("SSH key ID"),
      identityFilePath: z.string().optional().describe("Path to the private key file for IdentityFile"),
    },
    async (input) => {
      try {
        const result = await vault.getSSHKey(input.id);
        if (!result) return jsonError("SSH key not found");

        const { entry, fields } = result;
        const identityPath = input.identityFilePath || `~/.ssh/${entry.label.replace(/\s+/g, "_")}`;

        const fragment: SSHConfigFragment = {
          host: entry.host,
          hostName: entry.hostname,
          user: entry.username,
          port: entry.port,
          identityFile: identityPath,
        };

        // Build config text
        const lines: string[] = [
          `Host ${fragment.host}`,
          `    HostName ${fragment.hostName || fragment.host}`,
          `    User ${fragment.user}`,
          `    Port ${fragment.port}`,
          `    IdentityFile ${fragment.identityFile}`,
        ];

        // Add comment about passphrase
        if (fields.passphrase) {
          lines.push(`    # Note: key is passphrase-protected`);
        }

        if (fields.comment) {
          lines.push(`    # Key: ${fields.comment}`);
        }

        const config = lines.join("\n");

        return jsonOk({
          config,
          host: fragment.host,
          hostName: fragment.hostName || fragment.host,
          user: fragment.user,
          port: fragment.port,
          identityFile: fragment.identityFile,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === export_ssh_key_file ===
  server.tool(
    "export_ssh_key_file",
    "Export a stored SSH key to a file on disk",
    {
      id: z.string().min(1).describe("SSH key ID"),
      filePath: z.string().min(1).describe("Absolute or relative path to write the private key"),
      mode: z.enum(["0600", "0400"]).default("0600").describe("File permissions"),
    },
    async (input) => {
      try {
        const result = await vault.getSSHKey(input.id);
        if (!result) return jsonError("SSH key not found");

        const { entry, fields } = result;
        const fs = await import("node:fs/promises");

        await fs.writeFile(input.filePath, fields.privateKey, "utf8");
        await fs.chmod(input.filePath, parseInt(input.mode, 8));

        // Also write public key if available
        let publicKeyPath: string | undefined;
        if (fields.publicKey) {
          publicKeyPath = `${input.filePath}.pub`;
          await fs.writeFile(publicKeyPath, fields.publicKey + "\n", "utf8");
          await fs.chmod(publicKeyPath, 0o644);
        }

        return jsonOk({
          success: true,
          privateKeyPath: input.filePath,
          publicKeyPath,
          mode: input.mode,
          fingerprint: entry.fingerprint,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === get_ssh_fingerprint ===
  server.tool(
    "get_ssh_fingerprint",
    "Get the fingerprint of a stored SSH key",
    {
      id: z.string().min(1).describe("SSH key ID"),
    },
    async (input) => {
      try {
        const result = await vault.getSSHKey(input.id);
        if (!result) return jsonError("SSH key not found");

        return jsonOk({
          id: result.entry.id,
          label: result.entry.label,
          keyType: result.entry.keyType,
          fingerprint: result.entry.fingerprint,
          bits: result.entry.bits,
          publicKey: result.entry.publicKey,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === extract_ssh_public_key ===
  server.tool(
    "extract_ssh_public_key",
    "Extract public key and fingerprint from an SSH private key string",
    {
      privateKey: z.string().min(1).describe("Private key in PEM/OpenSSH format"),
      passphrase: z.string().optional().describe("Passphrase if the key is encrypted"),
    },
    async (input) => {
      try {
        const result = extractPublicKey(input.privateKey, input.passphrase);
        if (!result) return jsonError("Could not extract public key — invalid or unsupported key format");
        return jsonOk({
          publicKey: result.publicKey,
          fingerprint: result.fingerprint,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === update_ssh_key ===
  server.tool(
    "update_ssh_key",
    "Update metadata or key material of a stored SSH key",
    {
      id: z.string().min(1).describe("SSH key ID to update"),
      label: z.string().max(128).optional().describe("New label"),
      host: z.string().optional().describe("New host alias"),
      port: z.number().int().positive().optional().describe("New SSH port"),
      username: z.string().optional().describe("New remote username"),
      hostname: z.string().optional().describe("New full hostname/IP"),
      tags: z.array(z.string()).optional().describe("Replacement tags"),
    },
    async (input) => {
      try {
        const ok = await vault.updateSSHKey(input.id, {
          label: input.label,
          host: input.host,
          port: input.port,
          username: input.username,
          hostname: input.hostname,
          tags: input.tags,
        });
        if (!ok) return jsonError("SSH key not found");
        return jsonOk({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );
}
