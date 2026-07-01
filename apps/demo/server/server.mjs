/**
 * Demo proxy server.
 *
 * The browser CANNOT call api.traderepublic.com directly: CORS only allows
 * origin app.traderepublic.com, and the WAF/cookie handshake needs a server.
 * So this tiny Express app is the trusted middle-man. The React app talks to
 * THIS server; this server talks to Trade Republic.
 *
 * Modes:
 *   - real  (default): headless-Chromium WAF bootstrap + real TR login flow
 *   - demo  (TR_DEMO=1): synthetic data, no browser/credentials needed — so you
 *           can see the UI render a live-updating chart end to end.
 *
 * Run:  node server/server.mjs          (real)
 *       TR_DEMO=1 node server/server.mjs (mock)
 */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRClient, TRSocket, bootstrapWaf } from '@trade-republic/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO = process.env.TR_DEMO === '1';
const PORT = Number(process.env.PORT ?? 5175);

const app = express();
app.use(express.json());
// Serve the live React app; `/` -> demo.html (landing + docs live in the website app).
app.use(express.static(join(__dirname, '..', 'web'), { index: 'demo.html' }));

/** One in-memory session for the demo. Real apps: one client per user. */
let client = null;
/** Live WebSocket connection, started after login. */
let socket = null;

// ---- demo/mock data --------------------------------------------------------
function mockChart(range) {
  const counts = { '1d': 78, '5d': 120, '1m': 30, '1y': 52, max: 100 };
  const n = counts[range] ?? 60;
  let v = 10_000;
  const aggregates = Array.from({ length: n }, (_, i) => {
    v += (((i * 37 + 11) % 23) - 11) * 4.2; // deterministic pseudo-walk
    return { time: Date.now() - (n - i) * 60_000, value: Number(v.toFixed(2)) };
  });
  return { rangeType: range, aggregates };
}

/**
 * Trade Republic's real chart response shape varies (v2 nests the series and
 * uses close/adjValue, often as strings). Adaptively find the time-series array
 * and coerce it to [{ time, value }] so the UI stays decoupled from field names.
 */
const SERIES_KEYS = ['points', 'aggregates', 'snapshots', 'series', 'timeSeries', 'chart', 'data'];
const TIME_KEYS = ['timestamp', 'time', 'date', 't', 'x'];
const VALUE_KEYS = ['netValue', 'value', 'close', 'adjValue', 'totalValue', 'price', 'marketValue', 'v', 'y'];

