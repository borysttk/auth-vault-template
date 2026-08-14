import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

/**
 * Password generation module.
 * Uses OpenSSL (`openssl rand`) as primary entropy source when available,
 * with Node's crypto as automatic fallback.
 */

export interface PasswordOptions {
  length: number;
  lowercase?: boolean;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeSimilar?: boolean;
  method?: "openssl" | "node" | "auto";
}

export interface GeneratedPassword {
  password: string;
  method: string;
  entropyBits: number;
  strength: string;
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?/";
const SIMILAR = "il1Lo0O";

/** Small embedded diceware-style wordlist (EN/PL mix). */
const WORDLIST = [
  "kot", "las", "dom", "szak", "fala", "gora", "ocean", "niebo", "most", "skala",
  "river", "storm", "cloud", "stone", "fire", "wind", "moon", "star", "leaf", "root",
  "zamek", "klucz", "swiat", "czas", "droga", "sen", "ogien", "lod", "sol", "wiatr",
  "tower", "bridge", "light", "shadow", "wolf", "hawk", "bear", "fox", "owl", "deer",
  "prawo", "kod", "bit", "siec", "atom", "prad", "fala", "echo", "szum", "ton",
  "metal", "szklo", "piasek", "krzem", "helix", "neon", "kwas", "sol", "opon", "zar",
];

export function buildAlphabet(opts: PasswordOptions): string {
  let a = "";
  if (opts.lowercase !== false) a += LOWER;
  if (opts.uppercase !== false) a += UPPER;
  if (opts.digits !== false) a += DIGITS;
  if (opts.symbols) a += SYMBOLS;
  if (opts.excludeSimilar) {
    for (const c of SIMILAR) a = a.split(c).join("");
  }
  if (!a) a = LOWER + UPPER + DIGITS;
  return a;
}

/** Get N cryptographically random bytes via OpenSSL, fallback to Node. */
function randomBytesOpenSSL(n: number): Buffer {
  try {
    const r = spawnSync("openssl", ["rand", String(n)], { encoding: "buffer", timeout: 2000 });
    if (r.status === 0 && r.stdout && r.stdout.length >= n) {
      return r.stdout.subarray(0, n);
    }
  } catch {
    /* fall through */
  }
  return crypto.randomBytes(n);
}

function strengthLabel(entropyBits: number): string {
  if (entropyBits >= 80) return "BARDZO SILNE";
  if (entropyBits >= 60) return "SILNE";
  if (entropyBits >= 40) return "SREDNIE";
  if (entropyBits >= 25) return "SLABE";
  return "BARDZO SLABE";
}

/** Guarantee at least one char from each selected class appears. */
function ensureClasses(pw: string, _alphabet: string, opts: PasswordOptions): string {
  const need: string[] = [];
  if (opts.lowercase !== false && !/[a-z]/.test(pw)) need.push(LOWER);
  if (opts.uppercase !== false && !/[A-Z]/.test(pw)) need.push(UPPER);
  if (opts.digits !== false && !/[0-9]/.test(pw)) need.push(DIGITS);
  if (opts.symbols && !/[!@#$%^&*()\-_=+\[\]{};:,.<>?\/]/.test(pw)) need.push(SYMBOLS);
  if (need.length === 0) return pw;

  const chars = pw.split("");
  for (let i = 0; i < need.length; i++) {
    const pool = need[i];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    chars[i % chars.length] = pick;
  }
  return chars.join("");
}

export function generatePassword(opts: PasswordOptions): GeneratedPassword {
  const length = Math.max(4, Math.min(opts.length || 16, 128));
  const alphabet = buildAlphabet(opts);
  const size = alphabet.length;
  const useOpenSSL = (opts.method || "auto") !== "node";
  let bytes: Buffer;
  let method = "node:crypto";
  if (useOpenSSL) {
    bytes = randomBytesOpenSSL(length);
    method = "openssl rand";
  } else {
    bytes = crypto.randomBytes(length);
  }
  let pw = "";
  for (let i = 0; i < length; i++) {
    pw += alphabet[bytes[i] % size];
  }
  pw = ensureClasses(pw, alphabet, opts);
  const entropyBits = Math.round(length * Math.log2(size));
  return { password: pw, method, entropyBits, strength: strengthLabel(entropyBits) };
}

export function generatePassphrase(
  words = 4,
  separator = "-",
  useOpenSSL = true
): GeneratedPassword {
  const n = Math.max(2, Math.min(words, 12));
  const bytes = useOpenSSL ? randomBytesOpenSSL(n * 2) : crypto.randomBytes(n * 2);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = (bytes[i * 2] + bytes[i * 2 + 1] * 256) % WORDLIST.length;
    parts.push(WORDLIST[idx]);
  }
  const pw = parts.join(separator);
  const entropyBits = Math.round(n * Math.log2(WORDLIST.length));
  return { password: pw, method: "openssl+diceware", entropyBits, strength: strengthLabel(entropyBits) };
}
