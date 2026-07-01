/**
 * Website build: bundle the shared OpenAPI spec + guide from @trade-republic/api
 * into public/ so the static site (Scalar reference + guide renderer) is
 * self-contained and deployable to any static host.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openapiPath, guidePath } from '@trade-republic/api';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(pub, { recursive: true });
copyFileSync(openapiPath, join(pub, 'openapi.yaml'));
copyFileSync(guidePath, join(pub, 'docs.md'));
console.log('website: bundled openapi.yaml + docs.md into public/');
