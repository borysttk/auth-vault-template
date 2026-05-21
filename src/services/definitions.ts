import { LoginTemplate } from "../credentials/types.js";

const serviceRegistry = new Map<string, LoginTemplate>();

function register(template: LoginTemplate): void {
  serviceRegistry.set(template.id, template);
}

// === Google Login ===
register({
  id: "google",
  label: "Google",
  loginUrl: "https://accounts.google.com/",
  usernameSelector: 'input[type="email"], input[name="identifier"]',
  passwordSelector: 'input[type="password"], input[name="Passwd"]',
  submitSelector: '#identifierNext, #passwordNext, button[type="submit"]',
  twoFactorSelector: 'input[type="tel"], input[autocomplete="one-time-code"], input[name="code"]',
  twoFactorUrlPattern: "/signin/challenge/",
  successUrlPattern: "myaccount.google.com",
  successSelector: 'a[href*="myaccount"], [data-app-name]',
  preLoginSteps: [
    {
      type: "wait",
      timeout: 2000,
    },
  ],
  postLoginSteps: [
    {
      type: "wait",
      timeout: 1000,
    },
  ],
});

// === Arena.ai Login ===
register({
  id: "arena.ai",
  label: "Arena.ai",
  loginUrl: "https://arena.ai/login",
  usernameSelector: 'input[name="email"], input[type="email"]',
  passwordSelector: 'input[name="password"], input[type="password"]',
  submitSelector: 'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
  successSelector: '[data-testid="dashboard"], .dashboard, [class*="dashboard"]',
  preLoginSteps: [
    {
      type: "wait",
      timeout: 2000,
    },
  ],
  postLoginSteps: [
    {
      type: "wait",
      timeout: 1000,
    },
  ],
});

// === GitHub Login ===
register({
  id: "github",
  label: "GitHub",
  loginUrl: "https://github.com/login",
  usernameSelector: 'input[name="login"]',
  passwordSelector: 'input[name="password"]',
  submitSelector: 'input[type="submit"][value="Sign in"]',
  successUrlPattern: "github.com",
  successSelector: 'meta[name="user-login"], .avatar-user',
  preLoginSteps: [
    {
      type: "wait",
      timeout: 1000,
    },
  ],
});

// === Generic/User-defined ===
// Allows registering custom services at runtime via the add_service tool

export function getServiceTemplate(id: string): LoginTemplate | undefined {
  return serviceRegistry.get(id);
}

export function listServiceTemplates(): LoginTemplate[] {
  return Array.from(serviceRegistry.values());
}

export function registerCustomService(template: LoginTemplate): void {
  register(template);
}

export function removeServiceTemplate(id: string): boolean {
  return serviceRegistry.delete(id);
}
