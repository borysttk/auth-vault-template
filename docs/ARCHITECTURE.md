# Architecture — mcp-auth-vault

## System Context

```
┌─────────────────────────────────────────────────────┐
│                   Tailscale Network                  │
│                   100.87.202.50                      │
│                                                      │
│  ┌──────────────────┐    ┌──────────────────────┐    │
│  │  MCP SSE Server  │    │   Web UI Server      │    │
│  │  port 5501       │    │   port 5500           │    │
│  │  dist/index.js   │    │   dist/web/server.js  │    │
│  └──────┬───────────┘    └──────────┬───────────┘    │
│         │                           │                 │
│         │                           │                 │
│  ┌──────┴───────────────────────────┴───────────────┐ │
│  │               Credential Vault                    │ │
│  │        vault/index.json (AES-256-GCM)            │ │
│  │        vault/secrets.json (AES-256-GCM)          │ │
│  └──────────────────────┬──────────────────────────┘ │
│                         │                             │
│  ┌──────────────────────┴──────────────────────────┐ │
│  │           Playwright Browser Engine              │ │
│  │     (headless Chromium, per-session sandbox)     │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Two-Process Architecture

The server runs as **two independent processes** behind systemd:

### 1. MCP Server (`mcp-auth-vault.service`)

- **Entry:** `src/index.ts` → `dist/index.js`
- **Modes:** STDIO (default) or SSE (when `AUTH_SSE_PORT` is set)
- **Purpose:** Exposes MCP tools for AI clients (credential CRUD, login automation, secret management)
- **Protocol:** Model Context Protocol (MCP) via @modelcontextprotocol/sdk
- **Port:** 5501 (SSE mode)

### 2. Web UI Server (`mcp-auth-vault-web.service`)

- **Entry:** `src/web/server.ts` → `dist/web/server.js`
- **Purpose:** Provides a browser-based dashboard and REST API
- **Port:** 5500 (hardcoded)
- **Access:** Tailscale network + localhost only

## Data Flow — Login Automation

```
User/Client → POST /api/login/:id
                    │
                    ▼
          vault.getCredentials(id)
                    │
          ┌─────────┴──────────┐
          │  decrypt AES-256   │
          └─────────┬──────────┘
                    │
                    ▼
          browser.launchSession()
                    │
          ┌─────────┴──────────┐
          │  page.goto(url)     │
          │  page.fill(username)│
          │  page.fill(password)│
          │  page.click(submit) │
          └─────────┬──────────┘
                    │
                    ▼
          URL contains /challenge/?
                    │
           ┌────────┴────────┐
           │ YES             │ NO
           ▼                 ▼
     totpSecret exists?   loggedIn=true
           │
     ┌─────┴─────┐
     │ YES       │ NO
     ▼           ▼
  generateTOTP  needs2FA=true
  page.fill(code)  (manual)
  page.click(Next)
           │
           ▼
     URL = myaccount.google.com?
           │
      ┌────┴────┐
      │ YES     │ NO
      ▼         ▼
   loggedIn   2fa_failed
   =true      message
```

## Encryption Layer (AES-256-GCM)

```
┌───────────────────────────────────────┐
│         VAULT_ENCRYPTION_KEY          │
│         32 bytes (64 hex chars)       │
└──────────────┬────────────────────────┘
               │
               ▼
     createCipheriv('aes-256-gcm', key, iv)
               │
               ▼
┌───────────────────────────────────────┐
│  EncryptedPayload                      │
│  {                                     │
│    ciphertext: "hex",                  │
│    iv: "16 bytes hex",                 │
│    authTag: "16 bytes hex"             │
│  }                                     │
└───────────────────────────────────────┘
```

- **Algorithm:** aes-256-gcm (authenticated encryption)
- **IV:** 16 random bytes per encryption
- **Auth Tag:** 16 bytes — tamper detection
- **Key:** From `VAULT_ENCRYPTION_KEY` in `.env` (auto-generated if missing — **data lost on restart**)

## TOTP Implementation (RFC 6238)

```
TOTP = Truncate(HMAC-SHA1(K, T))
  where:
    K = base32_decode(secret)
    T = floor(current_unix_time / 30)
```

- **Algorithm:** HMAC-SHA1
- **Digits:** 6
- **Step:** 30 seconds
- **Validation:** Exact match (no drift tolerance in API, adjacent windows in login flow)

## Service Templates

Login templates define how to automate login for each service:

```typescript
interface LoginTemplate {
  id: string;
  label: string;
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  twoFactorSelector?: string;
  successUrlPattern?: string;
}
```

Currently supports: `google` (hardcoded specialization in web UI).

## Key Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| @modelcontextprotocol/sdk | ^1.16 | MCP protocol implementation |
| playwright | ^1.52 | Browser automation |
| qrcode | ^1.5 | QR code generation |
| zod | ^3.24 | Configuration validation |
| dotenv | ^16.4 | Environment loading |
