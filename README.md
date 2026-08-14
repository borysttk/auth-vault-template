# @mcp/auth-vault

> **🧩 Branch template** — czysta wersja do klonowania i adaptacji.  
> Brak testów specyficznych dla Q-ekosystemu, brak danych wrażliwych.  
> Własne serwisy konfigurujesz przez `add_service` — wystarczą selektory CSS.

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
- **Password generator** — strong random passwords and diceware passphrases (OpenSSL-backed)
- **Audit logging** — JSONL audit log with auto-rotation for sensitive actions
- **Vault health monitoring** — integrity checks (credentials, secrets, ssh indexes)
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
npm install

# Build TypeScript
npm run build

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

```bash
npm run add-creds     # Add credentials interactively
npm run add-secret    # Add a secret interactively
npm run list-creds    # List stored credentials
npm run list-secrets  # List stored secrets
npm run get-creds     # Get credential details

# SSH keys
npm run add-ssh-key       # Add an existing SSH key interactively
npm run generate-ssh-key  # Generate a new SSH key pair and store it
npm run list-ssh-keys     # List stored SSH keys
npm run get-ssh-key       # Get SSH key details
```

---

## REST API

### Credentials
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/credentials?includePassword=true` | List credentials (optionally with passwords) |
| `GET` | `/api/credentials/:id` | Get credential details (password hidden by default) |
| `POST` | `/api/credentials` | Create a credential |
| `DELETE` | `/api/credentials/:id` | Delete a credential |

### Secrets
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/secrets` | List secrets (metadata only) |
| `POST` | `/api/secrets` | Create a secret |
| `DELETE` | `/api/secrets/:id` | Delete a secret |
| `GET` | `/api/secrets/:id/detail` | Get decrypted secret value |

### SSH Keys
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ssh/:id/config` | Get `~/.ssh/config` fragment for a key |
| `GET` | `/api/ssh/:id/file` | Download the private key file |

### Audit & Health
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit?limit=50` | Read recent audit log entries |
| `POST` | `/api/audit` | Manually record an audit action |
| `GET` | `/api/health` | Vault health summary (integrity + storage + audit stats) |
| `GET` | `/api/discovery` | Metadata overview of vault contents (no decryption) |
| `GET` | `/api/password/generate?length=16&symbols=true` | Generate strong password(s) |

---

## MCP Tools

Tools are exposed under the `mcp_auth_vault_*` namespace:

- **Credentials:** `store_credentials`, `get_credentials`, `list_credentials`, `delete_credentials`, `get_credentials_for_service`, `attach_totp`, `generate_totp`, `generate_totp_by_service`, `totp_qr`
- **Secrets:** `store_secret`, `get_secret`, `list_secrets`, `delete_secret`, `update_secret`, `audit_secret_expiry`
- **SSH:** `store_ssh_key`, `get_ssh_key`, `list_ssh_keys`, `delete_ssh_key`, `generate_ssh_key`, `export_ssh_config`, `export_ssh_key_file`, `get_ssh_fingerprint`, `extract_ssh_public_key`, `update_ssh_key`
- **Services:** `get_service`, `list_services`, `add_service`
- **Login:** `auth_login`, `login_status`, `submit_totp`, `logout`
- **Audit:** `list_audit_actions`, `log_audit_action`, `vault_integrity_check`, `vault_health_summary`

---

## Systemd Services

```bash
# MCP SSE server (port 5501)
systemctl status mcp-auth-vault

# Web UI dashboard (port 5500)
systemctl status mcp-auth-vault-web
```

Both services restart automatically on failure and enable at boot.

---

## Security

- **AES-256-GCM** encryption for all stored credentials and secrets
- **Tailscope-restricted** — SSE mode blocks non-Tailscale connections
- **Encryption key** persisted in `.env` — if lost, data cannot be recovered
- **Headless browser** — no visible UI during automated logins

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
├── secrets/
│   ├── manager.ts        # Encrypted secrets store
│   └── types.ts          # Secret type definitions
├── browser/
│   └── manager.ts        # Playwright session management
├── services/
│   └── definitions.ts    # Login templates (Google, etc.)
├── web/
│   ├── server.ts         # Web UI HTTP server + REST API
│   └── dashboard.ts      # HTML dashboard template
├── tools/
│   ├── credentials.ts    # MCP tool definitions for credentials
│   ├── secrets.ts        # MCP tool definitions for secrets
│   ├── services.ts       # MCP tool definitions for services
│   └── login.ts          # MCP tool definitions for login
└── cli/
    ├── add-credentials.ts
    └── add-secret.ts
```

---

## Tech Stack

- **Runtime:** Node.js 24, TypeScript ESM
- **MCP:** @modelcontextprotocol/sdk v1.16
- **Encryption:** Node.js crypto (AES-256-GCM)
- **Browser:** Playwright (Chromium)
- **Config:** Zod validation
- **UI:** Vanilla JS (no framework)
- **QR:** qrcode npm package

---

## License

MIT
