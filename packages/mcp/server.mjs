#!/usr/bin/env node
/**
 * Trade Republic MCP server (read-only).
 *
 * Exposes the reverse-engineered TR API to any MCP client (Claude, etc.) as
 * tools + resources. The TR client/socket/WAF + OpenAPI spec come from the
 * shared @trade-republic/api package; session + auth-server helpers are in ./lib.
 *
 * Tools:
 *   tr_login            start login (bootstraps WAF via headless Chromium) -> processId
 *   tr_verify           complete login with the 2FA code (opens the WebSocket)
 *   tr_status           account overview (identity, IBAN, live value + sparkline, session)
 *   tr_account          raw /api/v2/auth/account payload + detected IBAN (debug)
 *   tr_portfolio_chart  portfolio value time series (REST)
 *   tr_positions        current positions incl. crypto (WS compactPortfolioByType)
 *   tr_cash             cash balances (WS availableCash)
 *   tr_timeline         recent activity, paginated (WS timelineTransactions)
 *
 * Resources:
 *   tr://openapi        the OpenAPI 3.1 document
 *   tr://guide          the markdown API guide
 *
 * Run:
 *   npm install && npx playwright install chromium && node server.mjs   (real)
 *   TR_DEMO=1 node server.mjs                                           (mock — no creds, no browser)
 *
 * SDK: @modelcontextprotocol/sdk v1.29 (registerTool + StdioServerTransport).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import { openapiPath, guidePath } from '@trade-republic/api';
import { loadSession, saveSession, clearSession } from './lib/session-store.mjs';

const DEMO = process.env.TR_DEMO === '1';

/** @type {import('@trade-republic/api').TRClient | null} */
let client = null;
let socket = null;

const text = (v) => ({
  content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
});
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: `Error: ${msg}` }] });

// ---- mock data (TR_DEMO=1) -------------------------------------------------
function mockChart(range) {
  const n = { '1d': 78, '5d': 120, '1m': 30, '1y': 52, max: 100 }[range] ?? 60;
  let v = 10_000;
  return {
    rangeType: range,
    aggregates: Array.from({ length: n }, (_, i) => {
      v += (((i * 37 + 11) % 23) - 11) * 4.2;
      return { time: 1_782_800_000_000 + i * 60_000, value: Number(v.toFixed(2)) };
    }),
  };
}
const MOCK_WS = {
  portfolio: {
    categories: [
      {
        categoryType: 'stocks',
        positions: [
          { instrumentId: 'US88160R1014', name: 'Tesla', netSize: '3', netValue: 612.3 },
          { instrumentId: 'US0378331005', name: 'Apple', netSize: '10', netValue: 1841 },
          { instrumentId: 'IE00B4L5Y983', name: 'iShares Core MSCI World', netSize: '25', netValue: 2010.5 },
        ],
      },
      { categoryType: 'cryptos', positions: [{ instrumentId: 'SOL', name: 'Solana', netSize: '1.2', netValue: 65.37 }] },
    ],
  },
  cash: [{ currencyId: 'EUR', amount: 1284.19 }],
  timeline: {
    items: [
      { id: 't1', eventType: 'ORDER_EXECUTED', title: 'Buy Apple', subtitle: '+2 @ €171.20' },
      { id: 't2', eventType: 'PAYMENT_INBOUND', title: 'Deposit', subtitle: '+€500.00' },
      { id: 't3', eventType: 'DIVIDEND', title: 'Dividend iShares World', subtitle: '+€12.44' },
    ],
  },
};

async function realDeps() {
  // Lazy so DEMO mode never needs @trade-republic/api's ws/playwright deps.
  return import('@trade-republic/api');
}

function requireLogin() {
  if (!DEMO && !client?.isLoggedIn) throw new Error('not authenticated — call tr_authenticate first');
}

/** Persist the current session to disk (called on login and every refresh). */
function persist() {
  if (DEMO || !client) return;
  try {
    saveSession(client.export());
  } catch (e) {
    console.error('[persist] failed:', e.message);
  }
}

/** Open a URL in the user's default browser (best-effort, cross-platform). */
function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  return new Promise((resolve) => exec(`${cmd} "${url}"`, () => resolve()));
}

async function startSocket() {
  const { TRSocket } = await realDeps();
  socket = new TRSocket(client);
  socket.start().catch((e) => console.error('[ws] start failed:', e.message));
}

