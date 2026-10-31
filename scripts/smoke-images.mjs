import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const origin = process.env.MALO_SMOKE_BASE || 'https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com';
const catalog = await fetch(origin + '/api/v1/assets/personas').then(r => r.json());
assert.equal(catalog.data.length, 20);
assert.ok(catalog.data.every(item => item.imageUrl));
const checked = await Promise.all(catalog.data.map(async item => {
  const r = await fetch(item.imageUrl); assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'image/webp'); assert.ok(r.headers.get('Cache-Control').includes('immutable'));
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF'); assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
  const id = new URL(item.imageUrl).pathname.split('/').at(-1);
  assert.equal(id, 'i_' + createHash('sha256').update(bytes).digest('hex').slice(0, 40));
  return { assetKey: item.assetKey, imageUrl: item.imageUrl, bytes: bytes.length };
}));
const r = await fetch(origin + '/ai/v1/images/personas/generate', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-AI-Service-Token': process.env.MALO_AI_SERVICE_TOKEN || '' },
  body: JSON.stringify({ characterId: 'girlfriend', emotion: 'happy' }) });
const cached = await r.json(); assert.equal(r.status, 200); assert.equal(cached.cached, true); assert.equal(cached.model, 'gpt-image-2.5-flare');
const report = { checkedAt: new Date().toISOString(), images: checked, generationCacheHit: true, provider: 'openai', model: cached.model };
if (process.env.MALO_IMAGE_SMOKE_REPORT) writeFileSync(process.env.MALO_IMAGE_SMOKE_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ images: checked.length, totalBytes: checked.reduce((n, image) => n + image.bytes, 0), contentHashesVerified: true, generationCacheHit: true }));
