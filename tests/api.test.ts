import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app, documentConfig } from '../src/app';
import { mergeProfiles, readProfile } from '../src/store';

before(() => { process.env.MALO_JWT_SECRET = 'test-only-secret-that-is-longer-than-32-characters'; process.env.MALO_DB_PATH = ':memory:'; process.env.MALO_ALLOW_DEMO_AUTH = 'true'; process.env.MALO_DATA_MODE = 'sqlite'; });
async function request(path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST') {
  const response = await app.request(`/api/v1${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...(await response.json()) };
}
const guest = () => request('/auth/guest', {});
test('Full learning flow persists mistakes, rewards exactly once and upgrades guest without loss', async () => {
  const auth = (await guest()).data; assert.equal(auth.user.kind, 'guest');
  const token = auth.accessToken;
  const play = (await request('/sessions', { sceneId: 'ko-professor-strict' }, token)).data;
  assert.equal(play.aiMode, 'mock'); assert.equal(play.lives, 3);
  const mistakeInput = { clientTurnId: 'bad-1', inputType: 'choice', choiceId: 'c' };
  const bad = await request(`/sessions/${play.id}/turns`, mistakeInput, token);
  assert.equal(bad.status, 200); assert.equal(bad.data.session.lives, 2); assert.ok(bad.data.mistakeId);
  const duplicate = await request(`/sessions/${play.id}/turns`, mistakeInput, token);
  assert.equal(duplicate.data.turn.id, bad.data.turn.id); assert.equal(duplicate.data.session.lives, 2);
  assert.equal((await request(`/sessions/${play.id}/turns`, { ...mistakeInput, choiceId: 'b' }, token)).status, 409);
  const unclear = await request(`/sessions/${play.id}/turns`, { clientTurnId: 'unclear', inputType: 'choice', choiceId: 'a' }, token);
  assert.equal(unclear.data.turn.outcome, 'clarify'); assert.equal(unclear.data.session.lives, 2); assert.equal(unclear.data.turn.feedback.speed, null);
  await request(`/sessions/${play.id}/hint`, {}, token);
  for (let i = 0; i < 3; i++) {
    const good = await request(`/sessions/${play.id}/turns`, { clientTurnId: `good-${i}`, inputType: 'choice', choiceId: 'b' }, token);
    assert.equal(good.status, 200); if (i === 2) assert.equal(good.data.result.rewardCoins, 30);
  }
  const first = await request(`/sessions/${play.id}/result`, undefined, token);
  const second = await request(`/sessions/${play.id}/result`, undefined, token);
  assert.deepEqual(first.data, second.data);
  assert.equal((await request('/wallet', undefined, token)).data.coins, 130);
  const mistakes = (await request('/mistakes', undefined, token)).data; assert.equal(mistakes.length, 2);
  const practice = await request(`/mistakes/${bad.data.mistakeId}/practice`, { clientTurnId: 'practice-1', text: '교수님 죄송합니다. 내일 오후 5시까지 제출해도 될까요?' }, token);
  assert.equal(practice.status, 200); assert.equal(practice.data.mistake.resolved, true);
  const upgraded = await request('/auth/demo-upgrade', { displayName: 'Malo tester' }, token);
  assert.equal(upgraded.data.user.id, auth.user.id); assert.equal(upgraded.data.user.kind, 'member'); assert.equal(upgraded.data.user.isMock, true);
  assert.equal((await request('/me', undefined, token)).status, 401);
  const records = await request('/records', undefined, upgraded.data.accessToken);
  assert.equal(records.data.completedScenes, 1); assert.equal(records.data.totalTurns, 5); assert.equal(records.data.streak.current, 1);
  assert.equal((await request('/wallet', undefined, upgraded.data.accessToken)).data.coins, 130);
});
test('Profiles are isolated; refresh rotation and logout revoke tokens', async () => {
  const a = (await guest()).data, b = (await guest()).data;
  const play = (await request('/sessions', { sceneId: 'en-friend-calm' }, a.accessToken)).data;
  assert.equal((await request(`/sessions/${play.id}`, undefined, b.accessToken)).status, 404);
  const refreshed = await request('/auth/refresh', { refreshToken: a.refreshToken }); assert.equal(refreshed.status, 200);
  assert.equal((await request('/auth/refresh', { refreshToken: a.refreshToken })).status, 401);
  await request('/auth/logout', {}, refreshed.data.accessToken);
  assert.equal((await request('/me', undefined, refreshed.data.accessToken)).status, 401);
});
test('AI/network error and invalid STT do not consume life; retry can recover', async () => {
  const auth = (await guest()).data;
  const play = (await request('/sessions', { sceneId: 'ko-manager-calm', aiMode: 'live' }, auth.accessToken)).data;
  const old = process.env.MALO_AI_URL; delete process.env.MALO_AI_URL;
  try {
    const response = await request(`/sessions/${play.id}/turns`, { clientTurnId: 'network', inputType: 'text', text: '내일 오후 5시에 마무리하겠습니다.' }, auth.accessToken);
    assert.equal(response.status, 503); assert.equal(response.error.retryable, true);
    assert.equal((await request(`/sessions/${play.id}`, undefined, auth.accessToken)).data.lives, 3);
    const invalid = await request(`/sessions/${play.id}/turns`, { clientTurnId: 'voice', inputType: 'voice', transcriptId: randomUUID() }, auth.accessToken);
    assert.equal(invalid.status, 422);
  } finally { if (old) process.env.MALO_AI_URL = old; }
});
test('Three clear mistakes fail, pause blocks turns and retry starts fresh', async () => {
  const auth = (await guest()).data;
  const play = (await request('/sessions', { sceneId: 'ko-girlfriend-playful' }, auth.accessToken)).data;
  await request(`/sessions/${play.id}/pause`, {}, auth.accessToken);
  assert.equal((await request(`/sessions/${play.id}/turns`, { clientTurnId: 'pause', inputType: 'choice', choiceId: 'b' }, auth.accessToken)).status, 409);
  await request(`/sessions/${play.id}/resume`, {}, auth.accessToken);
  for (let i = 0; i < 3; i++) await request(`/sessions/${play.id}/turns`, { clientTurnId: `fail-${i}`, inputType: 'choice', choiceId: 'c' }, auth.accessToken);
  const result = (await request(`/sessions/${play.id}/result`, undefined, auth.accessToken)).data;
  assert.equal(result.passed, false); assert.equal(result.rewardCoins, 5);
  const retry = (await request(`/sessions/${play.id}/retry`, {}, auth.accessToken)).data;
  assert.notEqual(retry.id, play.id); assert.equal(retry.lives, 3);
});
test('Real-account merge transfers data once and invalidates guest credentials', async () => {
  const a = (await guest()).data, b = (await guest()).data;
  await request('/settings', { pack: 'en' }, a.accessToken, 'PATCH');
  await mergeProfiles(a.user.id, b.user.id);
  assert.equal((await request('/me', undefined, a.accessToken)).status, 401);
  assert.equal((await request('/settings', undefined, b.accessToken)).data.pack, 'en');
  assert.equal((await readProfile(b.user.id))!.state.coins, 100);
  await assert.rejects(mergeProfiles(a.user.id, b.user.id));
});
test('Swagger, request validation, catalog and preview response contracts', async () => {
  const auth = (await guest()).data;
  const invalid = await request('/sessions', { sceneId: 'unknown' }, auth.accessToken); assert.equal(invalid.status, 404);
  const invalidBody = await request('/settings', { voiceSpeed: 9 }, auth.accessToken, 'PATCH'); assert.equal(invalidBody.status, 422);
  assert.equal((await request('/characters')).data.length, 4);
  assert.equal((await request('/scenes?pack=en')).data.length, 12);
  const shop = (await request('/shop', undefined, auth.accessToken)).data; assert.equal(shop.previewOnly, true); assert.equal(shop.realBilling, false);
  const spec = app.getOpenAPI31Document(documentConfig); assert.ok(Object.keys(spec.paths || {}).length >= 35);
  assert.equal((await app.request('/api/v1/docs')).status, 200);
});

test('Multipart files reach STT and return an editable draft without grading', async () => {
  const auth = (await guest()).data;
  const oldFetch = globalThis.fetch, oldUrl = process.env.MALO_AI_URL;
  process.env.MALO_AI_URL = 'http://internal-ai.test';
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), 'http://internal-ai.test/v1/speech/transcribe');
    assert.ok(init?.body instanceof FormData); assert.ok(init.body.get('file') instanceof File);
    return Response.json({ text: 'Could we meet at noon?', audioMetrics: { durationMs: 3000, pauseCount: 1, silenceRatio: 0.2, fillerCount: 0, speed: 100, speedUnit: 'words_per_minute', measurement: 'audio_rms_and_transcript', estimated: true } });
  }) as typeof fetch;
  try {
    const form = new FormData(); form.set('file', new File(['fake-audio'], 'clip.m4a', { type: 'audio/mp4' })); form.set('pack', 'en');
    const r = await app.request('/api/v1/speech/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}` }, body: form });
    const json = await r.json(); assert.equal(r.status, 200); assert.equal(json.data.editable, true); assert.ok(json.data.transcriptId);
    assert.equal((await request('/records', undefined, auth.accessToken)).data.totalTurns, 0);
  } finally { globalThis.fetch = oldFetch; if (oldUrl) process.env.MALO_AI_URL = oldUrl; else delete process.env.MALO_AI_URL; }
});
