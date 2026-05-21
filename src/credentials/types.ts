/**
 * Supported authentication service identifiers.
 * Extend this union type to add new services.
 */
export type ServiceId = "google" | "arena.ai" | string;

/**
 * Credential fields required for a service login.
 * Each service defines which fields it needs.
 */
export interface ServiceCredentialFields {
  username: string;
  password: string;
  /** Optional extra fields (e.g., "organization", "tenant_id", "totp_secret") */
  extra?: Record<string, string>;
}

/**
 * A stored credential entry in the vault.
 */
export interface CredentialEntry {
  /** Unique ID */
  id: string;
  /** Service identifier (e.g., "google", "arena.ai") */
  service: ServiceId;
  /** Human-readable label */
  label: string;
  /** Encrypted credential data */
  data: EncryptedData;
  /** When the entry was created */
  createdAt: string;
  /** When the entry was last updated */
  updatedAt: string;
  /** Metadata tags */
  tags?: string[];
}

/**
 * Encrypted payload structure (AES-256-GCM).
 */
export interface EncryptedData {
  /** AES-256-GCM ciphertext (hex) */
  ciphertext: string;
  /** Initialization vector (hex) */
  iv: string;
  /** Auth tag for tamper detection (hex) */
  authTag: string;
}

/**
 * Service login template describing how to log into a service.
 */
export interface LoginTemplate {
  /** Service identifier */
  id: ServiceId;
  /** Display name */
  label: string;
  /** Login page URL */
  loginUrl: string;
  /** CSS/attribute selector for the username field */
  usernameSelector: string;
  /** CSS/attribute selector for the password field */
  passwordSelector: string;
  /** CSS/attribute selector for the submit button */
  submitSelector: string;
  /** Optional: URL pattern to check for successful login */
  successUrlPattern?: string;
  /** Optional: CSS selector to check for successful login indicator */
  successSelector?: string;
  /** Optional: 2FA / TOTP code input field selector */
  twoFactorSelector?: string;
  /** Optional: 2FA submit button selector (defaults to submitSelector) */
  twoFactorSubmitSelector?: string;
  /** Optional: URL pattern indicating 2FA challenge page */
  twoFactorUrlPattern?: string;
  /** Optional: steps to execute before filling credentials */
  preLoginSteps?: LoginStep[];
  /** Optional: steps to execute after filling credentials */
  postLoginSteps?: LoginStep[];
  /** Optional: fields beyond username/password */
  extraFields?: ExtraFieldDef[];
}

export interface ExtraFieldDef {
  name: string;
  label: string;
  selector: string;
  type: "text" | "select" | "checkbox";
}

export interface LoginStep {
  type: "navigate" | "click" | "wait" | "type" | "select";
  /** Selector for click/wait/type actions */
  selector?: string;
  /** Value for type/select actions */
  value?: string;
  /** Wait duration in ms (for wait type) */
  timeout?: number;
  /** URL for navigate type */
  url?: string;
}

/**
 * Result of a captcha detection check.
 */
export interface CaptchaResult {
  /** Whether captcha was detected */
  detected: boolean;
  /** Type of captcha if detected */
  captchaType?: "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "image" | "text" | "unknown";
  /** Site key for reCAPTCHA/hCaptcha */
  siteKey?: string;
  /** Page URL where captcha was found */
  pageUrl?: string;
  /** Frame selector if captcha is inside an iframe */
  frameSelector?: string | null;
}

/**
 * Result of a captcha solving attempt.
 */
export interface CaptchaSolution {
  success: boolean;
  /** The solution token (for reCAPTCHA/hCaptcha) */
  token?: string;
  /** Text answer (for image/text captchas) */
  answer?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Browser session state
 */
export interface BrowserSession {
  /** Unique session ID */
  id: string;
  /** Service this session is for */
  service: ServiceId;
  /** When session was created */
  createdAt: string;
  /** Whether browser is still open */
  isActive: boolean;
}
