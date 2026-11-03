const TAILSCALE_IP = process.env.TAILSCALE_IP || "localhost";
const PORT = process.env.WEB_UI_PORT || "5500";
const BASE = `http://${TAILSCALE_IP}:${PORT}`;

export function htmlDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Auth Vault</title>
<style>
  :root {
    --bg: #0f0f1a; --card: #1a1a2e; --accent: #4f8cff;
    --text: #e0e0e0; --muted: #888; --danger: #ff4757; --ok: #2ed573;
    --radius: 10px; --shadow: 0 2px 8px rgba(0,0,0,.4);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 16px; line-height: 1.5; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.4rem; display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
  h1 small { font-size: .7rem; color: var(--muted); font-weight: normal; }
  h2 { font-size: 1.1rem; margin-bottom: 12px; }
  .card { background: var(--card); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; box-shadow: var(--shadow); }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .7rem;
    font-weight: 600; text-transform: uppercase;
  }
  .badge-cred { background: #3742fa22; color: #4f8cff; }
  .badge-secret { background: #ff634822; color: #ff6348; }
  .badge-ok { background: #2ed57322; color: #2ed573; }
  .badge-fail { background: #ff475722; color: #ff4757; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { text-align: left; padding: 8px 4px; border-bottom: 1px solid #ffffff11; }
  th { color: var(--muted); font-weight: 500; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  button, .btn {
    background: var(--accent); color: #fff; border: none; padding: 8px 14px;
    border-radius: 6px; font-size: .8rem; cursor: pointer;
  }
  button:hover { filter: brightness(1.15); }
  button.danger { background: var(--danger); }
  button.small { padding: 4px 10px; font-size: .75rem; }
  button.outline { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
  input, select, textarea {
    width: 100%; padding: 10px 12px; border: 1px solid #ffffff22; border-radius: 6px;
    background: #ffffff08; color: var(--text); font-size: .9rem; margin-bottom: 10px;
  }
  input:focus { outline: none; border-color: var(--accent); }
  label { display: block; font-size: .8rem; color: var(--muted); margin-bottom: 4px; }
  .row { display: flex; gap: 12px; }
  .row > * { flex: 1; }
  .toast {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: var(--card); padding: 12px 24px; border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,.6); z-index: 999;
    display: none; border-left: 3px solid var(--accent);
  }
  .toast.error { border-color: var(--danger); }
  .toast.ok { border-color: var(--ok); }
  .empty { text-align: center; padding: 30px; color: var(--muted); }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status-dot.online { background: var(--ok); }
  .status-dot.offline { background: var(--danger); }
  .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,.6); justify-content: center; align-items: center; z-index: 100; }
  .modal.show { display: flex; }
  .modal-content { background: var(--card); border-radius: var(--radius); padding: 24px;
    max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; }
  .modal h3 { margin-bottom: 16px; }
  .close-btn { float: right; background: none; border: none; color: var(--muted); font-size: 1.4rem; cursor: pointer; }
  .tab-bar { display: flex; gap: 4px; margin-bottom: 16px; }
  .tab { padding: 8px 16px; cursor: pointer; border-radius: 6px 6px 0 0; font-size: .85rem; color: var(--muted); }
  .tab.active { background: var(--card); color: var(--text); font-weight: 600; }
  @media (max-width: 600px) {
    .row { flex-direction: column; gap: 0; }
    table { font-size: .75rem; }
    th:nth-child(3), td:nth-child(3) { display: none; }
  }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: .8rem; }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover { background: #ffffff08; }
  .badge[title] { position: relative; cursor: help; }
  .badge[title]:hover::after {
    content: attr(title);
    position: absolute;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: .7rem;
    font-weight: normal;
    text-transform: none;
    white-space: nowrap;
    box-shadow: var(--shadow);
    z-index: 1000;
    border: 1px solid #ffffff22;
  }
  .badge[title]:hover::before {
    content: '';
    position: absolute;
    bottom: 118%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: var(--bg);
    z-index: 1000;
  }
</style>
</head>
<body>
<div class="container">
  <h1>🔐 Auth Vault <small>mcp-auth-vault</small></h1>
  <div id="stats-bar" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
    <div class="card" style="flex:1;min-width:120px;text-align:center;padding:12px;margin:0">
      <div style="font-size:1.6rem;font-weight:700" id="stat-creds">—</div>
      <div style="color:var(--muted);font-size:.75rem">Credentials</div>
    </div>
    <div class="card" style="flex:1;min-width:120px;text-align:center;padding:12px;margin:0">
      <div style="font-size:1.6rem;font-weight:700" id="stat-secrets">—</div>
      <div style="color:var(--muted);font-size:.75rem">Secrets</div>
    </div>
    <div class="card" style="flex:1;min-width:120px;text-align:center;padding:12px;margin:0">
      <div style="font-size:1.6rem;font-weight:700" id="stat-ssh">—</div>
      <div style="color:var(--muted);font-size:.75rem">SSH Keys</div>
    </div>
    <div class="card" style="flex:1;min-width:120px;text-align:center;padding:12px;margin:0">
      <div style="font-size:1.6rem;font-weight:700" id="stat-actions">—</div>
      <div style="color:var(--muted);font-size:.75rem">Actions (24h)</div>
    </div>
  </div>

  <!-- Unified Search Bar -->
  <div class="card" style="margin-bottom:12px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label for="unified-search" style="margin:0;font-size:.8rem;color:var(--muted);min-width:50px">🔍 Search</label>
      <input type="text" id="unified-search" placeholder="Search across credentials, secrets, SSH keys... (tags, service, label)" style="flex:1;min-width:200px;margin:0;padding:10px 12px">
      <span id="search-count" style="font-size:.75rem;color:var(--muted);min-width:80px;text-align:right"></span>
      <button onclick="clearUnifiedSearch()" class="small outline" style="margin:0">Clear</button>
    </div>
  </div>

  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('credentials')">Credentials</div>
    <div class="tab" onclick="switchTab('secrets')">Secrets</div>
    <div class="tab" onclick="switchTab('login')">Login</div>
    <div class="tab" onclick="switchTab('2fa')">2FA</div>
    <div class="tab" onclick="switchTab('ssh')">SSH Keys</div>
    <div class="tab" onclick="switchTab('generator')">🔐 Generator</div>
    <div class="tab" onclick="switchTab('audit')">Audit</div>
  </div>

  <!-- Credentials tab -->
  <div id="tab-credentials" class="tab-content">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2>Saved Credentials</h2>
        <button onclick="showAddCred()" class="small">+ Add</button>
      </div>
      <div id="cred-list"><div class="empty">Loading...</div></div>
    </div>
  </div>

  <!-- Secrets tab -->
  <div id="tab-secrets" class="tab-content" style="display:none">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2>Saved Secrets</h2>
        <button onclick="showAddSecret()" class="small">+ Add</button>
      </div>
      <div id="secret-list"><div class="empty">Loading...</div></div>
    </div>
  </div>

  <!-- Login tab -->
  <div id="tab-login" class="tab-content" style="display:none">
    <div class="card">
      <h2>Quick Login</h2>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:12px">
        Select a credential and start the login flow. If 2FA is configured with a TOTP secret, it will be solved automatically.
      </p>
      <div id="login-form">
        <label for="login-cred">Credential</label>
        <select id="login-cred"></select>
        <button onclick="startLogin()" style="width:100%">🚀 Start Login</button>
      </div>
      <div id="login-status" style="display:none;margin-top:12px"></div>
      <div id="login-2fa" style="display:none;margin-top:12px">
        <label for="tfa-code">🔑 2FA Code Required</label>
        <div class="row">
          <input type="text" id="tfa-code" inputmode="numeric" placeholder="6-digit code" style="flex:2" maxlength="8" autocomplete="one-time-code">
          <button onclick="submit2FA()" style="flex:0;white-space:nowrap">Submit</button>
        </div>
      </div>
    </div>
    <div id="login-result" class="card" style="display:none"></div>
  </div>
  </div>

  <!-- 2FA tab -->
  <div id="tab-2fa" class="tab-content" style="display:none">
    <!-- Generate TOTP Secret -->
    <div class="card">
      <h2>Generate TOTP Secret</h2>
      <div class="row">
        <div>
          <label for="2fa-account">Account</label>
          <input id="2fa-account" placeholder="user@example.com" value="user@example.com">
        </div>
        <div>
          <label for="2fa-issuer">Issuer</label>
          <input id="2fa-issuer" placeholder="MyApp" value="AuthVault">
        </div>
      </div>
      <button onclick="generateTOTP()" id="2fa-gen-btn" style="width:100%">🔑 Generate Secret</button>
      <div id="2fa-result" style="display:none;margin-top:12px">
        <div style="text-align:center;margin:12px 0">
          <img id="2fa-qr-img" style="display:none;margin:0 auto;border-radius:8px;max-width:200px" alt="QR Code">
        </div>
        <label>Secret (base32)</label>
        <div style="display:flex;gap:8px">
          <code id="2fa-secret" class="mono" style="flex:1;background:#ffffff08;padding:10px 12px;border-radius:6px;word-break:break-all"></code>
          <button onclick="copyTOTPSecret()" class="small" style="white-space:nowrap">📋 Copy</button>
        </div>
        <label style="margin-top:8px">otpauth:// URI</label>
        <code id="2fa-otpauth" class="mono" style="display:block;background:#ffffff08;padding:8px 12px;border-radius:6px;font-size:.7rem;word-break:break-all"></code>
      </div>
    </div>

    <!-- Verify TOTP Code -->
    <div class="card">
      <h2>Verify TOTP Code</h2>
      <label for="2fa-verify-secret">TOTP Secret</label>
      <input id="2fa-verify-secret" placeholder="Paste the secret here">
      <label for="2fa-verify-code">6-digit code</label>
      <div class="row">
        <input type="text" id="2fa-verify-code" inputmode="numeric" placeholder="000000" maxlength="6" style="flex:2">
        <button onclick="verifyTOTPCode()" style="flex:0;white-space:nowrap">Verify</button>
      </div>
      <div id="2fa-verify-result" style="margin-top:8px"></div>
    </div>

    <!-- Attach to Credential -->
    <div class="card">
      <h2>Attach to Credential</h2>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:12px">
        Link this TOTP secret to a credential so the login flow can auto-solve 2FA.
      </p>
      <label for="2fa-cred">Credential</label>
      <select id="2fa-cred"></select>
      <label for="2fa-attach-secret">TOTP Secret</label>
      <input id="2fa-attach-secret" placeholder="Generated secret will auto-fill">
      <button onclick="attachTOTP()" style="width:100%">Attach to Credential</button>
    </div>

    <!-- Credentials with TOTP -->
    <div class="card">
      <h2>Credentials with 2FA</h2>
      <div id="2fa-creds-list"><div class="empty">Loading...</div></div>
    </div>
  </div>

  <!-- Password Generator tab -->
  <div id="tab-generator" class="tab-content" style="display:none">
    <div class="card">
      <h2>🔐 Generator Haseł</h2>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:12px">
        Kryptograficznie bezpieczne hasła przez <code>openssl rand</code> (fallback: Node crypto).
      </p>
      <div class="row" style="align-items:flex-end">
        <div>
          <label for="pw-length">Długość</label>
          <input type="number" id="pw-length" value="16" min="4" max="128" style="width:80px">
        </div>
        <div>
          <label for="pw-count">Ilość</label>
          <input type="number" id="pw-count" value="1" min="1" max="20" style="width:70px">
        </div>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pw-lower" checked> a-z</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pw-upper" checked> A-Z</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pw-digits" checked> 0-9</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pw-symbols"> !@#$</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pw-exclude"> Bez podobnych (i,l,1,O,0)</label>
      </div>
      <div class="row" style="margin-top:10px">
        <button onclick="genPassword()" id="pw-btn">🔄 Generuj</button>
        <button onclick="genPassphrase()" class="outline">📝 Passphrase (diceware)</button>
        <select id="pw-method" style="flex:0">
          <option value="auto">Metoda: auto (openssl)</option>
          <option value="openssl">openssl rand</option>
          <option value="node">node:crypto</option>
        </select>
      </div>
      <div id="pw-result" style="margin-top:16px"></div>
    </div>
  </div>

  <!-- Audit tab -->
  <div id="tab-audit" class="tab-content" style="display:none">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2>Audit Log</h2>
        <div>
          <button onclick="loadAuditLog()" class="small outline">↻ Refresh</button>
        </div>
      </div>
      <div id="audit-list"><div class="empty">Loading...</div></div>
    </div>
    <div class="card">
      <h2>Audit Summary (24h)</h2>
      <div id="audit-summary"><div class="empty">Loading...</div></div>
    </div>
  </div>

  <!-- SSH Keys tab -->
  <div id="tab-ssh" class="tab-content" style="display:none">
    <!-- SSH Key List -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2>SSH Keys</h2>
        <div style="display:flex;gap:8px">
          <button onclick="showAddSSHKey()" class="small" style="background:var(--ok)">+ Import Key</button>
          <button onclick="showGenerateSSH()" class="small">+ Generate</button>
        </div>
      </div>
      <div id="ssh-key-list"><div class="empty">Loading...</div></div>
    </div>

    <!-- Quick Connect -->
    <div class="card" id="ssh-quick-connect" style="display:none">
      <h2>Quick Connect</h2>
      <div style="background:#ffffff08;padding:12px;border-radius:6px;font-family:'SF Mono','Fira Code',monospace;font-size:.8rem;word-break:break-all" id="ssh-connect-cmd"></div>
      <button onclick="copySSHCommand()" class="small" style="margin-top:8px">📋 Copy Command</button>
    </div>

    <!-- SSH Config Generator -->
    <div class="card" id="ssh-config-card" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>SSH Config Fragment</h2>
        <button onclick="copySSHConfig()" class="small">📋 Copy</button>
      </div>
      <pre id="ssh-config-text" style="background:#ffffff08;padding:12px;border-radius:6px;font-size:.8rem;margin-top:8px;overflow-x:auto"></pre>
    </div>

    <!-- Generate Key Pair -->
    <div class="card">
      <h2>Generate New Key Pair</h2>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:12px">
        Create a new SSH key pair and store it in the vault.
      </p>
      <div class="row">
        <div>
          <label for="ssh-gen-type">Type</label>
          <select id="ssh-gen-type">
            <option value="ed25519">Ed25519</option>
            <option value="rsa">RSA</option>
          </select>
        </div>
        <div id="ssh-gen-rsa-bits-row" style="display:none">
          <label for="ssh-gen-rsa-bits">RSA Bits</label>
          <select id="ssh-gen-rsa-bits">
            <option value="2048">2048</option>
            <option value="4096" selected>4096</option>
          </select>
        </div>
        <div style="flex:2">
          <label for="ssh-gen-host">Host</label>
          <input id="ssh-gen-host" placeholder="e.g. web01, github.com">
        </div>
        <div>
          <label for="ssh-gen-port">Port</label>
          <input id="ssh-gen-port" value="22" style="width:80px">
        </div>
      </div>
      <div class="row">
        <div>
          <label for="ssh-gen-user">Username</label>
          <input id="ssh-gen-user" placeholder="e.g. deploy, git">
        </div>
        <div style="flex:2">
          <label for="ssh-gen-label">Label</label>
          <input id="ssh-gen-label" placeholder="e.g. Production Deploy Key">
        </div>
      </div>
      <div class="row">
        <div style="flex:2">
          <label for="ssh-gen-comment">Comment (optional)</label>
          <input id="ssh-gen-comment" placeholder="e.g. deploy@web01">
        </div>
        <div>
          <label for="ssh-gen-passphrase">Passphrase (optional)</label>
          <input id="ssh-gen-passphrase" type="password" placeholder="••••••••">
        </div>
      </div>
      <div class="row">
        <div style="flex:2">
          <label for="ssh-gen-hostname">Full Hostname (optional)</label>
          <input id="ssh-gen-hostname" placeholder="e.g. 10.0.0.5 or server.example.com">
        </div>
        <div>
          <label for="ssh-gen-tags">Tags (optional, comma-separated)</label>
          <input id="ssh-gen-tags" placeholder="production,web">
        </div>
      </div>
      <button onclick="generateSSHKey()" id="ssh-gen-btn" style="width:100%">🔑 Generate &amp; Store</button>
      <div id="ssh-gen-result" style="display:none;margin-top:12px">
        <div style="background:#ffffff08;padding:12px;border-radius:6px;font-size:.8rem">
          <label>Public Key</label>
          <code id="ssh-gen-pubkey" class="mono" style="display:block;background:#00000022;padding:8px;border-radius:4px;word-break:break-all;margin-top:4px"></code>
          <button onclick="copyElement('ssh-gen-pubkey')" class="small" style="margin-top:4px">📋 Copy</button>
          <span style="margin-left:8px;color:var(--muted)">Fingerprint: <code id="ssh-gen-fingerprint" class="mono"></code></span>
        </div>
      </div>
    </div>

    <!-- Extract Public Key -->
    <div class="card">
      <h2>Extract Public Key</h2>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:12px">
        Paste a private key to extract its public key and fingerprint (no storage).
      </p>
      <label for="ssh-extract-key">Private Key (PEM/OpenSSH)</label>
      <textarea id="ssh-extract-key" rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" style="font-family:monospace;font-size:.75rem"></textarea>
      <label for="ssh-extract-passphrase">Passphrase (if encrypted)</label>
      <input id="ssh-extract-passphrase" type="password" placeholder="••••••••">
      <button onclick="extractPublicKeyUI()" style="width:100%">🔍 Extract</button>
      <div id="ssh-extract-result" style="display:none;margin-top:12px">
        <label>Public Key</label>
        <code id="ssh-extract-pubkey" class="mono" style="display:block;background:#00000022;padding:8px;border-radius:4px;word-break:break-all"></code>
        <button onclick="copyElement('ssh-extract-pubkey')" class="small" style="margin-top:4px">📋 Copy</button>
        <span style="margin-left:8px;color:var(--muted)">Fingerprint: <code id="ssh-extract-fp" class="mono"></code></span>
      </div>
    </div>
  </div>

<!-- Add SSH Key Modal -->
<div class="modal" id="modal-ssh-add">
  <div class="modal-content">
    <button class="close-btn" onclick="closeModal('modal-ssh-add')">&times;</button>
    <h3>Import SSH Key</h3>
    <label for="ssh-add-label">Label</label>
    <input id="ssh-add-label" placeholder="e.g. Production Deploy Key">
    <label for="ssh-add-type">Key Type</label>
    <input id="ssh-add-type" placeholder="e.g. ed25519, rsa-4096">
    <div class="row">
      <div>
        <label for="ssh-add-host">Host</label>
        <input id="ssh-add-host" placeholder="e.g. web01, github.com">
      </div>
      <div>
        <label for="ssh-add-port">Port</label>
        <input id="ssh-add-port" value="22">
      </div>
    </div>
    <div class="row">
      <div>
        <label for="ssh-add-user">Username</label>
        <input id="ssh-add-user" placeholder="e.g. deploy, git">
      </div>
      <div>
        <label for="ssh-add-hostname">Full Hostname (optional)</label>
        <input id="ssh-add-hostname" placeholder="e.g. 10.0.0.5">
      </div>
    </div>
    <label for="ssh-add-private">Private Key</label>
    <textarea id="ssh-add-private" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" style="font-family:monospace;font-size:.75rem"></textarea>
    <label for="ssh-add-public">Public Key (optional)</label>
    <input id="ssh-add-public" placeholder="ssh-ed25519 AAAAC3... comment">
    <label for="ssh-add-passphrase">Passphrase (optional)</label>
    <input id="ssh-add-passphrase" type="password" placeholder="••••••••">
    <label for="ssh-add-comment">Comment (optional)</label>
    <input id="ssh-add-comment" placeholder="e.g. user@host">
    <label for="ssh-add-tags">Tags (optional, comma-separated)</label>
    <input id="ssh-add-tags" placeholder="production,web">
    <button onclick="addSSHKey()" style="width:100%">Save SSH Key</button>
  </div>
</div>
  </div>

<!-- Add Credential Modal -->
<div class="modal" id="modal-cred">
  <div class="modal-content">
    <button class="close-btn" onclick="closeModal('modal-cred')">&times;</button>
    <h3>Add Credential</h3>
    <label for="cred-service">Service</label>
    <input id="cred-service" placeholder="e.g. google, github">
    <label for="cred-label">Label</label>
    <input id="cred-label" placeholder="e.g. My Account">
    <label for="cred-username">Username / Email</label>
    <input id="cred-username" placeholder="user@example.com">
    <label for="cred-password">Password</label>
    <input id="cred-password" type="password" placeholder="••••••••">
    <label for="cred-totp">TOTP Secret (optional)</label>
    <input id="cred-totp" placeholder="JBSWY3DPEHPK3PXP">
    <label for="cred-tags">Tags (optional, comma-separated)</label>
    <input id="cred-tags" placeholder="work,production">
    <button onclick="addCredential()" style="width:100%">Save Credential</button>
  </div>
</div>

<!-- Add Secret Modal -->
<div class="modal" id="modal-secret">
  <div class="modal-content">
    <button class="close-btn" onclick="closeModal('modal-secret')">&times;</button>
    <h3>Add Secret</h3>
    <label for="sec-label">Label</label>
    <input id="sec-label" placeholder="e.g. OpenAI API Key">
    <label for="sec-kind">Type</label>
    <select id="sec-kind">
      <option value="api_key">API Key</option>
      <option value="bearer_token">Bearer Token</option>
      <option value="access_token">Access Token</option>
      <option value="refresh_token">Refresh Token</option>
      <option value="private_key">Private Key</option>
      <option value="generic">Generic</option>
    </select>
    <label for="sec-service">Service</label>
    <input id="sec-service" placeholder="e.g. openai, github, stripe">
    <label for="sec-value">Secret Value</label>
    <input id="sec-value" type="password" placeholder="sk-...">
    <label for="sec-desc">Description (optional)</label>
    <input id="sec-desc" placeholder="What is this for?">
    <button onclick="addSecret()" style="width:100%">Save Secret</button>
  </div>
</div>

<!-- Credential Detail Modal -->
<div class="modal" id="modal-cred-detail">
  <div class="modal-content" style="max-width:600px">
    <button class="close-btn" onclick="closeModal('modal-cred-detail')">&times;</button>
    <h3 id="cred-detail-title">Credential Detail</h3>
    <div id="cred-detail-body"></div>
  </div>
</div>

<!-- Secret Detail Modal -->
<div class="modal" id="modal-secret-detail">
  <div class="modal-content" style="max-width:600px">
    <button class="close-btn" onclick="closeModal('modal-secret-detail')">&times;</button>
    <h3 id="secret-detail-title">Secret Detail</h3>
    <div id="secret-detail-body"></div>
  <!-- Edit Credential Modal -->
<div class="modal" id="modal-edit-cred">
  <div class="modal-content">
    <button class="close-btn" onclick="closeModal('modal-edit-cred')">&times;</button>
    <h3 id="edit-cred-title">Edit Credential</h3>
    <div id="edit-cred-body"></div>
    <button onclick="updateCredential()" style="width:100%">Save Changes</button>
  </div>
</div>

<!-- Edit Secret Modal -->
<div class="modal" id="modal-edit-secret">
  <div class="modal-content">
    <button class="close-btn" onclick="closeModal('modal-edit-secret')">&times;</button>
    <h3 id="edit-secret-title">Edit Secret</h3>
    <div id="edit-secret-body"></div>
    <button onclick="updateSecret()" style="width:100%">Save Changes</button>
  </div>
</div>

</div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<!-- Session status polling -->
<div id="session-status" style="display:none"></div>

<script>

// ── Stats / Overview ──────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const s = await api('/api/discovery/stats');
    document.getElementById('stat-creds').textContent = s.credentials?.total ?? '—';
    document.getElementById('stat-secrets').textContent = s.secrets ?? '—';
    document.getElementById('stat-ssh').textContent = s.sshKeys ?? '—';
    const sum = await api('/api/audit/summary');
    document.getElementById('stat-actions').textContent = sum.total ?? '—';
  } catch {}
}
const API = window.location.origin;

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type; t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).style.display = '';
  document.querySelector('.tab[onclick*="' + name + '"]').classList.add('active');
  if (name === 'credentials') loadCredentials();
  if (name === 'secrets') loadSecrets();
  if (name === 'login') { loadLoginCreds(); }
  if (name === '2fa') { load2FA(); }
  if (name === 'ssh') { loadSSHKeys(); }
  if (name === 'audit') { loadAuditLog(); }
}

