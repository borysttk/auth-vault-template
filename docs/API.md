# API Reference — mcp-auth-vault (Web UI)

Base URL: `http://<tailscale-ip>:5500`

---

## Credentials

### List Credentials

```
GET /api/credentials
```

**Response:**
```json
{
  "count": 1,
  "entries": [
    {
      "id": "b04a3ba4...",
      "service": "google",
      "label": "botai",
      "createdAt": "2026-05-20T04:22:20.886Z"
    }
  ]
}
```

### Get Credential Detail

```
GET /api/credentials/:id
```

**Response:**
```json
{
  "id": "b04a3ba4...",
  "service": "google",
  "label": "botai",
  "credentials": {
    "username": "user@gmail.com",
    "extra": { "totp_secret": "JBSWY3DP..." }
  }
}
```

Note: Password is omitted from API response for security.

### Create Credential

```
POST /api/credentials
Content-Type: application/json

{
  "service": "google",
  "label": "My Account",
  "username": "user@gmail.com",
  "password": "secret",
  "extra": { "totp_secret": "JBSWY3DP..." },
  "tags": ["work"]
}
```

**Response:** `201 Created`
```json
{ "success": true, "id": "b04a3ba4..." }
```

### Delete Credential

```
DELETE /api/credentials/:id
```

**Response:**
```json
{ "success": true }
```

---

## Secrets

### List Secrets

```
GET /api/secrets
```

**Response:**
```json
{
  "count": 1,
  "entries": [
    {
      "id": "abc123...",
      "label": "OpenAI Key",
      "kind": "api_key",
      "service": "openai",
      "createdAt": "2026-05-20T04:22:20.886Z"
    }
  ]
}
```

### Create Secret

```
POST /api/secrets
Content-Type: application/json

{
  "label": "OpenAI Key",
  "kind": "api_key",
  "service": "openai",
  "value": "sk-...",
  "description": "Production API key"
}
```

**Response:** `201 Created`
```json
{ "success": true, "id": "abc123..." }
```

### Delete Secret

```
DELETE /api/secrets/:id
```

**Response:**
```json
{ "success": true }
```

---

## TOTP / 2FA

### Generate TOTP Secret

```
GET /api/totp/generate?account=user@example.com&issuer=AuthVault
```

**Response:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "account": "user@example.com",
  "issuer": "AuthVault",
  "otpauthUrl": "otpauth://totp/AuthVault:user%40example.com?secret=...",
  "qrDataUri": "data:image/png;base64,..."
}
```

### Verify TOTP Code

```
POST /api/totp/verify
Content-Type: application/json

{
  "secret": "JBSWY3DPEHPK3PXP",
  "code": "123456"
}
```

**Response:**
```json
{
  "valid": true,
  "generatedCode": "123456"
}
```

Returns `valid: false` with the expected code if mismatch.

### Attach TOTP to Credential

```
POST /api/totp/attach
Content-Type: application/json

{
  "credentialId": "b04a3ba4...",
  "totpSecret": "JBSWY3DPEHPK3PXP"
}
```

**Response:**
```json
{ "success": true }
```

Stores `totp_secret` in credential's `extra.totp_secret` field (encrypted).

### Check Credential TOTP Status

```
GET /api/credentials/:id/totp
```

**Response:**
```json
{
  "id": "b04a3ba4...",
  "label": "botai",
  "service": "google",
  "hasTotp": true,
  "totpSecret": "JBSWY3DP..."
}
```

---

## Login Automation

### Start Login

```
POST /api/login/:credentialId
```

Initiates Playwright browser login for the given credential.

**Response (successful, no 2FA):**
```json
{
  "loggedIn": true,
  "sessionId": "abc...",
  "currentUrl": "https://myaccount.google.com/"
}
```

**Response (2FA required, auto-solved):**
```json
{
  "loggedIn": true,
  "sessionId": "abc...",
  "currentUrl": "https://myaccount.google.com/",
  "message": "Login successful"
}
```

**Response (2FA required, manual):**
```json
{
  "needs2FA": true,
  "sessionId": "abc...",
  "message": "2FA code required"
}
```

### Submit 2FA Code

```
POST /api/login/2fa
Content-Type: application/json

{
  "sessionId": "abc...",
  "code": "123456"
}
```

**Response:**
```json
{
  "loggedIn": true,
  "sessionId": "abc...",
  "currentUrl": "https://myaccount.google.com/"
}
```

### Login Session Status

```
GET /api/login/status/:sessionId
```

**Response:**
```json
{
  "active": true,
  "url": "https://accounts.google.com/v3/signin/challenge/totp"
}
```

---

## Health

### Health Check

```
GET /health
```

**Response (Web UI):**
```json
{ "status": "ok", "service": "mcp-auth-vault-web" }
```

**Response (MCP SSE, port 5501):**
```json
{
  "status": "ok",
  "service": "mcp-auth-vault",
  "version": "0.1.0",
  "bindAddress": "100.87.202.50",
  "sessions": 0
}
```
