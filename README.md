# @mcp/auth-vault

**MCP server** for secure credential management, browser-based login automation, SSH key vault, TOTP/2FA auto-solving, and audit logging.

```
Status:  active    |    License: MIT    |    Version: 0.2.0
```

---

## Overview

Auth Vault stores encrypted credentials, secrets, and SSH keys (AES-256-GCM), automates browser login flows via Playwright, auto-solves TOTP-based 2FA challenges, and tracks sensitive actions via an audit log. It provides both an **MCP interface** (for AI clients) and a **Web UI dashboard** (for manual management).

| Interface | Port | URL |
|-----------|------|-----|
| Web UI Dashboard | `5600` | `http://<tailscale-ip>:5600/` |
| MCP SSE | `5501` | `http://<tailscale-ip>:5501/sse` |
| MCP Health | `5501` | `http://<tailscale-ip>:5501/health` |

---

## Features

- **Encrypted vault** — credentials, secrets, and SSH keys stored with AES-256-GCM
- **SSH Key Vault** — generate, store, retrieve, and export SSH keys (Ed25519, RSA-2048/4096)
- **SSH Config generation** — export SSH config fragments and key files
- **Browser automation** — Playwright-based login with form filling
- **CAPTCHA detection** — automatic detection of CAPTCHA challenges during login
- **Trusted devices** — device fingerprinting with trusted device management
- **TOTP/2FA auto-solve** — RFC 6238 implementation, generates and submits 2FA codes
- **TOTP rotation detection** — suggests code refresh when window is near expiry
- **QR code support** — generate QR for Google Authenticator setup
- **Secrets management** — API keys, bearer tokens, access/refresh tokens
- **Audit logging** — JSONL audit log with auto-rotation for sensitive actions
- **Vault health monitoring** — periodic integrity checks every 12 hours
- **Discovery API** — metadata overview of all vault contents without decryption
- **Tailscale-only access** — binds to Tailscale IP by default, blocks external traffic
- **Two service modes** — STDIO (MCP standard) and SSE (HTTP for persistent connections)

---

## Quick Start

### Prerequisites

- Node.js 22+
- Playwright Chromium (installed via `postinstall`)
- Tailscale (recommended for SSE mode)

### Setup

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Configure environment
cp .env.example .env
# Edit .env: set VAULT_ENCRYPTION_KEY (64 hex chars) or leave empty for auto-generated
```

### Configuration

All configuration via `.env` file or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_ROOT` | `./vault` | Storage directory for encrypted vault files |
| `VAULT_ENCRYPTION_KEY` | `auto-generated` | AES-256 key (64 hex chars, persist for data survival) |
| `AUTH_SSE_PORT` | — | Enable SSE mode on given port (empty = STDIO mode) |
| `AUTH_BIND_ADDRESS` | auto (Tailscale) | Explicit bind address for SSE mode |
| `BROWSER_HEADLESS` | `true` | Run Playwright in headless mode |
| `BROWSER_TIMEOUT` | `30000` | Browser operation timeout (ms) |
| `AUDIT_LOG_MAX_BYTES` | `10485760` | Audit log rotation threshold (10 MB) |
| `LOG_LEVEL` | `info` | Logging level: debug, info, warn, error |

---

## Usage

### STDIO Mode (default for MCP clients)

```bash
node dist/index.js
```

### SSE Mode (HTTP server for persistent connections)

```bash
# Set AUTH_SSE_PORT=5501 in .env, then:
node dist/index.js
```

### Web UI Dashboard

```bash
node dist/web/server.js
# Dashboard at http://<tailscale-ip>:5600/
```

### CLI Commands

#### Credentials
```bash
pnpm run add-creds       # Add credentials interactively
pnpm run list-creds      # List stored credentials (JSON)
pnpm run get-creds       # Get credential details (JSON)
```

#### Secrets
```bash
pnpm run add-secret      # Add a secret interactively
pnpm run list-secrets    # List stored secrets (JSON)
```

#### SSH Keys
```bash
pnpm run add-ssh-key       # Add existing SSH key interactively
pnpm run generate-ssh-key  # Generate new SSH key pair and store
pnpm run list-ssh-keys     # List stored SSH keys (JSON)
pnpm run get-ssh-key       # Get SSH key details (JSON)
```

---

## REST API

### Credentials

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/credentials` | List all credentials (metadata only) |
| `GET` | `/api/credentials?includePassword=true` | List all credentials (with passwords) |
| `GET` | `/api/credentials/:id` | Get credential details (password hidden by default) |
| `POST` | `/api/credentials` | Create a new credential |
| `PUT` | `/api/credentials/:id` | Update a credential |
| `DELETE` | `/api/credentials/:id` | Delete a credential |
| `GET` | `/api/credentials/:id/devices` | List trusted devices |
| `POST` | `/api/credentials/:id/devices/add` | Add a trusted device |
| `DELETE` | `/api/credentials/:id/devices/:fingerprint` | Remove a trusted device |
| `GET` | `/api/credentials/:id/audit` | Audit log entries for a credential |
| `POST` | `/api/credentials/:id/trust-device` | Shortcut to add a trusted device |

### Secrets

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/secrets` | List all secrets (metadata only) |
| `POST` | `/api/secrets` | Create a new secret |
| `DELETE` | `/api/secrets/:id` | Delete a secret |
| `GET` | `/api/secrets/:id/detail` | Get decrypted secret value |

