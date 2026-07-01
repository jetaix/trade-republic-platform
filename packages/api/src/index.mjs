/**
 * @trade-republic/api — unofficial Trade Republic API client.
 *
 * Re-exports the REST client, the WebSocket client, and the headless-Chromium
 * WAF bootstrapper, plus resolvable filesystem paths to the bundled OpenAPI
 * spec and the markdown guide (used by the MCP server and the website build).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export { TRClient } from './trClient.mjs';
export { TRSocket, applyDelta } from './trSocket.mjs';
export { bootstrapWaf } from './waf.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Absolute path to the bundled OpenAPI 3.1 document. */
export const openapiPath = join(pkgRoot, 'openapi.yaml');
/** Absolute path to the bundled markdown API guide. */
export const guidePath = join(pkgRoot, 'guide.md');
