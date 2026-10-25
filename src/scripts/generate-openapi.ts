import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateOpenAPI(): Promise<void> {
  const app = buildApp();
  await app.ready();

  const openapiSpec = app.swagger();
  const outputPath = path.resolve(__dirname, '../../openapi.json');

  await fs.writeFile(outputPath, JSON.stringify(openapiSpec, null, 2), 'utf-8');
  console.log(`[OpenAPI] Successfully generated OpenAPI specification at ${outputPath}`);
  process.exit(0);
}

generateOpenAPI().catch((err) => {
  console.error('[OpenAPI] Failed to generate OpenAPI specification:', err);
  process.exit(1);
});
