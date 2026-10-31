import { mkdirSync, writeFileSync } from 'node:fs';
import { app, documentConfig } from '../src/app';
mkdirSync('docs', { recursive: true });
writeFileSync('docs/openapi.json', JSON.stringify(app.getOpenAPI31Document(documentConfig), null, 2) + '\n');
console.log('docs/openapi.json exported');
