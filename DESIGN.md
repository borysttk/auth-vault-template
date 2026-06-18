# DESIGN.md — auth-vault: Architektura systemu

## 1. Przegląd architektury

**auth-vault** to modułowy serwer TypeScript/Node.js łączący trzy funkcjonalności:

- **MCP server** — udostępnia narzędzia (tools) przez Model Context Protocol (SSE lub Stdio)
- **REST API + dashboard** — interfejs WWW do zarządzania danymi
- **Silnik automatyzacji** — Playwright do logowania przez przeglądarkę, CAPTCHA solving

```
┌──────────────────────────────────────────────────────────┐
│                     auth-vault                            │
│                                                           │
│  ┌──────────────────┐   ┌──────────────────┐             │
│  │   MCP Server      │   │   Web Server      │            │
│  │   (index.ts)      │   │   (web/server.ts)  │           │
│  │   :5500 SSE       │   │   :5600 REST+HTML  │            │
│  │   Stdio mode      │   │   Tailscale-only   │            │
│  └──────┬───────────┘   └──────┬───────────┘             │
│         │                      │                          │
│         ▼                      ▼                          │
│  ┌─────────────────────────────────────────────────┐      │
│  │                   Warstwa logiki                  │      │
│  │                                                   │      │
│  │  ┌───────────┐ ┌───────────┐ ┌────────────────┐  │      │
│  │  │Credentials │ │ Secrets   │ │ Services        │  │      │
│  │  │ (vault)   │ │ (manager) │ │ (definitions)   │  │      │
│  │  └─────┬─────┘ └─────┬─────┘ └───────┬────────┘  │      │
│  │        │             │               │            │      │
│  │  ┌─────▼─────────────▼───────────────▼────────┐   │      │
│  │  │          Browser + Captcha                 │   │      │
│  │  │          (Playwright)                      │   │      │
│  │  └────────────────────────────────────────────┘   │      │
│  └─────────────────────────────────────────────────┘      │
│                                                           │
│  ┌─────────────────────────────────────────────────┐      │
│  │               Przechowywanie danych               │      │
│  │   vault/index.json  ← credentials (AES-256-GCM)   │     │
│  │   vault/secrets.json ← secrets (AES-256-GCM)      │     │
│  │   vault/qr-codes/   ← kody QR (PNG)               │     │
│  └─────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────┘
```

## 2. Komponenty szczegółowo

### 2.1 MCP Server (`src/index.ts`)

Główny punkt wejścia. Obsługuje dwa tryby komunikacji:

- **SSE mode**: tworzy serwer HTTP na porcie 5500, akceptujący połączenia
  Server-Sent Events. Dla każdego klienta tworzy osobny `McpServer` i
  `SSEServerTransport`. Ogranicza dostęp do sieci Tailscale (100.x.x.x).

- **Stdio mode**: komunikacja przez stdin/stdout dla klientów lokalnych
  (np. Claude Desktop, narzędzia CLI).

Rejestruje wszystkie grupy narzędzi przez funkcje `register*Tools()`.

**Endpointy HTTP (tryb SSE):**
- `GET /health` — health check JSON
- `GET /sse` — połączenie SSE (tworzy nową sesję MCP)
- `POST /messages?sessionId=...` — odbieranie wiadomości MCP

**Ograniczenia sieciowe:**
- Bind wymaga Tailscale IP lub jawnego `AUTH_BIND_ADDRESS`
- Połączenia spoza Tailscale są blokowane (403)
- Licznik zablokowanych połączeń w `connectionsBlocked`

### 2.2 Web Server (`src/web/server.ts`)

Niezależny serwer HTTP na porcie 5600. Udostępnia:

- Dashboard HTML (`GET /`)
- REST API dla credentiali, sekretów, logowania, TOTP
- Automatyczne czyszczenie nieaktywnych sesji (30 min TTL)

**Route'y REST** szczegółowo opisane w AGENTS.md. Serwer implementuje
własny mini-router bez frameworka (czysty `http.createServer`).

### 2.3 Warstwa przechowywania danych

#### Credentials (`src/credentials/vault.ts`)

- Operacje CRUD na pliku `vault/index.json`
- Szyfrowanie AES-256-GCM przed zapisem
- Deszyfrowanie przy odczycie
- Identyfikatory: `crypto.randomBytes(16).toString("hex")`
- Obsługa pól `extra` (dowolne metadane, w tym `totp_secret`)

Struktura kryptograficzna:
```
plaintext = JSON.stringify(fields)
iv = randomBytes(16)
cipher = createCipheriv("aes-256-gcm", key, iv)
ciphertext = cipher.update(plaintext) + cipher.final()
authTag = cipher.getAuthTag()
return { ciphertext: hex, iv: hex, authTag: hex }
```

#### Secrets (`src/secrets/manager.ts`)

- Analogiczny CRUD na `vault/secrets.json`
- Ten sam mechanizm szyfrowania AES-256-GCM
- Wsparcie dla expiracji (`expiresAt`), zakresów (`scopes`), metadanych (`extra`)

#### Typy danych

