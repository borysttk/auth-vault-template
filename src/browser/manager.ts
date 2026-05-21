import crypto from "crypto";
import { Browser, BrowserContext, chromium, Page } from "playwright";
import { getConfig } from "../config.js";
import { BrowserSession, LoginTemplate, LoginStep } from "../credentials/types.js";

interface SessionEntry {
  session: BrowserSession;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const sessions = new Map<string, SessionEntry>();

function generateSessionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function getTimeout(): number {
  return getConfig().BROWSER_TIMEOUT;
}

const REAL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function getStealthViewport() {
  return { width: 1280, height: 720, deviceScaleFactor: 1 };
}

function getBrowserArgs(): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=ChromeWhatsNewUI,ChromeLabs",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--window-size=1280,720",
    "--disable-sync",
  ];
}

async function findRealChrome(): Promise<string | null> {
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]) {
    try {
      const { execFileSync } = await import("child_process");
      const out = execFileSync("which", [bin], { encoding: "utf8" });
      const p = out.trim();
      if (p) return p;
    } catch {
      continue;
    }
  }
  return null;
}

export async function launchBrowser(
  service: string,
  headless?: boolean
): Promise<BrowserSession> {
  const cfg = getConfig();
  const isHeadless = headless !== undefined ? headless : cfg.BROWSER_HEADLESS;

  const sessionId = generateSessionId();
  const realChrome = await findRealChrome();
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: isHeadless,
    args: getBrowserArgs(),
  };
  if (realChrome) {
    launchOptions.executablePath = realChrome;
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: getStealthViewport(),
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: REAL_USER_AGENT,
    bypassCSP: true,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(getTimeout());

  const session: BrowserSession = {
    id: sessionId,
    service,
    createdAt: new Date().toISOString(),
    isActive: true,
  };

  sessions.set(sessionId, { session, browser, context, page });

  return session;
}

export async function closeBrowser(sessionId: string): Promise<boolean> {
  const entry = sessions.get(sessionId);
  if (!entry) return false;

  try {
    await entry.browser.close();
  } catch {
    // browser may already be closed
  }
  entry.session.isActive = false;
  sessions.delete(sessionId);
  return true;
}

export function getPage(sessionId: string): Page | null {
  const entry = sessions.get(sessionId);
  return entry?.page ?? null;
}

export function getSession(sessionId: string): BrowserSession | null {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  return entry.session;
}

export function listSessions(): BrowserSession[] {
  return Array.from(sessions.values()).map((e) => e.session);
}

export async function closeAllSessions(): Promise<void> {
  for (const [id] of sessions) {
    await closeBrowser(id);
  }
}

export async function navigateTo(
  sessionId: string,
  url: string
): Promise<void> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  await page.goto(url, { waitUntil: "networkidle", timeout: getTimeout() });
}

export async function executeLoginSteps(
  sessionId: string,
  steps: LoginStep[]
): Promise<void> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  for (const step of steps) {
    switch (step.type) {
      case "navigate":
        if (!step.url) throw new Error("navigate step requires url");
        await page.goto(step.url, { waitUntil: "networkidle", timeout: getTimeout() });
        break;
      case "click":
        if (!step.selector) throw new Error("click step requires selector");
        await page.click(step.selector);
        break;
      case "wait":
        if (step.timeout) {
          await page.waitForTimeout(step.timeout);
        } else {
          await page.waitForTimeout(1000);
        }
        break;
      case "type":
        if (!step.selector || step.value === undefined) {
          throw new Error("type step requires selector and value");
        }
        await page.fill(step.selector, step.value);
        break;
      case "select":
        if (!step.selector || step.value === undefined) {
          throw new Error("select step requires selector and value");
        }
        await page.selectOption(step.selector, step.value);
        break;
    }
  }
}

export async function fillLoginForm(
  sessionId: string,
  template: LoginTemplate,
  username: string,
  password: string,
  extraValues?: Record<string, string>
): Promise<void> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  if (template.preLoginSteps) {
    await executeLoginSteps(sessionId, template.preLoginSteps);
  }

  // Fill username / email
  await page.fill(template.usernameSelector, username);

  // Handle multi-step logins (e.g. Google: email → submit → password → submit)
  const pwLocator = page.locator(template.passwordSelector);
  const pwVisible = await pwLocator.isVisible().catch(() => false);

  if (pwVisible) {
    await page.fill(template.passwordSelector, password);
  } else {
    await page.click(template.submitSelector);
    await page.waitForTimeout(2000);
    await page.waitForSelector(template.passwordSelector, { state: "visible", timeout: 15000 });
    await page.fill(template.passwordSelector, password);
  }

  if (extraValues && template.extraFields) {
    for (const field of template.extraFields) {
      const value = extraValues[field.name];
      if (value) {
        if (field.type === "select") {
          await page.selectOption(field.selector, value);
        } else {
          await page.fill(field.selector, value);
        }
      }
    }
  }

  if (template.postLoginSteps) {
    await executeLoginSteps(sessionId, template.postLoginSteps);
  }
}

export async function clickSubmit(
  sessionId: string,
  template: LoginTemplate
): Promise<void> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  await page.click(template.submitSelector);
  await page.waitForLoadState("networkidle");
}

