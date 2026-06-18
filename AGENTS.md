# AGENTS.md — auth-vault (MCP Credential Management)

## Przegląd

**auth-vault** to serwer MCP (Model Context Protocol) do bezpiecznego zarządzania
poświadczeniami (credentialami), automatyzacji logowania przez przeglądarkę,
obsługi CAPTCHA oraz przechowywania sekretów (API keys, tokeny).

| Właściwość        | Wartość                                                   |
|-------------------|-----------------------------------------------------------|
| Język             | TypeScript 5.9+ / Node.js 20+                             |
| Protokół          | MCP 2025-03-26 (SSE + Stdio)                              |
| Port MCP (SSE)    | 5500                                                       |
| Port REST (Web)   | 5600                                                       |
| Szyfrowanie       | AES-256-GCM (klucz 32 bajty)                              |
| Browser automation| Playwright (Chrome headless)                              |
| CAPTCHA solving   | 2Captcha API                                               |

## Tryby uruchomienia

Serwer działa w dwóch trybach:

1. **SSE mode** — nasłuchuje na porcie 5500, wymaga Tailscale IP lub `AUTH_BIND_ADDRESS`.
   Uruchom przez: `node dist/index.js` (z ustawionym `AUTH_SSE_PORT` w .env).
2. **Stdio mode** — komunikacja przez standardowe wejście/wyjście.
   Uruchom przez: `node dist/index.js` (bez `AUTH_SSE_PORT`).

Serwer WWW (REST API + dashboard) działa niezależnie na porcie 5600:
`node dist/web/server.js`

## Zmienne środowiskowe (.env)

| Zmienna                  | Typ    | Domyślnie    | Opis                                                   |
|--------------------------|--------|--------------|--------------------------------------------------------|
| `VAULT_ROOT`             | string | `./vault`    | Ścieżka do magazynu danych (index.json, secrets.json)  |
| `VAULT_ENCRYPTION_KEY`   | hex(64)| auto-gener.  | Klucz AES-256-GCM (64 znaki hex = 32 bajty)           |
| `CAPTCHA_API_KEY`        | string | —            | Klucz API do 2Captcha/CapMonster                      |
| `CAPTCHA_SERVICE`        | enum   | `2captcha`   | Dostawca CAPTCHA (`2captcha`, `capmonster`, `none`)   |
| `BROWSER_HEADLESS`       | bool   | `true`       | Czy uruchamiać przeglądarkę w trybie headless          |
| `BROWSER_TIMEOUT`        | number | `30000`      | Timeout dla operacji przeglądarki (ms)                 |
| `AUTH_SSE_PORT`          | number | —            | Port dla MCP SSE (jeśli ustawiony, włącza tryb SSE)   |
| `AUTH_BIND_ADDRESS`      | string | Tailscale IP | Adres do bindowania (wymagany gdy brak Tailscale)      |
| `LOG_LEVEL`              | enum   | `info`       | Poziom logowania (`debug`, `info`, `warn`, `error`)    |

## Narzędzia MCP (tools)

Wszystkie narzędzia są rejestrowane w serwerze MCP. Poniżej lista z opisem.

### Zarządzanie credentialami

| Narzędzie                  | Opis                                                               |
|----------------------------|--------------------------------------------------------------------|
| `store_credentials`        | Zapisuje login i hasło z szyfrowaniem AES-256-GCM                  |
| `get_credentials`          | Odczytuje credentiale po ID (hasło domyślnie ukryte)               |
| `list_credentials`         | Listuje wszystkie credentiale (opcjonalnie filtruje po serwisie)   |
| `delete_credentials`       | Usuwa credentiale po ID                                            |
| `get_credentials_for_service` | Zwraca wszystkie credentiale dla danego serwisu                 |
| `generate_qr`              | Generuje kod QR Google Authenticator dla TOTP secretu              |

### Zarządzanie sekretami (API keys, tokeny)

| Narzędzie            | Opis                                                              |
|----------------------|-------------------------------------------------------------------|
| `store_secret`       | Zapisuje API key/token z szyfrowaniem AES-256-GCM                |
| `get_secret`         | Odczytuje sekret po ID (zwraca odszyfrowaną wartość)             |
| `list_secrets`       | Listuje sekrety (filtrowanie po serwisie i/lub rodzaju)          |
| `delete_secret`      | Usuwa sekret po ID                                                |

### Automatyzacja logowania przez przeglądarkę

