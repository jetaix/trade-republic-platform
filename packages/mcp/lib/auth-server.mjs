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
import { FONT_BODY, FONT_MED, FONT_BOLD } from './auth-fonts.mjs';

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect Trade Republic</title>
<style>
  @font-face { font-family:'TR Sans'; font-weight:500; font-style:normal; font-display:swap; src:url('${FONT_BODY}') format('woff2'); }
  @font-face { font-family:'TR Sans'; font-weight:680; font-style:normal; font-display:swap; src:url('${FONT_MED}') format('woff2'); }
  @font-face { font-family:'TR Sans'; font-weight:740; font-style:normal; font-display:swap; src:url('${FONT_BOLD}') format('woff2'); }

  :root {
    --bg:#0b0b0d; --panel:#141518; --panel-2:#191b1f;
    --text:#f3f4f6; --muted:#8b909a; --soft:#3a3d45;
    --line:#26282e; --red:#ff4034; --red-ink:#ff5a4f;
    --red-cta:#d92d22; --red-cta-hover:#c4261c; /* button fills w/ white text — AA 4.8:1 */
    --sans:'TR Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    --ease:cubic-bezier(.22,1,.36,1);
  }
  * { box-sizing:border-box; }
  html,body { height:100%; }
  body {
    margin:0; display:flex; align-items:center; justify-content:center;
    background:
      radial-gradient(900px 600px at 50% -10%, rgba(255,64,52,.10), transparent 60%),
      radial-gradient(700px 500px at 50% 120%, rgba(255,64,52,.05), transparent 60%),
      var(--bg);
    color:var(--text); font-family:var(--sans); font-weight:500; font-size:15px; line-height:1.5;
    -webkit-font-smoothing:antialiased; letter-spacing:-0.01em; padding:24px;
  }
  #confetti { position:fixed; inset:0; pointer-events:none; z-index:60; }

  .brand {
    display:flex; align-items:center; justify-content:center; gap:11px;
    margin:0 0 26px; font-weight:740; font-size:18px; letter-spacing:-0.03em;
    opacity:0; transform:translateY(-6px); animation:rise .6s var(--ease) .05s forwards;
  }
  .brand .mark {
    width:28px; height:28px; border-radius:8px; flex:none; background:#000;
    display:grid; place-items:center; box-shadow:0 0 0 1px var(--line), 0 6px 20px rgba(0,0,0,.5);
  }
  .brand .mark::before { content:''; width:10px; height:10px; border-radius:3px; background:var(--red); }

  .card {
    width:100%; max-width:400px; position:relative;
    background:linear-gradient(180deg, var(--panel), var(--panel-2));
    border:1px solid var(--line); border-radius:20px; padding:32px 30px 30px;
    box-shadow:0 1px 0 rgba(255,255,255,.03) inset, 0 30px 80px -20px rgba(0,0,0,.7);
    opacity:0; transform:translateY(10px) scale(.98); animation:rise .6s var(--ease) .12s forwards;
    overflow:hidden;
  }
  .card::before {
    content:''; position:absolute; inset:0 0 auto; height:1px;
    background:linear-gradient(90deg, transparent, rgba(255,64,52,.6), transparent);
  }

  .dots { display:flex; gap:7px; justify-content:center; margin:0 0 22px; }
  .dots i {
    width:26px; height:4px; border-radius:99px; background:var(--soft);
    transition:background .4s var(--ease), width .4s var(--ease);
  }
  .dots i.on { background:var(--red); }
  .dots i.done { background:var(--text); }

  .step { display:none; }
  .step.active { display:block; animation:slide .45s var(--ease); }

  h1 { font-size:23px; font-weight:740; letter-spacing:-0.035em; margin:0 0 6px; }
  p.sub { color:var(--muted); font-size:14px; margin:0 0 22px; font-weight:500; }
  p.sub b { color:var(--text); font-weight:680; }

  .field { position:relative; margin-top:16px; }
  label { display:block; font-size:12px; font-weight:680; color:var(--muted); margin:0 0 7px; letter-spacing:0; }
  input {
    width:100%; padding:14px 15px; border-radius:12px; border:1px solid var(--line);
    background:#0c0d0f; color:var(--text); font-family:var(--sans); font-weight:680; font-size:16px;
    letter-spacing:-0.01em; transition:border-color .2s, box-shadow .2s, background .2s; outline:none;
  }
  input::placeholder { color:#4b4e57; font-weight:500; }
  input:focus { border-color:var(--red); background:#0e0f12; box-shadow:0 0 0 4px rgba(255,64,52,.15); }
  input.code-in { text-align:center; font-size:30px; letter-spacing:.5em; padding-left:.5em; font-weight:740; }

  button.cta {
    width:100%; margin-top:22px; padding:15px; border:0; border-radius:99px;
    background:var(--red-cta); color:#fff; font-family:var(--sans); font-weight:740; font-size:16px;
    letter-spacing:-0.01em; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:9px;
    transition:transform .18s var(--ease), background .2s, box-shadow .2s;
    box-shadow:0 10px 30px -10px rgba(255,64,52,.6);
  }
  button.cta:hover:not(:disabled) { background:var(--red-cta-hover); transform:translateY(-1px); }
  button.cta:active:not(:disabled) { transform:translateY(0) scale(.99); }
  button.cta:disabled { opacity:.6; cursor:default; box-shadow:none; }
  button.cta:focus-visible, .back:focus-visible { outline:2px solid var(--red-ink); outline-offset:3px; }
  button.cta .arr { transition:transform .25s var(--ease); }
  button.cta:hover:not(:disabled) .arr { transform:translateX(3px); }
  .spin { width:16px; height:16px; border-radius:50%; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; animation:spin .7s linear infinite; }

  .back { background:none; border:0; color:var(--muted); font-family:var(--sans); font-weight:680; font-size:13px; cursor:pointer; padding:10px 0 0; margin:6px auto 0; display:block; }
  .back:hover { color:var(--text); }

  .err { color:var(--red-ink); font-size:13px; font-weight:680; margin-top:14px; text-align:center; min-height:0; }
  .err:empty { display:none; }

  .done { text-align:center; padding:6px 0 4px; }
  .check {
    width:76px; height:76px; margin:2px auto 20px; border-radius:22px;
    background:linear-gradient(160deg,#ff5a4f,var(--red)); display:grid; place-items:center;
    box-shadow:0 14px 40px -8px rgba(255,64,52,.7); animation:pop .5s var(--ease);
  }
  .check svg { width:40px; height:40px; }
  .foot { color:var(--muted); font-size:12px; text-align:center; margin-top:24px; font-weight:500; display:flex; align-items:center; justify-content:center; gap:6px; }
  .foot svg { width:13px; height:13px; opacity:.7; }

  @keyframes rise { to { opacity:1; transform:none; } }
  @keyframes slide { from { opacity:0; transform:translateX(14px); } to { opacity:1; transform:none; } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes pop { 0% { transform:scale(0); } 60% { transform:scale(1.12); } 100% { transform:scale(1); } }
  @media (prefers-reduced-motion: reduce) { *,*::before { animation:none !important; } }
</style></head>
<body>
  <canvas id="confetti"></canvas>

  <div style="width:100%; max-width:400px;">
    <div class="brand"><span class="mark"></span> Trade Republic</div>
    <div class="card">
      <div class="dots"><i id="d0"></i><i id="d1"></i><i id="d2"></i></div>

      <!-- Step 1 — phone -->
      <div id="step-phone" class="step active">
        <h1>What's your number?</h1>
        <p class="sub">Log in <b>once</b>. Read-only, we never place trades.</p>
        <div class="field">
          <label for="phone">Phone number</label>
          <input id="phone" type="tel" placeholder="+33 6 12 34 56 78" autocomplete="tel" enterkeyhint="next"/>
        </div>
        <button class="cta" id="btn-phone">Continue <span class="arr">→</span></button>
        <div id="err0" class="err"></div>
      </div>

      <!-- Step 2 — pin -->
      <div id="step-pin" class="step">
        <h1>Enter your PIN</h1>
        <p class="sub">Your Trade Republic app PIN. Used once, <b>never stored</b>.</p>
        <div class="field">
          <label for="pin">PIN</label>
          <input id="pin" type="password" inputmode="numeric" placeholder="••••" autocomplete="off" enterkeyhint="go"/>
        </div>
        <button class="cta" id="btn-pin">Log in <span class="arr">→</span></button>
        <button class="back" id="back-pin">← Change number</button>
        <div id="err1" class="err"></div>
      </div>

      <!-- Step 3 — code -->
      <div id="step-code" class="step">
        <h1>Verify it's you</h1>
        <p class="sub" id="code-hint">Trade Republic sent you a code.</p>
        <div class="field">
          <label for="code">Verification code</label>
          <input id="code" class="code-in" inputmode="numeric" placeholder="————" autocomplete="one-time-code" maxlength="6" enterkeyhint="go"/>
        </div>
        <button class="cta" id="btn-code">Connect <span class="arr">→</span></button>
        <div id="err2" class="err"></div>
      </div>

      <!-- Done -->
      <div id="step-done" class="step">
        <div class="done">
          <div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
          <h1>You're connected</h1>
          <p class="sub">Close this tab and head back to Claude.</p>
        </div>
      </div>

      <div class="foot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Credentials stay on your device
      </div>
    </div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);
  const state = { phone:'', pin:'' };
  const STEPS = ['step-phone','step-pin','step-code','step-done'];

  function goto(id, dotIdx) {
    for (const s of STEPS) $(s).classList.toggle('active', s === id);
    // progress dots: mark completed vs current
    for (let i = 0; i < 3; i++) {
      const d = $('d' + i);
      d.className = i < dotIdx ? 'done' : (i === dotIdx ? 'on' : '');
    }
    const input = $(id).querySelector('input');
    if (input) setTimeout(() => input.focus(), 60);
  }

  async function post(path, body) {
    const r = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }

  function busy(btn, label) {
    btn.disabled = true; btn.dataset.html = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span> ' + label;
  }
  function unbusy(btn) { btn.disabled = false; btn.innerHTML = btn.dataset.html; }

  // --- wahoo 🎉 -----------------------------------------------------------
  const cv = $('confetti'), cx = cv.getContext('2d');
  function fit() { cv.width = innerWidth; cv.height = innerHeight; }
  fit(); addEventListener('resize', fit);
  function wahoo() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#ff4034','#ff5a4f','#ffffff','#ff8a80','#ffd1cc'];
    const P = [], N = 150;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, sp = 4 + Math.random() * 9;
      P.push({ x:innerWidth/2, y:innerHeight*0.42,
        vx:Math.cos(a)*sp*(0.6+Math.random()*0.8),
        vy:Math.sin(a)*sp*(0.6+Math.random()*0.8) - 4,
        g:0.16+Math.random()*0.12, r:4+Math.random()*5,
        c:colors[i % colors.length], rot:Math.random()*6.28, vr:(Math.random()-0.5)*0.4, life:0 });
    }
    let f = 0;
    (function frame() {
      f++; cx.clearRect(0,0,cv.width,cv.height);
      let alive = false;
      for (const p of P) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr; p.life++;
        const al = Math.max(0, 1 - p.life / 110);
        if (al > 0 && p.y < innerHeight + 30) alive = true;
        cx.save(); cx.globalAlpha = al; cx.translate(p.x, p.y); cx.rotate(p.rot);
        cx.fillStyle = p.c; cx.fillRect(-p.r/2, -p.r/2, p.r, p.r*1.7); cx.restore();
      }
      if (alive && f < 200) requestAnimationFrame(frame); else cx.clearRect(0,0,cv.width,cv.height);
    })();
  }

  // --- step 1: phone ------------------------------------------------------
  $('btn-phone').onclick = () => {
    const v = $('phone').value.trim();
    if (!v) { $('err0').textContent = 'Enter your phone number.'; $('phone').focus(); return; }
    $('err0').textContent = ''; state.phone = v;
    wahoo();                          // 🎉 phone number
    goto('step-pin', 1);
  };
  $('phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-phone').click(); });

  // --- step 2: pin (runs login) ------------------------------------------
  $('back-pin').onclick = () => goto('step-phone', 0);
  $('btn-pin').onclick = async () => {
    const v = $('pin').value.trim();
    if (!v) { $('err1').textContent = 'Enter your PIN.'; $('pin').focus(); return; }
    $('err1').textContent = ''; state.pin = v;
    const b = $('btn-pin'); busy(b, 'Contacting Trade Republic…');
    try {
      const r = await post('/api/login', { phoneNumber: state.phone, pin: state.pin });
      $('code-hint').textContent = r.twoFa === 'SMS'
        ? 'Trade Republic texted you a code.'
        : 'Approve or read the code in your Trade Republic app.';
      wahoo();                        // 🎉 pin
      goto('step-code', 2);
    } catch (e) { $('err1').textContent = e.message; }
    finally { unbusy(b); }
  };
  $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-pin').click(); });

  // --- step 3: code (verify) ---------------------------------------------
  $('btn-code').onclick = async () => {
    const v = $('code').value.trim();
    if (!v) { $('err2').textContent = 'Enter the code.'; $('code').focus(); return; }
    $('err2').textContent = '';
    const b = $('btn-code'); busy(b, 'Verifying…');
    try {
      await post('/api/verify', { code: v });
      goto('step-done', 3);
      wahoo();                        // 🎉 success
    } catch (e) { $('err2').textContent = e.message; unbusy(b); }
  };
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-code').click(); });

  // autofocus first field on load
  goto('step-phone', 0);
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
