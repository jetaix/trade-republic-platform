# @trade-republic/api

Unofficial, read-only Trade Republic API client — the shared core that the MCP
server and the demo app both build on. See [`guide.md`](./guide.md) for the full
protocol/auth write-up and [`openapi.yaml`](./openapi.yaml) for the REST spec.

```js
import { TRClient, TRSocket, bootstrapWaf, applyDelta, openapiPath, guidePath } from '@trade-republic/api';
```

| Export | What it is |
| --- | --- |
| `TRClient` | REST client: login, 2FA, 300 s session refresh, portfolio chart |
| `TRSocket` | WebSocket client: handshake, subscriptions, delta reconstruction, timeline pagination |
| `bootstrapWaf` | Headless-Chromium AWS-WAF token bootstrapper |
| `applyDelta` | Reconstructs a `D` frame from the previous raw payload (TR's text-diff format) |
| `openapiPath` / `guidePath` | Absolute paths to the bundled spec / guide |

Unofficial and not affiliated with Trade Republic Bank GmbH. Endpoints may change without notice.