| Plik typów                  | Główne interfejsy                              |
|-----------------------------|-------------------------------------------------|
| `src/credentials/types.ts`  | `CredentialEntry`, `EncryptedData`, `LoginTemplate`, `BrowserSession`, `CaptchaResult`, `CaptchaSolution` |
| `src/secrets/types.ts`      | `SecretEntry`, `SecretFields`, `EncryptedPayload`, `SecretKind` |

### 2.4 Serwisy i szablony logowania (`src/services/definitions.ts`)

Rejestr szablonów logowania (wzorzec Registry). Każdy serwis definiuje:

- Selektor username/password/submit
- Warunki sukcesu (URL pattern, selektor CSS)
- Obsługa 2FA (selektor, URL pattern)
- Dodatkowe kroki (pre/post login)
- Dodatkowe pola formularza

**Wbudowane**: `google`, `arena.ai`, `github`.

**Rejestracja w runtime**: `add_service` MCP tool → `registerCustomService()`.

### 2.5 Browser automation (`src/browser/manager.ts`)

Silnik Playwright. Zarządza sesjami przeglądarki w pamięci (`Map<string, SessionEntry>`).

**Sesja =** Browser + BrowserContext + Page.

**Funkcje:**
- `launchBrowser(service, headless?)` — uruchamia Chrome z stealth options
- `navigateTo(sessionId, url)` — nawigacja
- `fillLoginForm(...)` — wypełnienie formularza (wieloetapowe logowanie)
- `clickSubmit(...)` — kliknięcie submit
- `verifyLogin(...)` — weryfikacja przez URL pattern lub selektor

**Stealth/anty-bot:**
- Ukrywanie `navigator.webdriver`
- Ustawienie `navigator.plugins` (5 pluginów)
- Ustawienie `navigator.languages` na `["en-US", "en"]`
- Realistyczny User-Agent (Chrome 125)
- Viewport 1280×720

**Obsługa 2FA** — dedykowana ścieżka dla Google:
1. Wykrycie `/signin/challenge/`
2. Kliknięcie "Try another way"
3. Wybór "Google Authenticator"
4. Wypełnienie kodu TOTP
5. Kliknięcie "Next"

Dla pozostałych serwisów — uniwersalne wykrywanie przez listę selektorów.

### 2.6 CAPTCHA (`src/browser/captcha.ts`)

**Wykrywanie:** przeszukuje stronę pod kątem:
- `iframe[src*="recaptcha"]` — reCAPTCHA v2
- `.grecaptcha-badge` — reCAPTCHA badge
- `div.g-recaptcha` — widget reCAPTCHA
- `iframe[src*="hcaptcha"]`, `.h-captcha` — hCaptcha
- `img[src*="captcha"]` — image captcha
- `input[name*="captcha"]` — text captcha

**Rozwiązywanie:** przez 2Captcha API:
1. `POST /in.php` — zgłoszenie CAPTCHA
2. `GET /res.php?id=...` — polling co 5s (max 60 prób = 5 minut)

**Zastosowanie tokenu:** `applyRecaptchaSolution(page, token)` — wstrzykuje
token do grecaptcha callback i wywołuje funkcję weryfikacji.

### 2.7 TOTP (`src/credentials/totp.ts`)

Implementacja RFC 6238 / RFC 4226:
- Algorytm: HMAC-SHA1
- Digitów: 6
- Krok: 30 sekund
- Sekret: base32 (20 bajtów → 32 znaki)

### 2.8 QR kody (`src/credentials/qr.ts`)

- `generateTOTPSecret()` — losowy sekret base32 (20 bajtów)
- `buildOTPAuthURL()` — URL `otpauth://totp/...`
- `saveQRPNG()` — zapis PNG do `vault/qr-codes/`
- `renderQRCode()` — ASCII QR dla terminala

### 2.9 CLI (`src/cli/`)

Narzędzia konsolowe do szybkiego zarządzania danymi bez MCP:

| Plik                   | Opis                            |
|------------------------|---------------------------------|
| `add-credentials.ts`   | Interaktywne dodawanie cred     |
| `add-secret.ts`        | Interaktywne dodawanie sekretu  |
| `list-credentials.ts`  | Lista credentiali               |
| `get-credential.ts`    | Szczegóły credentiala           |
| `list-secrets.ts`      | Lista sekretów                  |
| `test-login.ts`        | Test logowania (debug)          |

## 3. Konfiguracja (`src/config.ts`)

Walidacja zmiennych środowiskowych przez Zod schema.
- `.env` ładowany przez `dotenv` z `override: false`
- Klucz szyfrowania może być auto-generowany przy starcie (warning w konsoli)
- Ścieżki normalizowane do absolutnych
- Wszystkie konfiguracje dostępne przez `getConfig()` (singleton)

## 4. Model bezpieczeństwa

### Szyfrowanie
- **Algorytm:** AES-256-GCM (authenticated encryption)
- **Klucz:** 32 bajty (64 znaki hex) z `VAULT_ENCRYPTION_KEY`
- **IV:** 16 bajtów losowych na każdy zapis
- **Auth tag:** weryfikacja integralności przy deszyfrowaniu
- Każdy zapis generuje nowy IV — deterministyczne szyfrowanie blokowane

