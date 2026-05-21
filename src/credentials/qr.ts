import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import qrcode from "qrcode";
import { getConfig } from "../config.js";

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Generate a cryptographically random base32 TOTP secret (20 bytes = 32 chars).
 */
export function generateTOTPSecret(): string {
  const bytes = crypto.randomBytes(20);
  let secret = "";
  for (const b of bytes) {
    secret += BASE32_CHARS[b & 31];
  }
  return secret;
}

/**
 * Build an otpauth://totp/ URI for Google Authenticator & compatible apps.
 */
export function buildOTPAuthURL(
  secret: string,
  account: string,
  issuer: string
): string {
  const encodedAccount = encodeURIComponent(account);
  const encodedIssuer = encodeURIComponent(issuer);
  return (
    `otpauth://totp/${encodedIssuer}:${encodedAccount}` +
    `?secret=${secret.replace(/\s/g, "")}` +
    `&issuer=${encodedIssuer}` +
    `&algorithm=SHA1` +
    `&digits=6` +
    `&period=30`
  );
}

/**
 * Render a QR code as an ASCII string for terminal display.
 */
export async function renderQRCode(text: string): Promise<string> {
  return qrcode.toString(text, { type: "terminal", small: true });
}

/**
 * Save a QR code as a PNG file. Returns the absolute path.
 */
export async function saveQRPNG(
  text: string,
  fileName: string
): Promise<string> {
  const vaultRoot = getConfig().VAULT_ROOT;
  const qrDir = path.join(vaultRoot, "qr-codes");
  await fs.mkdir(qrDir, { recursive: true });

  const filePath = path.join(qrDir, fileName);
  await qrcode.toFile(filePath, text, {
    type: "png",
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });

  return filePath;
}

/**
 * Default file name for a credential's QR code.
 */
export function qrFileName(service: string, label: string): string {
  const safe = `${service}_${label}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}_totp.png`;
}