/**
 * Proactive keepalive: refresh the session every ~4 min (before the 5-min JWT
 * expiry) so it stays alive while the server runs, even when no tool is called.
 * If TR invalidates the session, stop and require re-authentication.
 */
let keepaliveTimer = null;
function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(async () => {
    if (!client) return;
    try {
      await client.refreshSession(); // onUpdate -> persist()
      console.error(`[keepalive] session refreshed, TTL ~${Math.round(client.sessionTtlMs() / 1000)}s`);
    } catch (e) {
      console.error('[keepalive] refresh failed — re-auth needed:', e.message);
      stopKeepalive();
      socket?.close();
      socket = null;
      client = null;
    }
  }, 240_000);
}
function stopKeepalive() {
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = null;
}

// ---- server ----------------------------------------------------------------
const server = new McpServer({ name: 'trade-republic', version: '0.1.0' });

server.registerTool(
  'tr_authenticate',
  {
    title: 'Authenticate with Trade Republic (opens a browser)',
    description:
      'Opens a local browser page to collect your phone number, PIN and 2FA code, ' +
      'logs in to Trade Republic, and saves the session so it persists across restarts. ' +
      'Call this once; afterwards the other tools work until the session is revoked.',
    inputSchema: {},
  },
  async () => {
    if (DEMO) return text('Authenticated (DEMO mode — no browser needed).');
    try {
      if (client?.isLoggedIn) {
        return text(`Already authenticated. Session valid for ~${Math.round(client.sessionTtlMs() / 1000)}s.`);
      }
      const { TRClient, bootstrapWaf } = await realDeps();
      if (!client) client = new TRClient();
      client.onUpdate = persist;

      const { startAuthServer } = await import('./lib/auth-server.mjs');
      const auth = await startAuthServer({
        client,
        bootstrapWaf,
        onComplete: async () => {
          persist();
          startKeepalive();
          await startSocket();
        },
      });
      await openBrowser(auth.url);

      // Wait for the user to finish in the browser (up to 4 minutes).
      const ok = await Promise.race([
        auth.done,
        new Promise((r) => setTimeout(() => r(false), 240_000)),
      ]);
      auth.close();
      if (ok) {
        return text(`✅ Authenticated and session saved. You can now query your portfolio.`);
      }
      return text(
        `A browser window was opened at ${auth.url} — enter your phone number, PIN and code there, ` +
          `then ask me to check tr_status.`,
      );
    } catch (e) {
      return fail(e.message);
    }
  },
);

server.registerTool(
  'tr_logout',
  {
    title: 'Log out of Trade Republic',
    description: 'Closes the connection and deletes the saved session from disk.',
    inputSchema: {},
  },
  async () => {
    if (DEMO) return text('Logged out (DEMO).');
    stopKeepalive();
    socket?.close();
    socket = null;
    client = null;
    try {
      clearSession();
    } catch {}
    return text('Logged out and saved session deleted.');
  },
);

