#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import { getConfig } from "../config.js";
import * as vault from "../credentials/vault.js";
import * as secrets from "../secrets/manager.js";
import * as browser from "../browser/manager.js";
import { getServiceTemplate } from "../services/definitions.js";
import { generateTOTP, isValidTOTPSecret } from "../credentials/totp.js";
import { generateTOTPSecret, buildOTPAuthURL } from "../credentials/qr.js";
import qrcode from "qrcode";
import { htmlDashboard } from "./dashboard.js";

const PORT = parseInt(process.env.WEB_UI_PORT || "5600", 10);
const TAILSCALE_RANGE = "100.";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — auto-close stale browser sessions
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

function findTailscaleIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && addr.address.startsWith(TAILSCALE_RANGE)) {
        return addr.address;
      }
    }
  }
  return null;
}

function isTailscaleIP(ip: string): boolean {
  return ip.startsWith(TAILSCALE_RANGE);
}

function stripPort(addr: string): string {
  return addr.replace(/::ffff:/, "").replace(/:.*$/, "");
}

// ── Login session state ──────────────────────────────────────────────────────
const loginSessions = new Map<string, { credentialId: string; sessionId: string; step: string }>();

function checkTailscale(req: http.IncomingMessage, bindAddress: string): boolean {
  const remoteIP = stripPort(req.socket.remoteAddress || "");
  if (bindAddress === "127.0.0.1") return true;
  if (isTailscaleIP(remoteIP) || remoteIP === "127.0.0.1" || remoteIP === "::1" || remoteIP === "::ffff:127.0.0.1") {
    return true;
  }
  return false;
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function jsonError(res: http.ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status);
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = u.pathname;
  const method = req.method || "GET";

  // CORS for Tailscale
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlDashboard());
      return;
    }

    if (method === "GET" && path === "/health") {
      json(res, { status: "ok", service: "mcp-auth-vault-web" });
      return;
    }

    if (method === "GET" && path === "/api/credentials") {
      const entries = await vault.listCredentials();
      json(res, { count: entries.length, entries: entries.map(e => ({
        id: e.id, service: e.service, label: e.label,
        createdAt: e.createdAt, tags: e.tags,
      }))});
      return;
    }

    // ── API: Get credential detail ────────────────────────────────────────
    const credDetailMatch = path.match(/^\/api\/credentials\/([a-f0-9]+)$/);
    if (method === "GET" && credDetailMatch) {
      const result = await vault.getCredentials(credDetailMatch[1]);
      if (!result) { jsonError(res, "Not found", 404); return; }
      json(res, {
        id: result.entry.id, service: result.entry.service,
        label: result.entry.label, tags: result.entry.tags,
        credentials: { username: result.fields.username, extra: result.fields.extra },
      });
      return;
    }

    // ── API: Create credential ────────────────────────────────────────────
    if (method === "POST" && path === "/api/credentials") {
      const body = await parseBody(req);
      if (!body.service || !body.label || !body.username || !body.password) {
        jsonError(res, "Missing required fields: service, label, username, password");
        return;
      }
      const extra: Record<string, string> = {};
      if (body.extra?.totp_secret) extra.totp_secret = body.extra.totp_secret;
      const entry = await vault.storeCredentials(
        body.service, body.label,
        { username: body.username, password: body.password, extra: Object.keys(extra).length ? extra : undefined },
        body.tags
      );
      json(res, { success: true, id: entry.id }, 201);
      return;
    }

    // ── API: Delete credential ────────────────────────────────────────────
    const credDelMatch = path.match(/^\/api\/credentials\/([a-f0-9]+)$/);
    if (method === "DELETE" && credDelMatch) {
      const ok = await vault.deleteCredentials(credDelMatch[1]);
      if (!ok) { jsonError(res, "Not found", 404); return; }
      json(res, { success: true });
      return;
    }

    // ── API: List secrets ─────────────────────────────────────────────────
    if (method === "GET" && path === "/api/secrets") {
      const entries = await secrets.listSecrets();
      json(res, { count: entries.length, entries: entries.map(e => ({
        id: e.id, label: e.label, kind: e.kind, service: e.service,
        createdAt: e.createdAt, tags: e.tags,
      }))});
      return;
    }

    // ── API: Create secret ────────────────────────────────────────────────
    if (method === "POST" && path === "/api/secrets") {
      const body = await parseBody(req);
      if (!body.label || !body.kind || !body.service || !body.value) {
        jsonError(res, "Missing required fields: label, kind, service, value");
        return;
      }
      const entry = await secrets.storeSecret(
        body.label, body.kind, body.service,
        { value: body.value, description: body.description },
        body.tags
      );
      json(res, { success: true, id: entry.id }, 201);
      return;
    }

    // ── API: Delete secret ────────────────────────────────────────────────
    const secDelMatch = path.match(/^\/api\/secrets\/([a-f0-9]+)$/);
    if (method === "DELETE" && secDelMatch) {
      const ok = await secrets.deleteSecret(secDelMatch[1]);
      if (!ok) { jsonError(res, "Not found", 404); return; }
      json(res, { success: true });
      return;
    }

    // ── API: Login (start) ────────────────────────────────────────────────
    const loginMatch = path.match(/^\/api\/login\/([a-f0-9]+)$/);
    if (method === "POST" && loginMatch) {
      const credentialId = loginMatch[1];
      const credResult = await vault.getCredentials(credentialId);
      if (!credResult) { jsonError(res, "Credential not found", 404); return; }

      const template = getServiceTemplate(credResult.entry.service);
      if (!template) { jsonError(res, "No login template for this service"); return; }

      try {
        const session = await browser.launchBrowser(credResult.entry.service, true);
        const page = browser.getPage(session.id)!;

        // Navigate and fill
        await page.goto("https://accounts.google.com/", { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);
        await page.fill('input[type="email"]', credResult.fields.username);
        await page.click("#identifierNext");
        await page.waitForTimeout(2000);
        await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 15000 });
        await page.fill('input[type="password"]', credResult.fields.password);
        await page.click("#passwordNext");
        await page.waitForTimeout(5000);

        const url = page.url();
        const totpSecret = credResult.fields.extra?.totp_secret;

        // Check for 2FA
        if (url.includes("/signin/challenge/")) {
          // Try to auto-solve with stored TOTP secret
          if (totpSecret) {
            const ta = page.locator('button:has-text("Try another way")').first();
            if (await ta.isVisible().catch(() => false)) {
              await ta.click();
              await page.waitForTimeout(3000);
            }
            const clicked = await page.evaluate(() => {
              for (const el of document.querySelectorAll('[role="link"]')) {
                const t = el.textContent?.trim() || "";
                if (t.includes("Google Authenticator") && t.includes("verification")) {
                  (el as HTMLElement).click(); return true;
                }
              }
              return false;
            });
            if (clicked) {
              await page.waitForTimeout(3000);
              const code = generateTOTP(totpSecret);
              const pinVisible = await page.locator("#totpPin").isVisible().catch(() => false);
              if (pinVisible) {
                await page.fill("#totpPin", code);
                await page.waitForTimeout(300);
                const nb = page.locator('button:has-text("Next")').first();
                if (await nb.isVisible().catch(() => false)) await nb.click();
                else await page.press("#totpPin", "Enter");
                await page.waitForLoadState("networkidle");
                await page.waitForTimeout(3000);
                const fu = page.url();
                const loggedIn = fu.includes("myaccount.google.com");
                loginSessions.set(session.id, { credentialId, sessionId: session.id, step: loggedIn ? "done" : "2fa_failed" });
                json(res, {
                  loggedIn, sessionId: session.id,
                  currentUrl: fu,
                  message: loggedIn ? "Login successful" : "2FA code submitted but not accepted",
                });
                return;
              }
            }
          }
          // Manual 2FA needed
          loginSessions.set(session.id, { credentialId, sessionId: session.id, step: "awaiting_2fa" });
          json(res, { needs2FA: true, sessionId: session.id, message: "2FA code required" });
          return;
        }

        const loggedIn = url.includes("myaccount.google.com");
        loginSessions.set(session.id, { credentialId, sessionId: session.id, step: loggedIn ? "done" : "unknown" });
        browser.closeBrowser(session.id).catch(() => {});
        json(res, { loggedIn, sessionId: session.id, currentUrl: url });

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Login failed: " + msg, 500);
      }
      return;
    }

    // ── API: Close browser session ─────────────────────────────────────────
    const closeMatch = path.match(/^\/api\/login\/([a-f0-9]+)\/close$/);
    if (method === "POST" && closeMatch) {
      const sid = closeMatch[1];
      const ok = await browser.closeBrowser(sid);
      if (ok) {
        loginSessions.delete(sid);
        json(res, { success: true, message: "Browser session closed" });
      } else {
        json(res, { success: false, message: "Session not found" }, 404);
      }
      return;
    }

    // ── API: Login 2FA submit ────────────────────────────────────────────
    if (method === "POST" && path === "/api/login/2fa") {
      const body = await parseBody(req);
      const { sessionId, code } = body;
      if (!sessionId || !code) { jsonError(res, "Missing sessionId or code"); return; }

      const session = loginSessions.get(sessionId);
      if (!session) { jsonError(res, "Login session not found or expired", 404); return; }

      try {
        const page = browser.getPage(sessionId);
        if (!page) { jsonError(res, "Browser session expired"); return; }

        const pinVisible = await page.locator("#totpPin").isVisible().catch(() => false);
        if (!pinVisible) { browser.closeBrowser(sessionId).catch(() => {}); jsonError(res, "2FA input not available on current page"); return; }

        await page.fill("#totpPin", code);
        await page.waitForTimeout(300);
        const nb = page.locator('button:has-text("Next")').first();
        if (await nb.isVisible().catch(() => false)) await nb.click();
        else await page.press("#totpPin", "Enter");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(3000);

        const fu = page.url();
        const loggedIn = fu.includes("myaccount.google.com");
        session.step = loggedIn ? "done" : "2fa_failed";

        // Close browser after 2FA attempt — session metadata persists
        browser.closeBrowser(sessionId).catch(() => {});

        json(res, { loggedIn, sessionId, currentUrl: fu });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        browser.closeBrowser(sessionId).catch(() => {});
        jsonError(res, "2FA failed: " + msg, 500);
      }
      return;
    }

    // ── API: Login status ─────────────────────────────────────────────────
    if (method === "GET" && path.startsWith("/api/login/status/")) {
      const sid = path.split("/").pop() || "";
      const page = browser.getPage(sid);
      if (!page) { json(res, { active: false }); return; }
      try {
        json(res, { active: true, url: page.url() });
      } catch {
        json(res, { active: false });
      }
      return;
    }

    // ── API: TOTP Generate ─────────────────────────────────────────────────
    if (method === "GET" && path === "/api/totp/generate") {
      try {
        const account = u.searchParams.get("account") || "user@example.com";
        const issuer = u.searchParams.get("issuer") || "AuthVault";
        const secret = generateTOTPSecret();
        const otpauthUrl = buildOTPAuthURL(secret, account, issuer);
        const qrDataUri = await qrcode.toDataURL(otpauthUrl, { width: 300, margin: 2 });
        json(res, { secret, account, issuer, otpauthUrl, qrDataUri });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "TOTP generate failed: " + msg, 500);
      }
      return;
    }

    // ── API: TOTP Verify ───────────────────────────────────────────────────
    if (method === "POST" && path === "/api/totp/verify") {
      try {
        const body = await parseBody(req);
        const { secret, code } = body;
        if (!secret || !code) { jsonError(res, "Missing secret or code"); return; }
        if (!isValidTOTPSecret(secret)) { jsonError(res, "Invalid TOTP secret format"); return; }

        const currentCode = generateTOTP(secret);
        const valid = code === currentCode;

        json(res, { valid, generatedCode: currentCode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "TOTP verify failed: " + msg, 500);
      }
      return;
    }

    // ── API: TOTP Attach ───────────────────────────────────────────────────
    if (method === "POST" && path === "/api/totp/attach") {
      try {
        const body = await parseBody(req);
        const { credentialId, totpSecret } = body;
        if (!credentialId || !totpSecret) { jsonError(res, "Missing credentialId or totpSecret"); return; }
        if (!isValidTOTPSecret(totpSecret)) { jsonError(res, "Invalid TOTP secret format"); return; }

        const credResult = await vault.getCredentials(credentialId);
        if (!credResult) { jsonError(res, "Credential not found", 404); return; }

        credResult.fields.extra = credResult.fields.extra || {};
        credResult.fields.extra.totp_secret = totpSecret;

        await vault.updateCredentials(credentialId, credResult.fields);
        json(res, { success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "TOTP attach failed: " + msg, 500);
      }
      return;
    }

    // ── API: Get credential TOTP detail ────────────────────────────────────
    const credTotpMatch = path.match(/^\/api\/credentials\/([a-f0-9]+)\/totp$/);
    if (method === "GET" && credTotpMatch) {
      try {
        const result = await vault.getCredentials(credTotpMatch[1]);
        if (!result) { jsonError(res, "Not found", 404); return; }
        const hasTotp = !!(result.fields.extra?.totp_secret);
        json(res, {
          id: result.entry.id,
          label: result.entry.label,
          service: result.entry.service,
          hasTotp,
          totpSecret: hasTotp ? result.fields.extra!.totp_secret : null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Failed: " + msg, 500);
      }
      return;
    }

    jsonError(res, "Not found", 404);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[WEB] Error:", msg);
    jsonError(res, "Internal error: " + msg, 500);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  getConfig();
  const tailscaleIP = findTailscaleIPv4();
  const bindAddress = tailscaleIP || "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    if (!checkTailscale(req, bindAddress)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied: Tailscale network only" }));
      return;
    }
    await handleRequest(req, res);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[WEB] 🌐 Auth Vault UI — port ${PORT}`);
    console.log(`[WEB]    Tailscale: http://${bindAddress}:${PORT}`);
    console.log(`[WEB]    Local:     http://127.0.0.1:${PORT}`);
    console.log(`[WEB]    Access:    Tailscale network + localhost only`);
  });

  // ── Periodic cleanup of stale browser sessions ──────────────────────────
  const cleanupTimer = setInterval(async () => {
    const allSessions = browser.listSessions();
    const now = Date.now();
    let cleaned = 0;
    for (const s of allSessions) {
      const age = now - new Date(s.createdAt).getTime();
      if (age > SESSION_TTL_MS) {
        await browser.closeBrowser(s.id).catch(() => {});
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`[WEB] Cleaned ${cleaned} stale browser session(s)`);
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  // ── Graceful shutdown ──────────────────────────────────────────────────
  async function handleShutdown(signal: string) {
    console.log(`[WEB] ${signal} received — cleaning up browser sessions...`);
    clearInterval(cleanupTimer);
    await browser.closeAllSessions();
    server.close(() => {
      console.log(`[WEB] Shutdown complete`);
      process.exit(0);
    });
    // Force exit after 5s if cleanup hangs
    setTimeout(() => process.exit(1), 5000);
  }
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[WEB] Fatal:", err);
  process.exit(1);
});
