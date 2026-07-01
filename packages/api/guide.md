# Trade Republic — Unofficial API Reference

> Reverse-engineered notes for building a read-only account-aggregation connector.
> Trade Republic exposes **no public API**. Everything here is derived from the
> web app (`app.traderepublic.com`), the mobile app traffic, and the community
> projects [`pytr`](https://github.com/pytr-org/pytr) and
> [`TradeRepublicApi`](https://github.com/Zarathustra2/TradeRepublicApi).
> Endpoints and auth can change without notice.

**Base host:** `https://api.traderepublic.com`
**WebSocket host:** `wss://api.traderepublic.com/`

---

## TL;DR — the auth pain point

There are **two API surfaces**, but they share **one session**:

| Surface | Used by | Transport | How the session travels |
| --- | --- | --- | --- |
| REST `/api-gateway/*` | current web app (your curl) | HTTPS request/response | **cookies** (`tr_session`, `tr_claims`, …) + `x-aws-waf-token` header |
| WebSocket sub-protocol | mobile app, pytr | `wss://` frames | `token` field inside each `sub` payload **and** cookies on the WS handshake |

The friction you're hitting is **three moving parts that all expire on different clocks**:

1. **`tr_session` JWT — expires every 300 s (5 min).** Short-lived. Must be
   refreshed continuously via `GET /api/v1/auth/web/session`.
2. **AWS WAF token — a JS/CAPTCHA challenge artifact.** Required as both the
   `aws-waf-token` cookie and the `x-aws-waf-token` header. Cannot be minted with
   plain HTTP — it comes from solving a browser challenge. **This is the real
   blocker for a headless integration.**
3. **The login itself is 2FA-gated** (4-digit code via app push or SMS), so you
   cannot fully automate the *initial* login without a human in the loop.

Once you hold a valid session + WAF token, keeping it alive is just a refresh
loop (see [`persistent-poll.mjs`](./persistent-poll.mjs)).

---

## How to run it

This is part of a Turborepo monorepo. From the repo root:

```bash
pnpm install
pnpm dev        # demo app (:5175) + website/docs (:4321)
pnpm mcp:demo   # MCP server over stdio (mock mode)
```

- **Docs website** (`:4321`) — landing, Scalar API reference, this guide.
- **Live demo** (`:5175`) — React app + Node proxy against the real API.
- **MCP server** — connect Claude to your account; setup + tools in the
  MCP package README.

See the repo root `README.md` for the full task list, and the MCP package README
for the browser-based authentication flow (`tr_authenticate`) and the tool list.

---

## 1. Anatomy of your curl

```
GET /api-gateway/portfolio-chart/v2/chart?secAccNo=0384048802&range=1d&currency=EUR
Host: api.traderepublic.com
```

### The cookies that matter

| Cookie | Purpose | Lifetime |
| --- | --- | --- |
| `tr_session` | **The bearer.** ES256 JWT, `type:SESSION`. Carries `sub` (user id), `sessionId`, `jurisdiction`, `featuresEnabled`, and — crucially — the account numbers under `act.acc.owner.default.{sec,cash}`. | **300 s** |
| `tr_claims` | Same JWT payload as `tr_session`, used by the frontend to read claims without decoding the live session. | ~matches session |
| `tr_device` | Stable device id (persists across sessions). | long-lived |
| `tr_external_id` | Analytics/external correlation id. | long-lived |
| `aws-waf-token` | AWS WAF challenge solution. Gate for **every** request. | hours (until challenged again) |
| `JSESSIONID` | Server-side session affinity. | session |
| `INGRESSCOOKIE` | Load-balancer stickiness. | session |
| `tr_appearance`, `i18n_redirected`, `analytics`, `marketing`, `_sp_*` | UI / consent / analytics — **not required** for API calls. | — |

### The `tr_session` JWT decoded

```jsonc
// header
{ "alg": "ES256" }
// payload
{
  "act": {
    "id": "aeed69c9-…",
    "acc": { "owner": { "default": {
      "sec":  ["0384048802"],   // <- securities account -> secAccNo in the URL
      "cash": ["0384048811"]    // <- cash account
    } } },
    "rel": "self"
  },
  "jurisdiction": "FR",
  "sessionId": "6c822592-…",
  "type": "SESSION",
  "featuresEnabled": [ { "feature": "card" }, { "feature": "crypto" }, … ],
  "status": "ACTIVE",
  "iat": 1782891020,
  "exp": 1782891320,           // iat + 300s
  "sub": "aeed69c9-…"          // user id
}
```

> **Note:** `secAccNo=0384048802` in the URL is literally the `sec` account
> number embedded in the session JWT. You never hardcode it — you read it out of
> the decoded session after login.

### Required headers (REST gateway)

```
accept: */*
content-type: application/json
origin: https://app.traderepublic.com
x-tr-platform: web
x-tr-app-version: 15.65.6          # bump to match current web build
x-aws-waf-token: <same value as the aws-waf-token cookie>
user-agent: <a real browser UA>    # WAF fingerprints this
```

`traceparent` / `sec-*` / `priority` headers are browser noise and not required,
but sending a plausible `user-agent` matters because WAF fingerprints it.

---

## 2. Authentication flow (end to end)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 0. Obtain aws-waf-token  (headless browser solves the WAF challenge)  │
├─────────────────────────────────────────────────────────────────────┤
│ 1. POST /api/v1/auth/web/login      { phoneNumber, pin }              │
│        → { processId, "2fa": "APP"|"SMS", countdownInSeconds }        │
├─────────────────────────────────────────────────────────────────────┤
│ 2. (human) receive 4-digit code via app push / SMS                    │
├─────────────────────────────────────────────────────────────────────┤
│ 3. POST /api/v1/auth/web/login/{processId}/{code}                     │
│        → 200 + Set-Cookie: tr_session, tr_claims, …                   │
├─────────────────────────────────────────────────────────────────────┤
│ 4. loop:  GET /api/v1/auth/web/session   (every < 300s)               │
│        → Set-Cookie: fresh tr_session                                 │
├─────────────────────────────────────────────────────────────────────┤
│ 5. call any /api-gateway/* or open the WebSocket                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 0 — the AWS WAF token (the hard part)

The `aws-waf-token` is produced by AWS WAF's **challenge/CAPTCHA** JS SDK, which
runs proof-of-work / integrity checks in the browser. A raw `fetch` gets a `202`
or `405` challenge response, **not** data.

Practical options, in order of robustness:

1. **Headless Chromium (recommended).** Load `https://app.traderepublic.com`
   with Playwright/Puppeteer, let the WAF JS run, then read the `aws-waf-token`
   cookie off the context. Reuse that token for REST/WS calls until it 403s, then
   re-solve. This is exactly what recent `pytr` versions do.
2. **Reuse a browser session.** For a manual/ops tool, copy the cookie out of a
   logged-in browser (what your curl did). Fine for spikes, not for production.
3. **AWS WAF token SDK replication.** Fragile; the challenge changes. Avoid.

> A WAF `403`/`405` on a call you *think* is authenticated almost always means
> the WAF token — not the session — went stale. Handle them separately.

### Step 1 — initiate login

```http
POST /api/v1/auth/web/login
Content-Type: application/json
x-aws-waf-token: <token>

{ "phoneNumber": "+33…", "pin": "1234" }
```

Response:

```json
{ "processId": "…", "countdownInSeconds": 60, "2fa": "APP" }
```

`"2fa"` is `"APP"` (push to a paired device) or `"SMS"`. If the user has app
push, they approve/enter in-app; otherwise a code is texted.

- Resend the code: `POST /api/v1/auth/web/login/{processId}/resend`

### Step 2/3 — verify

```http
POST /api/v1/auth/web/login/{processId}/{code}
x-aws-waf-token: <token>
```

On success the response sets the `tr_session` / `tr_claims` cookies. **Persist
the whole cookie jar** — subsequent refreshes rely on `JSESSIONID` + the session
cookies together.

### Step 4 — refresh (the 5-minute heartbeat)

```http
GET /api/v1/auth/web/session
Cookie: <full jar>
x-aws-waf-token: <token>
```

Returns a fresh `Set-Cookie: tr_session=…`. Call it **before** the 300 s expiry
(we use a ~60 s safety margin). This is the loop that keeps a "persistent" client
alive without re-doing 2FA. Re-login (steps 1–3) is only needed when the
server-side session itself is invalidated (logout elsewhere, long downtime).

### App login (alternative, device-pinned)

The older/mobile flow pairs a device by generating an **ECDSA (secp256r1) key
pair**, registering the public key, and signing each request. It survives longer
without re-2FA but requires a device-reset (invalidates the phone's app session).
`pytr`'s "app login" and `cdamken/Trade_Republic_Connector` implement this. Use
web login unless you specifically need device pinning.

---

## 3. Endpoint catalogue

### 3a. REST — `/api/v1` auth & account

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/auth/web/login` | Start web login → `processId` |
| `POST` | `/api/v1/auth/web/login/{processId}/resend` | Resend 2FA code |
| `POST` | `/api/v1/auth/web/login/{processId}/{code}` | Complete login |
| `GET`  | `/api/v1/auth/web/session` | **Refresh session** |
| `GET`  | `/api/v2/auth/account` | Account settings |
| `POST` | `/api/v1/auth/account/reset/device` | Device reset (app-login pairing) |
| `GET`  | `/api/v1/user/costtransparency` | Order cost preview |
| `GET`  | `/api/v1/user/savingsplancosttransparency` | Savings-plan cost preview |
| `POST` | `/api/v1/payout` | Initiate payout |
| `POST` | `/api/v1/payout/{processId}/code` | Confirm payout with code |

### 3b. REST — `/api-gateway/*` (newer web gateway)

These are cookie+WAF authenticated (no `token` in body). Observed families:

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api-gateway/portfolio-chart/v2/chart` | `?secAccNo=&range=1d\|5d\|1m\|3m\|1y\|max&currency=EUR` — **your curl** |
| `GET` | `/api-gateway/…/portfolio` | current positions (mirror of WS `compactPortfolio`) |

> The gateway is progressively replacing WS topics with REST equivalents. When
> you find a new one in DevTools, the shape is `/api-gateway/{service}/{version}/{resource}`.
> Discover them by watching the Network tab on `app.traderepublic.com`.

### 3c. WebSocket sub-protocol — the bulk of the data

Connect to `wss://api.traderepublic.com/` and speak a tiny line protocol.

**Handshake:**
```
→  connect 21 {"locale":"en","platformId":"webtrading","platformVersion":"…"}
←  connected
```
(`21` is the protocol version pytr/community uses; older is `connect 22`/`31` —
match the current web build.)

**Subscribe / unsubscribe:**
```
→  sub {id} {"type":"portfolio","token":"<tr_session JWT>"}
←  {id} A {…}      # A = first snapshot (Answer)
←  {id} D [patch]  # D = Delta/JSON-patch update
→  unsub {id}
←  {id} C          # C = Continue/closed
←  {id} E {…}      # E = Error
```

- `{id}` is a **monotonically increasing integer** you assign per subscription.
- `A` = full payload, `D` = JSON-patch delta against the last payload, `C` =
  unsubscribed/closed, `E` = error.
- Every payload carries `"token"` = the current `tr_session` JWT. **Rotate it on
  every new sub** as the session refreshes.
- Some topics (e.g. `instrument`) send one `A` then auto-close; others stream `D`
  updates until you `unsub`.

**Subscription types (`type` field):**

| Type | Params | Returns |
| --- | --- | --- |
| `compactPortfolioByType` | — | **current** holdings topic → `{ categories: [{ categoryType, positions }] }`; `categoryType` includes `cryptos` |
| ~~`portfolio`~~ / ~~`compactPortfolio`~~ | — | **retired on protocol v31** — return `E BAD_SUBSCRIPTION_TYPE "Unknown topic type"`. Use `compactPortfolioByType`. |
| `portfolioStatus` | — | portfolio open/closed status |
| `portfolioAggregateHistory` | `range` | portfolio value time series (WS twin of the chart REST call) |
| `aggregateHistoryLight` | `isin`, `exchange`, `range`, `resolution` | instrument price history |
| `cash` | — | cash balances per currency |
| `availableCash` | — | investable cash |
| `availableCashForPayout` | — | withdrawable cash |
| `instrument` | `id` (ISIN) | instrument master data (one-shot) |
| `stockDetails` | `id` (ISIN) | company detail |
| `stockDetailKpis` | `id` (ISIN) | fundamentals/KPIs |
| `stockDetailDividends` | `id` (ISIN) | dividend history |
| `instrumentExchange` / `homeInstrumentExchange` | `instrumentId` | tradable exchanges |
| `instrumentSuitability` | `instrumentId` | suitability/appropriateness |
| `ticker` | `id` = `{isin}.{exchange}` (e.g. `US88160R1014.LSX`) | live bid/ask/last price |
| `derivatives` | `underlying`, `productCategory` | warrants/knock-outs |
| `timeline` | `after` (cursor) | activity feed page (orders, transfers, …) |
| `timelineActions` | — | pending user actions |
| `timelineDetail` | `id` | detail of a timeline event (contains document links) |
| `orders` | `terminated` (bool) | order list |
| `priceForOrder` | `parameters` | order price quote |
| `simpleCreateOrder` | `clientProcessId`, `instrumentId`, `exchangeId`, `expiry`, `limit`, `size`, `type` | **place order** ⚠️ |
| `cancelOrder` | `orderId` | cancel order ⚠️ |
| `savingsPlan` CRUD | `createSavingsPlan` / `changeSavingsPlan` / `cancelSavingsPlan` | recurring buys ⚠️ |
| `watchlist` / `addToWatchlist` / `removeFromWatchlist` | `instrumentId` | watchlist |
| `priceAlarms` / `createPriceAlarm` | `instrumentId`, `targetPrice` | price alarms |
| `neonSearch` / `neonSearchTags` / `neonSearchSuggestedTags` / `neonSearchAggregations` | `query`, `page`, `pageSize`, `filter` | instrument search |
| `neonNews` | `isin` | news |
| `neonCards` | — | card/home feed |
| `messageOfTheDay` | — | banner |
| `frontendExperiment` | `operation`, `experimentId`, `identifier` | A/B flags |

> ⚠️ Anything under orders / savings plans / payouts **moves money**. For a
> Finary aggregation connector, use **only the read topics** (`portfolio`,
> `compactPortfolio`, `cash`, `availableCash`, `portfolioAggregateHistory`,
> `timeline`, `timelineDetail`, `ticker`, `instrument`).

---

## 4. Recommended connector strategy (for Finary aggregation)

1. **Auth once, refresh forever.** Do the human 2FA login (steps 0–3) in a paired
   ops flow / headless-browser session. Store the cookie jar securely
   (encrypted). Run the 5-min refresh loop.
2. **Prefer WS read topics** for portfolio/cash/timeline — one connection covers
   most of what an aggregator needs. Use the REST chart gateway only where WS has
   no twin.
3. **Two independent staleness handlers:**
   - `tr_session` expiry → refresh via `/api/v1/auth/web/session`.
   - WAF `403`/`405` → re-solve the WAF challenge (headless browser), swap the
     `aws-waf-token` cookie + header.
4. **Never store the PIN in the app.** Login is an out-of-band, human-gated ops
   step, not something the mobile client does.
5. **Rate-limit gently.** These are private endpoints; aggressive polling gets
   WAF-challenged or the session killed. For balances, a poll every few minutes
   is plenty (the chart itself only moves intraday).

### Where things live (monorepo)

| Path | What it is |
| --- | --- |
| `packages/api` | This client (`TRClient`, `TRSocket`, `bootstrapWaf`), `openapi.yaml`, and this guide |
| `packages/api/persistent-poll.mjs` | Minimal Node refresh-loop + chart poller |
| `packages/mcp` | **MCP server** — tools + resources for Claude (browser auth, persistent session) |
| `apps/demo` | Runnable React + Node proxy demo (`TR_DEMO=1` mock mode) |
| `apps/website` | Landing page + **Scalar** API reference + this guide (static) |

From the repo root: `pnpm install` then `pnpm dev` (demo on `:5175`, docs on `:4321`).

---

## 5. References

- pytr (web + app login, session refresh, WAF token via headless Chromium) —
  <https://github.com/pytr-org/pytr>
- Zarathustra2/TradeRepublicApi (canonical WS sub-type list) —
  <https://github.com/Zarathustra2/TradeRepublicApi>
- cdamken/Trade_Republic_Connector (TypeScript, ECDSA device pairing) —
  <https://github.com/cdamken/Trade_Republic_Connector>
- dhojayev/traderepublic-portfolio-downloader (Go, timeline/documents) —
  <https://github.com/dhojayev/traderepublic-portfolio-downloader>
