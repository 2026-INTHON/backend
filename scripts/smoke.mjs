import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const origin = process.env.MALO_SMOKE_BASE || 'https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com';
const base = origin + '/api/v1';
const report = { checkedAt: new Date().toISOString(), base, checks: [] };
async function call(path, body, token, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${json.error?.code}`);
  return json.data;
}
function ok(check, data = {}) { report.checks.push({ check, status: 'passed', ...data }); console.log('PASS', check, JSON.stringify(data)); }
const health = await call('/health'); assert.equal(health.status, 'ok'); ok('https-health', { storage: health.storage });
const auth = await call('/auth/guest', { displayName: 'Malo smoke test' }); let token = auth.accessToken;
const session = await call('/sessions', { sceneId: 'ko-professor-strict', aiMode: 'mock' }, token);
const badInput = { clientTurnId: randomUUID(), inputType: 'choice', choiceId: 'c' };
const bad = await call(`/sessions/${session.id}/turns`, badInput, token); assert.equal(bad.session.lives, 2);
const repeated = await call(`/sessions/${session.id}/turns`, badInput, token); assert.equal(repeated.turn.id, bad.turn.id);
await call(`/sessions/${session.id}/hint`, {}, token);
for (let i = 0; i < 3; i++) await call(`/sessions/${session.id}/turns`, { clientTurnId: randomUUID(), inputType: 'choice', choiceId: 'b' }, token);
const result = await call(`/sessions/${session.id}/result`, undefined, token); assert.equal(result.passed, true);
const wallet = await call('/wallet', undefined, token); assert.equal(wallet.coins, 130);
const mistakes = await call('/mistakes', undefined, token); assert.equal(mistakes.length, 1);
const upgraded = await call('/auth/demo-upgrade', { displayName: 'Malo member smoke' }, token); token = upgraded.accessToken;
assert.equal(upgraded.user.id, auth.user.id);
assert.equal((await call('/wallet', undefined, token)).coins, 130);
assert.equal((await call('/records', undefined, token)).completedScenes, 1);
ok('guest-to-result-dictionary-demo-upgrade', { rewardCoins: result.rewardCoins, coins: wallet.coins });
const spec = await fetch(origin + '/openapi.json').then(r => r.json());
assert.ok(Object.keys(spec.paths).length >= 35); assert.ok(Object.keys(spec.paths).every(path => path.startsWith('/api/v1/')));
const doc = await fetch(origin + '/docs'); assert.equal(doc.status, 200); ok('swagger-openapi', { paths: Object.keys(spec.paths).length });
const aiHealth = await fetch(origin + '/ai/health'); assert.equal(aiHealth.status, 200);
const protectedAi = await fetch(origin + '/ai/v1/persona-assets'); assert.equal(protectedAi.status, 401); ok('ai-service-protection');
if (process.argv.includes('--live')) {
  const live = await call('/sessions', { sceneId: 'ko-professor-calm', aiMode: 'live' }, token);
  const audio = await call(`/sessions/${live.id}/speech`, {}, token);
  const mp3 = await fetch(audio.audioUrl); assert.equal(mp3.status, 200); assert.ok((await mp3.arrayBuffer()).byteLength > 1000);
  const cached = await call(`/sessions/${live.id}/speech`, {}, token); assert.equal(cached.cached, true);
  ok('azure-korean-tts-signed-audio-and-cache', { voice: audio.voice });
  const turn = await call(`/sessions/${live.id}/turns`, { clientTurnId: randomUUID(), inputType: 'text', text: '교수님, 자료 정리가 늦어져 죄송합니다. 내일 오후 5시까지 제출해도 될까요?' }, token);
  assert.equal(turn.turn.isMock, false); assert.equal(turn.turn.outcome, 'correct'); ok('live-llm-evaluation', { provider: turn.turn.provider });
  if (process.env.MALO_SMOKE_AUDIO) {
    const form = new FormData(); form.set('file', new Blob([readFileSync(process.env.MALO_SMOKE_AUDIO)], { type: 'audio/mpeg' }), 'smoke.mp3'); form.set('pack', 'en');
    const stt = await fetch(base + '/speech/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const json = await stt.json(); if (!stt.ok) throw new Error(`STT ${stt.status} ${json.error?.code}`);
    assert.ok(json.data.text.length > 5); assert.equal(json.data.editable, true); assert.ok(json.data.audioMetrics.durationMs > 300);
    ok('openai-stt-and-audio-metrics', { durationMs: json.data.audioMetrics.durationMs });
    const voicePlay = await call('/sessions', { sceneId: 'en-friend-calm', aiMode: 'mock' }, token);
    const voiced = await call(`/sessions/${voicePlay.id}/turns`, { clientTurnId: randomUUID(), inputType: 'voice', transcriptId: json.data.transcriptId, text: json.data.text }, token);
    assert.ok(voiced.turn.feedback.speed); assert.ok(voiced.turn.feedback.hesitation); ok('confirmed-voice-submission');
  }
}
if (process.env.MALO_SMOKE_REPORT) writeFileSync(process.env.MALO_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n');
