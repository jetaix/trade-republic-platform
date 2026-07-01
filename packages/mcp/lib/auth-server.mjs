/**
 * Local browser-based auth flow for the MCP.
 *
 * Instead of typing your phone number + PIN into the chat, the MCP opens a
 * short-lived local web page (127.0.0.1, random port) that collects them, runs
 * the Trade Republic login (headless-Chromium WAF bootstrap + REST login),
 * prompts for the 2FA code, and completes — then hands the session back to the
 * caller to persist. Uses only Node's built-in http server (no extra deps).
 *
 * startAuthServer({ client, bootstrapWaf, onComplete }) resolves to
 *   { url, done: Promise<boolean>, close() }.
 */
import { createServer } from 'node:http';

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect Trade Republic</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#0e1116; color:#e6e9ef; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { width:100%; max-width:380px; background:#161b22; border:1px solid #232a35; border-radius:14px; padding:28px; }
  h1 { font-size:19px; margin:0 0 4px; }
  p.sub { color:#8b93a7; font-size:13px; margin:0 0 20px; }
  label { display:block; font-size:12px; color:#8b93a7; margin:14px 0 4px; }
  input { width:100%; padding:11px; border-radius:9px; border:1px solid #2b3441; background:#0e1116; color:#e6e9ef; font:inherit; }
  button { width:100%; margin-top:20px; padding:11px; border:0; border-radius:9px; background:#2f6fed; color:#fff; font-weight:600; font-size:15px; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .err { color:#ff7b72; font-size:13px; margin-top:12px; }
  .ok { text-align:center; }
  .ok .big { font-size:40px; }
  .muted { color:#8b93a7; font-size:12px; margin-top:8px; }
  .hidden { display:none; }
</style></head>
<body>
  <div class="card">
    <div id="step-cred">
      <h1>Connect Trade Republic</h1>
      <p class="sub">Read-only. Credentials are used once to log in and are never stored.</p>
      <label>Phone number</label>
      <input id="phone" type="tel" placeholder="+33 6 12 34 56 78" autocomplete="tel"/>
      <label>PIN</label>
      <input id="pin" type="password" inputmode="numeric" placeholder="••••" autocomplete="off"/>
      <button id="btn-login">Send code</button>
      <div id="err1" class="err hidden"></div>
    </div>

    <div id="step-code" class="hidden">
      <h1>Enter the code</h1>
      <p class="sub" id="code-hint">Trade Republic sent a 4-digit code.</p>
      <label>Verification code</label>
      <input id="code" inputmode="numeric" placeholder="1234" autocomplete="one-time-code"/>
      <button id="btn-verify">Verify &amp; connect</button>
      <div id="err2" class="err hidden"></div>
    </div>

    <div id="step-done" class="hidden ok">
      <div class="big">✅</div>
      <h1>Connected</h1>
      <p class="sub">You can close this tab and return to Claude.</p>
    </div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);
  const show = (id) => { for (const s of ['step-cred','step-code','step-done']) $(s).classList.toggle('hidden', s !== id); };
  async function post(path, body) {
    const r = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }
  $('btn-login').onclick = async () => {
    const b = $('btn-login'); b.disabled = true; b.textContent = 'Contacting Trade Republic…'; $('err1').classList.add('hidden');
    try {
      const r = await post('/api/login', { phoneNumber: $('phone').value.trim(), pin: $('pin').value.trim() });
      $('code-hint').textContent = r.twoFa === 'SMS' ? 'Trade Republic texted you a code.' : 'Approve/read the code in your Trade Republic app.';
      show('step-code');
    } catch (e) { $('err1').textContent = e.message; $('err1').classList.remove('hidden'); }
    finally { b.disabled = false; b.textContent = 'Send code'; }
  };
  $('btn-verify').onclick = async () => {
    const b = $('btn-verify'); b.disabled = true; b.textContent = 'Verifying…'; $('err2').classList.add('hidden');
    try { await post('/api/verify', { code: $('code').value.trim() }); show('step-done'); }
    catch (e) { $('err2').textContent = e.message; $('err2').classList.remove('hidden'); }
    finally { b.disabled = false; b.textContent = 'Verify & connect'; }
  };
</script>
</body></html>`;

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

export function startAuthServer({ client, bootstrapWaf, onComplete }) {
  let processId = null;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  const server = createServer(async (req, res) => {
    const json = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(PAGE);
      }
      if (req.method === 'POST' && req.url === '/api/login') {
        const { phoneNumber, pin } = await readBody(req);
        if (!phoneNumber || !pin) return json(400, { error: 'Phone number and PIN are required.' });
        client.seedFromWaf(await bootstrapWaf());
        const r = await client.login(phoneNumber, pin);
        processId = r.processId;
        return json(200, { twoFa: r.twoFa });
      }
      if (req.method === 'POST' && req.url === '/api/verify') {
        const { code } = await readBody(req);
        if (!processId) return json(409, { error: 'Start with your phone number and PIN first.' });
        if (!code) return json(400, { error: 'Enter the verification code.' });
        await client.verify(processId, code);
        await onComplete?.();
        json(200, { ok: true });
        return resolveDone(true);
      }
      json(404, { error: 'not found' });
    } catch (err) {
      json(502, { error: err.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, done, close: () => server.close() });
    });
  });
}
