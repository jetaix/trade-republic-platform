/**
 * Trade Republic WebSocket client (read-only topics).
 *
 * Speaks TR's line protocol over wss://api.traderepublic.com/ :
 *   →  connect 31 {json}                 (handshake)
 *   ←  connected
 *   →  sub {id} {"type":"...", ...}       (subscribe)
 *   ←  {id} A {json}                      full snapshot
 *   ←  {id} D {text-diff}                 delta vs the previous RAW json string
 *   ←  {id} C                             closed
 *   ←  {id} E {json}                      error
 *
 * The `D` delta is NOT JSON Patch — it's a tab-separated text diff over the
 * previous raw payload STRING (=N copy, -N skip, +text insert-urldecoded).
 * `applyDelta` below mirrors pytr's `_calculate_delta` exactly.
 *
 * Auth for the web flow is the session cookie sent on the WS handshake (same
 * cookie jar as the REST client), so no token is needed inside sub payloads.
 *
 * Requires: `pnpm add ws`.
 */
import WebSocket from 'ws';

const WS_URL = 'wss://api.traderepublic.com/';

/** Python urllib.parse.unquote_plus equivalent (+ -> space, then %XX decode). */
function unquotePlus(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s.replace(/\+/g, ' ');
  }
}

/** Reconstruct the new raw payload from the previous one + a TR delta string. */
export function applyDelta(previous, deltaPayload) {
  let i = 0;
  const result = [];
  for (const diff of deltaPayload.split('\t')) {
    const sign = diff[0];
    if (sign === '+') {
      result.push(unquotePlus(diff).trim());
    } else if (sign === '-' || sign === '=') {
      const n = parseInt(diff.slice(1), 10);
      if (sign === '=') result.push(previous.slice(i, i + n));
      i += n;
    }
  }
  return result.join('');
}

/**
 * Read-only topics we surface for an aggregation view.
 * `compactPortfolio` / `portfolio` are retired on protocol v31
 * ("Unknown topic type"); the current holdings topic is
 * `compactPortfolioByType`, which returns { categories: [{ categoryType, positions }] }
 * (categoryType includes "cryptos").
 */
const READ_TOPICS = [
  { name: 'portfolio', type: 'compactPortfolioByType' },
  { name: 'cash', type: 'availableCash' },
  { name: 'timeline', type: 'timelineTransactions', params: {} },
];

// timelineTransactions is paginated: each page returns `items` + a `cursors.after`
// token. Re-subscribe with { after } to walk older pages. Cap for safety.
const MAX_TIMELINE_PAGES = 30;

export class TRSocket {
  /** @param {import('./trClient.mjs').TRClient} client */
  constructor(client) {
    this.client = client;
    this.ws = null;
    this.nextId = 1;
    /** @type {Map<string,{name:string,rawPrev:string}>} */
    this.subs = new Map();
    /** Latest parsed payload per topic name. */
    this.state = {};
    this.errors = {};
    this._logged = new Set();
    this._timeline = { items: [], seen: new Set(), pages: 0, lastCursor: null };
    this.connected = false;
    this._echo = 0;
    this._heartbeat = null;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    await this.client.ensureSession();

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS connect timeout')), 15_000);
      this.ws = new WebSocket(WS_URL, {
        headers: {
          Cookie: this.client.cookieHeader(),
          Origin: 'https://app.traderepublic.com',
          'User-Agent': this.client.userAgent,
        },
      });
      this._resolveConnected = () => {
        clearTimeout(t);
        this.connected = true;
        resolve();
      };
      this.ws.on('open', () => {
        const hello = {
          locale: 'en',
          platformId: 'webtrading',
          platformVersion: 'chrome - 94.0.4606',
          clientId: 'app.traderepublic.com',
          clientVersion: '5582',
        };
        this.ws.send(`connect 31 ${JSON.stringify(hello)}`);
      });
      this.ws.on('message', (d) => this._onMessage(d.toString()));
      this.ws.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      this.ws.on('close', () => {
        this.connected = false;
        clearInterval(this._heartbeat);
      });
    });

    // TR expects periodic keepalives from the client.
    this._heartbeat = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(`echo ${++this._echo}`);
    }, 25_000);
  }

  _onMessage(str) {
    if (process.env.TR_WS_DEBUG) console.error('[ws raw]', str.slice(0, 400));
    if (str === 'connected') return this._resolveConnected?.();
    if (str.startsWith('echo')) return; // keepalive ack
    const sp = str.indexOf(' ');
    if (sp === -1) return;
    const id = str.slice(0, sp);
    const rest = str.slice(sp + 1);
    const code = rest[0];
    const payload = rest.slice(1).replace(/^\s+/, '');
    const sub = this.subs.get(id);
    if (!sub) return;

    if (code === 'A') {
      sub.rawPrev = payload;
      this._store(sub, payload);
    } else if (code === 'D') {
      sub.rawPrev = applyDelta(sub.rawPrev, payload);
      this._store(sub, sub.rawPrev);
    } else if (code === 'E') {
      let err = payload;
      try {
        err = JSON.parse(payload);
      } catch {}
      this.errors[sub.name] = err;
      console.error(`[ws] ${sub.name} ERROR:`, JSON.stringify(err));
    }
    // 'C' = server closed this subscription; keep last state.
  }

  _store(sub, raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // partial frame; wait for the next delta
    }
    if (!this._logged.has(sub.name)) {
      this._logged.add(sub.name);
      const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : typeof parsed;
      console.error(`[ws] ${sub.name} first frame — keys:`, keys);
      console.error(`[ws] ${sub.name} sample:`, JSON.stringify(parsed).slice(0, 800));
    }
    if (sub.name === 'timeline') this._accumulateTimeline(parsed);
    else this.state[sub.name] = parsed;
  }

  /** Merge a timeline page and follow the `after` cursor to older pages. */
  _accumulateTimeline(page) {
    const items = page.items ?? page.data ?? page.events ?? [];
    for (const it of items) {
      const key = it.id ?? it.eventId ?? JSON.stringify(it).slice(0, 80);
      if (!this._timeline.seen.has(key)) {
        this._timeline.seen.add(key);
        this._timeline.items.push(it);
      }
    }
    this.state.timeline = { items: this._timeline.items, count: this._timeline.items.length, cursors: page.cursors };

    const cursor = page.cursors?.after ?? page.cursorAfter ?? page.after ?? null;
    if (cursor && cursor !== this._timeline.lastCursor && this._timeline.pages < MAX_TIMELINE_PAGES) {
      this._timeline.lastCursor = cursor;
      this._timeline.pages += 1;
      this.subscribe('timeline', 'timelineTransactions', { after: cursor });
    }
  }

  subscribe(name, type, params = {}) {
    const id = String(this.nextId++);
    this.subs.set(id, { name, type, rawPrev: '' });
    if (process.env.TR_WS_DEBUG) console.error(`[ws] sub ${id} -> ${type} (${name})`);
    this.ws.send(`sub ${id} ${JSON.stringify({ type, ...params })}`);
    return id;
  }

  /** Connect + subscribe to the read-only topics. */
  async start() {
    await this.connect();
    for (const t of READ_TOPICS) this.subscribe(t.name, t.type, t.params);
    return this;
  }

  snapshot() {
    return {
      connected: this.connected,
      topics: Object.keys(this.state),
      state: this.state,
      errors: this.errors,
    };
  }

  close() {
    clearInterval(this._heartbeat);
    this.ws?.close();
    this.connected = false;
  }
}
