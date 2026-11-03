/**
 * Supported secret types.
 */
export type SecretKind =
  | "api_key"        // API key (string token used in headers)
  | "bearer_token"   // OAuth / JWT bearer token
  | "access_token"   // Generic access token
  | "refresh_token"  // OAuth refresh token
  | "private_key"    // PEM or raw private key
  | "generic";       // Anything else

/**
 * Fields stored inside the encrypted payload for a secret.
 */
export interface SecretFields {
  /** The actual secret value (token, key, etc.) */
  value: string;
  /** Optional metadata about this secret */
  description?: string;
  /** Optional: expiry date ISO string */
  expiresAt?: string;
  /** Optional: permissions/scopes associated with this token */
  scopes?: string[];
  /** Optional: arbitrary extra fields */
  extra?: Record<string, string>;
}

/**
 * A stored secret entry in the vault.
 */
export interface SecretEntry {
  /** Unique ID */
  id: string;
  /** Human-readable label */
  label: string;
  /** Type of secret */
  kind: SecretKind;
  /** Service or system this secret is for (e.g. "openai", "github", "stripe") */
  service: string;
  /** Encrypted payload */
  data: EncryptedPayload;
  /** When created */
  createdAt: string;
  /** When last updated */
  updatedAt: string;
  /** Tags for organization */
  tags?: string[];
  /**
   * Operational status, same vocabulary as credentials:
   * "active" (default) | "disabled" | "degraded" | "expired" | "testing".
   * Anything other than "active" means "do not use without asking first".
   */
  status?: SecretStatus;
  /**
   * Free-form operator note — anything a future session cannot infer from
   * the secret itself: which account it belongs to, docs URL, "revoked",
   * "needs re-login", "superseded by ...".
   */
  notes?: string;
  /** When `status` last flipped, so "off since when?" is answerable. */
  statusChangedAt?: string;
}

/** Lifecycle state of a secret. Mirrors CredentialStatus. */
export type SecretStatus =
  | "active"
  | "disabled"
  | "degraded"
  | "expired"
  | "testing";

/**
 * Encrypted payload (AES-256-GCM) — same structure as credential vault.
 */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}
