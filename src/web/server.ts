#!/usr/bin/env node

import http from "node:http";
import { TrustedDevice } from "../credentials/types.js";
import { getConfig } from "../config.js";
import * as vault from "../credentials/vault.js";
import * as secrets from "../secrets/manager.js";
import * as browser from "../browser/manager.js";
import { getServiceTemplate } from "../services/definitions.js";
import { generateTOTP, isValidTOTPSecret, needsRotation, nextTOTPCode } from "../credentials/totp.js";
import { generateTOTPSecret, buildOTPAuthURL } from "../credentials/qr.js";
import qrcode from "qrcode";
import * as sshVault from "../ssh/vault.js";
import { generateSSHKeyPair, extractPublicKey } from "../ssh/generator.js";
import { generateDeviceFingerprint, buildTrustedDevice, isDeviceTrusted } from "../authVault/fingerprint.js";
import { htmlDashboard } from "./dashboard.js";
import { logAction, readAuditLog } from "../audit/log.js";
import { integrityCheck, healthSummary } from "../audit/health.js";
import { generatePassword, generatePassphrase, type GeneratedPassword } from "../password/generator.js";
const PORT = parseInt(process.env.WEB_UI_PORT || "5600", 10);
const TAILSCALE_RANGE = "100.";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — auto-close stale browser sessions
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

function isTailscaleIP(ip: string): boolean {
  return ip.startsWith(TAILSCALE_RANGE);
}

function stripPort(addr: string): string {
  return addr.replace(/::ffff:/, "").replace(/:.*$/, "");
}

// ── Login session state ──────────────────────────────────────────────────────
const loginSessions = new Map<string, { credentialId: string; sessionId: string; step: string }>();

