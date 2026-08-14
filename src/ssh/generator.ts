import crypto from "node:crypto";
import { SSHKeyType } from "./types.js";

export interface GeneratedKeyPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

/**
 * Convert a raw SPKI DER public key to OpenSSH base64 format.
 *
 * For Ed25519: the SPKI structure contains OID + raw 32-byte key.
 * We extract the key bytes and prepend the algorithm identifier.
 */
function rawPublicKeyToOpenSSH(
  publicKey: crypto.KeyObject,
  algorithm: "ssh-ed25519" | "ssh-rsa" | "ecdsa-sha2-nistp256",
  comment: string
): string {
  const derBuf = publicKey.export({ type: "spki", format: "der" });
  let wireKey: Buffer;

  if (algorithm === "ssh-ed25519") {
    // Ed25519 SPKI: SEQUENCE { SEQUENCE { OID(ed25519) }, BIT STRING (raw 32B) }
    // Skip past the ASN.1 wrapper to get raw key bytes (last 32 bytes)
    const rawKey = derBuf.subarray(derBuf.length - 32);
    wireKey = encodeWireKey(rawKey, "ssh-ed25519");
  } else if (algorithm === "ssh-rsa") {
    // RSA SPKI: SEQUENCE { SEQUENCE { OID(rsaEncryption) NULL }, BIT STRING (RSAPublicKey) }
    // RSA public key is DER-encoded RSAPublicKey { n, e }
    const rsaPub = crypto.createPublicKey({ key: derBuf, format: "der", type: "spki" });
    const rsaDer = rsaPub.export({ type: "pkcs1", format: "der" });
    const parsed = parseRSAPublicKey(rsaDer);
    wireKey = encodeWireKeyRSA(parsed.e, parsed.n);
  } else {
    // ECDSA — for completeness, though we primarily support ed25519/rsa
    const rawKey = derBuf.subarray(derBuf.length - 64);
    wireKey = encodeWireKey(rawKey, algorithm);
  }

  const b64 = wireKey.toString("base64");
  return `${algorithm} ${b64} ${comment}`;
}

/**
 * Encode a raw key with algorithm prefix into SSH wire format:
 *   [4B length][algorithm string][4B length][raw key bytes]
 */
function encodeWireKey(rawKey: Buffer, algorithm: string): Buffer {
  const algoBuf = Buffer.from(algorithm, "utf8");
  const parts = [
    encodeLength(algoBuf.length),
    algoBuf,
    encodeLength(rawKey.length),
    rawKey,
  ];
  return Buffer.concat(parts);
}

/**
 * Encode RSA public exponent and modulus into SSH wire format:
 *   [4B len][algorithm][4B len][e][4B len][n]
 */
function encodeWireKeyRSA(e: Buffer, n: Buffer): Buffer {
  const algo = "ssh-rsa";
  const algoBuf = Buffer.from(algo, "utf8");
  const parts = [
    encodeLength(algoBuf.length),
    algoBuf,
    encodeLength(e.length),
    e,
    encodeLength(n.length),
    n,
  ];
  return Buffer.concat(parts);
}

function encodeLength(len: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(len);
  return buf;
}

function parseRSAPublicKey(der: Buffer): { e: Buffer; n: Buffer } {
  // PKCS#1 RSAPublicKey ::= SEQUENCE { n INTEGER, e INTEGER }
  // Simplified: find the two integers after the SEQUENCE tag+length
  let pos = 0;
  // Skip SEQUENCE tag (0x30) and length (could be multi-byte)
  if (der[pos] !== 0x30) throw new Error("Invalid RSA PKCS#1 DER");
  pos++;
  if (der[pos] & 0x80) {
    const lenBytes = der[pos] & 0x7f;
    pos += lenBytes + 1;
  } else {
    pos++;
  }

  // Read n (INTEGER 0x02)
  if (der[pos] !== 0x02) throw new Error("Expected INTEGER for n");
  pos++;
  let nLen = der[pos];
  pos++;
  if (nLen & 0x80) {
    const nLenBytes = nLen & 0x7f;
    nLen = parseInt(der.subarray(pos, pos + nLenBytes).toString("hex"), 16);
    pos += nLenBytes;
  }
  // Strip leading 0x00 if present
  let n = der.subarray(pos, pos + nLen);
  if (n[0] === 0x00) n = n.subarray(1);
  pos += nLen;

  // Read e (INTEGER 0x02)
  if (der[pos] !== 0x02) throw new Error("Expected INTEGER for e");
  pos++;
  let eLen = der[pos];
  pos++;
  if (eLen & 0x80) {
    const eLenBytes = eLen & 0x7f;
    eLen = parseInt(der.subarray(pos, pos + eLenBytes).toString("hex"), 16);
    pos += eLenBytes;
  }
  const e = der.subarray(pos, pos + eLen);

  return { e, n };
}

