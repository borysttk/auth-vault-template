# Architectural Decisions — mcp-auth-vault

## ADR-1: AES-256-GCM for Credential Encryption

**Status:** Accepted

**Context:** Need to store credentials (username, password, TOTP secrets) securely on disk.

**Decision:** Use Node.js built-in `crypto.createCipheriv('aes-256-gcm', ...)` with random IV per encryption.

**Consequences:**
- Zero external dependencies for crypto
- Authenticated encryption prevents tampering
- Key must be persisted in `.env` — if lost, data is unrecoverable
- Performance adequate for single-user vault (< 1000 entries)

**Alternatives considered:**
- libsodium (NaCl) — more modern but adds dependency
- SQLCipher — overkill for file-based vault
- Plain JSON + filesystem permissions — no protection

---

## ADR-2: JSON File Store Instead of Database

**Status:** Accepted

**Context:** The vault stores a small number of credential entries. No multi-user or concurrent access needed.

**Decision:** Use a flat JSON file (`vault/index.json`) with in-memory read/write.

**Consequences:**
- Simple, debuggable, no DB setup
- Risk of write corruption on concurrent access (mitigated by single-user design)
- Entire index loaded into memory (acceptable for <10K entries)
- Easy backup: just copy the vault directory

**Alternatives considered:**
- SQLite — robust but adds complexity
- Redis — overkill for local vault
- LevelDB — adds native dependency build complexity

---

## ADR-3: Separate Systemd Services for MCP and Web UI

**Status:** Accepted

**Context:** MCP SSE server and Web UI HTTP server both need to listen on ports. They cannot share port 5500.

**Decision:** Run two independent Node.js processes behind systemd.

| Service | Port | Binary | Purpose |
|---------|------|--------|---------|
| `mcp-auth-vault` | 5501 | `dist/index.js` | MCP protocol |
| `mcp-auth-vault-web` | 5500 | `dist/web/server.js` | Web dashboard |

**Consequences:**
- Independent lifecycle (restart one without affecting the other)
- Web UI depends on MCP server (`Requires=` in systemd)
- Double memory usage (~80MB each)

---

## ADR-4: Tailscale-Only Network Access

**Status:** Accepted

**Context:** Credential vault with browser automation should not be exposed to the public internet.

**Decision:** Bind to Tailscale IP (100.x.x.x) by default. Block non-Tailscale connections in SSE mode.

**Consequences:**
- Only devices on the same Tailscale network can access the server
- No firewall configuration needed
- Auto-detects Tailscale IP at startup
- Falls back to `AUTH_BIND_ADDRESS` env var if Tailscale not detected

---

## ADR-5: TOTP Auto-Solve via Playwright

**Status:** Accepted

**Context:** Login automation needs to handle 2FA challenges without user intervention.

**Decision:** Implement RFC 6238 TOTP natively and inject codes into browser pages via Playwright selectors.

**Consequences:**
- Zero external TOTP library dependency
- Full control over implementation
- TOTP secret must match Google's registered secret exactly
- Selector-based injection is fragile — Google page changes may break it

---

## ADR-6: Vanilla JS Dashboard Instead of Framework

**Status:** Accepted

**Context:** The web UI needs to display credentials, secrets, and 2FA management with minimal complexity.

**Decision:** Single-page HTML with vanilla JavaScript served from a template literal.

**Consequences:**
- Zero build tooling, zero npm dependencies for frontend
- Everything in one file (dashboard.ts as template literal)
- No hydration, no virtual DOM — simpler but less maintainable at scale
- Template literal escaping requires care (lesson learned: use `data-*` attributes)

---

## ADR-7: STDIO as Default MCP Transport

**Status:** Accepted

**Context:** MCP servers typically communicate via STDIO with the MCP client (Claude Code, etc.). SSE needed for persistent always-on servers.

**Decision:** Default to STDIO transport, enable SSE when `AUTH_SSE_PORT` is configured.

**Consequences:**
- STDIO: simpler, no port conflicts, launched by MCP client
- SSE: persistent, can serve multiple clients, requires Tailscale
- Code switches transport at startup based on configuration
