# @trade-republic/demo — live demo app

A tiny app that proves the flow end to end:

```
React app (web/demo.html)  ──►  Node proxy (server/)  ──►  api.traderepublic.com
   no build                     express + @trade-republic/api    REST + WebSocket
```

The browser can't call Trade Republic directly (CORS + WAF), so the Node proxy is
the trusted middle-man. The TR client/socket/WAF live in
[`@trade-republic/api`](../../packages/api); this app just wires them to HTTP + UI.
The landing page and docs are the separate [website app](../website).

## Run (from the monorepo root)

```bash
pnpm install
pnpm demo                         # mock mode → http://localhost:5175
```

Real mode (your account):

```bash
pnpm --filter @trade-republic/demo exec playwright install chromium   # one-time
pnpm --filter @trade-republic/demo start                              # real API → :5175
```

`/` serves the live React app (`demo.html`): an auto-refreshing chart plus
positions, cash and timeline. In real mode: enter phone + PIN, then the 4-digit
2FA code; the proxy keeps the 300 s session refreshed.

> WAF error on login? Solve it visibly: set `bootstrapWaf({ headless: false })` in
> [`packages/api/src/waf.mjs`](../../packages/api/src/waf.mjs).

## Files

| File | Role |
| --- | --- |
| `server/server.mjs` | Express proxy (real & mock modes); imports `@trade-republic/api` |
| `web/demo.html` | No-build React app (CDN React + Babel), served at `/` |

## WebSocket data plane

After login the proxy opens `wss://api.traderepublic.com/` and subscribes to the
read-only topics, served to the UI at `GET /api/ws`:

| UI panel | TR topic |
| --- | --- |
| Cash | `availableCash` |
| Positions (incl. crypto) | `compactPortfolioByType` |
| Timeline | `timelineTransactions` (paginated) |

Delta reconstruction, pagination, and the topic protocol live in
`@trade-republic/api` (`TRSocket` / `applyDelta`).

## Safety

Read-only. Only the portfolio-chart REST endpoint and the read-only WebSocket
topics above are wired up — no order/payout/savings-plan actions.
