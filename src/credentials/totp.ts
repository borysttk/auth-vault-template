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

function generateCodeForCounter(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
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
 * Generate a TOTP code from a base32-encoded secret.
 * Implements RFC 6238 / RFC 4226 (HMAC-based One-Time Password).
 */
export function generateTOTP(secretBase32: string): string {
  const time = Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / TOTP_STEP);
  return generateCodeForCounter(secretBase32, counter);
}

/**
 * Check if a string looks like a valid base32-encoded TOTP secret.
 */
export function isValidTOTPSecret(s: string): boolean {
  const clean = s.replace(/[\s=]/g, "");
  if (clean.length < 16) return false;
  return /^[A-Z2-7]+$/i.test(clean);
}

/**
 * Generate a new random TOTP secret (RFC 4226 compliant, 20 bytes → 32 base32 chars).
 */
export function generateTOTPSecret(): string {
  const raw = crypto.randomBytes(20);
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of raw) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += b32[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += b32[(buffer << (5 - bits)) & 0x1f];
  }
  return result;
}

/**
 * Check if the current TOTP window is near its end (≤5 seconds remaining).
 * Returns true if rotation is suggested (e.g. for presentation on login page).
 *
 * @param thresholdDays  Optional — if provided alongside lastRotatedDate,
 *                       returns true when lastRotated exceeds threshold.
 * @param lastRotatedDate  ISO date string of last rotation. When both
 *                         thresholdDays and lastRotatedDate are set, returns
 *                         a time-based rotation suggestion alongside the
 *                         window-based check.
 */
export function needsRotation(thresholdDays?: number, lastRotatedDate?: string): boolean {
  // Window-based: check if ≤5 seconds remain in current TOTP window
  const now = Math.floor(Date.now() / 1000);
  const inWindow = now % TOTP_STEP;
  const windowSuggestion = inWindow >= (TOTP_STEP - 5);

  // Time-based: if both threshold and lastRotated supplied, check age
  if (thresholdDays && lastRotatedDate) {
    const lastRotated = new Date(lastRotatedDate).getTime();
    if (isNaN(lastRotated)) return windowSuggestion;
    const ageDays = (Date.now() - lastRotated) / (1000 * 60 * 60 * 24);
    return windowSuggestion || ageDays >= thresholdDays;
  }

  return windowSuggestion;
}

/**
 * If the TOTP code is very close to expiry, also return a "rolling" suggested code
 * for the next window so users can prepare.
 */
export function nextTOTPCode(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / TOTP_STEP) + 1;
  return generateCodeForCounter(secret, counter);
}