function findSeries(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  for (const k of SERIES_KEYS) {
    if (Array.isArray(obj[k]) && obj[k].length && typeof obj[k][0] === 'object') return obj[k];
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findSeries(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function pick(obj, keys) {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

function toTime(t) {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  const d = Date.parse(t);
  return Number.isFinite(d) ? d : null;
}

function normalizeChart(raw, range) {
  const arr = findSeries(raw) ?? [];
  const aggregates = arr
    .map((o) => ({ time: toTime(pick(o, TIME_KEYS)), value: Number(pick(o, VALUE_KEYS)) }))
    .filter((p) => Number.isFinite(p.value));
  return { rangeType: raw?.rangeType ?? raw?.range ?? range, aggregates };
}

function mockWsState() {
  return {
    connected: true,
    topics: ['portfolio', 'cash', 'timeline'],
    state: {
      portfolio: {
        categories: [
          {
            categoryType: 'stocks',
            positions: [
              { instrumentId: 'US88160R1014', name: 'Tesla', netSize: '3', averageBuyIn: '182.40', netValue: 612.30 },
              { instrumentId: 'US0378331005', name: 'Apple', netSize: '10', averageBuyIn: '164.10', netValue: 1841.00 },
              { instrumentId: 'IE00B4L5Y983', name: 'iShares Core MSCI World', netSize: '25', averageBuyIn: '78.02', netValue: 2010.50 },
            ],
          },
          {
            categoryType: 'cryptos',
            positions: [{ instrumentId: 'SOL', name: 'Solana', netSize: '1.2', averageBuyIn: '48.10', netValue: 65.37 }],
          },
        ],
      },
      cash: [{ currencyId: 'EUR', amount: 1284.19 }],
      timeline: {
        items: [
          { id: 't1', timestamp: Date.now() - 3_600_000, eventType: 'ORDER_EXECUTED', title: 'Buy Apple', subtitle: '+2 @ €171.20' },
          { id: 't2', timestamp: Date.now() - 90_000_000, eventType: 'PAYMENT_INBOUND', title: 'Deposit', subtitle: '+€500.00' },
          { id: 't3', timestamp: Date.now() - 180_000_000, eventType: 'DIVIDEND', title: 'Dividend iShares World', subtitle: '+€12.44' },
        ],
      },
    },
    errors: {},
  };
}

// ---- routes ----------------------------------------------------------------
// (Docs — Scalar reference, guide, openapi.yaml — are served by the website app.)

app.get('/api/status', (req, res) => {
  res.json({
    mode: DEMO ? 'demo' : 'real',
    loggedIn: DEMO ? true : Boolean(client?.isLoggedIn),
    sessionTtlMs: DEMO ? 300_000 : (client?.sessionTtlMs() ?? 0),
    secAccNo: DEMO ? '0384048802' : (client?.secAccNo() ?? null),
    wafReady: DEMO ? true : Boolean(client?.wafToken),
    wsConnected: DEMO ? true : Boolean(socket?.connected),
  });
});

app.post('/api/login', async (req, res) => {
  if (DEMO) return res.json({ processId: 'demo', twoFa: 'APP', countdownInSeconds: 0 });
  try {
    const { phoneNumber, pin } = req.body ?? {};
    if (!phoneNumber || !pin) return res.status(400).json({ error: 'phoneNumber & pin required' });

    // Bootstrap WAF token via headless browser, then start login.
    client = new TRClient();
    client.seedFromWaf(await bootstrapWaf());
    const result = await client.login(phoneNumber, pin);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/verify', async (req, res) => {
  if (DEMO) return res.json({ ttlMs: 300_000, secAccNo: '0384048802' });
  try {
    const { processId, code } = req.body ?? {};
    if (!client) return res.status(409).json({ error: 'call /api/login first' });
    const result = await client.verify(processId, code);
    // Open the live WebSocket and subscribe to read-only topics.
    socket = new TRSocket(client);
    socket.start().catch((e) => console.error('[ws] start failed:', e.message));
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/chart', async (req, res) => {
  const range = String(req.query.range ?? '1d');
  const currency = String(req.query.currency ?? 'EUR');
  if (DEMO) return res.json(mockChart(range));
  try {
    if (!client?.isLoggedIn) return res.status(401).json({ error: 'not logged in' });
    const raw = await client.getChart({ range, currency });
    const norm = normalizeChart(raw, range);
    if (!norm.aggregates.length) {
      // Help diagnose an unexpected shape: log top-level keys + a sample row.
      const series = findSeries(raw);
      console.error('[chart] 0 points. response keys:', Object.keys(raw ?? {}));
      console.error('[chart] first series row:', JSON.stringify(series?.[0] ?? null));
    }
    res.json(norm);
  } catch (err) {
    const status = err.code === 'REAUTH' ? 401 : err.code === 'WAF' ? 403 : 502;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// Live WebSocket state: portfolio (compactPortfolio), cash (availableCash),
// timeline (timelineTransactions). In real mode this is fed by TR deltas.
app.get('/api/ws', (req, res) => {
  if (DEMO) return res.json(mockWsState());
  if (!socket) return res.status(409).json({ error: 'not connected — log in first' });
  res.json(socket.snapshot());
});

app.listen(PORT, () => {
  console.log(`TR demo (${DEMO ? 'DEMO/mock' : 'REAL'}) → http://localhost:${PORT}`);
});
