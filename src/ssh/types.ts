/**
 * Supported SSH key types for generation and storage.
 */
export type SSHKeyType =
  | "ed25519"
  | "rsa-2048"
  | "rsa-4096"
  | "ecdsa-256"
  | "ecdsa-384"
  | "ecdsa-521"
  | string;

/**
 * Fields stored inside the encrypted payload for an SSH key.
 */
export interface SSHKeyFields {
  /** Private key material (PEM or OpenSSH format) */
  privateKey: string;
  /** Optional passphrase protecting the private key */
  passphrase?: string;
  /** Public key in OpenSSH format ("ssh-ed25519 AAAA... comment") */
  publicKey?: string;
  /** Comment associated with the key (typically user@host) */
  comment?: string;
  /** Arbitrary extra metadata */
  extra?: Record<string, string>;
}

/**
 * Encrypted payload (AES-256-GCM) — same structure as credential vault.
 */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * A stored SSH key entry in the vault.
 */
export interface SSHKeyEntry {
  /** Unique ID */
  id: string;
  /** Human-readable label */
  label: string;
  /** SSH key algorithm */
  keyType: SSHKeyType;
  /** Key fingerprint (SHA256:) */
  fingerprint: string;
  /** Key size in bits (for RSA) */
  bits?: number;
  /** Host alias or hostname this key is used for (e.g. "github.com", "web01") */
  host: string;
  /** SSH port (default 22) */
  port: number;
  /** Remote username */
  username: string;
  /** Full hostname/IP (if host is just an alias) */
  hostname?: string;
  /** Public key in OpenSSH format (for quick copy/display without decryption) */
  publicKey?: string;
  /** Encrypted payload */
  data: EncryptedPayload;
  /** When created */
  createdAt: string;
  /** When last updated */
  updatedAt: string;
  /** Tags for organization */
  tags?: string[];
}

/**
 * Index file structure for the SSH vault.
 */
export interface SSHIndex {
  entries: SSHKeyEntry[];
}

/**
 * Parameters for generating a new SSH key pair.
 */
export interface SSHGenerateParams {
  label: string;
  keyType: "ed25519" | "rsa";
  host: string;
  port: number;
  username: string;
  rsaBits?: 2048 | 4096;
  passphrase?: string;
  comment?: string;
  tags?: string[];
}

/**
 * SSH config fragment for ~/.ssh/config
 */
export interface SSHConfigFragment {
  host: string;
  hostName?: string;
  user: string;
  port: number;
  identityFile: string;
  options?: Record<string, string>;
}
