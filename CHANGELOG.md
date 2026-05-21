# Changelog — mcp-auth-vault

## [0.1.0] — 2026-05-20

### Added
- Encrypted credential vault (AES-256-GCM) with JSON file store
- Encrypted secrets manager for API keys and tokens
- TOTP implementation (RFC 6238) — generate, verify, auto-solve
- QR code generation for Google Authenticator setup
- Playwright-based browser login automation
- Auto-solving of TOTP 2FA challenges during login
- Web UI dashboard with four tabs:
  - **Credentials** — list, add, delete credentials
  - **Secrets** — list, add, delete secrets
  - **Login** — trigger automated login with 2FA support
  - **2FA** — generate TOTP secrets, display QR codes, verify codes, attach to credentials
- MCP server with STDIO and SSE transport modes
- REST API for all operations
- Tailscale-only network security
- Systemd service files for production deployment
- Two-process architecture (MCP + Web UI as separate services)

### Fixed
- Dashboard JavaScript syntax error caused by template literal escape sequences — replaced inline `onclick` strings with `data-*` attributes

### Security
- AES-256-GCM authenticated encryption for all stored secrets
- Random IV per encryption operation
- Tailscale network isolation with IP-based access control
- Headless browser mode by default
- Systemd service hardening (NoNewPrivileges, ProtectSystem, PrivateTmp)