export async function verifyLogin(
  sessionId: string,
  template: LoginTemplate
): Promise<boolean> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  // Check success URL pattern
  if (template.successUrlPattern) {
    const currentUrl = page.url();
    if (currentUrl.includes(template.successUrlPattern)) {
      return true;
    }
  }

  // Check success selector
  if (template.successSelector) {
    try {
      await page.waitForSelector(template.successSelector, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // Default: check if URL changed from login page
  return !page.url().includes(template.loginUrl);
}

// ── 2FA / TOTP support ──────────────────────────────────────────────────────

/**
 * Common 2FA code input selectors used across different services.
 * Tried in order until one matches.
 */
const COMMON_2FA_SELECTORS = [
  'input[type="tel"]',
  'input[autocomplete="one-time-code"]',
  'input[name="code"]',
  'input#totpCode',
  'input[name="totp"]',
  'input[name="totpPin"]',
  '#totpPin',
  'input[inputmode="numeric"]',
  'input[id*="totp"]',
  'input[id*="2fa"]',
  'input[id*="mfa"]',
];

/**
 * Detect whether the current page shows a 2FA code challenge.
 * Returns the matched selector or null.
 */
export async function detect2FAChallenge(
  sessionId: string,
  template?: LoginTemplate
): Promise<string | null> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  await page.waitForTimeout(1500);

  if (template?.twoFactorSelector) {
    const visible = await page
      .locator(template.twoFactorSelector)
      .isVisible()
      .catch(() => false);
    if (visible) return template.twoFactorSelector;
  }

  if (template?.twoFactorUrlPattern) {
    const url = page.url();
    if (url.includes(template.twoFactorUrlPattern)) {
      for (const sel of COMMON_2FA_SELECTORS) {
        const visible = await page.locator(sel).isVisible().catch(() => false);
        if (visible) return sel;
      }
    }
  }

  for (const sel of COMMON_2FA_SELECTORS) {
    const visible = await page.locator(sel).isVisible().catch(() => false);
    if (visible) return sel;
  }

  return null;
}

/**
 * Generate a TOTP code from a stored secret and fill it into the 2FA input.
 * Returns the generated code on success, or null if no 2FA field is found.
 */
export async function fill2FACode(
  sessionId: string,
  totpSecret: string,
  selector: string
): Promise<string> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  const { generateTOTP } = await import("../credentials/totp.js");
  const code = generateTOTP(totpSecret);

  await page.fill(selector, code);
  await page.waitForTimeout(500);

  return code;
}

/**
 * Handle a 2FA challenge: detect it, generate TOTP, fill, and submit.
 * Returns true if 2FA was handled, false if no challenge was detected.
 */
export async function handle2FAChallenge(
  sessionId: string,
  template: LoginTemplate,
  totpSecret: string
): Promise<boolean> {
  const page = getPage(sessionId);
  if (!page) throw new Error(`Session ${sessionId} not found or not active`);

  await page.waitForTimeout(2000);

  // Google-specific multi-step 2FA: device prompt → "Try another way" → Authenticator
  if (template.id === "google") {
    return await handleGoogle2FA(page, sessionId, template, totpSecret);
  }

  // Generic 2FA: detect input, fill TOTP, submit
  const selector = await detect2FAChallenge(sessionId, template);
  if (!selector) return false;

  await fill2FACode(sessionId, totpSecret, selector);
  await page.waitForTimeout(300);

  const submitSel = template.twoFactorSubmitSelector || template.submitSelector;
  await page.click(submitSel);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  return true;
}

/**
 * Google-specific 2FA challenge handler.
 * Flow: challenge page → Try another way → pick Authenticator → fill TOTP
 */
async function handleGoogle2FA(
  page: Page,
  sessionId: string,
  template: LoginTemplate,
  totpSecret: string
): Promise<boolean> {
  const url = page.url();

  if (!url.includes("/signin/challenge/")) return false;

  // Step 1: Click "Try another way" to expand options
  const tryAnother = page.locator(
    'button:has-text("Try another way"), [role=button]:has-text("Try another way"), div:has-text("Try another way")'
  ).first();
  const tryVisible = await tryAnother.isVisible().catch(() => false);
  if (tryVisible) {
    await tryAnother.click();
    await page.waitForTimeout(3000);
  }

  // Step 2: Select "Google Authenticator" option
  const authClicked = await page.evaluate(() => {
    const candidates = document.querySelectorAll('[role="link"], li, div');
    for (const el of candidates) {
      const t = el.textContent?.trim() || "";
      if (t.includes("Google Authenticator") && t.includes("verification code")) {
        if (el.getAttribute("role") === "link") {
          (el as HTMLElement).click();
          return true;
        }
      }
    }
    // Fallback: try clicking the parent LI
    for (const el of candidates) {
      const t = el.textContent?.trim() || "";
      if (t.includes("Google Authenticator") && t.includes("verification code") && t.length < 100) {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (authClicked) {
    await page.waitForTimeout(3000);
  } else {
    return false;
  }

  // Step 3: Wait for and fill the TOTP input
  const { generateTOTP } = await import("../credentials/totp.js");

  for (const sel of COMMON_2FA_SELECTORS) {
    const visible = await page.locator(sel).isVisible().catch(() => false);
    if (visible) {
      const code = generateTOTP(totpSecret);
      await page.fill(sel, code);
      await page.waitForTimeout(500);

      // Submit (Google's TOTP page has "Next" button)
      const nextBtn = page.locator(
        'button:has-text("Next"), [role=button]:has-text("Next"), #totpNext'
      ).first();
      const nextVisible = await nextBtn.isVisible().catch(() => false);
      if (nextVisible) {
        await nextBtn.click();
      } else {
        try {
          await page.press(sel, "Enter");
        } catch {
          // empty
        }
      }
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);
      return true;
    }
  }

  return false;
}