| Narzędzie            | Opis                                                              |
|----------------------|-------------------------------------------------------------------|
| `browser_launch`     | Uruchamia nową sesję przeglądarki dla danego serwisu              |
| `browser_navigate`   | Nawiguje do URL w aktywnej sesji                                  |
| `browser_close`      | Zamyka sesję przeglądarki                                         |
| `list_sessions`      | Listuje wszystkie aktywne sesje przeglądarki                      |
| `login_service`      | Automatyzuje logowanie: wypełnia formularz, captcha, 2FA         |
| `detect_captcha`     | Sprawdza czy na stronie jest CAPTCHA                              |
| `solve_captcha`      | Rozwiązuje CAPTCHA przez 2Captcha API                            |
| `click_submit`       | Klika przycisk submit (używane po rozwiązaniu captcha)            |
| `detect_2fa`         | Sprawdza czy strona wymaga kodu 2FA                               |
| `solve_2fa`          | Generuje kod TOTP z sekretu i wypełnia pole 2FA                  |
| `check_session`      | Sprawdza czy sesja jest aktywna i czy użytkownik jest zalogowany  |

### Rejestracja serwisów

| Narzędzie            | Opis                                                              |
|----------------------|-------------------------------------------------------------------|
| `list_services`      | Listuje zarejestrowane szablony logowania                         |
| `get_service_template` | Zwraca szczegóły szablonu logowania dla serwisu                |
| `add_service`        | Rejestruje niestandardowy szablon logowania w runtime             |

### Diagnostyka

| Narzędzie                 | Opis                                                              |
|---------------------------|-------------------------------------------------------------------|
| `vault_health`            | Kompleksowy health check: storage, encryption, serwisy, sesje     |
| `test_credential`         | Testuje czy credentiale istnieją i mają poprawną strukturę        |
| `test_session_integrity`  | Sprawdza czy sesje przeglądarki są żywe                          |
| `test_totp`               | Weryfikuje sekret TOTP przez wygenerowanie kodu                  |
| `test_service_selector`   | Testuje czy selektor CSS działa na stronie logowania             |
| `test_secret_expiry`      | Sprawdza wszystkie sekrety pod kątem wygaśnięcia                 |
| `test_browser_cdp`        | Testuje połączenie Chrome DevTools Protocol                      |
| `test_all_services`       | Testuje dostępność stron logowania wszystkich serwisów           |

## REST API (port 5600)

Serwer WWW udostępnia interfejs REST oraz dashboard HTML:

| Ścieżka                       | Metoda   | Opis                                              |
|-------------------------------|----------|---------------------------------------------------|
| `/`                           | GET      | Dashboard HTML                                    |
| `/health`                     | GET      | Health check                                      |
| `/api/credentials`            | GET/POST | Lista / dodawanie credentiali                     |
| `/api/credentials/:id`        | GET/DELETE | Szczegóły / usuwanie credentiali              |
| `/api/secrets`                | GET/POST | Lista / dodawanie sekretów                        |
| `/api/secrets/:id`            | DELETE   | Usuwanie sekretu                                  |
| `/api/login/:credentialId`    | POST     | Automatyczne logowanie (Google)                  |
| `/api/login/2fa`              | POST     | Przesłanie kodu 2FA                               |
| `/api/login/status/:sessionId`| GET      | Status sesji logowania                            |
| `/api/totp/generate`          | GET      | Generowanie nowego sekretu TOTP + QR kod         |
| `/api/totp/verify`            | POST     | Weryfikacja kodu TOTP                             |
| `/api/totp/attach`            | POST     | Dołączenie sekretu TOTP do credentiali           |

**Uwaga:** REST API jest dostępne tylko z sieci Tailscale i localhosta.
Żądania spoza Tailscale są odrzucane (403).

## Struktura danych (vault/)

```
vault/
├── index.json        # Indeks credentiali (szyfrowane payloady AES-256-GCM)
├── secrets.json      # Indeks sekretów (szyfrowane payloady AES-256-GCM)
└── qr-codes/         # Wygenerowane kody QR (PNG)
```

### Format credential entry (index.json)

```json
{
  "entries": [
    {
      "id": "hex-32-znaki",
      "service": "google",
      "label": "Konto osobiste",
      "data": {
        "ciphertext": "hex...",
        "iv": "hex...",
        "authTag": "hex..."
      },
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601",
      "tags": ["produkcyjne", "ważne"]
    }
  ]
}
```

Odszyfrowany payload (ServiceCredentialFields):
```json
{
  "username": "user@example.com",
  "password": "tajne_haslo",
  "extra": {
    "totp_secret": "BASE32SECRET...",
    "organization": "mycorp"
  }
}
```

### Format secret entry (secrets.json)

