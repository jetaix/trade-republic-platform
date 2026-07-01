/**
 * Website build: bundle the shared OpenAPI spec + guide from @trade-republic/api
 * into public/ so the static site (Scalar reference + guide renderer) is
 * self-contained and deployable to any static host (e.g. Vercel).
 *
 * Uses only Node built-ins — no dependencies needed to build the site.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');

/**
 * Resolve the source spec/guide. Prefer the workspace package (dev / pnpm),
 * but fall back to the sibling path so the build works even when the workspace
 * isn't linked (e.g. Vercel deploying only this app with "include files outside
 * root directory" enabled).
 */
async function sources() {
  try {
    const api = await import('@trade-republic/api');
    return { openapi: api.openapiPath, guide: api.guidePath };
  } catch {
    const apiDir = join(here, '..', '..', '..', 'packages', 'api');
    return { openapi: join(apiDir, 'openapi.yaml'), guide: join(apiDir, 'guide.md') };
  }
}

const { openapi, guide } = await sources();
mkdirSync(pub, { recursive: true });
copyFileSync(openapi, join(pub, 'openapi.yaml'));
copyFileSync(guide, join(pub, 'docs.md'));
console.log('website: bundled openapi.yaml + docs.md into public/');
