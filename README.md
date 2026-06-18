# @mcp/auth-vault

> **🧩 Branch template** — czysta wersja do klonowania i adaptacji.  
> Brak testów specyficznych dla Q-ekosystemu, brak danych wrażliwych.  
> Własne serwisy konfigurujesz przez `add_service` — wystarczą selektory CSS.

**MCP server** for secure credential management, browser-based login automation, and TOTP/2FA auto-solving.

```
Status:  active    |    License: MIT    |    Version: 0.1.0
```

---

## Overview

Auth Vault stores encrypted credentials and secrets (AES-256-GCM), automates browser login flows via Playwright, and auto-solves TOTP-based 2FA challenges. It provides both an **MCP interface** (for AI clients) and a **Web UI dashboard** (for manual management).

| Interface | Port | URL |
|-----------|------|-----|
| Web UI Dashboard | `5500` | `http://<tailscale-ip>:5500/` |
| MCP SSE | `5501` | `http://<tailscale-ip>:5501/sse` |
| MCP Health | `5501` | `http://<tailscale-ip>:5501/health` |

---

## Features

- **Encrypted vault** — credentials and secrets stored with AES-256-GCM
- **Browser automation** — Playwright-based login with form filling
- **TOTP/2FA auto-solve** — RFC 6238 implementation, generates and submits 2FA codes
- **QR code support** — generate QR for Google Authenticator setup
- **Secrets management** — API keys, bearer tokens, access/refresh tokens
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
# Dashboard at http://<tailscale-ip>:5500/
```

### CLI Commands

```bash
npm run add-creds     # Add credentials interactively
npm run add-secret    # Add a secret interactively
npm run list-creds    # List stored credentials
npm run list-secrets  # List stored secrets
npm run get-creds     # Get credential details
```

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