### Izolacja sieciowa
- MCP SSE: dostęp tylko z Tailscale (100.x.x.x) lub localhost
- REST API: dostęp tylko z Tailscale lub localhost
- Blokowanie połączeń z zewnętrznych adresów (403)
- Liczba zablokowanych połączeń accessowalna przez diagnostykę

### Ochrona haseł
- Hasła ukryte domyślnie w odpowiedziach API (`***`)
- Jawne żądanie `includePassword: true` wymagane do odsłonięcia

### Zarządzanie sesjami
- Sesje przeglądarki czyszczone przy SIGINT/SIGTERM
- Automatyczne czyszczenie po 30 minutach (REST API)
- Czyszczenie co 5 minut

## 5. Zależności

| Pakiet                        | Zastosowanie                              |
|-------------------------------|-------------------------------------------|
| `@modelcontextprotocol/sdk`   | MCP Server, SSE/Stdio transport           |
| `playwright`                  | Browser automation (Chrome)               |
| `qrcode`                      | Generowanie kodów QR (PNG + terminal)     |
| `zod`                         | Walidacja konfiguracji i inputów          |
| `dotenv`                      | Ładowanie .env                            |
| `typescript`                  | Kompilacja                                |
| `tsx`                         | Development mode (watch + transpile)      |

## 6. Przepływy danych

### 6.1 Zapis credentiala

```
MCP tool: store_credentials
  ↓
registerCredentialTools()
  ↓
vault.storeCredentials(service, label, fields, tags)
  ↓
encrypt(JSON.stringify(fields)) → { ciphertext, iv, authTag }
  ↓
readIndex() → append entry → writeIndex()
  ↓
Zwraca CredentialEntry (bez haseł w logach)
```

### 6.2 Automatyczne logowanie

```
MCP tool: login_service(sessionId, credentialId)
  ↓
vault.getCredentials(credentialId) → odszyfruj
  ↓
getServiceTemplate(service) → znajdź szablon
  ↓
browser.fillLoginForm(sessionId, template, username, password, extra)
  ├── preLoginSteps (wait, click itp.)
  ├── fill username selector
  ├── if password visible → fill; else → submit → wait → fill password
  └── extraFields (jeśli zdefiniowane)
  ↓
detectCaptcha(page) → jeśli wykryty → solveCaptcha() → applyRecaptchaSolution()
  ↓
browser.clickSubmit(sessionId, template)
  ↓
handle2FAChallenge()
  ├── Google: try another way → Authenticator → fill TOTP
  └── Inne: detect → fill → submit
  ↓
browser.verifyLogin(template) → success URL pattern lub selector
```

### 6.3 Health check

```
vault_health()
  ↓
Sprawdza:
  ├── storage:   listCredentials() + listSecrets() — czy działają
  ├── encryption: czy VAULT_ENCRYPTION_KEY istnieje
  ├── services:   czy template'y google/arena/github są zarejestrowane
  ├── browser:    listSessions() — aktywne sesje
  └── totp:       ile credentiali ma totp_secret
  ↓
Zwraca overall: "healthy" | "degraded"
```

## 7. Decyzje architektoniczne

### Dlaczego AES-256-GCM zamiast libsodium?
- Brak zależności natywnych (crypto z Node.js)
- Wystarczający poziom bezpieczeństwa dla credentiali
- Prosta serializacja (hex stringi)

### Dlaczego osobny web server?
- MCP nie nadaje się dobrze do interaktywnego dashboardu
- REST API pozwala na integrację z zewnętrznymi narzędziami
- Możliwość uruchomienia niezależnie od MCP

### Dlaczego Playwright zamiast Puppeteer?
- Lepsze API do automatyzacji formularzy
- Wbudowane `locator` API
- `chromium.launch` z opcją headless

### Dlaczego Tailscale-only?
- Bezpieczeństwo: magazyn credentiali nie powinien być dostępny publicznie
- Tailscale zapewnia szyfrowane połączenie mesh
- Łatwa konfiguracja (brak certyfikatów SSL)

### Dlaczego Registry pattern dla serwisów?
- Łatwe dodawanie nowych serwisów w runtime
- Separacja definicji od implementacji
- Testowalność (można podmienić registry w testach)

## 8. Obsługa błędów

- Wszystkie MCP tool'e używają `try/catch` → zwracają `isError: true`
- Funkcje diagnostyczne raportują stan per-komponent (storage, encryption itd.)
- Brak obsługi danego komponentu nie blokuje innych (graceful degradation)
- Krytyczne błędy konfiguracji → `process.exit(1)` z komunikatem

## 9. Monitorowanie i diagnostyka

- `vault_health` — pełny health check wszystkich podsystemów
- `test_*` — szczegółowa diagnostyka per-komponent
- Endpoint `/health` (SSE + REST) — szybkie sprawdzenie
- Logowanie przez `console.error` (zgodne z MCP stdio convention)
- Poziomy logowania: debug, info, warn, error
