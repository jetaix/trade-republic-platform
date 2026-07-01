#!/usr/bin/env node
/**
 * Trade Republic — persistent poller (read-only).
 *
 * Demonstrates the auth heartbeat that keeps a "persistent" client alive:
 *   - refreshes the 5-minute `tr_session` JWT via GET /api/v1/auth/web/session
 *   - re-sends the WAF token on every call (cookie + x-aws-waf-token header)
 *   - polls the portfolio-chart gateway endpoint from the original curl
 *
 * This does NOT perform the initial login (that is 2FA-gated and must be done by
 * a human / headless browser). You bootstrap it with a cookie jar copied out of
 * a logged-in browser session, then it keeps that session warm.
 *
 * Usage:
 *   TR_COOKIE='tr_session=…; tr_claims=…; JSESSIONID=…; aws-waf-token=…; …' \
 *   TR_WAF_TOKEN='b69b65d0-…' \
 *   TR_SEC_ACC=0384048802 \
 *   node persistent-poll.mjs
 *
 * Requires Node >= 22 (global fetch). No dependencies.
 */

const BASE = 'https://api.traderepublic.com';

const COOKIE = process.env.TR_COOKIE;
const WAF_TOKEN = process.env.TR_WAF_TOKEN;
const CURRENCY = process.env.TR_CURRENCY ?? 'EUR';
const RANGE = process.env.TR_RANGE ?? '1d';
const APP_VERSION = process.env.TR_APP_VERSION ?? '15.65.6';
const POLL_MS = Number(process.env.TR_POLL_MS ?? 60_000); // 60s between chart polls
const REFRESH_MARGIN_MS = 60_000; // refresh session 60s before it expires

if (!COOKIE || !WAF_TOKEN) {
  console.error('Set TR_COOKIE and TR_WAF_TOKEN (see file header).');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

/** Mutable cookie jar as a single Cookie-header string, keyed by cookie name. */
const jar = new Map(
  COOKIE.split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i), c.slice(i + 1)];
    }),
);

const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

const baseHeaders = () => ({
  accept: '*/*',
  'accept-language': 'en',
  'content-type': 'application/json',
  origin: 'https://app.traderepublic.com',
  cookie: cookieHeader(),
  'user-agent': UA,
  'x-aws-waf-token': WAF_TOKEN,
  'x-tr-app-version': APP_VERSION,
  'x-tr-platform': 'web',
});

/** Merge any Set-Cookie headers from a response back into the jar. */
function absorbSetCookie(res) {
  // Node fetch exposes combined Set-Cookie via getSetCookie() (undici).
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const raw of cookies) {
    const first = raw.split(';', 1)[0];
    const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
}

/** Decode a JWT payload without verifying (we only read exp/act, not trust it). */
function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    const json = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** ms until the current tr_session expires (0 if unknown/expired). */
function sessionTtlMs() {
  const claims = decodeJwt(jar.get('tr_session') ?? '');
  if (!claims?.exp) return 0;
  return Math.max(0, claims.exp * 1000 - Date.now());
}

function secAccNo() {
  if (process.env.TR_SEC_ACC) return process.env.TR_SEC_ACC;
  const claims = decodeJwt(jar.get('tr_session') ?? '');
  return claims?.act?.acc?.owner?.default?.sec?.[0];
}

async function refreshSession() {
  const res = await fetch(`${BASE}/api/v1/auth/web/session`, {
    method: 'GET',
    headers: baseHeaders(),
  });
  if (res.status === 403 || res.status === 405) {
    throw new Error(
      `WAF challenge on session refresh (HTTP ${res.status}). ` +
        'Re-solve the aws-waf-token via a headless browser and restart.',
    );
  }
  if (!res.ok) {
    throw new Error(`Session refresh failed: HTTP ${res.status} — session likely dead, re-login (2FA) required.`);
  }
  absorbSetCookie(res);
  const ttl = Math.round(sessionTtlMs() / 1000);
  console.log(`[auth] session refreshed, valid for ~${ttl}s`);
}

async function ensureSession() {
  if (sessionTtlMs() <= REFRESH_MARGIN_MS) await refreshSession();
}

async function pollChart() {
  await ensureSession();
  const sec = secAccNo();
  if (!sec) throw new Error('No securities account number (set TR_SEC_ACC).');

  const url =
    `${BASE}/api-gateway/portfolio-chart/v2/chart` +
    `?secAccNo=${encodeURIComponent(sec)}&range=${RANGE}&currency=${CURRENCY}`;

  const res = await fetch(url, { method: 'GET', headers: baseHeaders() });
  if (!res.ok) {
    console.error(`[chart] HTTP ${res.status}: ${await res.text()}`);
    return;
  }
  const data = await res.json();
  const points = data?.aggregates?.length ?? data?.snapshots?.length ?? '?';
  console.log(
    `[chart] ${new Date().toISOString()} secAcc=${sec} range=${RANGE} ` +
      `points=${points}`,
  );
}

// --- main loop -------------------------------------------------------------
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
  console.log('\n[exit] stopping…');
});

console.log(
  `[start] polling chart every ${POLL_MS / 1000}s, session TTL now ~${Math.round(
    sessionTtlMs() / 1000,
  )}s`,
);

while (!stopped) {
  try {
    await pollChart();
  } catch (err) {
    console.error(`[error] ${err.message}`);
    if (/re-login|WAF challenge/.test(err.message)) break; // unrecoverable here
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