### SSH Keys

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ssh` | List all SSH keys |
| `GET` | `/api/ssh/:id` | Get SSH key details (private key hidden by default) |
| `POST` | `/api/ssh` | Store an SSH key |
| `PUT` | `/api/ssh/:id` | Update an SSH key |
| `DELETE` | `/api/ssh/:id` | Delete an SSH key |
| `POST` | `/api/ssh/generate` | Generate and store a new SSH key pair |
| `GET` | `/api/ssh/:id/config` | Get SSH config fragment |
| `POST` | `/api/ssh/extract` | Extract public key from private key |
| `POST` | `/api/ssh/:id/rotate` | Generate new key pair for existing entry |
| `GET` | `/api/ssh/:id/public` | Get public key in plain text |

### TOTP / 2FA

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/totp/generate` | Generate a new TOTP secret with QR code |
| `POST` | `/api/totp/verify` | Verify a TOTP code (returns `rotationSuggested` if near expiry) |
| `POST` | `/api/totp/attach` | Attach a TOTP secret to a credential |
| `POST` | `/api/totp/regenerate` | Replace TOTP secret on an existing credential |
| `GET` | `/api/totp/:id/next-code` | Get current + next TOTP codes |
| `GET` | `/api/totp/:id/rotation-info` | Get TOTP rotation status |

### Login Automation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/login/:id` | Start automated login (returns `needsCaptcha`, `needs2FA`, `trustedDevice`, `retryCount`) |
| `POST` | `/api/login/:id/2fa` | Submit 2FA code during login |
| `GET` | `/api/login/status/:sessionId` | Check login session status |
| `POST` | `/api/login/:id/cancel` | Cancel an active login session |
| `GET` | `/api/login/sessions` | List active login sessions |
| `GET` | `/api/login/:id/fallback` | Get recovery options (TOTP recovery, backup codes) |

### Discovery

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/discovery/overview` | Metadata overview of all vault entries (no decryption) |
| `GET` | `/api/discovery/stats` | Aggregate statistics (counts by type, TOTP status) |
| `GET` | `/api/discovery/recent` | Recent activity (last 10 audit entries + updated credentials) |

### Audit

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit/actions` | List audit log entries (newest first) |
| `POST` | `/api/audit/actions` | Manually log an action |
| `GET` | `/api/audit/summary` | Activity summary for last 24 hours |
| `GET` | `/api/audit/services` | Services with audit activity |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health check |
| `GET` | `/api/health/integrity` | Vault file integrity validation |
| `GET` | `/api/health/summary` | Combined health (integrity + storage stats + audit stats) |

---

## Systemd Services

```bash
# MCP SSE server (port 5501)
systemctl status mcp-auth-vault

# Web UI dashboard (port 5600)
systemctl status mcp-auth-vault-web
```

Both services restart automatically on failure and enable at boot.

---

## Security

- **AES-256-GCM** encryption for all stored credentials, secrets, and SSH keys
- **Tailscale-restricted** — Web UI and SSE mode block non-Tailscale connections
- **Encryption key** persisted in `.env` — if lost, data cannot be recovered
- **Headless browser** — no visible UI during automated logins
- **Audit logging** — all sensitive actions logged to append-only JSONL file
- **Vault integrity** — periodic validation every 12 hours
- **Private key material** — SSH private keys encrypted at rest, never exposed in list endpoints

---

## Project Structure

```
src/
├── index.ts              # MCP server entry (STDIO + SSE)
├── config.ts             # Zod-validated configuration
├── credentials/
│   ├── totp.ts           # TOTP (RFC 6238) implementation
│   ├── qr.ts             # QR code generation + TOTP secret generator
│   ├── vault.ts          # Encrypted credential store
│   └── types.ts          # Credential type definitions
├── ssh/
│   ├── vault.ts          # Encrypted SSH key store
│   ├── generator.ts      # SSH key pair generation (Ed25519, RSA)
│   └── types.ts          # SSH key type definitions
├── secrets/
│   ├── manager.ts        # Encrypted secrets store
│   └── types.ts          # Secret type definitions
├── audit/
│   ├── log.ts            # JSONL audit log with auto-rotation
│   └── health.ts         # Vault integrity check module
├── authVault/
│   └── fingerprint.ts    # Trusted device fingerprinting
├── browser/
│   └── manager.ts        # Playwright session management
├── services/
│   └── definitions.ts    # Login templates (Google, etc.)
├── web/
│   ├── server.ts         # Web UI HTTP server + REST API
│   └── dashboard.ts      # HTML dashboard template
├── tools/
│   ├── credentials.ts    # MCP tool definitions for credentials
│   ├── ssh.ts            # MCP tool definitions for SSH keys
│   ├── secrets.ts        # MCP tool definitions for secrets
│   ├── services.ts       # MCP tool definitions for services
│   ├── login.ts          # MCP tool definitions for login
│   ├── audit.ts          # MCP tool definitions for audit/health
│   └── totp.ts           # MCP tool definitions for TOTP
└── cli/
    ├── add-credentials.ts
    ├── add-secret.ts
    ├── add-ssh-key.ts
    ├── generate-ssh-key.ts
    ├── get-ssh-key.ts
    ├── list-ssh-keys.ts
    ├── list-credentials.ts
    ├── list-secrets.ts
    └── get-credential.ts
```

---

## Tech Stack

- **Runtime:** Node.js 22+, TypeScript ESM
- **MCP:** @modelcontextprotocol/sdk v1.16
- **Encryption:** Node.js crypto (AES-256-GCM)
- **Browser:** Playwright (Chromium)
- **Config:** Zod validation
- **UI:** Vanilla JS (no framework)
- **QR:** qrcode npm package

---

## License

MIT