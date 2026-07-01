# Trade Republic MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the (unofficial, read-only) Trade Republic API to MCP clients like Claude.

Built on `@modelcontextprotocol/sdk` v1.29. Part of the Trade Republic monorepo:
the TR client / socket / WAF code and the OpenAPI spec come from the shared
[`@trade-republic/api`](../api) package; the session store and browser auth
server are local to this package (`lib/`).

## Tools

| Tool | Description |
| --- | --- |
| `tr_authenticate` | **Opens a browser** to collect phone + PIN + 2FA, logs in, and **saves the session to disk** |
| `tr_logout` | Close the connection and delete the saved session |
| `tr_status` | Session TTL, WAF/WS state, account numbers |
| `tr_portfolio_chart` | Portfolio value time series (REST) |
| `tr_positions` | Current holdings incl. crypto (WS `compactPortfolioByType`) |
| `tr_cash` | Cash balances (WS `availableCash`) |
| `tr_timeline` | Recent orders / transfers / dividends (WS `timelineTransactions`) |

## Resources

| URI | Content |
| --- | --- |
| `tr://openapi` | The OpenAPI 3.1 document |
| `tr://guide` | The markdown API guide |

## Install & run

This is **not published to npm** — you run it from a git clone. From the
**repo root** (a `pnpm install` there sets up the whole workspace, incl.
`@trade-republic/api`):

```bash
git clone https://github.com/jetaix/trade-republic-platform
cd trade-republic-platform
pnpm install
pnpm --filter @trade-republic/mcp demo    # TR_DEMO=1 — mock data, no credentials, no browser
```

For real mode, also download the headless browser used to pass the WAF challenge:

```bash
pnpm --filter @trade-republic/mcp exec playwright install chromium   # one-time
pnpm --filter @trade-republic/mcp start                              # real API
```

## Verify

```bash
pnpm --filter @trade-republic/mcp test
```

Drives the server over stdio (initialize, tools, resources). Prints `ALL PASS`.

## Register with an MCP client

**Claude Code** — copy-paste this from the repo root (`$(pwd)` fills in your path):

```bash
claude mcp add trade-republic -- node "$(pwd)/packages/mcp/server.mjs"
```

**Other clients** (JSON config) need the absolute path. Print it, then paste it in:

```bash
echo "$(pwd)/packages/mcp/server.mjs"
```

```json
{
  "mcpServers": {
    "trade-republic": {
      "command": "node",
      "args": ["<paste the path printed above>"],
      "env": { "TR_DEMO": "1" }
    }
  }
}
```

Drop `TR_DEMO` for the real API. Typical flow from the client:
`tr_authenticate` (browser opens → enter phone/PIN/2FA) → then `tr_status` /
`tr_positions` / `tr_cash` / `tr_timeline` / `tr_portfolio_chart`. Auth persists
across restarts; `tr_logout` clears it.

## Run with REAL data — step by step (non-technical)

Follow these exactly. Copy each command, paste it into **Terminal**, press Enter.

### 1. Open Terminal
Press `Cmd + Space`, type **Terminal**, press Enter. A window with a text prompt opens.

### 2. Check that Node.js is installed
Paste and press Enter:
```bash
node --version
```
- If you see something like `v22.x` or `v24.x` → good, continue.
- If you see `command not found` → download the **LTS** installer from
  <https://nodejs.org>, run it, then close and reopen Terminal and try again.

### 3. Download the project (git clone)
```bash
cd ~                                   # or wherever you keep projects
git clone https://github.com/jetaix/trade-republic-platform
cd trade-republic-platform
```
(If `git` says command not found, install it from <https://git-scm.com>. If `pnpm`
is missing, run `npm install -g pnpm` first.)

### 4. Install it (one-time, ~2 min)
```bash
pnpm install
pnpm --filter @trade-republic/mcp exec playwright install chromium
```
(The second command downloads a mini browser used to pass Trade Republic's
robot-check. It only runs once.)

### 5. (Optional but recommended) Test with FAKE data first
```bash
pnpm --filter @trade-republic/mcp test
```
If it prints **`ALL PASS`**, everything is wired correctly.

### 6. Connect the server to Claude (REAL data)
Run this **from the repo root** (step 3) so `$(pwd)` expands to your absolute path:
```bash
claude mcp add trade-republic -- node "$(pwd)/packages/mcp/server.mjs"
```
Check it's registered:
```bash
claude mcp list
```
You should see `trade-republic` in the list. **Restart Claude Code** so it picks
up the new server.

### 7. Log in and use it (inside Claude, plain English)

1. Say **“Connect my Trade Republic account.”**
   → Claude runs `tr_authenticate`, which **opens a browser window**. Enter your
   **phone number** and **PIN** there (never in the chat), click *Send code*,
   then type the **4-digit code** from your TR app / SMS and click *Verify*.
2. The page shows **✅ Connected** — close the tab and return to Claude.
3. Ask for anything:
   - **“What's my portfolio value?”** (`tr_portfolio_chart`)
   - **“List my positions.”** (`tr_positions`)
   - **“How much cash do I have?”** (`tr_cash`)
   - **“Show my recent transactions.”** (`tr_timeline`)

**You only do this once.** The session is saved to `~/.trade-republic-mcp/session.json`
(owner-only, `0600`) and **auto-refreshed** — restart Claude or your machine and
the tools keep working. To disconnect, say **“Log out of Trade Republic”**
(`tr_logout`), which deletes the saved session.

### Common issues
- **“Robot-check / WAF error” on login** → open
  [`packages/api/src/waf.mjs`](../api/src/waf.mjs), change `bootstrapWaf()` to
  `bootstrapWaf({ headless: false })`, retry, and solve the puzzle in the browser
  window that appears.
- **Want fake data instead?** Re-add with mock mode:
  `claude mcp remove trade-republic` then
  `claude mcp add trade-republic --env TR_DEMO=1 -- node "$(pwd)/packages/mcp/server.mjs"` (from the repo root)
- **Session expired after a while / logged out** → just do step 7.1–7.2 again.

## Safety

Read-only: no order/payout/savings-plan tools are exposed. Credentials live only
in the process memory for the session and are never written to disk.
