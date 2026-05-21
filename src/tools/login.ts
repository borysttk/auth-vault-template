import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as browser from "../browser/manager.js";
import { detectCaptcha, solveCaptcha, applyRecaptchaSolution } from "../browser/captcha.js";
import { getServiceTemplate } from "../services/definitions.js";
import * as vault from "../credentials/vault.js";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonError(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function registerLoginTools(server: McpServer): void {
  // === browser_launch ===
  server.tool(
    "browser_launch",
    "Launch a new browser session for logging into a service",
    {
      service: z.string().min(1).describe("Service identifier (e.g., 'google', 'arena.ai')"),
      headless: z.boolean().optional().describe("Run browser in headless mode (default: from config)"),
    },
    async (input) => {
      try {
        const template = getServiceTemplate(input.service);
        if (!template) {
          return jsonError(`Service '${input.service}' not found. Use list_services or add_service first.`);
        }

        const session = await browser.launchBrowser(input.service, input.headless);
        await browser.navigateTo(session.id, template.loginUrl);

        return jsonOk({
          success: true,
          sessionId: session.id,
          service: session.service,
          loginUrl: template.loginUrl,
          createdAt: session.createdAt,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === browser_navigate ===
  server.tool(
    "browser_navigate",
    "Navigate the browser to a URL within an active session",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
      url: z.string().url().describe("URL to navigate to"),
    },
    async (input) => {
      try {
        await browser.navigateTo(input.sessionId, input.url);
        return jsonOk({ success: true, url: input.url, sessionId: input.sessionId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === browser_close ===
  server.tool(
    "browser_close",
    "Close a browser session",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
    },
    async (input) => {
      try {
        const closed = await browser.closeBrowser(input.sessionId);
        return jsonOk({ success: closed, sessionId: input.sessionId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === list_sessions ===
  server.tool(
    "list_sessions",
    "List all active browser sessions",
    {},
    async () => {
      try {
        const sessions = browser.listSessions();
        return jsonOk({
          count: sessions.length,
          sessions: sessions.map((s) => ({
            id: s.id,
            service: s.service,
            createdAt: s.createdAt,
            isActive: s.isActive,
          })),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === login_service ===
  server.tool(
    "login_service",
    "Automate login to a service using stored credentials. Launches browser, fills form, handles captcha.",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
      credentialId: z.string().min(1).describe("Credential ID from store_credentials or list_credentials"),
      solveCaptcha: z.boolean().optional().default(true).describe("Automatically detect and solve captcha"),
    },
    async (input) => {
      try {
        // Get the credential
        const credResult = await vault.getCredentials(input.credentialId);
        if (!credResult) {
          return jsonError(`Credential not found: ${input.credentialId}`);
        }

        const { fields } = credResult;
        const page = browser.getPage(input.sessionId);
        if (!page) {
          return jsonError(`Session ${input.sessionId} not found or not active`);
        }

        // Get the service template
        const service = credResult.entry.service;
        const template = getServiceTemplate(service);
        if (!template) {
          return jsonError(`Service template '${service}' not found. Use add_service first.`);
        }

        // Fill the login form
        await browser.fillLoginForm(
          input.sessionId,
          template,
          fields.username,
          fields.password,
          fields.extra
        );

        // Check for captcha before submitting
        if (input.solveCaptcha) {
          const captchaResult = await detectCaptcha(page);
          if (captchaResult.detected) {
            const solution = await solveCaptcha(captchaResult);
            if (solution.success && solution.token) {
              await applyRecaptchaSolution(page, solution.token);
            }
            return jsonOk({
              step: "captcha_detected",
              captchaType: captchaResult.captchaType,
              captchaSolved: solution.success,
              captchaError: solution.error,
              message: solution.success
                ? "Captcha solved. Click submit to continue."
                : "Captcha could not be solved automatically. Manual intervention needed.",
              sessionId: input.sessionId,
            });
          }
        }

        // Submit the form
        await browser.clickSubmit(input.sessionId, template);

        // Check for 2FA challenge — auto-solve if TOTP secret is stored
        let twoFactorHandled = false;
        const totpSecret = fields.extra?.totp_secret;
        if (totpSecret) {
          twoFactorHandled = await browser.handle2FAChallenge(
            input.sessionId,
            template,
            totpSecret
          );
        }

        // Verify login
        const isLoggedIn = await browser.verifyLogin(input.sessionId, template);

        return jsonOk({
          success: true,
          loggedIn: isLoggedIn,
          sessionId: input.sessionId,
          service,
          currentUrl: page.url(),
          twoFactorHandled,
          message: isLoggedIn
            ? `Successfully logged into ${service}`
            : twoFactorHandled
              ? "2FA code submitted. Verifying login..."
              : `Form submitted but login could not be verified. Current URL: ${page.url()}`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === detect_captcha ===
  server.tool(
    "detect_captcha",
    "Check the current page for captcha challenges",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
    },
    async (input) => {
      try {
        const page = browser.getPage(input.sessionId);
        if (!page) {
          return jsonError(`Session ${input.sessionId} not found or not active`);
        }

        const result = await detectCaptcha(page);
        return jsonOk(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === solve_captcha ===
  server.tool(
    "solve_captcha",
    "Solve a detected captcha on the current page using configured captcha service",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
      apiKey: z.string().optional().describe("Override captcha API key (default: from config)"),
    },
    async (input) => {
      try {
        const page = browser.getPage(input.sessionId);
        if (!page) {
          return jsonError(`Session ${input.sessionId} not found or not active`);
        }

        const captchaResult = await detectCaptcha(page);
        if (!captchaResult.detected) {
          return jsonOk({ detected: false, message: "No captcha detected on this page" });
        }

        const solution = await solveCaptcha(captchaResult, input.apiKey);

        if (solution.success && solution.token) {
          await applyRecaptchaSolution(page, solution.token);
        }

        return jsonOk({
          detected: true,
          captchaType: captchaResult.captchaType,
          solved: solution.success,
          token: solution.token ? `${solution.token.substring(0, 20)}...` : undefined,
          error: solution.error,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === click_submit ===
  server.tool(
    "click_submit",
    "Click the submit button on the login form (useful after captcha solving)",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
      service: z.string().min(1).describe("Service identifier for the submit button selector"),
    },
    async (input) => {
      try {
        const template = getServiceTemplate(input.service);
        if (!template) {
          return jsonError(`Service template '${input.service}' not found`);
        }

        const page = browser.getPage(input.sessionId);
        if (!page) {
          return jsonError(`Session ${input.sessionId} not found or not active`);
        }

        await browser.clickSubmit(input.sessionId, template);
        const isLoggedIn = await browser.verifyLogin(input.sessionId, template);

        return jsonOk({
          success: true,
          loggedIn: isLoggedIn,
          sessionId: input.sessionId,
          currentUrl: page.url(),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === detect_2fa ===
  server.tool(
    "detect_2fa",
    "Check the current page for a 2FA code challenge",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
      service: z.string().optional().describe("Service identifier for template-specific selectors"),
    },
    async (input) => {
      try {
        const template = input.service ? getServiceTemplate(input.service) : undefined;
        const selector = await browser.detect2FAChallenge(input.sessionId, template);
        return jsonOk({
          detected: selector !== null,
          selector,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === solve_2fa ===
  server.tool(
    "solve_2fa",
    "Generate a TOTP code from the stored secret and fill it into the 2FA input field",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
      credentialId: z.string().min(1).describe("Credential ID (must have a totp_secret in extra fields)"),
      service: z.string().optional().describe("Service identifier for template selectors"),
    },
    async (input) => {
      try {
        const credResult = await vault.getCredentials(input.credentialId);
        if (!credResult) {
          return jsonError(`Credential not found: ${input.credentialId}`);
        }

        const totpSecret = credResult.fields.extra?.totp_secret;
        if (!totpSecret) {
          return jsonError(`No TOTP secret (totp_secret) stored in credential ${input.credentialId}`);
        }

        const page = browser.getPage(input.sessionId);
        if (!page) {
          return jsonError(`Session ${input.sessionId} not found or not active`);
        }

        const template = input.service ? getServiceTemplate(input.service) : undefined;
        const selector = await browser.detect2FAChallenge(input.sessionId, template);
        if (!selector) {
          return jsonOk({ detected: false, message: "No 2FA input field detected on this page" });
        }

        const code = await browser.fill2FACode(input.sessionId, totpSecret, selector);

        return jsonOk({
          success: true,
          detected: true,
          codeGenerated: true,
          code: `${code.slice(0, 3)}...${code.slice(-1)}`,
          selectorUsed: selector,
          message: "TOTP code generated and filled. Use click_submit to submit.",
          sessionId: input.sessionId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === check_session ===
  server.tool(
    "check_session",
    "Check if a browser session is still active and optionally verify login status",
    {
      sessionId: z.string().min(1).describe("Session ID from browser_launch"),
      verifyLogin: z.boolean().optional().default(false).describe("Check if still logged in (requires service template)"),
    },
    async (input) => {
      try {
        const session = browser.getSession(input.sessionId);
        if (!session) {
          return jsonOk({ active: false, message: "Session not found" });
        }

        if (!input.verifyLogin) {
          return jsonOk({
            active: session.isActive,
            sessionId: session.id,
            service: session.service,
            createdAt: session.createdAt,
          });
        }

        const page = browser.getPage(input.sessionId);
        if (!page) {
          return jsonOk({ active: false, message: "Session expired" });
        }

        try {
          const currentUrl = page.url();
          const template = getServiceTemplate(session.service);
          const loggedIn = template ? await browser.verifyLogin(input.sessionId, template) : false;

          return jsonOk({
            active: session.isActive,
            loggedIn,
            sessionId: session.id,
            service: session.service,
            currentUrl,
          });
        } catch {
          return jsonOk({ active: false, message: "Page unavailable" });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );
}
