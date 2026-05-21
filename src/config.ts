import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";

// Load .env from project directory
dotenv.config({ override: false });

const configSchema = z.object({
  // === Vault storage ===
  VAULT_ROOT: z.string().default("./vault"),

  // Encryption key AES-256 (64 hex chars = 32 bytes)
  VAULT_ENCRYPTION_KEY: z
    .string()
    .length(64, "Encryption key must be exactly 64 hex characters (32 bytes)")
    .regex(/^[0-9a-f]{64}$/i, "Encryption key must be a valid hex string")
    .optional(),

  // === Captcha solving ===
  CAPTCHA_API_KEY: z.string().optional(),
  CAPTCHA_SERVICE: z.enum(["2captcha", "capmonster", "none"]).default("2captcha"),

  // === Browser ===
  BROWSER_HEADLESS: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  BROWSER_VIEWPORT_WIDTH: z
    .string()
    .default("1280")
    .transform(Number)
    .pipe(z.number().int().positive().max(3840)),
  BROWSER_VIEWPORT_HEIGHT: z
    .string()
    .default("720")
    .transform(Number)
    .pipe(z.number().int().positive().max(2160)),
  BROWSER_TIMEOUT: z
    .string()
    .default("30000")
    .transform(Number)
    .pipe(z.number().int().positive()),

  // === SSE Server ===
  AUTH_SSE_PORT: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().positive().max(65535).optional()),
  AUTH_BIND_ADDRESS: z.string().optional(),

  // === Logging ===
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error("[CONFIG] Invalid configuration:\n" + errors);
    process.exit(1);
  }

  _config = parsed.data;

  // Normalize paths
  _config.VAULT_ROOT = path.resolve(_config.VAULT_ROOT);

  // Generate encryption key if not provided
  if (!_config.VAULT_ENCRYPTION_KEY) {
    const generated = crypto.randomBytes(32).toString("hex");
    _config.VAULT_ENCRYPTION_KEY = generated;
    console.warn(
      "[CONFIG] No VAULT_ENCRYPTION_KEY set. Generated temporary key.\n" +
        `  Add to .env for persistence: VAULT_ENCRYPTION_KEY=${generated}`
    );
  }

  return _config;
}