function checkTailscale(req: http.IncomingMessage): boolean {
  const remoteIP = stripPort(req.socket.remoteAddress || "");
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

/**
 * Persist login retry count in credential's extra field.
 */
async function persistRetryCount(
  credentialId: string,
  credResult: { fields: import("../credentials/types.js").ServiceCredentialFields },
  count: number
): Promise<void> {
  try {
    const extra = credResult.fields.extra || {};
    extra.login_retry_count = String(count);
    await vault.updateCredentials(credentialId, {
      username: credResult.fields.username,
      password: credResult.fields.password,
      extra,
      trusted_devices: credResult.fields.trusted_devices,
    });
  } catch { /* non-blocking */ }
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

  // No CORS headers on purpose: this endpoint returns decrypted secrets, and a
  // browser request originates from 127.0.0.1, so the IP gate cannot stop it.
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
      const includePassword = u.searchParams.get("includePassword") === "true";
      const entries = await vault.listCredentials();

      if (!includePassword) {
        // Metadata only (no decryption needed).
        // status/notes są OBOK szyfrogramu, więc trafiają tutaj bez odkrywania
        // sekretów — dokładnie po to, by agent widział "wyłączone / nie działa"
        // zanim sięgnie po klucz.
        json(res, { count: entries.length, entries: entries.map(e => ({
          id: e.id, service: e.service, label: e.label,
          createdAt: e.createdAt, tags: e.tags,
          status: e.status, notes: e.notes, statusChangedAt: e.statusChangedAt,
        }))});
        return;
      }

      // Full detail with passwords — decrypt each entry
      const detailed: unknown[] = [];
      for (const entry of entries) {
        const result = await vault.getCredentials(entry.id);
        if (!result) continue;
        detailed.push({
          id: result.entry.id, service: result.entry.service,
          label: result.entry.label, createdAt: result.entry.createdAt,
          tags: result.entry.tags,
          status: result.entry.status,
          notes: result.entry.notes,
          statusChangedAt: result.entry.statusChangedAt,
          credentials: {
            username: result.fields.username,
            password: result.fields.password,
            extra: result.fields.extra,
          },
        });
      }
      json(res, { count: detailed.length, entries: detailed });
      return;
    }

    // ── API: Get credential detail ────────────────────────────────────────
    const credDetailMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)$/);
    if (method === "GET" && credDetailMatch) {
      const includePassword = u.searchParams.get("includePassword") === "true";
      const result = await vault.getCredentials(credDetailMatch[1]);
      if (!result) { jsonError(res, "Not found", 404); return; }
      json(res, {
        id: result.entry.id, service: result.entry.service,
        label: result.entry.label, tags: result.entry.tags,
        status: result.entry.status,
        notes: result.entry.notes,
        statusChangedAt: result.entry.statusChangedAt,
        createdAt: result.entry.createdAt,
        updatedAt: result.entry.updatedAt,
        credentials: {
          username: result.fields.username,
          password: includePassword ? result.fields.password : "***",
          extra: result.fields.extra,
        },
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
        {
          username: body.username,
          password: body.password,
          extra: Object.keys(extra).length ? extra : undefined,
          trusted_devices: body.trusted_devices,
        },
        body.tags
      );
      json(res, { success: true, id: entry.id }, 201);
      return;
    }

    // ── API: Delete credential ────────────────────────────────────────────
    const credDelMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)$/);
    if (method === "DELETE" && credDelMatch) {
      const existing = await vault.getCredentials(credDelMatch[1]);
      const ok = await vault.deleteCredentials(credDelMatch[1]);
      if (!ok) { jsonError(res, "Not found", 404); return; }
      await logAction({
        timestamp: new Date().toISOString(),
        action: "delete_key",
        credentialId: credDelMatch[1],
        service: existing?.entry.service,
        metadata: { source: "web", type: "credential", label: existing?.entry.label },
      });
      json(res, { success: true });
      return;
    }

    // ── API: List secrets ─────────────────────────────────────────────────
    if (method === "GET" && path === "/api/secrets") {
      const entries = await secrets.listSecrets();
      json(res, { count: entries.length, entries: entries.map(e => ({
        id: e.id, label: e.label, kind: e.kind, service: e.service,
        createdAt: e.createdAt, tags: e.tags,
        status: e.status, notes: e.notes, statusChangedAt: e.statusChangedAt,
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

    // ── API: Get secret detail (decrypted) ────────────────────────────────
    const secDetailMatch = path.match(/^\/api\/secrets\/([A-Za-z0-9_-]+)\/detail$/);
    if (method === "GET" && secDetailMatch) {
      const result = await secrets.getSecret(secDetailMatch[1]);
      if (!result) { jsonError(res, "Not found", 404); return; }
      json(res, {
        id: result.entry.id, label: result.entry.label,
        kind: result.entry.kind, service: result.entry.service,
        createdAt: result.entry.createdAt, tags: result.entry.tags,
        status: result.entry.status,
        notes: result.entry.notes,
        statusChangedAt: result.entry.statusChangedAt,
        value: result.fields.value,
        description: result.fields.description,
        expiresAt: result.fields.expiresAt,
      });
      return;
    }

    // ── API: Get secret metadata (no decryption) ──────────────────────────
    // BEZ tego handlera GET /api/secrets/:id nie mial zadnej odpowiedzi —
    // request wisial do timeoutu klienta. Byl tylko DELETE na tej sciezce.
    const secMetaMatch = path.match(/^\/api\/secrets\/([A-Za-z0-9_-]+)$/);
    if (method === "GET" && secMetaMatch) {
      const result = await secrets.getSecret(secMetaMatch[1]);
      if (!result) { jsonError(res, "Not found", 404); return; }
      json(res, {
        id: result.entry.id, label: result.entry.label,
        kind: result.entry.kind, service: result.entry.service,
        createdAt: result.entry.createdAt, updatedAt: result.entry.updatedAt,
        tags: result.entry.tags,
        status: result.entry.status,
        notes: result.entry.notes,
        statusChangedAt: result.entry.statusChangedAt,
      });
      return;
    }

        // ── API: Delete secret ────────────────────────────────────────────────
    const secDelMatch = path.match(/^\/api\/secrets\/([A-Za-z0-9_-]+)$/);
    if (method === "DELETE" && secDelMatch) {
      const existing = await secrets.getSecret(secDelMatch[1]);
      const ok = await secrets.deleteSecret(secDelMatch[1]);
      if (!ok) { jsonError(res, "Not found", 404); return; }
      await logAction({
        timestamp: new Date().toISOString(),
        action: "delete_key",
        credentialId: secDelMatch[1],
        service: existing?.entry.service,
        metadata: { source: "web", type: "secret", label: existing?.entry.label, kind: existing?.entry.kind },
      });
      json(res, { success: true });
      return;
    }

    // ── API: Login (start) ────────────────────────────────────────────────
    const loginMatch = path.match(/^\/api\/login\/([A-Za-z0-9_-]+)$/);
    if (method === "POST" && loginMatch) {
      const credentialId = loginMatch[1];
      const credResult = await vault.getCredentials(credentialId);
      if (!credResult) { jsonError(res, "Credential not found", 404); return; }

      const template = getServiceTemplate(credResult.entry.service);
      if (!template) { jsonError(res, "No login template for this service"); return; }

      // Check trusted device status
      const body = await parseBody(req).catch(() => ({}));
      const deviceFp = body.deviceFingerprint || generateDeviceFingerprint({
        userAgent: body.userAgent,
      });
      const trustedDevices = credResult.fields.trusted_devices || [];
      const isTrusted = isDeviceTrusted(deviceFp, trustedDevices);

      // Track retry count (from extra or session)
      let retryCount = 0;
      const retryStr = credResult.fields.extra?.login_retry_count;
      if (retryStr) retryCount = parseInt(retryStr, 10) || 0;
      retryCount++;

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

        // Detect CAPTCHA after form submit
        let needsCaptcha = false;
        try {
          const captchaVisible = await page.locator('[class*="captcha"], [class*="recaptcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').first().isVisible().catch(() => false);
          const captchaInUrl = page.url().includes("captcha") || page.url().includes("recaptcha");
          needsCaptcha = captchaVisible || captchaInUrl;
        } catch { /* captcha detection non-blocking */ }

        const url = page.url();
        const totpSecret = credResult.fields.extra?.totp_secret;

        // If needsCaptcha — return early
        if (needsCaptcha) {
          loginSessions.set(session.id, { credentialId, sessionId: session.id, step: "awaiting_captcha" });
          // Persist retry count
          await persistRetryCount(credentialId, credResult, retryCount);
          json(res, {
            needsCaptcha: true,
            needs2FA: false,
            trustedDevice: isTrusted,
            retryCount,
            sessionId: session.id,
            message: "CAPTCHA challenge detected — requires solving",
          });
          return;
        }

        // Check for 2FA challenge
        if (url.includes("/signin/challenge/")) {
          // If device is trusted and not first retry, try auto-solve
          if (isTrusted && retryCount <= 1 && totpSecret) {
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
                await logAction({ timestamp: new Date().toISOString(), action: "login_attempt", credentialId, service: credResult.entry.service, metadata: { success: loggedIn, trustedDevice: true, retryCount } });
                json(res, {
                  loggedIn, needsCaptcha: false, needs2FA: false,
                  trustedDevice: isTrusted, retryCount, sessionId: session.id,
                  currentUrl: fu,
                  message: loggedIn ? "Login successful" : "2FA code submitted but not accepted",
                });
                return;
              }
            }
          }
          // Manual 2FA needed (or untrusted device force 2FA)
          loginSessions.set(session.id, { credentialId, sessionId: session.id, step: "awaiting_2fa" });
          await persistRetryCount(credentialId, credResult, retryCount);
          await logAction({ timestamp: new Date().toISOString(), action: "login_attempt", credentialId, service: credResult.entry.service, metadata: { status: "2fa_required", trustedDevice: isTrusted, retryCount } });
          json(res, {
            needs2FA: true, needsCaptcha: false,
            trustedDevice: isTrusted, retryCount,
            sessionId: session.id,
            message: "2FA code required",
          });
          return;
        }

        const loggedIn = url.includes("myaccount.google.com");
        loginSessions.set(session.id, { credentialId, sessionId: session.id, step: loggedIn ? "done" : "unknown" });
        browser.closeBrowser(session.id).catch(() => {});

        // Reset retry count on success
        if (loggedIn && retryCount > 0) {
          const extra = credResult.fields.extra || {};
          delete extra.login_retry_count;
          await vault.updateCredentials(credentialId, {
            username: credResult.fields.username,
            password: credResult.fields.password,
            extra,
            trusted_devices: credResult.fields.trusted_devices,
          });
        }

        await logAction({ timestamp: new Date().toISOString(), action: "login_attempt", credentialId, service: credResult.entry.service, metadata: { success: loggedIn, trustedDevice: isTrusted, retryCount } });
        json(res, {
          loggedIn, needsCaptcha: false, needs2FA: false,
          trustedDevice: isTrusted, retryCount,
          sessionId: session.id, currentUrl: url,
        });

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await logAction({ timestamp: new Date().toISOString(), action: "login_attempt", credentialId, service: credResult.entry.service, metadata: { error: msg, retryCount } });
        jsonError(res, "Login failed: " + msg, 500);
      }
      return;
    }

    // ── API: Close browser session ─────────────────────────────────────────
    const closeMatch = path.match(/^\/api\/login\/([A-Za-z0-9_-]+)\/close$/);
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

        // Check if rotation is suggested (current TOTP window near end)
        const rotationSuggested = needsRotation();

        // If rotation suggested, also return the next window's code
        let nextCode: string | undefined;
        if (rotationSuggested) {
          nextCode = nextTOTPCode(secret);
        }

        json(res, { valid, generatedCode: currentCode, rotationSuggested, nextCode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "TOTP verify failed: " + msg, 500);
      }
      return;
    }

    // ── API: Password Generator ───────────────────────────────────────────
    if (method === "GET" && path === "/api/password/generate") {
      try {
        const length = parseInt(u.searchParams.get("length") || "16", 10);
        const symbols = u.searchParams.get("symbols") === "true";
        const excludeSimilar = u.searchParams.get("excludeSimilar") === "true";
        const lowercase = u.searchParams.get("lowercase") !== "false";
        const uppercase = u.searchParams.get("uppercase") !== "false";
        const digits = u.searchParams.get("digits") !== "false";
        const count = Math.min(parseInt(u.searchParams.get("count") || "1", 10), 20);
        const method = (u.searchParams.get("method") || "auto") as "openssl" | "node" | "auto";

        const passwords: GeneratedPassword[] = [];
        for (let i = 0; i < count; i++) {
          passwords.push(generatePassword({
            length, symbols, excludeSimilar, lowercase, uppercase, digits, method,
          }));
        }
        json(res, { count: passwords.length, passwords });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Password generation failed: " + msg, 500);
      }
      return;
    }

    // ── API: Passphrase Generator ─────────────────────────────────────────
    if (method === "GET" && path === "/api/password/passphrase") {
      try {
        const words = Math.min(parseInt(u.searchParams.get("words") || "4", 10), 12);
        const separator = u.searchParams.get("separator") || "-";
        const count = Math.min(parseInt(u.searchParams.get("count") || "1", 10), 20);
        const useOpenSSL = u.searchParams.get("method") !== "node";
        const phrases: GeneratedPassword[] = [];
        for (let i = 0; i < count; i++) {
          phrases.push(generatePassphrase(words, separator, useOpenSSL));
        }
        json(res, { count: phrases.length, phrases });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Passphrase generation failed: " + msg, 500);
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

    // ── API: TOTP Regenerate ──────────────────────────────────────────────
    if (method === "POST" && path === "/api/totp/regenerate") {
      try {
        const body = await parseBody(req);
        const { credentialId, oldSecret } = body;
        if (!credentialId || !oldSecret) { jsonError(res, "Missing credentialId or oldSecret"); return; }
        if (!isValidTOTPSecret(oldSecret)) { jsonError(res, "Invalid old TOTP secret"); return; }

        const credResult = await vault.getCredentials(credentialId);
        if (!credResult) { jsonError(res, "Credential not found", 404); return; }

        // Verify old secret matches stored secret
        const storedSecret = credResult.fields.extra?.totp_secret;
        if (!storedSecret) { jsonError(res, "No TOTP secret attached to this credential", 400); return; }
        if (storedSecret !== oldSecret) { jsonError(res, "Old TOTP secret does not match", 400); return; }

        // Generate new secret
        const newSecret = generateTOTPSecret();

        // Update credential with new secret
        credResult.fields.extra = credResult.fields.extra || {};
        credResult.fields.extra.totp_secret = newSecret;
        credResult.fields.extra.totp_rotated_at = new Date().toISOString();
        await vault.updateCredentials(credentialId, credResult.fields);

        await logAction({ timestamp: new Date().toISOString(), action: "rotate_password", credentialId, service: credResult.entry.service, metadata: { totp: true } });

        json(res, { success: true, newSecret, rotatedAt: credResult.fields.extra.totp_rotated_at });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "TOTP regenerate failed: " + msg, 500);
      }
      return;
    }

    // ── API: Get credential TOTP detail ────────────────────────────────────
    const credTotpMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)\/totp$/);
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

    // ── API: List trusted devices for credential ──────────────────────────
    const credDevicesMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)\/devices$/);
    if (method === "GET" && credDevicesMatch) {
      try {
        const result = await vault.getCredentials(credDevicesMatch[1]);
        if (!result) { jsonError(res, "Not found", 404); return; }
        json(res, {
          devices: result.fields.trusted_devices || [],
          count: (result.fields.trusted_devices || []).length,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Failed: " + msg, 500);
      }
      return;
    }

    // ── API: Add trusted device ─────────────────────────────────────────────
    const credDevicesAddMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)\/devices\/add$/);
    if (method === "POST" && credDevicesAddMatch) {
      try {
        const result = await vault.getCredentials(credDevicesAddMatch[1]);
        if (!result) { jsonError(res, "Not found", 404); return; }

        const body = await parseBody(req);
        const device = buildTrustedDevice({
          userAgent: body.userAgent,
          sshPubFragment: body.sshPubFragment,
        });

        const existingDevices = result.fields.trusted_devices || [];
        // Avoid duplicates — replace if same fingerprint exists
        const idx = existingDevices.findIndex((d) => d.fingerprint === device.fingerprint);
        if (idx >= 0) {
          existingDevices[idx] = { ...existingDevices[idx], ...device, lastUsedAt: new Date().toISOString() };
        } else {
          existingDevices.push(device);
        }

        result.fields.trusted_devices = existingDevices;
        await vault.updateCredentials(credDevicesAddMatch[1], {
          username: result.fields.username,
          password: result.fields.password,
          extra: result.fields.extra,
          trusted_devices: existingDevices,
        });

        json(res, { success: true, device }, 201);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Failed: " + msg, 500);
      }
      return;
    }

    // ── API: Remove trusted device ──────────────────────────────────────────
    const credDevicesRemoveMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)\/devices\/([A-Za-z0-9:]+)$/);
    if (method === "DELETE" && credDevicesRemoveMatch) {
      try {
        const result = await vault.getCredentials(credDevicesRemoveMatch[1]);
        if (!result) { jsonError(res, "Not found", 404); return; }

        const fingerprint = credDevicesRemoveMatch[2];
        const existingDevices = result.fields.trusted_devices || [];
        const filtered = existingDevices.filter((d) => d.fingerprint !== fingerprint);

        if (filtered.length === existingDevices.length) {
          jsonError(res, "Device not found in trust list", 404);
          return;
        }

        result.fields.trusted_devices = filtered;
        await vault.updateCredentials(credDevicesRemoveMatch[1], {
          username: result.fields.username,
          password: result.fields.password,
          extra: result.fields.extra,
          trusted_devices: filtered,
        });

        json(res, { success: true, removed: fingerprint });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Failed: " + msg, 500);
      }
      return;
    }

    // ── API: Update credential ──────────────────────────────────────────────
    const credUpdateMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)$/);
    if (method === "PUT" && credUpdateMatch) {
      const body = await parseBody(req);
      if (!body || Object.keys(body).length === 0) { jsonError(res, "Missing update fields"); return; }

      const existing = await vault.getCredentials(credUpdateMatch[1]);
      if (!existing) { jsonError(res, "Not found", 404); return; }

      const extra: Record<string, string> = { ...(existing.fields.extra || {}) };
      if (typeof body.totp_secret === "string") {
        if (body.totp_secret) extra.totp_secret = body.totp_secret;
        else delete extra.totp_secret;
      } else if (body.extra && typeof body.extra === "object") {
        Object.assign(extra, body.extra);
      }

      const updatedFields = {
        username: body.username ?? existing.fields.username,
        password: body.password ?? existing.fields.password,
        extra,
        trusted_devices: body.trusted_devices ?? existing.fields.trusted_devices,
      };

      const ok = await vault.updateCredentials(credUpdateMatch[1], updatedFields);
      if (!ok) { jsonError(res, "Not found", 404); return; }

      if (body.label !== undefined || body.service !== undefined || body.tags !== undefined) {
        await vault.updateCredentialMeta(credUpdateMatch[1], {
          label: body.label,
          service: body.service,
          tags: Array.isArray(body.tags)
            ? body.tags
            : typeof body.tags === "string"
              ? body.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
              : undefined,
        });
      }

      json(res, { success: true });
      return;
    }

    // ── API: Update secret ──────────────────────────────────────────────────
    const secUpdateMatch = path.match(/^\/api\/secrets\/([A-Za-z0-9_-]+)$/);
    if (method === "PUT" && secUpdateMatch) {
      const body = await parseBody(req);
      if (!body || Object.keys(body).length === 0) { jsonError(res, "Missing update fields"); return; }

      const existing = await secrets.getSecret(secUpdateMatch[1]);
      if (!existing) { jsonError(res, "Not found", 404); return; }

      const updatedFields = {
        value: body.value ?? existing.fields.value,
        description: body.description ?? existing.fields.description,
      };

      const ok = await secrets.updateSecret(secUpdateMatch[1], updatedFields);
      if (!ok) { jsonError(res, "Not found", 404); return; }

      if (body.label !== undefined || body.kind !== undefined || body.service !== undefined) {
        await secrets.updateSecretMeta(secUpdateMatch[1], {
          label: body.label,
          kind: body.kind,
          service: body.service,
        });
      }

      json(res, { success: true });
      return;
    }


    // ── API: List SSH keys ─────────────────────────────────────────────────
    if (method === "GET" && path === "/api/ssh") {
      const host = u.searchParams.get("host") || undefined;
      const keyType = u.searchParams.get("keyType") || undefined;
      const entries = await sshVault.listSSHKeys(host, keyType);
      json(res, { count: entries.length, entries: entries.map((e) => ({
        id: e.id, label: e.label, keyType: e.keyType,
        fingerprint: e.fingerprint, host: e.host, port: e.port,
        username: e.username, hostname: e.hostname,
        publicKey: e.publicKey, createdAt: e.createdAt, tags: e.tags,
      }))});
      return;
    }

    // ── API: Get SSH key detail ────────────────────────────────────────────
    const sshDetailMatch = path.match(/^\/api\/ssh\/([A-Za-z0-9_-]+)$/);
    if (method === "GET" && sshDetailMatch) {
      const includePrivate = u.searchParams.get("includePrivate") === "true";
      const result = await sshVault.getSSHKey(sshDetailMatch[1]);
      if (!result) { jsonError(res, "Not found", 404); return; }
      json(res, {
        id: result.entry.id, label: result.entry.label,
        keyType: result.entry.keyType, fingerprint: result.entry.fingerprint,
        bits: result.entry.bits, host: result.entry.host, port: result.entry.port,
        username: result.entry.username, hostname: result.entry.hostname,
        publicKey: result.entry.publicKey,
        privateKey: includePrivate ? result.fields.privateKey : "***",
        hasPassphrase: !!result.fields.passphrase,
        comment: result.fields.comment,
        createdAt: result.entry.createdAt, updatedAt: result.entry.updatedAt,
        tags: result.entry.tags,
      });
      return;
    }

    // ── API: Create SSH key ────────────────────────────────────────────────
    if (method === "POST" && path === "/api/ssh") {
      const body = await parseBody(req);
      if (!body.label || !body.host || !body.username || !body.privateKey) {
        jsonError(res, "Missing required fields: label, host, username, privateKey");
        return;
      }
      const entry = await sshVault.storeSSHKey(
        body.label, body.keyType || "ed25519",
        body.host, body.port || 22, body.username,
        {
          privateKey: body.privateKey,
          passphrase: body.passphrase,
          publicKey: body.publicKey,
          comment: body.comment,
        },
        body.tags, body.hostname
      );
      json(res, { success: true, id: entry.id, fingerprint: entry.fingerprint }, 201);
      return;
    }

    // ── API: Update SSH key ────────────────────────────────────────────────
    const sshUpdateMatch = path.match(/^\/api\/ssh\/([A-Za-z0-9_-]+)$/);
    if (method === "PUT" && sshUpdateMatch) {
      const body = await parseBody(req);
      if (!body || Object.keys(body).length === 0) { jsonError(res, "Missing update fields"); return; }
      const ok = await sshVault.updateSSHKey(sshUpdateMatch[1], {
        label: body.label, host: body.host, port: body.port,
        username: body.username, hostname: body.hostname, tags: body.tags,
      });
      if (!ok) { jsonError(res, "Not found", 404); return; }
      json(res, { success: true });
      return;
    }

    // ── API: Delete SSH key ────────────────────────────────────────────────
    const sshDelMatch = path.match(/^\/api\/ssh\/([A-Za-z0-9_-]+)$/);
    if (method === "DELETE" && sshDelMatch) {
      const existing = await sshVault.listSSHKeys().then(k => k.find(x => x.id === sshDelMatch[1]));
      const ok = await sshVault.deleteSSHKey(sshDelMatch[1]);
      if (!ok) { jsonError(res, "Not found", 404); return; }
      await logAction({
        timestamp: new Date().toISOString(),
        action: "delete_key",
        credentialId: sshDelMatch[1],
        metadata: { source: "web", type: "ssh", label: existing?.label, host: existing?.host },
      });
      json(res, { success: true });
      return;
    }

    // ── API: Generate SSH key pair ──────────────────────────────────────────
    if (method === "POST" && path === "/api/ssh/generate") {
      try {
        const body = await parseBody(req);
        const keyType = body.keyType || "ed25519";
        const format = body.format || "pkcs8";
        const service = body.service;
        const comment = body.comment || `${body.username || "user"}@${body.host || "host"}`;

        const generated = await generateSSHKeyPair(keyType, {
          rsaBits: body.rsaBits,
          passphrase: body.passphrase,
          comment,
        });

        let sshKeyId: string | undefined;
        let privateKeyPath: string | undefined;

        // Auto-store if service is provided
        if (service && body.host && body.username) {
          const stored = await sshVault.storeSSHKey(
            `ssh-${service}-${Date.now()}`,
            keyType === "rsa" ? `rsa-${body.rsaBits || 4096}` : "ed25519",
            body.host,
            body.port || 22,
            body.username,
            {
              privateKey: generated.privateKey,
              passphrase: body.passphrase,
              publicKey: generated.publicKey,
              comment,
            },
            body.tags
          );
          sshKeyId = stored.id;

          // If service matches a credential, store reference in extra.ssh_key_id
          const creds = await vault.listCredentials(service);
          if (creds.length > 0) {
            for (const cred of creds) {
              const existing = await vault.getCredentials(cred.id);
              if (existing) {
                const extra = existing.fields.extra || {};
                extra.ssh_key_id = sshKeyId;
                await vault.updateCredentials(cred.id, {
                  username: existing.fields.username,
                  password: existing.fields.password,
                  extra,
                  trusted_devices: existing.fields.trusted_devices,
                });
              }
            }
          }
        }

        json(res, {
          success: true,
          serviceId: service || null,
          sshKeyId: sshKeyId || null,
          fingerprint: generated.fingerprint,
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          privateKeyPath,
          format,
          comment,
        }, 201);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Key generation failed: " + msg, 500);
      }
      return;
    }

    // ── API: Extract public key from private key ────────────────────────────
    if (method === "POST" && path === "/api/ssh/extract") {
      try {
        const body = await parseBody(req);
        if (!body.privateKey) { jsonError(res, "privateKey is required"); return; }
        const result = extractPublicKey(body.privateKey, body.passphrase);
        if (!result) { jsonError(res, "Could not extract public key — invalid format"); return; }
        json(res, { publicKey: result.publicKey, fingerprint: result.fingerprint });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Extraction failed: " + msg, 500);
      }
      return;
    }

    // ── API: SSH config fragment ────────────────────────────────────────────
    const sshConfigMatch = path.match(/^\/api\/ssh\/([A-Za-z0-9_-]+)\/config$/);
    if (method === "GET" && sshConfigMatch) {
      const result = await sshVault.getSSHKey(sshConfigMatch[1]);
      if (!result) { jsonError(res, "Not found", 404); return; }
      const identityPath = u.searchParams.get("identityPath") || `~/.ssh/${result.entry.label.replace(/\s+/g, "_")}`;
      const lines = [
        `Host ${result.entry.host}`,
        `    HostName ${result.entry.hostname || result.entry.host}`,
        `    User ${result.entry.username}`,
        `    Port ${result.entry.port}`,
        `    IdentityFile ${identityPath}`,
      ];
      json(res, { config: lines.join("\n") });
      return;
    }

    // ── API: Export SSH key to file ─────────────────────────────────────────
    const sshExportMatch = path.match(/^\/api\/ssh\/([A-Za-z0-9_-]+)\/export$/);
    if (method === "POST" && sshExportMatch) {
      try {
        const body = await parseBody(req);
        if (!body.filePath) { jsonError(res, "filePath is required"); return; }
        const result = await sshVault.getSSHKey(sshExportMatch[1]);
        if (!result) { jsonError(res, "Not found", 404); return; }
        const fs = await import("node:fs/promises");
        await fs.writeFile(body.filePath, result.fields.privateKey, "utf8");
        await fs.chmod(body.filePath, body.mode ? parseInt(body.mode, 8) : 0o600);
        if (result.fields.publicKey) {
          const pubPath = `${body.filePath}.pub`;
          await fs.writeFile(pubPath, result.fields.publicKey + "\n", "utf8");
        }
        json(res, { success: true, path: body.filePath, fingerprint: result.entry.fingerprint });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Export failed: " + msg, 500);
      }
      return;
    }

    // ── API: SSH rotate keypair ────────────────────────────────────────────
    const sshRotateMatch = path.match(/^\/api\/ssh\/([A-Za-z0-9_-]+)\/rotate$/);
    if (method === "POST" && sshRotateMatch) {
      try {
        const existing = await sshVault.getSSHKey(sshRotateMatch[1]);
        if (!existing) { jsonError(res, "Not found", 404); return; }

        const body = await parseBody(req);
        const keyType = body.keyType || (existing.entry.keyType.startsWith("rsa") ? "rsa" : "ed25519");
        const rsaBits = body.rsaBits || (existing.entry.keyType === "rsa-4096" ? 4096 : 2048);
        const passphrase = body.passphrase !== undefined ? body.passphrase : existing.fields.passphrase;
        const comment = body.comment || existing.fields.comment || `${existing.entry.username}@${existing.entry.host}`;

        const generated = await generateSSHKeyPair(keyType, {
          rsaBits: keyType === "rsa" ? rsaBits : undefined,
          passphrase,
          comment,
        });

        const ok = await sshVault.updateSSHKey(sshRotateMatch[1], {
          label: existing.entry.label,
          privateKey: generated.privateKey,
          passphrase: passphrase || undefined,
          publicKey: generated.publicKey,
          comment,
        });
        if (!ok) { jsonError(res, "Update failed", 500); return; }

        await logAction({ timestamp: new Date().toISOString(), action: "ssh_keygen", credentialId: sshRotateMatch[1], metadata: { rotate: true, keyType } });
        json(res, { success: true, id: sshRotateMatch[1], fingerprint: generated.fingerprint });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "SSH rotate failed: " + msg, 500);
      }
      return;
    }

    // ── API: SSH public key (plain text) ───────────────────────────────────
    const sshPublicMatch = path.match(/^\/api\/ssh\/([A-Za-z0-9_-]+)\/public$/);
    if (method === "GET" && sshPublicMatch) {
      const result = await sshVault.getSSHKey(sshPublicMatch[1]);
      if (!result) { jsonError(res, "Not found", 404); return; }
      json(res, { id: result.entry.id, publicKey: result.entry.publicKey, createdAt: result.entry.createdAt });
      return;
    }

    // ── API: Discovery overview ──────────────────────────────────────────────
    // No decrypt by default (metadata only). Pass ?includeTotp=true to check hasTotp.
    if (method === "GET" && path === "/api/discovery/overview") {
      try {
        const includeTotp = u.searchParams.get("includeTotp") === "true";

        // Credentials — metadata only, no decrypt
        const credEntries = await vault.listCredentials();
        const creds = credEntries.map((e) => ({
          id: e.id, service: e.service, label: e.label,
          tags: e.tags, createdAt: e.createdAt, updatedAt: e.updatedAt,
        }));

        // hasTotp requires decrypt — only if explicitly requested
        const credsWithTotp: string[] = [];
        if (includeTotp) {
          for (const entry of credEntries) {
            try {
              const result = await vault.getCredentials(entry.id);
              if (result?.fields.extra?.totp_secret) {
                credsWithTotp.push(entry.id);
              }
            } catch { /* skip failed decrypt */ }
          }
        }

        // Secrets — metadata only
        const { listSecrets } = await import("../secrets/manager.js");
        const secEntries = await listSecrets();
        const secs = secEntries.map((e) => ({
          id: e.id, label: e.label, kind: e.kind,
          service: e.service, createdAt: e.createdAt, tags: e.tags,
          status: e.status, notes: e.notes, statusChangedAt: e.statusChangedAt,
        }));

        // SSH keys — metadata only
        const sshEntries = await sshVault.listSSHKeys();
        const sshKeys = sshEntries.map((e) => ({
          id: e.id, label: e.label, keyType: e.keyType,
          fingerprint: e.fingerprint, host: e.host, port: e.port,
          username: e.username, createdAt: e.createdAt, tags: e.tags,
        }));

        json(res, {
          credentials: creds.map((c) => ({
            ...c,
            hasTotp: includeTotp ? credsWithTotp.includes(c.id) : null,
          })),
          secrets: secs,
          sshKeys,
          counts: {
            credentials: creds.length,
            secrets: secs.length,
            sshKeys: sshKeys.length,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Discovery failed: " + msg, 500);
      }
      return;
    }

    // ── API: List audit actions ────────────────────────────────────────────────
        if (method === "GET" && path === "/api/audit/actions") {
          try {
            const limit = parseInt(u.searchParams.get("limit") || "50", 10);
            const entries = await readAuditLog(Math.min(limit, 200));
            json(res, { count: entries.length, entries });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(res, "Audit read failed: " + msg, 500);
          }
          return;
        }

        // ── API: Unified Search (credentials + secrets + SSH) ──────────────────
        // Query params: q=search term, limit=50 (default), types=credentials,secrets,ssh
        if (method === "GET" && path === "/api/search") {
          try {
            const query = u.searchParams.get("q") || "";
            const limit = Math.min(parseInt(u.searchParams.get("limit") || "50", 10), 200);
            const types = (u.searchParams.get("types") || "credentials,secrets,ssh").split(",");
            const results: any[] = [];

            // Search credentials
            if (types.includes("credentials")) {
              const credEntries = await vault.listCredentials();
              for (const entry of credEntries) {
                const result = await vault.getCredentials(entry.id);
                if (!result) continue;
                const searchable = [
                  result.entry.service,
                  result.entry.label,
                  result.fields.username,
                  result.fields.extra ? Object.values(result.fields.extra).join(" ") : "",
                ].join(" ").toLowerCase();
                if (!query || searchable.includes(query.toLowerCase())) {
                  results.push({
                    type: "credential",
                    id: result.entry.id,
                    service: result.entry.service,
                    label: result.entry.label,
                    username: result.fields.username,
                    tags: result.entry.tags,
                    createdAt: result.entry.createdAt,
                    updatedAt: result.entry.updatedAt,
                  });
                }
              }
            }

            // Search secrets
            if (types.includes("secrets")) {
              const { listSecrets } = await import("../secrets/manager.js");
              const secEntries = await listSecrets();
              for (const entry of secEntries) {
                const result = await secrets.getSecret(entry.id);
                if (!result) continue;
                const searchable = [
                  result.entry.label,
                  result.entry.kind,
                  result.entry.service,
                  result.fields.description || "",
                  result.fields.value,
                  result.fields.extra ? Object.values(result.fields.extra).join(" ") : "",
                ].join(" ").toLowerCase();
                if (!query || searchable.includes(query.toLowerCase())) {
                  results.push({
                    type: "secret",
                    id: result.entry.id,
                    label: result.entry.label,
                    kind: result.entry.kind,
                    service: result.entry.service,
                    tags: result.entry.tags,
                    createdAt: result.entry.createdAt,
                    updatedAt: result.entry.updatedAt,
                  });
                }
              }
            }

            // Search SSH keys
            if (types.includes("ssh")) {
              const sshEntries = await sshVault.listSSHKeys();
              for (const entry of sshEntries) {
                const searchable = [
                  entry.label,
                  entry.keyType,
                  entry.host,
                  entry.hostname || "",
                  entry.username,
                  entry.fingerprint,
                ].join(" ").toLowerCase();
                if (!query || searchable.includes(query.toLowerCase())) {
                  results.push({
                    type: "ssh",
                    id: entry.id,
                    label: entry.label,
                    keyType: entry.keyType,
                    host: entry.host,
                    port: entry.port,
                    username: entry.username,
                    fingerprint: entry.fingerprint,
                    tags: entry.tags,
                    createdAt: entry.createdAt,
                  });
                }
              }
            }

            // Sort by updatedAt desc
            results.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

            json(res, { count: results.length, results: results.slice(0, limit) });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(res, "Search failed: " + msg, 500);
          }
          return;
        }

        // ── API: Bulk Delete ────────────────────────────────────────────────────
        // Body: { ids: string[], type: "credentials" | "secrets" | "ssh" }
        if (method === "POST" && path === "/api/bulk/delete") {
          try {
            const body = await parseBody(req);
            if (!body.ids || !Array.isArray(body.ids) || !body.type) {
              jsonError(res, "Missing required fields: ids (array), type (credentials|secrets|ssh)");
              return;
            }
            const { ids, type } = body;
            let deleted = 0;
            let errors: string[] = [];

            if (type === "credentials") {
              for (const id of ids) {
                try {
                  const ok = await vault.deleteCredentials(id);
                  if (ok) deleted++;
                  else errors.push(`${id}: not found`);
                } catch (e) { errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
              }
            } else if (type === "secrets") {
              const { deleteSecret } = await import("../secrets/manager.js");
              for (const id of ids) {
                try {
                  const ok = await deleteSecret(id);
                  if (ok) deleted++;
                  else errors.push(`${id}: not found`);
                } catch (e) { errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
              }
            } else if (type === "ssh") {
              for (const id of ids) {
                try {
                  const ok = await sshVault.deleteSSHKey(id);
                  if (ok) deleted++;
                  else errors.push(`${id}: not found`);
                } catch (e) { errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
              }
            } else {
              jsonError(res, "Invalid type: must be credentials, secrets, or ssh");
              return;
            }

            json(res, { deleted, errors, type });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(res, "Bulk delete failed: " + msg, 500);
          }
          return;
        }

        // ── API: Export All Data (backup) ───────────────────────────────────────
        if (method === "GET" && path === "/api/export") {
          try {
            const [credEntries, secEntries, sshEntries] = await Promise.all([
              vault.listCredentials(),
              (await import("../secrets/manager.js")).listSecrets(),
              sshVault.listSSHKeys(),
            ]);

            // Full export with decrypted values
            const credentials = [];
            for (const entry of credEntries) {
              const result = await vault.getCredentials(entry.id);
              if (result) {
                credentials.push({
                  id: result.entry.id,
                  service: result.entry.service,
                  label: result.entry.label,
                  tags: result.entry.tags,
                  createdAt: result.entry.createdAt,
                  updatedAt: result.entry.updatedAt,
                  username: result.fields.username,
                  password: result.fields.password,
                  extra: result.fields.extra,
                });
              }
            }

            const secretsList = [];
            for (const entry of secEntries) {
              const result = await secrets.getSecret(entry.id);
              if (result) {
                secretsList.push({
                  id: result.entry.id,
                  label: result.entry.label,
                  kind: result.entry.kind,
                  service: result.entry.service,
                  tags: result.entry.tags,
                  createdAt: result.entry.createdAt,
                  updatedAt: result.entry.updatedAt,
                  value: result.fields.value,
                  description: result.fields.description,
                  expiresAt: result.fields.expiresAt,
                  scopes: result.fields.scopes,
                  extra: result.fields.extra,
                });
              }
            }

            const sshKeys = sshEntries.map(e => ({
              id: e.id,
              label: e.label,
              keyType: e.keyType,
              host: e.host,
              port: e.port,
              username: e.username,
              hostname: e.hostname,
              privateKey: e.privateKey,
              publicKey: e.publicKey,
              passphrase: e.passphrase,
              comment: e.comment,
              fingerprint: e.fingerprint,
              tags: e.tags,
              createdAt: e.createdAt,
            }));

            const exportData = {
              version: "1.0",
              exportedAt: new Date().toISOString(),
              counts: {
                credentials: credentials.length,
                secrets: secretsList.length,
                sshKeys: sshKeys.length,
              },
              credentials,
              secrets: secretsList,
              sshKeys,
            };

            res.setHeader("Content-Disposition", `attachment; filename="auth-vault-export-${new Date().toISOString().slice(0,10)}.json"`);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(exportData, null, 2));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(res, "Export failed: " + msg, 500);
          }
          return;
        }

        // ── API: Secret Expiry Audit ────────────────────────────────────────────
        if (method === "GET" && path === "/api/audit/expiry") {
          try {
            const soonDays = Math.min(parseInt(u.searchParams.get("soonDays") || "30", 10), 365);
            const { listSecrets } = await import("../secrets/manager.js");
            const all = await listSecrets();
            const now = new Date();
            const soonMs = soonDays * 86400000;
            const expired: any[] = [], soon: any[] = [], valid: any[] = [], noExpiry: any[] = [];

            for (const entry of all) {
              const full = await secrets.getSecret(entry.id);
              if (!full) continue;
              const ea = full.fields.expiresAt;
              const s = { id: entry.id, label: entry.label, kind: entry.kind, service: entry.service, createdAt: entry.createdAt, expiresAt: ea || null };
              if (!ea) {
                noExpiry.push(s);
                continue;
              }
              const ed = new Date(ea);
              if (isNaN(ed.getTime())) {
                noExpiry.push({ ...s, note: "invalid date" });
                continue;
              }
              if (ed <= now) {
                expired.push({ ...s, expiredSince: ed.toISOString() });
              } else if (ed.getTime() - now.getTime() <= soonMs) {
                soon.push({ ...s, expiresInDays: Math.round((ed.getTime() - now.getTime()) / 86400000) });
              } else {
                valid.push(s);
              }
            }

            json(res, { total: all.length, expired, expiresSoon: soon, valid, noExpiry, checked: now.toISOString(), soonThreshold: soonDays });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(res, "Expiry audit failed: " + msg, 500);
          }
          return;
        }

        // ── API: Update Credential (inline edit) ────────────────────────────────
        // PATCH /api/credentials/:id  body: { label?, username?, password?, extra?, tags? }
        const credPatchMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)$/);
        if (method === "PATCH" && credPatchMatch) {
          try {
            const body = await parseBody(req);
            const result = await vault.getCredentials(credPatchMatch[1]);
            if (!result) { jsonError(res, "Not found", 404); return; }

            const fields = { ...result.fields };
            if (body.username !== undefined) fields.username = body.username;
            if (body.password !== undefined) fields.password = body.password;
            if (body.extra !== undefined) fields.extra = body.extra;

            // Metadane wpisu (label / tags / status / notes) — trzymane OBOK
            // szyfrogramu, więc notatka i status są czytelne bez odszyfrowywania
            // i przeżywają zmianę sekretu.
            const meta: Parameters<typeof vault.updateCredentialMeta>[1] = {};
            if (body.label !== undefined) meta.label = body.label;
            if (body.tags !== undefined) meta.tags = body.tags;
            if (body.notes !== undefined) meta.notes = body.notes;
            if (body.status !== undefined) {
              const allowed = ["active", "disabled", "degraded", "expired", "testing"];
              if (!allowed.includes(body.status)) {
                jsonError(res, `status musi być jednym z: ${allowed.join(", ")}`);
                return;
              }
              meta.status = body.status;
            }

            const ok = await vault.updateCredentials(credPatchMatch[1], {
              username: fields.username,
              password: fields.password,
              extra: fields.extra,
              trusted_devices: fields.trusted_devices,
            });
            if (!ok) { jsonError(res, "Update failed"); return; }
            if (Object.keys(meta).length) {
              const metaOk = await vault.updateCredentialMeta(credPatchMatch[1], meta);
              if (!metaOk) { jsonError(res, "Meta update failed"); return; }
            }
            json(res, { success: true, id: credPatchMatch[1] });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(res, "Update failed: " + msg, 500);
          }
          return;
        }

        // ── API: Update Secret (inline edit) ────────────────────────────────────
        // PATCH /api/secrets/:id  body: { label?, kind?, service?, value?, description?, expiresAt?, scopes?, extra?, tags? }
        const secPatchMatch = path.match(/^\/api\/secrets\/([A-Za-z0-9_-]+)$/);
        if (method === "PATCH" && secPatchMatch) {
          try {
            const body = await parseBody(req);
            const result = await secrets.getSecret(secPatchMatch[1]);
            if (!result) { jsonError(res, "Not found", 404); return; }

            const fields = { ...result.fields };
            const entryUpdates: any = {};
            if (body.label !== undefined) { entryUpdates.label = body.label; }
            if (body.notes !== undefined) { entryUpdates.notes = body.notes; }
            if (body.status !== undefined) {
              const allowed = ["active", "disabled", "degraded", "expired", "testing"];
              if (!allowed.includes(body.status)) {
                jsonError(res, `status musi być jednym z: ${allowed.join(", ")}`);
                return;
              }
              entryUpdates.status = body.status;
            }
            if (body.value !== undefined) fields.value = body.value;
            if (body.description !== undefined) fields.description = body.description;
            if (body.expiresAt !== undefined) fields.expiresAt = body.expiresAt || undefined;
            if (body.scopes !== undefined) fields.scopes = body.scopes;
            if (body.extra !== undefined) fields.extra = body.extra;
            if (body.tags !== undefined) entryUpdates.tags = body.tags;

            // Use updateSecret for fields, and also update entry if label/kind/service changed
            const { updateSecret } = await import("../secrets/manager.js");
            const ok = await updateSecret(secPatchMatch[1], fields);
            if (!ok) { jsonError(res, "Update failed"); return; }

            // Entry-level metadata (label/tags/status/notes) żyje OBOK szyfrogramu,
            // więc notatka o stanie klucza jest czytelna bez deszyfrowania — tak samo
            // jak w /api/credentials. Bez tego PATCH zwracał "success", a notatka
            // nigdy nie trafiła do indeksu.
            if (Object.keys(entryUpdates).length) {
              const { updateSecretMeta } = await import("../secrets/manager.js");
              const metaOk = await updateSecretMeta(secPatchMatch[1], entryUpdates);
              if (!metaOk) { jsonError(res, "Meta update failed"); return; }
            }
            json(res, { success: true, id: secPatchMatch[1] });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(res, "Update failed: " + msg, 500);
          }
          return;
        }

        // ── API: Log audit action ──────────────────────────────────────────────
        if (method === "POST" && path === "/api/audit/actions") {
      try {
        const body = await parseBody(req);
        if (!body.action) { jsonError(res, "action is required"); return; }
        await logAction({
          timestamp: new Date().toISOString(),
          action: body.action,
          credentialId: body.credentialId,
          service: body.service,
          fingerprint: body.fingerprint,
          metadata: body.metadata,
        });
        json(res, { success: true }, 201);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Audit log failed: " + msg, 500);
      }
      return;
    }

    // ── API: Health integrity check ────────────────────────────────────────
    if (method === "GET" && path === "/api/health/integrity") {
      try {
        const result = await integrityCheck();
        json(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Integrity check failed: " + msg, 500);
      }
      return;
    }

    // ── API: Discovery stats ──────────────────────────────────────────────
    if (method === "GET" && path === "/api/discovery/stats") {
      try {
        const creds = await vault.listCredentials();
        const secretsList = await import("../secrets/manager.js").then(m => m.listSecrets());
        const sshList = await sshVault.listSSHKeys();
        const logSize = await import("../audit/log.js").then(m => m.auditLogSize());
        json(res, {
          credentials: { total: creds.length, hasTotp: null },
          secrets: secretsList.length,
          sshKeys: sshList.length,
          audit: { logSize },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Stats failed: " + msg, 500);
      }
      return;
    }

    // ── API: Discovery recent ──────────────────────────────────────────────
    if (method === "GET" && path === "/api/discovery/recent") {
      try {
        const auditEntries = await readAuditLog(10);
        const creds = await vault.listCredentials();
        const recentCreds = creds
          .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
          .slice(0, 10)
          .map(e => ({ id: e.id, service: e.service, label: e.label, updatedAt: e.updatedAt || e.createdAt }));
        json(res, { audit: auditEntries, recentCredentials: recentCreds });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Recent failed: " + msg, 500);
      }
      return;
    }

    // ── API: Credential audit ──────────────────────────────────────────────
    const credAuditMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)\/audit$/);
    if (method === "GET" && credAuditMatch) {
      try {
        const limit = parseInt(u.searchParams.get("limit") || "50", 10);
        const all = await readAuditLog(Math.min(limit, 200));
        const filtered = all.filter(e => e.credentialId === credAuditMatch[1]);
        json(res, { credentialId: credAuditMatch[1], count: filtered.length, entries: filtered });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Credential audit failed: " + msg, 500);
      }
      return;
    }

    // ── API: Trust device shortcut ─────────────────────────────────────────
    const trustDeviceMatch = path.match(/^\/api\/credentials\/([A-Za-z0-9_-]+)\/trust-device$/);
    if (method === "POST" && trustDeviceMatch) {
      try {
        const body = await parseBody(req);
        const { deviceFingerprint, deviceName } = body;
        if (!deviceFingerprint) { jsonError(res, "deviceFingerprint is required"); return; }

        const credResult = await vault.getCredentials(trustDeviceMatch[1]);
        if (!credResult) { jsonError(res, "Not found", 404); return; }

        const trusted: TrustedDevice = {
          fingerprint: deviceFingerprint,
          os: process.platform,
          hostname: deviceName || "unknown",
          addedAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        };
        if (req.headers["user-agent"]) trusted.userAgentHash = req.headers["user-agent"];
        const devices = credResult.fields.trusted_devices || [];
        devices.push(trusted);

        await vault.updateCredentials(trustDeviceMatch[1], {
          username: credResult.fields.username,
          password: credResult.fields.password,
          extra: credResult.fields.extra,
          trusted_devices: devices,
        });

        await logAction({ timestamp: new Date().toISOString(), action: "trust_device", credentialId: trustDeviceMatch[1], fingerprint: deviceFingerprint });
        json(res, { success: true, device: trusted }, 201);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Trust device failed: " + msg, 500);
      }
      return;
    }

    // ── API: TOTP next code ────────────────────────────────────────────────
    const totpNextMatch = path.match(/^\/api\/totp\/([A-Za-z0-9_-]+)\/next-code$/);
    if (method === "GET" && totpNextMatch) {
      try {
        const credResult = await vault.getCredentials(totpNextMatch[1]);
        if (!credResult) { jsonError(res, "Not found", 404); return; }
        const totpSecret = credResult.fields.extra?.totp_secret;
        if (!totpSecret) { jsonError(res, "No TOTP secret attached", 400); return; }

        const currentCode = generateTOTP(totpSecret);
        const nextCode = nextTOTPCode(totpSecret);
        const nextWindow = Math.ceil(Date.now() / 30000) * 30000;
        json(res, { currentCode, nextCode, nextWindowISO: new Date(nextWindow).toISOString() });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "TOTP next code failed: " + msg, 500);
      }
      return;
    }

    // ── API: TOTP rotation info ────────────────────────────────────────────
    const totpRotInfoMatch = path.match(/^\/api\/totp\/([A-Za-z0-9_-]+)\/rotation-info$/);
    if (method === "GET" && totpRotInfoMatch) {
      try {
        const credResult = await vault.getCredentials(totpRotInfoMatch[1]);
        if (!credResult) { jsonError(res, "Not found", 404); return; }
        const lastRotated = credResult.fields.extra?.totp_rotated_at;
        const thresholdDays = 30;
        const suggested = needsRotation(thresholdDays, lastRotated);
        let daysUntilRotation: number | null = null;
        if (lastRotated) {
          const ageDays = (Date.now() - new Date(lastRotated).getTime()) / (86400000);
          daysUntilRotation = Math.max(0, thresholdDays - ageDays);
        }
        json(res, { lastRotated: lastRotated || null, thresholdDays, daysUntilRotation, suggested });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "TOTP rotation info failed: " + msg, 500);
      }
      return;
    }

    // ── API: Login cancel ──────────────────────────────────────────────────
    const loginCancelMatch = path.match(/^\/api\/login\/([A-Za-z0-9_-]+)\/cancel$/);
    if (method === "POST" && loginCancelMatch) {
      try {
        const body = await parseBody(req);
        const sessionId = body.sessionId;
        if (!sessionId) { jsonError(res, "Missing sessionId"); return; }

        await browser.closeBrowser(sessionId).catch(() => {});
        loginSessions.delete(sessionId);

        json(res, { success: true, sessionId, credentialId: loginCancelMatch[1] });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Login cancel failed: " + msg, 500);
      }
      return;
    }

    // ── API: Login sessions ────────────────────────────────────────────────
    if (method === "GET" && path === "/api/login/sessions") {
      try {
        const allBrowserSessions = browser.listSessions();
        const enriched = allBrowserSessions.map(s => {
          const meta = loginSessions.get(s.id);
          return {
            sessionId: s.id,
            credentialId: meta?.credentialId || null,
            step: meta?.step || "unknown",
            createdAt: s.createdAt,
          };
        });
        json(res, { count: enriched.length, sessions: enriched });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Login sessions failed: " + msg, 500);
      }
      return;
    }

    // ── API: Login fallback ────────────────────────────────────────────────
    const loginFallbackMatch = path.match(/^\/api\/login\/([A-Za-z0-9_-]+)\/fallback$/);
    if (method === "GET" && loginFallbackMatch) {
      try {
        const credentialId = loginFallbackMatch[1];
        const credResult = await vault.getCredentials(credentialId);
        if (!credResult) { jsonError(res, "Not found", 404); return; }
        const hasTotp = !!credResult.fields.extra?.totp_secret;

        // Try to find backup codes in secrets tagged with this credential's tags
        const { listSecrets } = await import("../secrets/manager.js");
        const all = await listSecrets();
        const backupCodes = all.filter(s => s.tags?.includes(credentialId));

        json(res, {
          credentialId,
          service: credResult.entry.service,
          options: {
            totpRecovery: hasTotp,
            backupCodes: backupCodes.length > 0,
          },
          backupCodeCount: backupCodes.length,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Fallback failed: " + msg, 500);
      }
      return;
    }

    // ── API: Audit summary ─────────────────────────────────────────────────
    if (method === "GET" && path === "/api/audit/summary") {
      try {
        const all = await readAuditLog(1000);
        const now = Date.now();
        const last24h = all.filter(e => new Date(e.timestamp).getTime() > now - 86400000);
        const actionCounts: Record<string, number> = {};
        let failedLogins = 0;
        for (const entry of last24h) {
          actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
          if (entry.action === "login_attempt" && entry.metadata && (entry.metadata as any).success === false) {
            failedLogins++;
          }
        }
        json(res, { period: "24h", total: last24h.length, actions: actionCounts, failedLogins });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Audit summary failed: " + msg, 500);
      }
      return;
    }

    // ── API: Audit services ────────────────────────────────────────────────
    if (method === "GET" && path === "/api/audit/services") {
      try {
        const all = await readAuditLog(5000);
        const serviceMap = new Map<string, { credentialId?: string; actionCount: number; lastSeen: string }>();
        for (const entry of all) {
          const key = entry.service || entry.credentialId || "unknown";
          const existing = serviceMap.get(key);
          if (existing) {
            existing.actionCount++;
            if (entry.timestamp > existing.lastSeen) existing.lastSeen = entry.timestamp;
          } else {
            serviceMap.set(key, { credentialId: entry.credentialId, actionCount: 1, lastSeen: entry.timestamp });
          }
        }
        const services = Array.from(serviceMap.entries()).map(([service, data]) => ({ service, ...data }));
        json(res, { count: services.length, services });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Audit services failed: " + msg, 500);
      }
      return;
    }

    // ── API: Health summary ───────────────────────────────────────────────
    if (method === "GET" && path === "/api/health/summary") {
      try {
        const result = await healthSummary();
        json(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Health summary failed: " + msg, 500);
      }
      return;
    }

    // ── API: Cache proxy → q-prompt-cache MCP :8769 ──────────────────────
    if (method === "POST" && path === "/api/cache_proxy") {
      const body = await parseBody(req);
      try {
        const resp = await fetch("http://127.0.0.1:8769/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        res.writeHead(resp.status, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(data));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonError(res, "Cache proxy failed: " + msg, 502);
      }
      return;
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[WEB] Error:", msg);
    jsonError(res, "Internal error: " + msg, 500);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {

  // ── Periodic integrity check (every 12 hours) ───────────────────────────
  const INTEGRITY_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const integrityTimer = setInterval(async () => {
    try {
      const result = await integrityCheck();
      if (result.status === "healthy") {
        console.log(`[HEALTH] Integrity check: OK (${Object.keys(result.files).join(", ")})`);
      } else {
        console.warn(`[HEALTH] Integrity check: DEGRADED — one or more vault files missing or corrupt`);
        for (const [name, status] of Object.entries(result.files)) {
          if (!status.valid) console.warn(`[HEALTH]   ${name}: ${status.exists ? "corrupt" : "missing"}`);
        }
      }
    } catch (err) {
      console.error("[HEALTH] Integrity check error:", err);
    }
  }, INTEGRITY_INTERVAL_MS);
  integrityTimer.unref();
  getConfig();

  const server = http.createServer(async (req, res) => {
    if (!checkTailscale(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied: Tailscale network only" }));
      return;
    }
    await handleRequest(req, res);
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[WEB] 🔒 Auth Vault UI — port ${PORT}`);
    console.log(`[WEB]    Bound:    http://127.0.0.1:${PORT} (localhost only)`);
    console.log(`[WEB]    Access:   loopback callers only (Camofox plugin); no CORS`);
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
