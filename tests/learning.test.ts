import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app';
import { mutate } from '../src/store';
import { buildScenario, learningSupport } from '../src/catalog';

before(() => { process.env.MALO_JWT_SECRET = 'test-only-secret-that-is-longer-than-32-characters'; process.env.MALO_DB_PATH = ':memory:'; process.env.MALO_DATA_MODE = 'sqlite'; });
async function request(path: string, body?: unknown, token?: string) {
  const response = await app.request('/api/v1' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
const guest = async () => (await request('/auth/guest', {})).data;

test('Clues, staged hints, language help, correction comparison and achievement persist end to end', async () => {
  const auth = await guest(), token = auth.accessToken;
  const session = (await request('/sessions', { sceneId: 'ko-manager-strict',aiMode:'mock' }, token)).data;
  assert.ok(session.npc.action); assert.deepEqual(session.npc.cues.map((c: { k: string }) => c.k), ['표정', '억양']);
  assert.equal(session.npc.hiddenThought, undefined); assert.equal(session.npc.views, undefined);
  const h1 = (await request(`/sessions/${session.id}/hint`, { step: 1 }, token)).data;
  assert.equal(h1.step, 1); assert.equal(h1.clue.length, 3); assert.equal(h1.hiddenThought, null); assert.equal(h1.tip, null);
  assert.equal(h1.session.hintsUsed, 1); assert.equal(h1.session.lives, 3);
  const again = (await request(`/sessions/${session.id}/hint`, { step: 1 }, token)).data;
  assert.equal(again.session.hintsUsed, 1);
  const h2 = (await request(`/sessions/${session.id}/hint`, { step: 2 }, token)).data;
  assert.ok(h2.hiddenThought); assert.ok(h2.tip); assert.equal(h2.session.hintsUsed, 2);
  assert.equal((await request(`/sessions/${session.id}/hint`, { step: 3 }, token)).status, 422);
  const nativeInput = { clientTurnId: 'native', inputType: 'text', text: 'I have collected the data but still need to finish the analysis.' };
  const native = (await request(`/sessions/${session.id}/turns`, nativeInput, token)).data;
  assert.equal(native.turn.native, true); assert.equal(native.turn.mark, '△'); assert.equal(native.turn.outcome, 'clarify');
  assert.equal(native.turn.lifeDelta, 0); assert.equal(native.session.nodeIndex, 0); assert.equal(native.session.lives, 3); assert.equal(native.mistakeId, null);
  assert.match(native.turn.feedback.betterExpression, /[가-힣]/); assert.ok(native.turn.action); assert.ok(native.turn.cues.length);
  const duplicate = (await request(`/sessions/${session.id}/turns`, nativeInput, token)).data;
  assert.deepEqual(duplicate, native);
  const bad = (await request(`/sessions/${session.id}/turns`, { clientTurnId: 'bad', inputType: 'choice', choiceId: 'c' }, token)).data;
  assert.equal(bad.turn.mark, 'X'); assert.equal(bad.session.lives, 2); assert.equal(bad.turn.attempt, 2);
  assert.equal(bad.turn.comparison.firstAnswer, nativeInput.text); assert.equal(bad.turn.comparison.improved, false);
  const fixed = (await request(`/sessions/${session.id}/turns`, { clientTurnId: 'fixed', inputType: 'choice', choiceId: 'b' }, token)).data;
  assert.equal(fixed.turn.mark, 'O'); assert.equal(fixed.turn.attempt, 3); assert.equal(fixed.turn.comparison.firstAnswer, nativeInput.text);
  assert.equal(fixed.turn.comparison.currentAnswer, fixed.turn.text); assert.equal(fixed.turn.comparison.improved, true);
  assert.ok(fixed.turn.feedback.views.length >= 2); assert.ok(fixed.turn.feedback.views.every((v: { who: string; meaning: string; cue: string }) => v.who && v.meaning && v.cue));
  assert.notEqual(fixed.session.npc.action, session.npc.action);
  for (let index = 1; index < 3; index++) {
    const response = (await request(`/sessions/${session.id}/turns`, { clientTurnId: `next-${index}`, inputType: 'choice', choiceId: 'b' }, token)).data;
    assert.equal(response.turn.attempt, 1); assert.equal(response.turn.comparison, null);
  }
  const result = (await request(`/sessions/${session.id}/result`, undefined, token)).data;
  assert.deepEqual(result.achievement, { reach: 100, infer: 60, self: 60 });
  assert.equal(result.rewardCoins, 30); assert.equal((await request('/wallet', undefined, token)).data.coins, 130);
  assert.equal((await request(`/sessions/${session.id}/hint`, { step: 1 }, token)).status, 409);
  const history = (await request(`/sessions/${session.id}/history`, undefined, token)).data;
  assert.equal(history[2].comparison.firstAnswer, nativeInput.text);
  const chapters = (await request('/chapters?pack=ko&characterId=manager', undefined, token)).data;
  assert.equal(chapters.length, 1); assert.equal(chapters[0].subs.length, 1);
  assert.equal(chapters[0].subs[0].state, 'done'); // Personality variants share episode progress.
  assert.equal((await request('/chapters?pack=bogus', undefined, token)).status, 422);
});

test('Hints enforce ownership, pause and pending-turn boundaries; {} preserves the old second hint', async () => {
  const a = await guest(), b = await guest();
  const s = (await request('/sessions', { sceneId: 'ko-friend-calm',aiMode:'mock' }, a.accessToken)).data;
  assert.equal((await request(`/sessions/${s.id}/hint`, { step: 1 }, b.accessToken)).status, 404);
  const legacy = (await request(`/sessions/${s.id}/hint`, {}, a.accessToken)).data;
  assert.equal(legacy.step, 2); assert.ok(legacy.hiddenThought); assert.ok(legacy.tip);
  await request(`/sessions/${s.id}/pause`, {}, a.accessToken);
  assert.equal((await request(`/sessions/${s.id}/hint`, { step: 1 }, a.accessToken)).status, 409);
  await request(`/sessions/${s.id}/resume`, {}, a.accessToken);
  await mutate(a.user.id, p => { p.state.plays[0].turns.push({ id: 'pending', clientTurnId: 'pending', inputHash: 'pending', status: 'pending' }); });
  assert.equal((await request(`/sessions/${s.id}/hint`, { step: 1 }, a.accessToken)).status, 409);
});

test('Legacy saved nodes receive support without a database migration', () => {
  const scenario = buildScenario('professor', 'calm', 'ko');
  const node = scenario.nodes[0];
  delete node.action; delete node.cues; delete node.clue; delete node.views;
  const support = learningSupport(scenario, node);
  assert.ok(support.action); assert.ok(support.cues.length); assert.equal(support.clue.length, 3); assert.equal(support.views.length, 2);
});

test('Live AI metadata reaches the API and language or low-confidence mistakes never consume life', async () => {
  const a = await guest();
  const s = (await request('/sessions', { sceneId: 'ko-professor-calm', aiMode: 'live' }, a.accessToken)).data;
  const oldFetch = globalThis.fetch, oldUrl = process.env.MALO_AI_URL;
  process.env.MALO_AI_URL = 'http://internal-ai.test';
  let confidence = 0.99;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.node.cues.length); assert.ok(body.node.clue.length); assert.ok(body.node.views.length);
    return Response.json({ outcome: 'misunderstanding', confidence, toneScore: 50, toneLabel: '다시 말해보세요', native: false,
      feedback: '표현을 참고해 다시 말해보세요.', betterExpression: body.node.goodExample, reason: '기한을 구체적으로 설명해보세요.',
      npcReply: '한국어로 다시 말해 줄래요?', emotion: 'neutral', action: '잠시 기다린다.', cues: [{ k: '침묵', v: '대답을 기다린다.' }],
      views: body.node.views, provider: 'lablup', isMock: false });
  }) as typeof fetch;
  try {
    const native = (await request(`/sessions/${s.id}/turns`, { clientTurnId: 'english', inputType: 'text', text: 'Could I submit it tomorrow?' }, a.accessToken)).data;
    assert.equal(native.turn.native, true); assert.equal(native.turn.mark, '△'); assert.equal(native.turn.lifeDelta, 0);
    assert.equal(native.turn.provider, 'lablup'); assert.equal(native.turn.cues[0].k, '침묵');
    confidence = 0.5;
    const vague = (await request(`/sessions/${s.id}/turns`, { clientTurnId: 'vague', inputType: 'text', text: '내일쯤 할게요.' }, a.accessToken)).data;
    assert.equal(vague.turn.native, false); assert.equal(vague.turn.mark, '?'); assert.equal(vague.turn.lifeDelta, 0);
    assert.equal(vague.session.nodeIndex, 0); assert.equal(vague.session.lives, 3);
  } finally { globalThis.fetch = oldFetch; if (oldUrl) process.env.MALO_AI_URL = oldUrl; else delete process.env.MALO_AI_URL; }
});
