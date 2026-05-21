# Security — mcp-auth-vault

## Threat Model

### Assets Protected
- Credentials (usernames, passwords)
- TOTP/2FA secrets
- API keys and tokens
- Browser session cookies (during active login)

### Threat Actors
- Unauthorized network access (internet scanners, compromised LAN)
- Local user with filesystem access
- Malicious MCP client

## Encryption

### At Rest
All secrets are encrypted with **AES-256-GCM** before being written to disk.

```
Algorithm:  aes-256-gcm
Key size:   256 bits (32 bytes)
IV:         16 random bytes per encryption
Auth tag:   16 bytes (integrity verification)
Storage:    vault/index.json, vault/secrets.json
```

**Key management:**
- Key stored in `VAULT_ENCRYPTION_KEY` environment variable (`.env`)
- If not set, a random key is generated at each start — **all data becomes inaccessible on restart**
- Recommendation: persist the key in `.env` for production use

### In Transit
- **SSE mode:** Plain HTTP over Tailscale (encrypted at network layer by WireGuard)
- **STDIO mode:** Local IPC only (no network exposure)
- **Tailscale** provides end-to-end encryption between nodes

## Network Security

### SSE Mode (port 5501)
- Default bind: **Tailscale IP only** (100.x.x.x)
- Non-Tailscale connections → **HTTP 403**
- Localhost (127.0.0.1) always permitted
- Configurable via `AUTH_BIND_ADDRESS`

### Web UI (port 5500)
- Listens on `0.0.0.0:5500`
- Access restricted to Tailscale IPs + localhost
- Non-Tailscale remote IPs → **HTTP 403**

## Browser Security

### Playwright Configuration
- **Headless mode** by default (`BROWSER_HEADLESS=true`)
- No persistent profile — fresh sandbox per login session
- Sessions auto-cleaned on process exit (SIGINT/SIGTERM)
- Viewport: 1280x720 (appears as standard desktop browser)

### Session Management
- Browser sessions tracked in memory (Map)
- No session persistence to disk
- Sessions invalidated on server restart

## Secrets Handling

### Credential Vault (`vault/index.json`)
- Encrypted fields: `username`, `password`, `extra` (TOTP secrets, etc.)
- Metadata (id, service, label, createdAt) stored in plaintext (not sensitive)
- Each entry has unique ID (crypto.randomBytes(16))

### Secrets Store (`vault/secrets.json`)
- Encrypted fields: `value`, `description`, `scopes`, `extra`
- Supported types: api_key, bearer_token, access_token, refresh_token, private_key, generic

## Operational Security

### Systemd Service Hardening
```
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
```

### Logging
- `LOG_LEVEL` configurable: debug, info, warn, error
- Sensible default: `info`
- Debug level may expose credential metadata (not values)

### Recovery
- **Lost encryption key = lost data**
- Backup strategy: copy `vault/` directory and `.env` file together
- No key derivation — key is used directly

## Recommendations for Production

1. **Always set a persistent `VAULT_ENCRYPTION_KEY`** — generate with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Keep `.env` outside version control** — already in `.gitignore`
3. **Use Tailscale SSH** instead of password-based SSH
4. **Regularly backup** both `vault/` and `.env`
5. **Monitor logs** for unauthorized access attempts (403 responses)
6. **Keep dependencies updated** — especially Playwright and Node.js
