import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as vault from "../credentials/vault.js";
import * as browserMgr from "../browser/manager.js";
import { getServiceTemplate } from "../services/definitions.js";
import * as secrets from "../secrets/manager.js";
import { SecretKind } from "../secrets/types.js";
import { getConfig } from "../config.js";
import crypto from "node:crypto";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonError(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function registerDiagnosticsTools(server: McpServer): void {
  // === vault_health ===
  server.tool(
    "vault_health",
    "Comprehensive health check of the auth-vault system — encryption, storage, services, sessions",
    {},
    async () => {
      try {
        const checks: Record<string, unknown> = {};
        const timestamp = new Date().toISOString();

        // Storage
        try {
          const credEntries = await vault.listCredentials();
          const secretEntries = await secrets.listSecrets();
          checks.storage = {
            status: "ok",
            credentialsCount: credEntries.length,
            secretsCount: secretEntries.length,
          };
        } catch {
          checks.storage = { status: "error", message: "Failed to read vault storage" };
        }

        // Encryption
        try {
          const config = getConfig();
          const keyPresent = !!config.VAULT_ENCRYPTION_KEY;
          checks.encryption = {
            status: keyPresent ? "ok" : "disabled",
            algorithm: keyPresent ? "AES-256-GCM" : "none",
            keyPresent,
          };
        } catch {
          checks.encryption = { status: "error", message: "Encryption check failed" };
        }

        // Services
        try {
          const serviceIds = ["google", "arena.ai", "github"];
          const templates = serviceIds.map((s) => getServiceTemplate(s)).filter((t): t is NonNullable<typeof t> => !!t);
          checks.services = {
            status: "ok",
            count: templates.length,
            templates: templates.map((t) => t.id),
          };
        } catch {
          checks.services = { status: "error", message: "Service registry check failed" };
        }

        // Browser sessions
        try {
          const sessions = browserMgr.listSessions();
          checks.browser = {
            status: "ok",
            activeSessions: sessions.length,
            sessions: sessions.map((s) => ({
              id: s.id,
              service: s.service,
              isActive: s.isActive,
              createdAt: s.createdAt,
            })),
          };
        } catch {
          checks.browser = { status: "error", message: "Browser session check failed" };
        }

        // TOTP
        try {
          const credEntries = await vault.listCredentials();
          let totpCount = 0;
          for (const entry of credEntries) {
            try {
              const result = await vault.getCredentials(entry.id);
              if (result?.fields.extra?.totp_secret) totpCount++;
            } catch {
              // skip unreadable entries
            }
          }
          checks.totp = {
            status: "ok",
            credentialsWithTOTP: totpCount,
            totalCredentials: credEntries.length,
          };
        } catch {
          checks.totp = { status: "error", message: "TOTP check failed" };
        }

        const overallStatus = Object.values(checks).every((c) => (c as Record<string, unknown>).status !== "error")
          ? "healthy"
          : "degraded";

        return jsonOk({ overall: overallStatus, timestamp, checks });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === test_credential ===
  server.tool(
    "test_credential",
    "Test if credentials exist in vault and validate their structure (returns non-sensitive info only)",
    {
      id: z.string().optional().describe("Credential ID to test (omit for all credentials)"),
      service: z.string().optional().describe("Filter by service name"),
    },
    async (input) => {
      try {
        if (input.id) {
          const result = await vault.getCredentials(input.id);
          if (!result) return jsonOk({ found: false, id: input.id, message: "Credential not found" });
          const { entry, fields } = result;
          return jsonOk({
            found: true,
            id: entry.id,
            label: entry.label,
            service: entry.service,
            hasUsername: !!fields.username,
            hasPassword: !!fields.password,
            hasTOTP: !!fields.extra?.totp_secret,
            extraKeys: fields.extra ? Object.keys(fields.extra) : [],
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          });
        }

        const allEntries = await vault.listCredentials(input.service);
        const results: Array<Record<string, unknown>> = [];
        for (const entry of allEntries) {
          try {
            const result = await vault.getCredentials(entry.id);
            if (!result) continue;
            const { fields } = result;
            results.push({
              id: entry.id,
              label: entry.label,
              service: entry.service,
              hasUsername: !!fields.username,
              hasPassword: !!fields.password,
              hasTOTP: !!fields.extra?.totp_secret,
              extraKeys: fields.extra ? Object.keys(fields.extra) : [],
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
            });
          } catch {
            // skip unreadable entries
          }
        }

        return jsonOk({ count: results.length, credentials: results });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === test_session_integrity ===
  server.tool(
    "test_session_integrity",
    "Check if browser sessions are alive and can interact with pages",
    {
      sessionId: z.string().optional().describe("Specific session ID to test (omit for all)"),
    },
    async (input) => {
      try {
        const sessions = browserMgr.listSessions();
        const toTest = input.sessionId ? sessions.filter((s) => s.id === input.sessionId) : sessions;
        const results: Array<Record<string, unknown>> = [];

        for (const session of toTest) {
          try {
            const page = browserMgr.getPage(session.id);
            if (!page) {
              results.push({ sessionId: session.id, alive: false, reason: "Session not found or expired" });
              continue;
            }
            const url = page.url();
            const template = getServiceTemplate(session.service);
            const isLoggedIn = template ? await browserMgr.verifyLogin(session.id, template) : false;

            results.push({
              sessionId: session.id,
              alive: session.isActive,
              loggedIn: isLoggedIn,
              currentUrl: url,
              service: session.service,
              createdAt: session.createdAt,
            });
          } catch {
            results.push({ sessionId: session.id, alive: false, error: "Failed to communicate with session" });
          }
        }

        return jsonOk({ totalSessions: sessions.length, tested: results.length, results });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === test_totp ===
  server.tool(
    "test_totp",
    "Verify TOTP secret by generating a current code and optionally checking against expected value",
    {
      credentialId: z.string().min(1).describe("Credential ID with totp_secret in extra fields"),
      expectedCode: z.string().optional().describe("Optional 6-digit code to verify against"),
    },
    async (input) => {
      try {
        const result = await vault.getCredentials(input.credentialId);
        if (!result) return jsonError(`Credential not found: ${input.credentialId}`);

        const totpSecret = result.fields.extra?.totp_secret;
        if (!totpSecret) return jsonError(`No TOTP secret stored for credential ${input.credentialId}`);

        const codeResult = generateTOTP(totpSecret);
        if (!codeResult.success || !codeResult.code) {
          return jsonError(`TOTP generation failed: ${codeResult.error}`);
        }

        const response: Record<string, unknown> = {
          success: true,
          credentialId: input.credentialId,
          code: `${codeResult.code.slice(0, 3)}...${codeResult.code.slice(-1)}`,
          fullCode: codeResult.code,
          timestamp: new Date().toISOString(),
        };

        if (input.expectedCode) {
          const match = codeResult.code === input.expectedCode;
          (response as Record<string, unknown>).valid = match;
          (response as Record<string, unknown>).match = match;
        }

        return jsonOk(response);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === test_service_selector ===
  server.tool(
    "test_service_selector",
    "Test if a CSS selector works on a service's login page (launches browser, checks selector matches)",
    {
      service: z.string().min(1).describe("Service identifier (e.g., 'google')"),
      selectorType: z.string().optional().describe("Selector type: username, password, submit (default: username)"),
      selectorOverride: z.string().optional().describe("Override the CSS selector to test"),
    },
    async (input) => {
      try {
        const template = getServiceTemplate(input.service);
        if (!template) return jsonError(`Service '${input.service}' not found. Use list_services.`);

        const session = await browserMgr.launchBrowser(input.service, true);
        await browserMgr.navigateTo(session.id, template.loginUrl);

        // Wait for page load
        await new Promise((r) => setTimeout(r, 2000));

        let selector: string;
        let label: string;
        if (input.selectorOverride) {
          selector = input.selectorOverride;
          label = "custom";
        } else {
          const sType = input.selectorType || "username";
          switch (sType) {
            case "username":
              selector = template.usernameSelector;
              label = "usernameSelector";
              break;
            case "password":
              selector = template.passwordSelector;
              label = "passwordSelector";
              break;
            case "submit":
              selector = template.submitSelector;
              label = "submitSelector";
              break;
            default:
              selector = template.usernameSelector;
              label = "usernameSelector";
          }
        }

        let count = -1;
        try {
          const page = browserMgr.getPage(session.id);
          if (page) {
            count = await page.locator(selector).count();
          } else {
            count = -1;
          }
        } catch {
          count = -1;
        }

        await browserMgr.closeBrowser(session.id);

        const found = count > 0;
        return jsonOk({
          service: input.service,
          selectorType: label,
          selector,
          loginUrl: template.loginUrl,
          found,
          matchCount: count,
          status: found ? "ok" : "selector_not_found",
          note: found
            ? `Found ${count} element(s) matching selector`
            : count === -1
              ? "Selector threw an error (possibly invalid syntax)"
              : "No elements matched — selector may be outdated",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === test_secret_expiry ===
  server.tool(
    "test_secret_expiry",
    "Check all secrets for expiration — identifies expired, expiring soon, or valid secrets",
    {
      warningDays: z.number().optional().default(7).describe("Days before expiry to flag as 'expiring soon'"),
      service: z.string().optional().describe("Filter by service"),
    },
    async (input) => {
      try {
        const allEntries = await secrets.listSecrets(input.service);
        const now = new Date();
        const results: Array<Record<string, unknown>> = [];

        for (const entry of allEntries) {
          // Secrets don't have direct expiresAt on entry - check via metadata
          // We must read the decrypted fields to get expiry info
          let expiryDate: Date | null = null;
          try {
            const secret = await secrets.getSecret(entry.id);
            if (secret?.fields?.expiresAt) {
              expiryDate = new Date(secret.fields.expiresAt);
            }
          } catch {
            // skip
          }

          let expiryStatus: string | null;
          let daysUntilExpiry: number | null = null;
          let warning = false;

          if (expiryDate) {
            daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry < 0) {
              expiryStatus = "expired";
            } else if (daysUntilExpiry <= input.warningDays) {
              expiryStatus = "expiring_soon";
              warning = true;
            } else {
              expiryStatus = "valid";
            }
          } else {
            expiryStatus = "no_expiry";
          }

          results.push({
            id: entry.id,
            label: entry.label,
            service: entry.service,
            kind: entry.kind,
            expiryStatus,
            daysUntilExpiry,
            warning,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          });
        }

        const expired = results.filter((r) => r.expiryStatus === "expired");
        const expiringSoon = results.filter((r) => (r as Record<string, unknown>).warning === true);
        const valid = results.filter((r) => r.expiryStatus === "valid" || r.expiryStatus === "no_expiry");

        return jsonOk({
          totalSecrets: results.length,
          summary: {
            expired: expired.length,
            expiringSoon: expiringSoon.length,
            valid: valid.length,
          },
          details: results,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === test_browser_cdp ===
  server.tool(
    "test_browser_cdp",
    "Test Chrome DevTools Protocol connectivity — verify CDP endpoint is reachable",
    {
      port: z.number().optional().default(9222).describe("CDP port to test"),
      host: z.string().optional().default("localhost").describe("CDP host"),
    },
    async (input) => {
      try {
        const url = `http://${input.host}:${input.port}/json/version`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (!resp.ok) {
          return jsonOk({
            reachable: false,
            status: resp.status,
            url,
            message: `HTTP ${resp.status} — Chrome not running or CDP not enabled`,
          });
        }

        const data = (await resp.json()) as Record<string, unknown>;
        return jsonOk({
          reachable: true,
          status: resp.status,
          url,
          browser: data["Browser"],
          protocolVersion: data["Protocol-Version"],
          webSocketDebuggerUrl: data["webSocketDebuggerUrl"],
          message: "CDP connection successful",
        });
      } catch {
        return jsonOk({
          reachable: false,
          url: `http://${input.host}:${input.port}/json/version`,
          message: "Connection refused — Chrome not running or CDP not enabled",
        });
      }
    }
  );

  // === test_all_services ===
  server.tool(
    "test_all_services",
    "Test all registered service templates — check if login pages are reachable",
    {},
    async () => {
      try {
        const services = ["google", "arena.ai", "github"];
        const results: Array<Record<string, unknown>> = [];

        for (const svc of services) {
          const template = getServiceTemplate(svc);
          if (!template) continue;

          try {
            const start = Date.now();
            const resp = await fetch(template.loginUrl, {
              method: "HEAD",
              redirect: "follow",
              signal: AbortSignal.timeout(10000),
            });
            const loadTime = Date.now() - start;

            results.push({
              service: svc,
              loginUrl: template.loginUrl,
              reachable: resp.ok || resp.status === 405,
              status: resp.status,
              loadTimeMs: loadTime,
              usernameSelector: template.usernameSelector,
              passwordSelector: template.passwordSelector,
              submitSelector: template.submitSelector,
              hasSuccessUrlPattern: !!template.successUrlPattern,
              hasSuccessSelector: !!template.successSelector,
            });
          } catch {
            results.push({
              service: svc,
              loginUrl: template.loginUrl,
              reachable: false,
              error: "Connection failed",
            });
          }
        }

        return jsonOk({ totalServices: services.length, tested: results.length, results });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );
}

// Helper: TOTP generator using Node native crypto (HMAC-SHA1, RFC 6238)
function generateTOTP(secret: string): { success: boolean; code?: string; error?: string } {
  try {
    const clean = secret.replace(/\s/g, "").toUpperCase();

    // Decode base32 using Node crypto
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let val = 0;
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i++) {
      const idx = alphabet.indexOf(clean[i]);
      if (idx < 0) continue;
      val = (val << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((val >> bits) & 0xff);
      }
    }
    if (bytes.length < 10) {
      return { success: false, error: "Invalid TOTP secret length" };
    }
    const key = Buffer.from(bytes);

    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / 30);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));

    const hmac = crypto.createHmac("sha1", key);
    hmac.update(counterBuffer);
    const sigBuffer = hmac.digest();

    const offset = sigBuffer[sigBuffer.length - 1] & 0x0f;
    const binary =
      ((sigBuffer[offset] & 0x7f) << 24) |
      ((sigBuffer[offset + 1] & 0xff) << 16) |
      ((sigBuffer[offset + 2] & 0xff) << 8) |
      (sigBuffer[offset + 3] & 0xff);

    const code = String((binary % 1_000_000)).padStart(6, "0");
    return { success: true, code };
  } catch {
    return { success: false, error: "TOTP generation failed" };
  }
}
