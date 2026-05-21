import crypto from "node:crypto";

const TOTP_STEP = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "sha1";

const BASE32_LOOKUP: Record<string, number> = {};
"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".split("").forEach((ch, i) => {
  BASE32_LOOKUP[ch] = i;
  BASE32_LOOKUP[ch.toLowerCase()] = i;
});

function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/[\s=]/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const ch of clean) {
    const val = BASE32_LOOKUP[ch];
    if (val === undefined) {
      throw new Error(`Invalid base32 character: ${ch}`);
    }
    buffer = (buffer << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function truncate(hs: Buffer): number {
  const offset = hs[hs.length - 1] & 0xf;
  const p =
    ((hs[offset] & 0x7f) << 24) |
    ((hs[offset + 1] & 0xff) << 16) |
    ((hs[offset + 2] & 0xff) << 8) |
    (hs[offset + 3] & 0xff);
  return p % 10 ** TOTP_DIGITS;
}

/**
 * Generate a TOTP code from a base32-encoded secret.
 * Implements RFC 6238 / RFC 4226 (HMAC-based One-Time Password).
 */
export function generateTOTP(secretBase32: string): string {
  const key = base32Decode(secretBase32);
  const time = Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / TOTP_STEP);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(0, 0);
  counterBuf.writeUInt32BE(counter, 4);

  const hmac = crypto.createHmac(TOTP_ALGORITHM, key);
  hmac.update(counterBuf);
  const hs = hmac.digest();

  const code = truncate(hs);
  return String(code).padStart(TOTP_DIGITS, "0");
}

/**
 * Check if a string looks like a valid base32-encoded TOTP secret.
 */
export function isValidTOTPSecret(s: string): boolean {
  const clean = s.replace(/[\s=]/g, "");
  if (clean.length < 16) return false;
  return /^[A-Z2-7]+$/i.test(clean);
}
