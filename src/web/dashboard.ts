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
</style>
</head>
<body>
<div class="container">
  <h1>🔐 Auth Vault <small>mcp-auth-vault</small></h1>

  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('credentials')">Credentials</div>
    <div class="tab" onclick="switchTab('secrets')">Secrets</div>
    <div class="tab" onclick="switchTab('login')">Login</div>
    <div class="tab" onclick="switchTab('2fa')">2FA</div>
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

<!-- Toast -->
<div class="toast" id="toast"></div>

<!-- Session status polling -->
<div id="session-status" style="display:none"></div>

<script>
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
}

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
    const el = document.getElementById('cred-list');
    if (entries.length === 0) {
      el.innerHTML = '<div class="empty">No credentials stored. Add one to get started.</div>';
      return;
    }
    el.innerHTML = '<table><thead><tr><th>Label</th><th>Service</th><th>Tags</th><th></th></tr></thead><tbody>' +
      entries.map(e => '<tr class="clickable" data-id="' + e.id + '" onclick="showCredDetail(this.dataset.id)">' +
        '<td><strong>' + esc(e.label) + '</strong></td>' +
        '<td><span class="badge badge-cred">' + esc(e.service) + '</span></td>' +
        '<td>' + (e.tags || []).map(t => '<span class="badge" style="background:#ffffff11">' + esc(t) + '</span> ').join('') + '</td>' +
        '<td><button class="danger small" data-id="' + e.id + '" onclick="event.stopPropagation();deleteCred(this.dataset.id)">✕</button></td>' +
        '</tr>').join('') +
      '</tbody></table>';
  } catch { document.getElementById('cred-list').innerHTML = '<div class="empty">Failed to load</div>'; }
}

async function showCredDetail(id) {
  try {
    const d = await api('/api/credentials/' + id);
    const c = d.credentials || {};
    toast(
      'User: ' + esc(c.username) +
      (c.extra && c.extra.totp_secret ? ' | TOTP: configured' : '') +
      ' | Tags: ' + ((d.tags||[]).join(', ') || 'none'),
      'ok'
    );
  } catch {}
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
    const el = document.getElementById('secret-list');
    if (entries.length === 0) {
      el.innerHTML = '<div class="empty">No secrets stored.</div>';
      return;
    }
    el.innerHTML = '<table><thead><tr><th>Label</th><th>Kind</th><th>Service</th><th></th></tr></thead><tbody>' +
      entries.map(e => '<tr>' +
        '<td><strong>' + esc(e.label) + '</strong></td>' +
        '<td><span class="badge badge-secret">' + esc(e.kind) + '</span></td>' +
        '<td>' + esc(e.service) + '</td>' +
        '<td><button class="danger small" data-id="' + e.id + '" onclick="deleteSecret(this.dataset.id)">✕</button></td>' +
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, function(m) {
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
}); }

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// Initial load
loadCredentials();
loadSecrets();
loadLoginCreds();
</script>
</body>
</html>`;
}