// ---- rich status report helpers -------------------------------------------
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/;
function findByKey(obj, keyRe, valRe) {
  let found = null;
  (function walk(o) {
    if (found != null || !o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (found != null) return;
      if (typeof v === 'string') {
        if (keyRe.test(k) && (!valRe || valRe.test(v.replace(/\s/g, '')))) found = v;
      } else if (v && typeof v === 'object') walk(v);
    }
  })(obj);
  return found;
}
const findIban = (o) => findByKey(o, /iban/i, IBAN_RE) || findByKey(o, /.*/, IBAN_RE);
const eur = (n) => (n == null || isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en', { style: 'currency', currency: 'EUR' }));
function sparkline(vals) {
  const bars = '▁▂▃▄▅▆▇█';
  const nums = (vals || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '▁▂▃▄▅▆▇█▇▆▅▄▃▂▁';
  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const N = Math.min(30, nums.length), step = nums.length / N;
  let out = '';
  for (let i = 0; i < N; i++) out += bars[Math.min(7, Math.floor(((nums[Math.floor(i * step)] - min) / span) * 8))];
  return out;
}
function flatPositions(portfolio) {
  if (Array.isArray(portfolio?.categories))
    return portfolio.categories.flatMap((c) => (c.positions ?? []).map((p) => ({ ...p, categoryType: c.categoryType })));
  return Array.isArray(portfolio?.positions) ? portfolio.positions : [];
}
function box(title, w = 54) {
  const t = title.length > w - 2 ? title.slice(0, w - 2) : title;
  const gap = w - 2 - t.length, l = Math.floor(gap / 2), r = gap - l;
  return [
    '  ╭' + '─'.repeat(w - 2) + '╮',
    '  │' + ' '.repeat(l) + t + ' '.repeat(r) + '│',
    '  ╰' + '─'.repeat(w - 2) + '╯',
  ].join('\n');
}
/** Flatten an object to [dotted.path, value] pairs for every scalar leaf. */
function flattenScalars(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || k === 'token') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object') {
      if (Array.isArray(v) && v.every((x) => x == null || typeof x !== 'object')) out.push([key, v.join(', ')]);
      else flattenScalars(v, key, out);
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

function renderReport(d) {
  const row = (label, val) => `     ${(String(label) + '  ').padEnd(20)}${val}`;
  const L = [];
  L.push(box('T R A D E   R E P U B L I C   ·   M C P'));
  L.push('       ' + (d.spark || '') + '   ✅ connected');
  L.push('');
  if (d.netValue != null)
    L.push(`  💶  ${eur(d.netValue)}   ${d.range || '1d'}${d.deltaPct != null ? `   ${d.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(d.deltaPct).toFixed(2)}%` : ''}`);
  L.push('');

  L.push('  👤 Identity');
  L.push(row('User ID', d.userId ?? '—'));
  if (d.actId && d.actId !== d.userId) L.push(row('Actor ID', d.actId));
  if (d.rel) L.push(row('Relationship', d.rel));
  L.push(row('Jurisdiction', d.jurisdiction ?? '—'));
  L.push(row('Status', d.status ?? '—'));
  if (d.tokenType) L.push(row('Token type', d.tokenType));
  L.push('');

  L.push('  🪪 Personal details');
  if (d.accountScalars?.length) {
    for (const [k, v] of d.accountScalars) L.push(row(k, v));
  } else {
    L.push('     ' + (d.accountError ? `unavailable — ${d.accountError}` : 'none returned by /api/v2/auth/account'));
    L.push('     (run tr_account for the raw payload)');
  }
  L.push('');

  L.push('  🏦 Accounts');
  L.push(row('Securities', ((d.sec || []).join(', ') || '—') + '   (internal API id)'));
  L.push(row('Cash', ((d.cash || []).join(', ') || '—') + '   (internal API id)'));
  L.push(row('IBAN', d.iban || '— (see tr_account)'));
  L.push('');

  L.push('  🔑 Device & session');
  if (d.device) L.push(row('Device ID', d.device));
  if (d.externalId) L.push(row('External ID', d.externalId));
  if (d.sessionId) L.push(row('Session ID', d.sessionId));
  if (d.issued) L.push(row('Issued', d.issued));
  if (d.expires) L.push(row('Expires', d.expires));
  L.push(row('tr_session', `valid ~${d.ttlSec}s · auto-refresh`));
  L.push(row('WebSocket', d.wsConnected ? 'connected' : 'connecting…'));
  L.push('');

  L.push('  🚩 Features');
  L.push('     ' + ((d.features || []).join(' · ') || '—'));
  L.push('');

  L.push('  📊 Portfolio');
  L.push(row('Net value', d.netValue != null ? eur(d.netValue) : '—'));
  if (d.cashBalances?.length) {
    for (const c of d.cashBalances) L.push(row('Cash · ' + (c.currency || '?'), eur(c.amount)));
  } else {
    L.push(row('Cash avail.', d.cashAvailable != null ? eur(d.cashAvailable) : '—'));
  }
  if (d.positions?.length) {
    L.push(row('Positions', String(d.positions.length)));
    for (const p of d.positions.slice(0, 25))
      L.push(`       • ${p.name}${p.category ? ` · ${p.category}` : ''}${p.value != null ? `   ${eur(p.value)}` : p.size != null ? `   ×${p.size}` : ''}`);
  } else {
    L.push(row('Positions', '— (open tr_positions)'));
  }
  if (d.timelineCount != null) L.push(row('Timeline', `${d.timelineCount} events`));
  return L.join('\n');
}

const DEMO_REPORT = {
  spark: sparkline([16.1, 16.0, 15.7, 16.4, 16.9, 16.6, 16.8, 17.0, 16.7, 17.01]),
  netValue: 12842.55, range: '1d', deltaPct: 2.15,
  userId: 'aeed69c9-… (mock)', actId: 'aeed69c9-… (mock)', rel: 'self',
  jurisdiction: 'FR', status: 'ACTIVE', tokenType: 'SESSION',
  accountScalars: [
    ['firstName', 'Ada'], ['lastName', 'Lovelace'], ['email', 'ada@example.com'],
    ['phoneNumber', '+33600000012'], ['dateOfBirth', '1990-01-01'], ['taxResidency', 'FR'],
    ['address.street', '12 Rue de Rivoli'], ['address.city', 'Paris'], ['address.postalCode', '75001'],
    ['cashAccount.iban', 'DE89 3704 0044 0532 0130 00'], ['experience.stocks', 'experienced'],
  ],
  sec: ['0384048802'], cash: ['0384048811'], iban: 'DE89 3704 0044 0532 0130 00',
  device: '0a9a8a05-…', externalId: 'edd87383-…', sessionId: '6c822592-…',
  issued: '2026-07-01 11:21:35 UTC', expires: '2026-07-01 11:26:35 UTC',
  features: ['currentAccountActivated', 'trIbanActivated', 'card', 'crypto', 'bondTrading', 'pvEnabledForCards'],
  cashBalances: [{ currency: 'EUR', amount: 1284.19 }],
  positions: [
    { name: 'Tesla', category: 'stocks', value: 612.3 },
    { name: 'Apple', category: 'stocks', value: 1841 },
    { name: 'iShares Core MSCI World', category: 'stocks', value: 2010.5 },
    { name: 'Solana', category: 'cryptos', value: 65.37 },
  ],
  timelineCount: 42, wsConnected: true, ttlSec: 300,
};

server.registerTool(
  'tr_status',
  {
    title: 'Account overview & session status',
    description:
      'Confident overview: authenticated identity, features, account numbers + IBAN, ' +
      'live portfolio value with a sparkline, and session/WebSocket state.',
    inputSchema: {},
  },
  async () => {
    if (DEMO) return text(renderReport(DEMO_REPORT));
    try {
      if (!client?.isLoggedIn) return text('Not authenticated yet. Run tr_authenticate to connect (opens a browser).');
      const claims = client.claims() ?? {};
      const fmt = (s) => { try { return new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; } catch { return null; } };

      // full account payload (best effort — never fails the report)
      let account = null, accountError = null;
      try { account = await client.getAccountInfo(); } catch (e) { accountError = e.message; }

      // live 1d chart → net value, delta, sparkline (best effort)
      let netValue = socket?.state?.portfolio?.netValue ?? null;
      let deltaPct = null, spark = '';
      try {
        const chart = await client.getChart({ range: '1d' });
        const pts = (chart.points ?? []).map((p) => Number(p.netValue)).filter(Number.isFinite);
        if (pts.length) { spark = sparkline(pts); netValue = pts.at(-1); if (pts[0]) deltaPct = ((pts.at(-1) - pts[0]) / pts[0]) * 100; }
      } catch {}

      const owner = claims.act?.acc?.owner?.default ?? {};
      const cashArr = Array.isArray(socket?.state?.cash) ? socket.state.cash : [];
      const positions = flatPositions(socket?.state?.portfolio).map((p) => ({
        name: p.name ?? p.instrumentId ?? p.isin ?? p.id ?? '?',
        category: p.categoryType,
        size: p.netSize ?? p.size ?? p.quantity,
        value: p.netValue ?? p.value ?? p.marketValue,
      }));

      return text(
        renderReport({
          spark, netValue, deltaPct, range: '1d',
          userId: claims.sub,
          actId: claims.act?.id,
          rel: claims.act?.rel,
          jurisdiction: claims.jurisdiction,
          status: claims.status,
          tokenType: claims.type,
          accountScalars: account ? flattenScalars(account) : [],
          accountError,
          sec: owner.sec ?? (client.secAccNo() ? [client.secAccNo()] : []),
          cash: owner.cash ?? (client.cashAccNo() ? [client.cashAccNo()] : []),
          iban: account ? findIban(account) : null,
          device: client.jar?.get?.('tr_device'),
          externalId: client.jar?.get?.('tr_external_id'),
          sessionId: claims.sessionId,
          issued: fmt(claims.iat),
          expires: fmt(claims.exp),
          features: client.features(),
          cashBalances: cashArr.map((c) => ({ currency: c.currencyId ?? c.currency ?? 'EUR', amount: c.amount ?? c.value })),
          cashAvailable: cashArr[0]?.amount ?? null,
          positions,
          timelineCount: socket?.state?.timeline?.items?.length ?? null,
          wsConnected: Boolean(socket?.connected),
          ttlSec: Math.round((client.sessionTtlMs() ?? 0) / 1000),
        }),
      );
    } catch (e) {
      return fail(e.message);
    }
  },
);

server.registerTool(
  'tr_account',
  {
    title: 'Raw account payload (debug)',
    description:
      'Returns the raw /api/v2/auth/account response plus the auto-detected IBAN. ' +
      'Use this to discover exactly which field holds the IBAN and other personal details.',
    inputSchema: {},
  },
  async () => {
    if (DEMO)
      return text({
        note: 'DEMO mock — not real data',
        detectedIban: 'DE89 3704 0044 0532 0130 00',
        raw: {
          personId: 'demo',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          phoneNumber: '+33600000012',
          taxResidency: 'FR',
          cashAccount: { iban: 'DE89 3704 0044 0532 0130 00', accountNumber: '0384048811' },
          securitiesAccount: { accountNumber: '0384048802' },
        },
      });
    try {
      requireLogin();
      const account = await client.getAccountInfo();
      return text({ detectedIban: findIban(account) ?? null, raw: account });
    } catch (e) {
      return fail(e.message);
    }
  },
);

server.registerTool(
  'tr_portfolio_chart',
  {
    title: 'Portfolio value chart',
    description: 'Portfolio value time series for the given range (REST portfolio-chart endpoint).',
    inputSchema: {
      range: z.enum(['1d', '5d', '1m', '3m', '1y', 'max']).default('1d'),
      currency: z.string().default('EUR'),
    },
  },
  async ({ range, currency }) => {
    try {
      requireLogin();
      if (DEMO) return text(mockChart(range));
      return text(await client.getChart({ range, currency }));
    } catch (e) {
      return fail(e.message);
    }
  },
);

const wsTool = (name, title, key, desc) =>
  server.registerTool(name, { title, description: desc, inputSchema: {} }, async () => {
    try {
      requireLogin();
      if (DEMO) return text(MOCK_WS[key]);
      const state = socket?.state?.[key];
      if (!state) return text({ pending: true, note: 'WebSocket frame not received yet — retry shortly' });
      return text(state);
    } catch (e) {
      return fail(e.message);
    }
  });

wsTool('tr_positions', 'Current positions', 'portfolio', 'Current holdings incl. crypto (WebSocket compactPortfolioByType topic).');
wsTool('tr_cash', 'Cash balances', 'cash', 'Available cash per currency (WebSocket availableCash topic).');
wsTool('tr_timeline', 'Activity timeline', 'timeline', 'Recent orders, transfers, and dividends (WebSocket timelineTransactions topic).');

// ---- resources -------------------------------------------------------------
server.registerResource(
  'openapi',
  'tr://openapi',
  { title: 'Trade Republic OpenAPI 3.1', description: 'Reverse-engineered REST spec', mimeType: 'text/yaml' },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/yaml', text: readFileSync(openapiPath, 'utf8') }],
  }),
);

server.registerResource(
  'guide',
  'tr://guide',
  { title: 'Trade Republic API guide', description: 'Markdown reference incl. the auth model', mimeType: 'text/markdown' },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(guidePath, 'utf8') }],
  }),
);

// ---- restore a persisted session on startup --------------------------------
async function restoreSession() {
  if (DEMO) return;
  const saved = loadSession();
  if (!saved?.cookies?.length) return;
  try {
    const { TRClient } = await realDeps();
    client = new TRClient();
    client.seedFromWaf(saved);
    client.onUpdate = persist;
    await client.refreshSession(); // fails (REAUTH) if the session is dead
    persist();
    startKeepalive();
    await startSocket();
    console.error(`[tr-mcp] restored session, TTL ~${Math.round(client.sessionTtlMs() / 1000)}s`);
  } catch (e) {
    console.error('[tr-mcp] saved session could not be refreshed, re-auth needed:', e.message);
    client = null;
  }
}

// ---- start -----------------------------------------------------------------
await restoreSession();
await server.connect(new StdioServerTransport());
console.error(`[tr-mcp] ready (${DEMO ? 'DEMO/mock' : 'real'})`);
