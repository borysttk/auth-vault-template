import crypto from "node:crypto";
import os from "node:os";

/**
 * Generate a deterministic device fingerprint for trusted device detection.
 *
 * Combines: userAgent, OS platform/release, hostname, and an optional
 * SSH public key fragment into a single SHA256 hash.
 *
 * The fingerprint is NOT a unique device ID — it's a context-dependent
 * identifier that helps recognize previously-used devices during login.
 */
export function generateDeviceFingerprint(options?: {
  userAgent?: string;
  sshPubFragment?: string;
}): string {
  const parts: string[] = [
    os.platform(),
    os.release(),
    os.hostname(),
    options?.userAgent || "",
    options?.sshPubFragment || "",
  ];

  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return `DEV:${hash.digest("hex").substring(0, 32)}`;
}

/**
 * Build a TrustedDevice entry from current machine context.
 */
export function buildTrustedDevice(options?: {
  userAgent?: string;
  sshPubFragment?: string;
}): {
  fingerprint: string;
  os: string;
  hostname: string;
  addedAt: string;
  lastUsedAt: string;
  userAgentHash?: string;
} {
  const fingerprint = generateDeviceFingerprint(options);
  const now = new Date().toISOString();

  let userAgentHash: string | undefined;
  if (options?.userAgent) {
    userAgentHash = crypto
      .createHash("sha256")
      .update(options.userAgent)
      .digest("hex")
      .substring(0, 16);
  }

  return {
    fingerprint,
    os: `${os.platform()} ${os.release()}`,
    hostname: os.hostname(),
    addedAt: now,
    lastUsedAt: now,
    userAgentHash,
  };
}

/**
 * Check if a device fingerprint is in the trusted devices list.
 */
export function isDeviceTrusted(
  fingerprint: string,
  trustedDevices: Array<{ fingerprint: string }>
): boolean {
  return trustedDevices.some((d) => d.fingerprint === fingerprint);
}