// ── Unified Search ───────────────────────────────────────────────────────────

let searchDebounceTimer = null;
let currentSearchQuery = '';
let cachedEntries = { credentials: [], secrets: [], ssh: [] };
let editingCredId = null;
let editingSecretId = null;

function initUnifiedSearch() {
  const input = document.getElementById('unified-search');
  if (!input) return;
  input.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      currentSearchQuery = e.target.value.trim().toLowerCase();
      applySearchFilter();
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearUnifiedSearch();
  });
}

function clearUnifiedSearch() {
  const input = document.getElementById('unified-search');
  if (input) {
    input.value = '';
    currentSearchQuery = '';
    applySearchFilter();
    input.focus();
  }
}

function applySearchFilter() {
  const countEl = document.getElementById('search-count');
  const activeTab = document.querySelector('.tab.active')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1] || 'credentials';

  if (!currentSearchQuery) {
    if (countEl) countEl.textContent = '';
    renderCurrentTab(activeTab);
    return;
  }

  let filtered = [];
  let total = 0;

  if (activeTab === 'credentials') {
    filtered = cachedEntries.credentials.filter(e =>
      (e.label?.toLowerCase().includes(currentSearchQuery)) ||
      (e.service?.toLowerCase().includes(currentSearchQuery)) ||
      (e.username?.toLowerCase().includes(currentSearchQuery)) ||
      (e.tags || []).some(t => t.toLowerCase().includes(currentSearchQuery))
    );
    total = cachedEntries.credentials.length;
    renderFilteredCredentials(filtered);
  } else if (activeTab === 'secrets') {
    filtered = cachedEntries.secrets.filter(e =>
      (e.label?.toLowerCase().includes(currentSearchQuery)) ||
      (e.kind?.toLowerCase().includes(currentSearchQuery)) ||
      (e.service?.toLowerCase().includes(currentSearchQuery)) ||
      (e.tags || []).some(t => t.toLowerCase().includes(currentSearchQuery))
    );
    total = cachedEntries.secrets.length;
    renderFilteredSecrets(filtered);
  } else if (activeTab === 'ssh') {
    filtered = cachedEntries.ssh.filter(e =>
      (e.label?.toLowerCase().includes(currentSearchQuery)) ||
      (e.host?.toLowerCase().includes(currentSearchQuery)) ||
      (e.user?.toLowerCase().includes(currentSearchQuery)) ||
      (e.tags || []).some(t => t.toLowerCase().includes(currentSearchQuery))
    );
    total = cachedEntries.ssh.length;
    renderFilteredSSH(filtered);
  }

  if (countEl) countEl.textContent = filtered.length + ' / ' + total;
}