```json
{
  "entries": [
    {
      "id": "hex-32-znaki",
      "label": "OpenAI API Key",
      "kind": "api_key",
      "service": "openai",
      "data": { "ciphertext": "...", "iv": "...", "authTag": "..." },
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601",
      "tags": ["llm"]
    }
  ]
}
```

Dozwolone `kind`: `api_key`, `bearer_token`, `access_token`, `refresh_token`,
`private_key`, `generic`.

## Szablony logowania (services)

Wbudowane serwisy: `google`, `github` (demo). Resztę konfigurujesz przez `add_service` w runtime — wystarczy znać selektory CSS strony logowania.

Każdy szablon definiuje:
- `loginUrl` — URL strony logowania
- `usernameSelector`, `passwordSelector`, `submitSelector` — selektory CSS
- `successUrlPattern`, `successSelector` — weryfikacja zalogowania
- `twoFactorSelector`, `twoFactorUrlPattern` — obsługa 2FA
- `preLoginSteps`, `postLoginSteps` — dodatkowe kroki
- `extraFields` — dodatkowe pola formularza

Nowe serwisy można rejestrować w runtime przez `add_service`.

## Obsługa CAPTCHA

Wykrywanie: reCAPTCHA v2/v3, hCaptcha, image captcha, text captcha.

Rozwiązywanie: przez 2Captcha API (klucz w `CAPTCHA_API_KEY`).
Proces: `detect_captcha` → `solve_captcha` → `applyRecaptchaSolution` → `click_submit`.

## Obsługa 2FA / TOTP

- Generowanie sekretu TOTP: `generateTOTPSecret()` (20 bajtów base32)
- Generowanie kodu: `generateTOTP(secret)` — RFC 6238 (SHA1, 6 cyfr, 30s)
- Automatyczne wypełnienie 2FA podczas `login_service` jeśli `totp_secret` istnieje
- Wsparcie dla Google Authenticator QR: `generate_qr` tool

## CLI (narzędzia wiersza poleceń)

| Skrypt                       | Opis                                              |
|------------------------------|---------------------------------------------------|
| `npm run add-creds`          | Dodaje credentiale interaktywnie                  |
| `npm run add-secret`         | Dodaje sekret interaktywnie                       |
| `npm run list-creds`         | Listuje wszystkie credentiale                     |
| `npm run get-creds`          | Pokazuje szczegóły credentiala                    |
| `npm run list-secrets`       | Listuje wszystkie sekrety                         |

## Wskazówki dla agentów AI

1. **Zawsze sprawdzaj `vault_health`** przed pierwszym użyciem — zweryfikuj
   szyfrowanie, storage i dostępność serwisów.

2. **Credentiale vs Sekrety**: credentiale służą do logowania (username + password),
   sekrety do API keys/tokenów. Używaj odpowiednich narzędzi.

3. **Bezpieczeństwo haseł**: hasła są domyślnie ukryte w odpowiedziach
   (`get_credentials` zwraca `***`). Ustaw `includePassword: true` tylko gdy
   naprawdę potrzebujesz.

4. **Sesje przeglądarki**: zawsze zamykaj sesje po zakończeniu (`browser_close`).
   Nieotwarte sesje są automatycznie czyszczone po 30 minutach (REST API) lub
   przy restarcie serwera.

5. **CAPTCHA**: `login_service` automatycznie wykrywa i rozwiązuje CAPTCHA.
   Jeśli rozwiązanie się nie powiedzie, agent może użyć `detect_captcha` +
   `solve_captcha` + `click_submit` ręcznie.

6. **2FA/TOTP**: jeśli credential ma pole `extra.totp_secret`, `login_service`
   automatycznie obsłuży 2FA. Dla Google używa dedykowanej ścieżki
   ("Try another way" → "Google Authenticator").

7. **Sieć**: tryb SSE wymaga Tailscale. REST API jest dostępne tylko z
   Tailscale/localhost. Sprawdź `test_browser_cdp` jeśli potrzebujesz
   debugować przeglądarkę.

8. **Szablony serwisów**: możesz dodać własny serwis w runtime przez
   `add_service` — wystarczy znać selektory CSS strony logowania.

## Przykładowy przepływ (workflow)

```
1. vault_health                     → sprawdź stan
2. store_credentials                → zapisz credentiale (np. google)
3. browser_launch(service="google") → uruchom przeglądarkę
4. login_service(sessionId, credentialId) → automatyczne logowanie
5. Jeśli 2FA: automatycznie lub detect_2fa + solve_2fa
6. check_session                    → weryfikacja
7. browser_close                    → zamknij sesję
```

Lub dla API key:
```
1. store_secret(kind="api_key", service="openai") → zapisz klucz
2. get_secret(id) → odczytaj
```
