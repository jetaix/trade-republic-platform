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
 *   tr_status           session TTL, WAF/WS state, account numbers
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
    socket?.close();
    socket = null;
    client = null;
    try {
      clearSession();
    } catch {}
    return text('Logged out and saved session deleted.');
  },
);

server.registerTool(
  'tr_status',
  {
    title: 'Session status',
    description: 'Reports login state, session TTL, WAF readiness, WebSocket connection, and account numbers.',
    inputSchema: {},
  },
  async () => {
    if (DEMO) {
      return text({ mode: 'demo', loggedIn: true, sessionTtlMs: 300_000, wafReady: true, wsConnected: true, secAccNo: '0384048802' });
    }
    return text({
      mode: 'real',
      loggedIn: Boolean(client?.isLoggedIn),
      sessionTtlMs: client?.sessionTtlMs() ?? 0,
      wafReady: Boolean(client?.wafToken),
      wsConnected: Boolean(socket?.connected),
      secAccNo: client?.secAccNo() ?? null,
      cashAccNo: client?.cashAccNo() ?? null,
    });
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