/**
 * Compute SHA256 fingerprint from an OpenSSH public key line.
 */
function computeFingerprint(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error("Invalid public key format");
  }
  const keyBytes = Buffer.from(parts[1], "base64");
  const hash = crypto.createHash("sha256").update(keyBytes).digest("base64");
  return `SHA256:${hash}`;
}

/**
 * Generate a new SSH key pair.
 *
 * Supports ed25519 and rsa (2048/4096) key types.
 * Returns OpenSSH-formatted public key and PEM private key.
 */
export async function generateSSHKeyPair(
  type: "ed25519" | "rsa",
  options?: {
    rsaBits?: 2048 | 4096;
    passphrase?: string;
    comment?: string;
  }
): Promise<GeneratedKeyPair> {
  const passphrase = options?.passphrase;
  const comment = options?.comment || "";

  let publicKeyPEM: string;
  let privateKeyPEM: string;
  let sshAlgorithm: "ssh-ed25519" | "ssh-rsa" | "ecdsa-sha2-nistp256";

  if (type === "ed25519") {
    sshAlgorithm = "ssh-ed25519";
    const keyPair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
        cipher: passphrase ? "aes-256-cbc" : undefined,
        passphrase: passphrase || undefined,
      },
    });
    publicKeyPEM = keyPair.publicKey;
    privateKeyPEM = keyPair.privateKey;
  } else {
    // RSA
    const bits = options?.rsaBits || 4096;
    sshAlgorithm = "ssh-rsa";
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: bits,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
        cipher: passphrase ? "aes-256-cbc" : undefined,
        passphrase: passphrase || undefined,
      },
    });
    publicKeyPEM = keyPair.publicKey;
    privateKeyPEM = keyPair.privateKey;
  }

  // Convert PEM public key to OpenSSH format
  const pubKeyObject = crypto.createPublicKey(publicKeyPEM);
  const opensshPublic = rawPublicKeyToOpenSSH(pubKeyObject, sshAlgorithm, comment);
  const fingerprint = computeFingerprint(opensshPublic);

  return {
    publicKey: opensshPublic,
    privateKey: privateKeyPEM,
    fingerprint,
  };
}

/**
 * Parse an OpenSSH private key file to extract the public key.
 * Returns OpenSSH-format public key and fingerprint, or null if parsing fails.
 */
export function extractPublicKey(privateKey: string, passphrase?: string): { publicKey: string; fingerprint: string } | null {
  try {
    const keyObject = crypto.createPrivateKey({
      key: privateKey,
      format: "pem",
      passphrase: passphrase || undefined,
    });
    const pubKeyObject = crypto.createPublicKey(keyObject);
    const pubPem = pubKeyObject.export({ type: "spki", format: "pem" });

    // Determine algorithm from key type
    const keyType = keyObject.asymmetricKeyType;
    let algorithm: "ssh-ed25519" | "ssh-rsa" | "ecdsa-sha2-nistp256";
    if (keyType === "ed25519") {
      algorithm = "ssh-ed25519";
    } else if (keyType === "rsa") {
      algorithm = "ssh-rsa";
    } else if (keyType === "ec") {
      algorithm = "ecdsa-sha2-nistp256";
    } else {
      return null;
    }

    const openssh = rawPublicKeyToOpenSSH(pubKeyObject, algorithm, "");
    const fingerprint = computeFingerprint(openssh);
    return { publicKey: openssh, fingerprint };
  } catch {
    return null;
  }
}