function renderCurrentTab(tab) {
  if (tab === 'credentials') loadCredentials();
  else if (tab === 'secrets') loadSecrets();
  else if (tab === 'ssh') loadSSHKeys();
}

function renderFilteredCredentials(entries) {
  const el = document.getElementById('cred-list');
  if (!el) return;
  if (entries.length === 0) {
    el.innerHTML = '<div class="empty">No matching credentials</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Label</th><th>Service</th><th>Tags</th><th>Actions</th></tr></thead><tbody>' +
    entries.map(e => '<tr class="clickable" data-id="' + e.id + '" onclick="showCredDetail(this.dataset.id)">' +
      '<td><strong>' + esc(e.label) + '</strong></td>' +
      '<td><span class="badge badge-cred">' + esc(e.service) + '</span></td>' +
      '<td>' + (e.tags || []).map(t => '<span class="badge" style="background:#ffffff11" title="' + esc(t) + '">' + esc(t) + '</span> ').join('') + '</td>' +
      '<td>' +
      '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copyCredUsername(this.dataset.id)" title="Copy username">👤</button>' +
      '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copyCredPassword(this.dataset.id)" title="Copy password">🔑</button>' +
      '<button class="danger small" data-id="' + e.id + '" onclick="event.stopPropagation();deleteCred(this.dataset.id)">✕</button>' +
      '</td>' +
      '</tr>').join('') +
    '</tbody></table>';
}

function renderFilteredSecrets(entries) {
  const el = document.getElementById('secret-list');
  if (!el) return;
  if (entries.length === 0) {
    el.innerHTML = '<div class="empty">No matching secrets</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Label</th><th>Kind</th><th>Service</th><th>Actions</th></tr></thead><tbody>' +
    entries.map(e => '<tr class="clickable" data-id="' + e.id + '" onclick="showSecretDetail(this.dataset.id)">' +
      '<td><strong>' + esc(e.label) + '</strong></td>' +
      '<td><span class="badge badge-secret">' + esc(e.kind) + '</span></td>' +
      '<td>' + esc(e.service) + '</td>' +
      '<td>' +
      '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copySecretValue(this.dataset.id)" title="Copy secret value">📋</button>' +
      '<button class="danger small" data-id="' + e.id + '" onclick="event.stopPropagation();deleteSecret(this.dataset.id)">✕</button>' +
      '</td>' +
      '</tr>').join('') +
    '</tbody></table>';
}

function renderFilteredSSH(entries) {
  const el = document.getElementById('ssh-key-list');
  if (!el) return;
  if (entries.length === 0) {
    el.innerHTML = '<div class="empty">No matching SSH keys</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Label</th><th>Host</th><th>User</th><th>Type</th><th>Actions</th></tr></thead><tbody>' +
    entries.map(e => '<tr class="clickable" data-id="' + e.id + '" onclick="showSSHDetail(this.dataset.id)">' +
      '<td><strong>' + esc(e.label) + '</strong></td>' +
      '<td>' + esc(e.host) + '</td>' +
      '<td>' + esc(e.user) + '</td>' +
      '<td><span class="badge badge-ok">' + esc(e.type || 'ed25519') + '</span></td>' +
      '<td>' +
      '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copySSHPrivateKey(this.dataset.id)" title="Copy private key">🔑</button>' +
      '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copySSHCommand(this.dataset.id)" title="Copy SSH command">💻</button>' +
      '<button class="danger small" data-id="' + e.id + '" onclick="event.stopPropagation();deleteSSHKey(this.dataset.id)">✕</button>' +
      '</td>' +
      '</tr>').join('') +
    '</tbody></table>';
}

// Cache entries when loaded (will be added inside load functions below)

async function api(path, opts = {}) {
  try {
    const r = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.text || (j.error && j.error.text) || 'Request failed');
    return j;
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

// ── Credentials ──────────────────────────────────────────────────────────────

async function loadCredentials() {
  try {
    const data = await api('/api/credentials');
    const entries = data.entries || [];
    cachedEntries.credentials = entries;
    if (currentSearchQuery) applySearchFilter();
    const el = document.getElementById('cred-list');
    if (entries.length === 0) {
      el.innerHTML = '<div class="empty">No credentials stored. Add one to get started.</div>';
      return;
    }
    el.innerHTML = '<table><thead><tr><th>Label</th><th>Service</th><th>Tags</th><th>Actions</th></tr></thead><tbody>' +
      entries.map(e => '<tr class="clickable" data-id="' + e.id + '" onclick="showCredDetail(this.dataset.id)">' +
        '<td><strong>' + esc(e.label) + '</strong></td>' +
        '<td><span class="badge badge-cred">' + esc(e.service) + '</span></td>' +
        '<td>' + (e.tags || []).map(t => '<span class="badge" style="background:#ffffff11" title="' + esc(t) + '">' + esc(t) + '</span> ').join('') + '</td>' +
        '<td>' +
        '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copyCredUsername(this.dataset.id)" title="Copy username">👤</button>' +
        '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copyCredPassword(this.dataset.id)" title="Copy password">🔑</button>' +
        '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();editCred(this.dataset.id)" title="Edit credential">✎</button>' +
        '<button class="danger small" data-id="' + e.id + '" onclick="event.stopPropagation();deleteCred(this.dataset.id)">✕</button>' +
        '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  } catch { document.getElementById('cred-list').innerHTML = '<div class="empty">Failed to load</div>'; }
}

async function copyCredUsername(id) {
  try {
    const d = await api('/api/credentials/' + id + '?includePassword=true');
    const c = d.credentials || {};
    await navigator.clipboard.writeText(c.username);
    toast('Username copied', 'ok');
  } catch { toast('Failed to copy username', 'error'); }
}

async function copyCredPassword(id) {
  try {
    const d = await api('/api/credentials/' + id + '?includePassword=true');
    const c = d.credentials || {};
    await navigator.clipboard.writeText(c.password);
    toast('Password copied', 'ok');
  } catch { toast('Failed to copy password', 'error'); }
}

async function showCredDetail(id) {
  try {
    const d = await api('/api/credentials/' + id + '?includePassword=true');
    const c = d.credentials || {};
    const extra = c.extra || {};
    const trustedDevices = c.trusted_devices || [];
    const hasTotp = !!extra.totp_secret;
    const totpRotated = extra.totp_rotated_at;

    let html = '<table style="font-size:.85rem">';
    html += '<tr><th style="width:120px">Service</th><td>' + esc(d.service) + '</td></tr>';
    html += '<tr><th>Label</th><td>' + esc(d.label) + '</td></tr>';
    html += '<tr><th>Username</th><td><code>' + esc(c.username) + '</code></td></tr>';
    html += '<tr><th>Password</th><td>';
    html += '<span id="pw-hidden-' + id + '">••••••••</span> ';
    html += '<span id="pw-reveal-' + id + '" style="display:none"><code>' + esc(c.password) + '</code></span> ';
    html += '<button class="small" data-id="' + id + '" onclick="togglePw(this.dataset.id)">👁 Reveal</button>';
    html += '</td></tr>';
    html += '<tr><th>TOTP</th><td>' + (hasTotp
      ? '<span class="badge badge-ok">Configured</span>'
      : '<span class="badge badge-fail">Not configured</span>') + '</td></tr>';
    if (totpRotated) html += '<tr><th>TOTP Last Rotated</th><td>' + esc(new Date(totpRotated).toLocaleString()) + '</td></tr>';
    if (d.tags && d.tags.length) html += '<tr><th>Tags</th><td>' + d.tags.map((t) => '<span class="badge" style="background:#ffffff11" title="' + esc(t) + '">' + esc(t) + '</span>').join(' ') + '</td></tr>';
    html += '<tr><th>Created</th><td>' + esc(new Date(d.createdAt).toLocaleString()) + '</td></tr>';
    if (d.updatedAt) html += '<tr><th>Updated</th><td>' + esc(new Date(d.updatedAt).toLocaleString()) + '</td></tr>';
    if (trustedDevices.length > 0) {
      html += '<tr><th>Trusted Devices</th><td>' + trustedDevices.length + '</td></tr>';
    }
    html += '</table>';

    if (trustedDevices.length > 0) {
      html += '<div style="margin-top:12px"><strong>Trusted Devices</strong></div>';
      html += '<table style="font-size:.8rem;margin-top:4px"><thead><tr><th>Fingerprint</th><th>Hostname</th><th>Added</th></tr></thead><tbody>';
      for (const dev of trustedDevices) {
        html += '<tr><td><code style="font-size:.65rem">' + esc(dev.fingerprint || '').slice(0,24) + '…</code></td>';
        html += '<td>' + esc(dev.hostname || dev.os || '') + '</td>';
        html += '<td>' + esc(dev.addedAt ? new Date(dev.addedAt).toLocaleDateString() : '') + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    document.getElementById('cred-detail-title').textContent = '🔐 ' + esc(d.label);
    document.getElementById('cred-detail-body').innerHTML = html;
    document.getElementById('modal-cred-detail').classList.add('show');
  } catch { toast('Failed to load credential detail', 'error'); }
}

function togglePw(id) {
  const hidden = document.getElementById('pw-hidden-' + id);
  const revealed = document.getElementById('pw-reveal-' + id);
  if (hidden.style.display === 'none') {
    hidden.style.display = '';
    revealed.style.display = 'none';
  } else {
    hidden.style.display = 'none';
    revealed.style.display = '';
  }
}

async function showSecretDetail(id) {
  try {
    const d = await api('/api/secrets/' + id + '/detail');
    const val = d.value || '';
    let html = '<table style="font-size:.85rem">';
    html += '<tr><th style="width:100px">Label</th><td>' + esc(d.label) + '</td></tr>';
    html += '<tr><th>Kind</th><td><span class="badge badge-secret">' + esc(d.kind) + '</span></td></tr>';
    html += '<tr><th>Service</th><td>' + esc(d.service) + '</td></tr>';
    html += '<tr><th>Value</th><td>';
    html += '<span id="sec-val-hidden-' + id + '">••••••••</span> ';
    html += '<span id="sec-val-reveal-' + id + '" style="display:none"><code style="word-break:break-all;font-size:.75rem">' + esc(val) + '</code></span> ';
    html += '<button class="small" data-id="' + id + '" onclick="toggleSecVal(this.dataset.id)">👁 Reveal</button>';
    html += ' <button class="small outline" data-id="' + id + '" onclick="copySecretValue(this.dataset.id)">📋 Copy</button>';
    html += '</td></tr>';
    if (d.description) html += '<tr><th>Description</th><td>' + esc(d.description) + '</td></tr>';
    if (d.tags && d.tags.length) html += '<tr><th>Tags</th><td>' + d.tags.map(t => '<span class="badge" style="background:#ffffff11" title="' + esc(t) + '">' + esc(t) + '</span>').join(' ') + '</td></tr>';
    if (d.expiresAt) {
      const exp = new Date(d.expiresAt);
      const now = new Date();
      const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
      const isExpired = daysLeft < 0;
      const isExpiringSoon = daysLeft >= 0 && daysLeft <= 30;
      let badgeClass = 'badge-ok';
      let badgeText = daysLeft + ' days';
      if (isExpired) { badgeClass = 'badge-fail'; badgeText = 'Expired'; }
      else if (isExpiringSoon) { badgeClass = 'badge-secret'; badgeText = '⚠️ ' + daysLeft + ' days left'; }
      html += '<tr><th>Expires</th><td>' + esc(exp.toLocaleDateString()) + ' <span class="badge ' + badgeClass + '">' + badgeText + '</span></td></tr>';
    }
    html += '<tr><th>Created</th><td>' + esc(new Date(d.createdAt).toLocaleString()) + '</td></tr>';
    document.getElementById('secret-detail-title').textContent = '🔑 ' + esc(d.label);
    document.getElementById('secret-detail-body').innerHTML = html;
    document.getElementById('modal-secret-detail').classList.add('show');
  } catch { toast('Failed to load secret detail', 'error'); }
}

function toggleSecVal(id) {
  const hidden = document.getElementById('sec-val-hidden-' + id);
  const revealed = document.getElementById('sec-val-reveal-' + id);
  if (hidden.style.display === 'none') {
    hidden.style.display = '';
    revealed.style.display = 'none';
  } else {
    hidden.style.display = 'none';
    revealed.style.display = '';
  }
}

function showAddCred() {
  document.getElementById('cred-service').value = '';
  document.getElementById('cred-label').value = '';
  document.getElementById('cred-username').value = '';
  document.getElementById('cred-password').value = '';
  document.getElementById('cred-totp').value = '';
  document.getElementById('cred-tags').value = '';
  document.getElementById('modal-cred').classList.add('show');
}

async function addCredential() {
  const body = {
    service: document.getElementById('cred-service').value,
    label: document.getElementById('cred-label').value,
    username: document.getElementById('cred-username').value,
    password: document.getElementById('cred-password').value,
  };
  const totp = document.getElementById('cred-totp').value.trim();
  if (totp) body.extra = { totp_secret: totp };
  const tags = document.getElementById('cred-tags').value.trim();
  if (tags) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);

  if (!body.service || !body.label || !body.username || !body.password) {
    toast('Please fill all required fields', 'error');
    return;
  }

  await api('/api/credentials', { method: 'POST', body: JSON.stringify(body) });
  toast('Credential saved', 'ok');
  closeModal('modal-cred');
  loadCredentials();
}

async function deleteCred(id) {
  if (!confirm('Delete this credential?')) return;
  await api('/api/credentials/' + id, { method: 'DELETE' });
  toast('Deleted', 'ok');
  loadCredentials();
}

// ── Secrets ──────────────────────────────────────────────────────────────────

async function loadSecrets() {
  try {
    const data = await api('/api/secrets');
    const entries = data.entries || [];
    cachedEntries.secrets = entries;
    if (currentSearchQuery) applySearchFilter();
    const el = document.getElementById('secret-list');
    if (entries.length === 0) {
      el.innerHTML = '<div class="empty">No secrets stored.</div>';
      return;
    }
    el.innerHTML = '<table><thead><tr><th>Label</th><th>Kind</th><th>Service</th><th>Actions</th></tr></thead><tbody>' +
      entries.map(e => '<tr class="clickable" data-id="' + e.id + '" onclick="showSecretDetail(this.dataset.id)">' +
        '<td><strong>' + esc(e.label) + '</strong></td>' +
        '<td><span class="badge badge-secret">' + esc(e.kind) + '</span></td>' +
        '<td>' + esc(e.service) + '</td>' +
        '<td>' +
        '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copySecretValue(this.dataset.id)" title="Copy secret value">📋</button>' +
        '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();editSecret(this.dataset.id)" title="Edit secret">✎</button>' +
        '<button class="danger small" data-id="' + e.id + '" onclick="event.stopPropagation();deleteSecret(this.dataset.id)">✕</button>' +
        '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  } catch { document.getElementById('secret-list').innerHTML = '<div class="empty">Failed to load</div>'; }
}

function showAddSecret() {
  document.getElementById('sec-label').value = '';
  document.getElementById('sec-kind').value = 'api_key';
  document.getElementById('sec-service').value = '';
  document.getElementById('sec-value').value = '';
  document.getElementById('sec-desc').value = '';
  document.getElementById('modal-secret').classList.add('show');
}

async function addSecret() {
  const body = {
    label: document.getElementById('sec-label').value,
    kind: document.getElementById('sec-kind').value,
    service: document.getElementById('sec-service').value,
    value: document.getElementById('sec-value').value,
  };
  const desc = document.getElementById('sec-desc').value.trim();
  if (desc) body.description = desc;
  if (!body.label || !body.service || !body.value) {
    toast('Please fill all required fields', 'error');
    return;
  }
  await api('/api/secrets', { method: 'POST', body: JSON.stringify(body) });
  toast('Secret saved', 'ok');
  closeModal('modal-secret');
  loadSecrets();
}

async function deleteSecret(id) {
  if (!confirm('Delete this secret?')) return;
  await api('/api/secrets/' + id, { method: 'DELETE' });
  toast('Deleted', 'ok');
  loadSecrets();
}

// ── Audit ──────────────────────────────────────────────────────────────────────

async function loadAuditLog() {
  try {
    const all = await api('/api/audit/actions');
    const entries = all.entries || [];
    const el = document.getElementById('audit-list');
    if (entries.length === 0) {
      el.innerHTML = '<div class="empty">No audit entries yet.</div>';
    } else {
      el.innerHTML = '<table><thead><tr><th>Time</th><th>Action</th><th>Credential</th><th>Details</th></tr></thead><tbody>' +
        entries.map(e => '<tr>' +
          '<td style="white-space:nowrap">' + esc(new Date(e.timestamp).toLocaleString()) + '</td>' +
          '<td><span class="badge" style="background:#ffffff11">' + esc(e.action) + '</span></td>' +
          '<td><code style="font-size:.7rem">' + esc((e.credentialId || e.service || '').slice(0,16)) + '</code></td>' +
          '<td style="font-size:.75rem;color:var(--muted)">' + esc(e.metadata ? JSON.stringify(e.metadata).slice(0,60) : '') + '</td>' +
          '</tr>').join('') +
        '</tbody></table>';
    }
    const sum = await api('/api/audit/summary');
    const sumEl = document.getElementById('audit-summary');
    sumEl.innerHTML = '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
      '<div style="background:#ffffff08;padding:8px 16px;border-radius:6px"><strong>' + esc(sum.total) + '</strong> actions (24h)</div>' +
      (sum.failedLogins > 0 ? '<div style="background:#ff475722;padding:8px 16px;border-radius:6px"><strong>' + esc(sum.failedLogins) + '</strong> failed logins</div>' : '') +
      Object.entries(sum.actions || {}).map(([act, cnt]) =>
        '<div style="background:#ffffff08;padding:8px 16px;border-radius:6px"><code>' + esc(act) + '</code>: <strong>' + esc(cnt) + '</strong></div>'
      ).join('') +
      '</div>';
  } catch { document.getElementById('audit-list').innerHTML = '<div class="empty">Failed to load audit log</div>'; }
}

// ── Login ────────────────────────────────────────────────────────────────────

async function loadLoginCreds() {
  try {
    const data = await api('/api/credentials');
    const sel = document.getElementById('login-cred');
    sel.innerHTML = '<option value="">— Select credential —</option>' +
      (data.entries || []).map(e =>
        '<option value="' + e.id + '">' + esc(e.label) + ' (' + esc(e.service) + ')</option>'
      ).join('');
    document.getElementById('login-status').style.display = 'none';
    document.getElementById('login-2fa').style.display = 'none';
    document.getElementById('login-result').style.display = 'none';
  } catch {}
}

let loginSessionId = null;

async function startLogin() {
  const id = document.getElementById('login-cred').value;
  if (!id) { toast('Select a credential first', 'error'); return; }
  const statusEl = document.getElementById('login-status');
  const resultEl = document.getElementById('login-result');
  statusEl.style.display = 'block';
  statusEl.innerHTML = '<span class="status-dot online"></span> Starting login...';
  document.getElementById('login-2fa').style.display = 'none';
  resultEl.style.display = 'none';

  try {
    const res = await api('/api/login/' + id, { method: 'POST' });
    loginSessionId = res.sessionId;

    if (res.loggedIn) {
      statusEl.innerHTML = '<span class="status-dot online"></span> ✅ Logged in successfully!';
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<span class="badge badge-ok">SUCCESS</span> URL: ' + esc(res.currentUrl);
    } else if (res.needs2FA) {
      statusEl.innerHTML = '<span class="status-dot offline"></span> 🔑 2FA code required';
      document.getElementById('login-2fa').style.display = 'block';
      document.getElementById('tfa-code').value = '';
      document.getElementById('tfa-code').focus();
      toast('Enter the 6-digit code from your authenticator app', '');
    } else {
      statusEl.innerHTML = '<span class="status-dot offline"></span> ⚠️ ' + esc(res.message || 'Login pending');
      resultEl.style.display = 'block';
      resultEl.innerHTML = 'URL: ' + esc(res.currentUrl || '');
    }
  } catch (e) {
    statusEl.innerHTML = '<span class="status-dot offline"></span> ❌ Login failed: ' + esc(e.message);
  }
}

async function submit2FA() {
  const code = document.getElementById('tfa-code').value.trim();
  if (!code || code.length < 4) { toast('Enter a valid code', 'error'); return; }
  if (!loginSessionId) { toast('No active login session', 'error'); return; }
  const statusEl = document.getElementById('login-status');
  const resultEl = document.getElementById('login-result');

  try {
    const res = await api('/api/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ sessionId: loginSessionId, code }),
    });

    if (res.loggedIn) {
      statusEl.innerHTML = '<span class="status-dot online"></span> ✅ Logged in successfully!';
      document.getElementById('login-2fa').style.display = 'none';
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<span class="badge badge-ok">SUCCESS</span> URL: ' + esc(res.currentUrl);
    } else {
      statusEl.innerHTML = '<span class="status-dot offline"></span> ⚠️ Code may be invalid';
      toast('Code not accepted. Try again with a fresh code.', 'error');
      document.getElementById('tfa-code').value = '';
      document.getElementById('tfa-code').focus();
    }
  } catch (e) {
    toast('2FA failed: ' + e.message, 'error');
  }
}

// ── 2FA / TOTP ────────────────────────────────────────────────────────────────

let lastGeneratedSecret = '';

async function load2FA() {
  try {
    const data = await api('/api/credentials');
    const sel = document.getElementById('2fa-cred');
    if (sel) {
      sel.innerHTML = '<option value="">— Select credential —</option>' +
        (data.entries || []).map(e =>
          '<option value="' + e.id + '">' + esc(e.label) + ' (' + esc(e.service) + ')</option>'
        ).join('');
    }
    await load2FACreds(data.entries || []);
  } catch { document.getElementById('2fa-creds-list').innerHTML = '<div class="empty">Failed to load</div>'; }
}

async function load2FACreds(entries) {
  const el = document.getElementById('2fa-creds-list');
  const withTotp = [];
  for (const e of entries) {
    try {
      const d = await api('/api/credentials/' + e.id + '/totp');
      if (d.hasTotp) withTotp.push(d);
    } catch {}
  }
  if (withTotp.length === 0) {
    el.innerHTML = '<div class="empty">No credentials with TOTP configured.</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Label</th><th>Service</th><th>Status</th></tr></thead><tbody>' +
    withTotp.map(e => '<tr>' +
      '<td><strong>' + esc(e.label) + '</strong></td>' +
      '<td><span class="badge badge-cred">' + esc(e.service) + '</span></td>' +
      '<td><span class="badge badge-ok">TOTP configured</span></td>' +
      '</tr>').join('') +
    '</tbody></table>';
}

async function generateTOTP() {
  const account = document.getElementById('2fa-account').value || 'user@example.com';
  const issuer = document.getElementById('2fa-issuer').value || 'AuthVault';
  const btn = document.getElementById('2fa-gen-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  try {
    const res = await api('/api/totp/generate?account=' + encodeURIComponent(account) + '&issuer=' + encodeURIComponent(issuer));
    lastGeneratedSecret = res.secret;
    document.getElementById('2fa-secret').textContent = res.secret;
    document.getElementById('2fa-otpauth').textContent = res.otpauthUrl;
    document.getElementById('2fa-qr-img').src = res.qrDataUri;
    document.getElementById('2fa-qr-img').style.display = 'inline';
    document.getElementById('2fa-verify-secret').value = res.secret;
    document.getElementById('2fa-attach-secret').value = res.secret;
    document.getElementById('2fa-result').style.display = 'block';
    toast('TOTP secret generated!', 'ok');
  } catch (e) {
    toast('Generation failed: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = '🔑 Generate Secret';
}

async function verifyTOTPCode() {
  const secret = document.getElementById('2fa-verify-secret').value.trim();
  const code = document.getElementById('2fa-verify-code').value.trim();
  if (!secret || !code) { toast('Enter secret and code', 'error'); return; }
  try {
    const res = await api('/api/totp/verify', {
      method: 'POST',
      body: JSON.stringify({ secret, code }),
    });
    const el = document.getElementById('2fa-verify-result');
    if (res.valid) {
      el.innerHTML = '<span class="badge badge-ok"> Valid code</span>';
    } else {
      el.innerHTML = '<span class="badge badge-fail"> Invalid code (expected: ' + esc(res.generatedCode) + ')</span>';
    }
  } catch (e) {
    toast('Verification failed: ' + e.message, 'error');
  }
}

async function attachTOTP() {
  const credentialId = document.getElementById('2fa-cred').value;
  const totpSecret = document.getElementById('2fa-attach-secret').value.trim();
  if (!credentialId) { toast('Select a credential', 'error'); return; }
  if (!totpSecret) { toast('TOTP secret is empty', 'error'); return; }
  try {
    await api('/api/totp/attach', {
      method: 'POST',
      body: JSON.stringify({ credentialId, totpSecret }),
    });
    toast('TOTP attached to credential!', 'ok');
    load2FA();
  } catch (e) {
    toast('Attach failed: ' + e.message, 'error');
  }
}

function copyTOTPSecret() {
  const text = document.getElementById('2fa-secret').textContent;
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      toast('Secret copied!', 'ok');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Secret copied!', 'ok');
    });
  }
}

// ── SSH Keys ─────────────────────────────────────────────────────────────────

async function loadSSHKeys() {
  try {
    const data = await api('/api/ssh');
    const entries = data.entries || [];
    cachedEntries.ssh = entries.map(e => ({
      id: e.id,
      label: e.label,
      host: e.host,
      user: e.username,
      type: e.keyType,
      tags: e.tags || []
    }));
    if (currentSearchQuery) applySearchFilter();
    const el = document.getElementById('ssh-key-list');
    if (entries.length === 0) {
      el.innerHTML = '<div class="empty">No SSH keys stored. Import one or generate a new pair.</div>';
      return;
    }
    el.innerHTML = '<table><thead><tr><th>Label</th><th>Key Type</th><th>Host:Port</th><th>User</th><th>Fingerprint</th><th>Actions</th></tr></thead><tbody>' +
      entries.map(e => '<tr class="clickable" data-id="' + e.id + '" onclick="showSSHDetail(this.dataset.id)">' +
        '<td><strong>' + esc(e.label) + '</strong></td>' +
        '<td><span class="badge badge-secret">' + esc(e.keyType) + '</span></td>' +
        '<td><code>' + esc(e.host) + ':' + esc(e.port) + '</code></td>' +
        '<td>' + esc(e.username) + '</td>' +
        '<td><code style="font-size:.7rem">' + esc(e.fingerprint) + '</code></td>' +
        '<td>' +
        '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copySSHPrivateKey(this.dataset.id)" title="Copy private key">🔑</button>' +
        '<button class="small outline" data-id="' + e.id + '" onclick="event.stopPropagation();copySSHCommand(this.dataset.id)" title="Copy SSH command">💻</button>' +
        '<button class="danger small" data-id="' + e.id + '" onclick="event.stopPropagation();deleteSSHKey(this.dataset.id)">✕</button>' +
        '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  } catch { document.getElementById('ssh-key-list').innerHTML = '<div class="empty">Failed to load</div>'; }
}

async function showSSHDetail(id) {
  try {
    const d = await api('/api/ssh/' + id);
    const el = document.getElementById('ssh-quick-connect');
    const cmdEl = document.getElementById('ssh-connect-cmd');
    const hostName = d.hostname || d.host;
    cmdEl.textContent = 'ssh ' + (d.port !== 22 ? '-p ' + d.port + ' ' : '') + d.username + '@' + hostName;
    el.style.display = 'block';

    // Show config fragment
    const configEl = document.getElementById('ssh-config-card');
    const configTextEl = document.getElementById('ssh-config-text');
    const identityPath = '~/.ssh/' + d.label.replace(/\\s+/g, '_');
    configTextEl.textContent =
      'Host ' + d.host + '\\n' +
      '    HostName ' + hostName + '\\n' +
      '    User ' + d.username + '\\n' +
      '    Port ' + d.port + '\\n' +
      '    IdentityFile ' + identityPath;
    configEl.style.display = 'block';

    toast('🔑 ' + esc(d.label) + ' | ' + esc(d.keyType) + ' | ' + esc(d.fingerprint), 'ok');
  } catch {}
}

let _sshCopiedCmd = '';
let _sshCopiedConfig = '';

function copySSHCommand() {
  const text = document.getElementById('ssh-connect-cmd').textContent;
  if (text) {
    _sshCopiedCmd = text;
    copyText(text);
    toast('SSH command copied!', 'ok');
  }
}

function copySSHConfig() {
  const text = document.getElementById('ssh-config-text').textContent;
  if (text) {
    _sshCopiedConfig = text;
    copyText(text);
    toast('SSH config copied!', 'ok');
  }
}

async function copySSHPrivateKey(id) {
  try {
    const d = await api('/api/ssh/' + id);
    if (d.privateKey) {
      await navigator.clipboard.writeText(d.privateKey);
      toast('Private key copied', 'ok');
    } else {
      toast('No private key available', 'error');
    }
  } catch { toast('Failed to copy private key', 'error'); }
}

async function copySSHCommand(id) {
  try {
    const d = await api('/api/ssh/' + id);
    const hostName = d.hostname || d.host;
    const cmd = 'ssh ' + (d.port !== 22 ? '-p ' + d.port + ' ' : '') + d.username + '@' + hostName;
    await navigator.clipboard.writeText(cmd);
    toast('SSH command copied', 'ok');
  } catch { toast('Failed to copy SSH command', 'error'); }
}

function showAddSSHKey() {
  document.getElementById('ssh-add-label').value = '';
  document.getElementById('ssh-add-type').value = 'ed25519';
  document.getElementById('ssh-add-host').value = '';
  document.getElementById('ssh-add-port').value = '22';
  document.getElementById('ssh-add-user').value = '';
  document.getElementById('ssh-add-hostname').value = '';
  document.getElementById('ssh-add-private').value = '';
  document.getElementById('ssh-add-public').value = '';
  document.getElementById('ssh-add-passphrase').value = '';
  document.getElementById('ssh-add-comment').value = '';
  document.getElementById('ssh-add-tags').value = '';
  document.getElementById('modal-ssh-add').classList.add('show');
}

async function addSSHKey() {
  const body = {
    label: document.getElementById('ssh-add-label').value.trim(),
    keyType: document.getElementById('ssh-add-type').value.trim(),
    host: document.getElementById('ssh-add-host').value.trim(),
    port: parseInt(document.getElementById('ssh-add-port').value) || 22,
    username: document.getElementById('ssh-add-user').value.trim(),
    privateKey: document.getElementById('ssh-add-private').value.trim(),
  };
  const pub = document.getElementById('ssh-add-public').value.trim();
  if (pub) body.publicKey = pub;
  const pass = document.getElementById('ssh-add-passphrase').value;
  if (pass) body.passphrase = pass;
  const comment = document.getElementById('ssh-add-comment').value.trim();
  if (comment) body.comment = comment;
  const hostname = document.getElementById('ssh-add-hostname').value.trim();
  if (hostname) body.hostname = hostname;
  const tags = document.getElementById('ssh-add-tags').value.trim();
  if (tags) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);

  if (!body.label || !body.host || !body.username || !body.privateKey) {
    toast('Please fill all required fields (label, host, username, private key)', 'error');
    return;
  }

  await api('/api/ssh', { method: 'POST', body: JSON.stringify(body) });
  toast('SSH key saved! Fingerprint: ' + (body.fingerprint || 'computed on save'), 'ok');
  closeModal('modal-ssh-add');
  loadSSHKeys();
}

async function deleteSSHKey(id) {
  if (!confirm('Delete this SSH key?')) return;
  await api('/api/ssh/' + id, { method: 'DELETE' });
  toast('SSH key deleted', 'ok');
  loadSSHKeys();
}

function showGenerateSSH() {
  document.getElementById('ssh-gen-label').value = '';
  document.getElementById('ssh-gen-host').value = '';
  document.getElementById('ssh-gen-port').value = '22';
  document.getElementById('ssh-gen-user').value = '';
  document.getElementById('ssh-gen-comment').value = '';
  document.getElementById('ssh-gen-passphrase').value = '';
  document.getElementById('ssh-gen-hostname').value = '';
  document.getElementById('ssh-gen-tags').value = '';
  document.getElementById('ssh-gen-result').style.display = 'none';
  window.scrollTo(0, document.getElementById('tab-ssh').offsetTop);
  // Scroll to generator section
  const genSection = document.querySelector('#tab-ssh .card:nth-child(3)');
  if (genSection) genSection.scrollIntoView({ behavior: 'smooth' });
}

// Show/hide RSA bits selector based on key type
document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'ssh-gen-type') {
    document.getElementById('ssh-gen-rsa-bits-row').style.display =
      e.target.value === 'rsa' ? '' : 'none';
  }
});

async function generateSSHKey() {
  const body = {
    keyType: document.getElementById('ssh-gen-type').value,
    host: document.getElementById('ssh-gen-host').value.trim(),
    port: parseInt(document.getElementById('ssh-gen-port').value) || 22,
    username: document.getElementById('ssh-gen-user').value.trim(),
    label: document.getElementById('ssh-gen-label').value.trim(),
  };
  const comment = document.getElementById('ssh-gen-comment').value.trim();
  if (comment) body.comment = comment;
  const passphrase = document.getElementById('ssh-gen-passphrase').value;
  if (passphrase) body.passphrase = passphrase;
  const hostname = document.getElementById('ssh-gen-hostname').value.trim();
  if (hostname) body.hostname = hostname;
  const tags = document.getElementById('ssh-gen-tags').value.trim();
  if (tags) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
  if (body.keyType === 'rsa') {
    body.rsaBits = parseInt(document.getElementById('ssh-gen-rsa-bits').value);
  }

  if (!body.label || !body.host || !body.username) {
    toast('Please fill label, host, and username', 'error');
    return;
  }

  const btn = document.getElementById('ssh-gen-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const res = await api('/api/ssh/generate', { method: 'POST', body: JSON.stringify(body) });
    const resultEl = document.getElementById('ssh-gen-result');
    document.getElementById('ssh-gen-pubkey').textContent = res.publicKey;
    document.getElementById('ssh-gen-fingerprint').textContent = res.fingerprint;
    resultEl.style.display = 'block';

    // Also auto-store
    await api('/api/ssh', {
      method: 'POST',
      body: JSON.stringify({
        label: body.label, keyType: body.keyType === 'rsa' ? 'rsa-' + (body.rsaBits || 4096) : 'ed25519',
        host: body.host, port: body.port, username: body.username,
        hostname: body.hostname, tags: body.tags,
        privateKey: res.privateKey, publicKey: res.publicKey,
        passphrase: body.passphrase, comment: res.comment,
      }),
    });
    toast('✅ Key generated, stored, and ready to use!', 'ok');
    loadSSHKeys();
  } catch (e) {
    toast('Generation failed: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = '🔑 Generate & Store';
}

async function extractPublicKeyUI() {
  const keyText = document.getElementById('ssh-extract-key').value.trim();
  const passphrase = document.getElementById('ssh-extract-passphrase').value;
  if (!keyText) { toast('Paste a private key first', 'error'); return; }
  try {
    const res = await api('/api/ssh/extract', {
      method: 'POST',
      body: JSON.stringify({ privateKey: keyText, passphrase: passphrase || undefined }),
    });
    document.getElementById('ssh-extract-pubkey').textContent = res.publicKey;
    document.getElementById('ssh-extract-fp').textContent = res.fingerprint;
    document.getElementById('ssh-extract-result').style.display = 'block';
    toast('Public key extracted!', 'ok');
  } catch (e) {
    toast('Extraction failed: ' + e.message, 'error');
  }
}

function copyElement(id) {
  const el = document.getElementById(id);
  if (el) copyText(el.textContent);
}

function copySecretValue(id) {
  const el = document.getElementById('sec-val-reveal-' + id);
  if (el) copyText(el.textContent);
}

function copyText(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, function(m) {
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
}); }

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ── Password Generator ─────────────────────────────────────────────────────
async function genPassword() {
  const length = document.getElementById('pw-length').value || 16;
  const count = document.getElementById('pw-count').value || 1;
  const symbols = document.getElementById('pw-symbols').checked;
  const exclude = document.getElementById('pw-exclude').checked;
  const lower = document.getElementById('pw-lower').checked;
  const upper = document.getElementById('pw-upper').checked;
  const digits = document.getElementById('pw-digits').checked;
  const method = document.getElementById('pw-method').value;
  const el = document.getElementById('pw-result');
  el.innerHTML = '<div class="empty">Generating...</div>';
  try {
    const q = 'length=' + length + '&count=' + count + '&symbols=' + symbols + '&excludeSimilar=' + exclude + '&lowercase=' + lower + '&uppercase=' + upper + '&digits=' + digits + '&method=' + method;
    const d = await api('/api/password/generate?' + q);
    el.innerHTML = d.passwords.map(function(p) {
      return '<div class="pw-row" style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;padding:8px;background:#ffffff08;border-radius:6px">' +
        '<code style="font-size:1rem;word-break:break-all">' + esc(p.password) + '</code>' +
        '<span style="margin-left:8px;white-space:nowrap">' +
          '<span class="badge badge-secret">' + esc(p.strength) + '</span>' +
          '<span style="color:var(--muted);font-size:.75rem">' + p.entropyBits + ' bit</span> ' +
          '<button class="small" data-pw="' + esc(p.password) + '" onclick="copyText(this.dataset.pw)">📋</button>' +
        '</span></div>';
    }).join('') +
      '<div style="color:var(--muted);font-size:.75rem;margin-top:6px">Metoda: ' + esc(d.passwords[0] ? d.passwords[0].method : '') + '</div>';
  } catch (e) { el.innerHTML = '<div class="empty">Błąd: ' + esc(e.message) + '</div>'; }
}

async function genPassphrase() {
  const words = document.getElementById('pw-count').value || 4;
  const method = document.getElementById('pw-method').value;
  const el = document.getElementById('pw-result');
  el.innerHTML = '<div class="empty">Generating...</div>';
  try {
    const d = await api('/api/password/passphrase?words=' + words + '&method=' + method);
    el.innerHTML = d.phrases.map(function(p) {
      return '<div class="pw-row" style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;padding:8px;background:#ffffff08;border-radius:6px">' +
        '<code style="font-size:1rem;word-break:break-all">' + esc(p.password) + '</code>' +
        '<span style="margin-left:8px;white-space:nowrap">' +
          '<span class="badge badge-secret">' + esc(p.strength) + '</span>' +
          '<span style="color:var(--muted);font-size:.75rem">' + p.entropyBits + ' bit</span> ' +
          '<button class="small" data-pw="' + esc(p.password) + '" onclick="copyText(this.dataset.pw)">📋</button>' +
        '</span></div>';
    }).join('') +
      '<div style="color:var(--muted);font-size:.75rem;margin-top:6px">Metoda: ' + esc(d.phrases[0] ? d.phrases[0].method : '') + '</div>';
  } catch (e) { el.innerHTML = '<div class="empty">Błąd: ' + esc(e.message) + '</div>'; }
}

// Initial load
loadCredentials();
loadSecrets();
loadLoginCreds();
loadSSHKeys();
loadStats();

// ── Edit Credential ──────────────────────────────────────────────────────────────
async function showEditCredential(id) {
  editingCredId = id;
  try {
    const d = await api('/api/credentials/' + id + '?includePassword=true');
    const c = d.credentials || {};
    const extra = c.extra || {};
    document.getElementById('edit-cred-title').textContent = '✏️ Edit Credential';
    document.getElementById('edit-cred-body').innerHTML =
      '<label for="edit-cred-service">Service</label>\\n' +
      '<input id="edit-cred-service" value="' + esc(d.service) + '" placeholder="e.g. google, github">\\n' +
      '<label for="edit-cred-label">Label</label>\\n' +
      '<input id="edit-cred-label" value="' + esc(d.label) + '" placeholder="e.g. My Account">\\n' +
      '<label for="edit-cred-username">Username / Email</label>\\n' +
      '<input id="edit-cred-username" value="' + esc(c.username) + '" placeholder="user@example.com">\\n' +
      '<label for="edit-cred-password">Password</label>\\n' +
      '<input id="edit-cred-password" type="password" value="' + esc(c.password) + '" placeholder="••••••••">\\n' +
      '<label for="edit-cred-totp">TOTP Secret (optional)</label>\\n' +
      '<input id="edit-cred-totp" value="' + (extra.totp_secret || '') + '" placeholder="JBSWY3DPEHPK3PXP">\\n' +
      '<label for="edit-cred-tags">Tags (optional, comma-separated)</label>\\n' +
      '<input id="edit-cred-tags" value="' + ((d.tags || []).join(',')) + '" placeholder="work,production">\\n'
    ;
    document.getElementById('modal-edit-cred').classList.add('show');
  } catch { toast('Failed to load credential for editing', 'error'); }
}
async function updateCredential(id = editingCredId) {
  if (!id) { toast('No credential selected', 'error'); return; }
  const body = {
    service: document.getElementById('edit-cred-service').value,
    label: document.getElementById('edit-cred-label').value,
    username: document.getElementById('edit-cred-username').value,
    password: document.getElementById('edit-cred-password').value,
  };
  body.totp_secret = document.getElementById('edit-cred-totp').value.trim();
  const tags = document.getElementById('edit-cred-tags').value.trim();
  if (tags) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);

  if (!body.service || !body.label || !body.username || !body.password) {
    toast('Please fill all required fields', 'error');
    return;
  }

  await api('/api/credentials/' + id, { method: 'PUT', body: JSON.stringify(body) });
  toast('Credential updated', 'ok');
  closeModal('modal-edit-cred');
  loadCredentials();
}

// ── Edit Secret ──────────────────────────────────────────────────────────────
async function showEditSecret(id) {
  editingSecretId = id;
  try {
    const d = await api('/api/secrets/' + id + '/detail');
    document.getElementById('edit-secret-title').textContent = '✏️ Edit Secret';
    document.getElementById('edit-secret-body').innerHTML =
      '<label for="edit-secret-label">Label</label>\\n' +
      '<input id="edit-secret-label" value="' + esc(d.label) + '" placeholder="e.g. OpenAI API Key">\\n' +
      '<label for="edit-secret-kind">Type</label>\\n' +
      '<select id="edit-secret-kind">\\n' +
        '<option value="api_key" ' + (d.kind === 'api_key' ? 'selected' : '') + '>API Key</option>\\n' +
        '<option value="bearer_token" ' + (d.kind === 'bearer_token' ? 'selected' : '') + '>Bearer Token</option>\\n' +
        '<option value="access_token" ' + (d.kind === 'access_token' ? 'selected' : '') + '>Access Token</option>\\n' +
        '<option value="refresh_token" ' + (d.kind === 'refresh_token' ? 'selected' : '') + '>Refresh Token</option>\\n' +
        '<option value="private_key" ' + (d.kind === 'private_key' ? 'selected' : '') + '>Private Key</option>\\n' +
        '<option value="generic" ' + (d.kind === 'generic' ? 'selected' : '') + '>Generic</option>\\n' +
      '</select>\\n' +
      '<label for="edit-secret-service">Service</label>\\n' +
      '<input id="edit-secret-service" value="' + esc(d.service) + '" placeholder="e.g. openai, github, stripe">\\n' +
      '<label for="edit-secret-value">Secret Value</label>\\n' +
      '<input id="edit-secret-value" type="password" value="' + esc(d.value) + '" placeholder="sk-...">\\n' +
      '<label for="edit-secret-desc">Description (optional)</label>\\n' +
      '<input id="edit-secret-desc" value="' + esc(d.description || '') + '" placeholder="What is this for?">\\n'
    ;
    document.getElementById('modal-edit-secret').classList.add('show');
  } catch { toast('Failed to load secret for editing', 'error'); }
}
const editCred = showEditCredential;
const editSecret = showEditSecret;

async function updateSecret(id = editingSecretId) {
  if (!id) { toast('No secret selected', 'error'); return; }
  const body = {
    label: document.getElementById('edit-secret-label').value,
    kind: document.getElementById('edit-secret-kind').value,
    service: document.getElementById('edit-secret-service').value,
    value: document.getElementById('edit-secret-value').value,
  };
  const desc = document.getElementById('edit-secret-desc').value.trim();
  if (desc) body.description = desc;

  if (!body.label || !body.service || !body.value) {
    toast('Please fill all required fields', 'error');
    return;
  }

  await api('/api/secrets/' + id, { method: 'PUT', body: JSON.stringify(body) });
  toast('Secret updated', 'ok');
  closeModal('modal-edit-secret');
  loadSecrets();
}
</script>
</body>
</html>`;
}
