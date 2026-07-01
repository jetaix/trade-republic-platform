# Trade Republic — API, MCP & Docs (monorepo)

A [Turborepo](https://turbo.build) + pnpm monorepo for an **unofficial, read-only**
Trade Republic integration: a shared API client, an MCP server for AI agents, a
live demo app, and a documentation website.

> Unofficial and not affiliated with Trade Republic Bank GmbH. Reverse-engineered
> from the public web app for personal, read-only use. Endpoints may change or
> break without notice.

## Layout

```
packages/
  api/        @trade-republic/api   — shared REST + WebSocket client, WAF bootstrap, OpenAPI spec, guide
  mcp/        @trade-republic/mcp   — Model Context Protocol server (browser auth, persistent session)
apps/
  demo/       @trade-republic/demo  — React live app + Node proxy (chart, positions, cash, timeline)
  website/    @trade-republic/website — landing page + Scalar API reference + guide (static)
```

The `api` package is the single source of truth for the protocol; `mcp`, `demo`,
and `website` all depend on it (`workspace:*`), so there's no duplicated client code.

## Setup

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
# for the MCP / demo real mode, install the headless browser once:
pnpm --filter @trade-republic/mcp exec playwright install chromium
```

## Common tasks

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run demo + website dev servers together (Turbo) |
| `pnpm build` | Build all packages (bundles spec+guide into the website) |
| `pnpm test` | Run package tests (MCP stdio smoke test) |
| `pnpm demo` | Live demo only → http://localhost:5175 (`/` = live app) |
| `pnpm website` | Docs site only → http://localhost:4321 (landing + Scalar + guide) |
| `pnpm mcp` / `pnpm mcp:demo` | Run the MCP server (real / mock) over stdio |

> The demo (`:5175`) and website (`:4321`) are separate apps. Cross-app links use
> those dev URLs — update them for production (see `WEBSITE_URL` in
> `apps/demo/web/demo.html` and the `localhost:5175` links in `apps/website/public/`).

## Per-package docs

- **API** — [`packages/api/README.md`](packages/api/README.md) · full guide: [`packages/api/guide.md`](packages/api/guide.md)
- **MCP** — [`packages/mcp/README.md`](packages/mcp/README.md) (setup + tools)
- **Demo** — [`apps/demo/README.md`](apps/demo/README.md)

## Publishing

`@trade-republic/mcp` and `@trade-republic/api` are publishable (add a LICENSE and
`npm publish`, or wire up Changesets for versioned releases). `demo` and `website`
are `private` apps meant to be deployed, not published.
