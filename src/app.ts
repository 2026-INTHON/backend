import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import * as C from './contracts';
import * as Auth from './auth';
import * as Game from './game';
import { characters, packs, listScenes, findScenario } from './catalog';
import { aiRequest, audioBytes, Grade } from './ai';
import { mutate, dataMode } from './store';
import { ApiError } from './errors';
import type { Profile } from './models';

const { z } = C;
type Env = { Variables: { requestId: string } };
export const app = new OpenAPIHono<Env>({ defaultHook(result) { if (!result.success) throw new ApiError('VALIDATION_ERROR', '요청 형식을 확인해 주세요.', 422, false, result.error.issues.map(i => ({ path: i.path, message: i.message }))); } }).basePath('/api/v1');
app.use('*', async (c, next) => { c.set('requestId', randomUUID()); c.header('X-Request-Id', c.get('requestId')); c.header('Cache-Control', 'no-store'); await next(); });
app.use('*', cors({ origin: process.env.MALO_CORS_ORIGINS?.split(',') || '*', allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'], exposeHeaders: ['X-Request-Id'] }));
app.use('*', bodyLimit({ maxSize: 6 * 1024 * 1024, onError: () => { throw new ApiError('REQUEST_TOO_LARGE', '요청 크기가 너무 커요.', 413); } }));
// ponytail: In-memory, per-instance request limits for one VM. Persistent AI usage ceilings live in the AI service.
const limits = new Map<string, { count: number; until: number }>();
function limit(key: string, cap: number) {
  if (limits.size > 10000) for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
  const state = limits.get(key); if (!state || state.until < Date.now()) { limits.set(key, { count: 1, until: Date.now() + 60000 }); return; }
  if (++state.count > cap) throw new ApiError('RATE_LIMITED', '잠시 후 다시 시도해 주세요.', 429, true);
}
app.onError((error, c) => {
  const e = error instanceof ApiError ? error : error instanceof C.z.ZodError ? new ApiError('VALIDATION_ERROR', '요청 형식을 확인해 주세요.', 422) : error instanceof HTTPException && error.status < 500 ? new ApiError('INVALID_REQUEST', '요청 형식을 확인해 주세요.', error.status) : new ApiError('INTERNAL_ERROR', '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.', 500, true);
  // Never log tokens, user dialogue, raw provider errors or request bodies.
  if (!(error instanceof ApiError)) console.error('request_failed', c.get('requestId'), error.name);
  return c.json({ error: { code: e.code, message: e.message, retryable: e.retryable, requestId: c.get('requestId'), ...(e.details ? { details: e.details } : {}) } }, e.status as 400);
});
app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: 'API 경로를 확인해 주세요.', retryable: false, requestId: c.get('requestId') } }, 404));
app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

type Endpoint<I extends C.z.ZodType, O extends C.z.ZodType> = { method: 'get' | 'post' | 'patch' | 'delete'; path: string; tag: string; summary: string;
  input?: I; output: O; auth?: boolean; params?: C.z.ZodObject; query?: C.z.ZodObject; description?: string;
  run: (c: Context<Env>, body: C.z.infer<I>, profile: Profile | null) => Promise<unknown> | unknown };
function endpoint<I extends C.z.ZodType = C.z.ZodObject, O extends C.z.ZodType = C.z.ZodType>(e: Endpoint<I, O>) {
  const protectedRoute = e.auth !== false;
  const route = createRoute({ method: e.method, path: e.path, tags: [e.tag], summary: e.summary, description: e.description,
    ...(protectedRoute ? { security: [{ BearerAuth: [] }] } : {}),
    request: { ...(e.input ? { body: { required: true, content: { 'application/json': { schema: e.input } } } } : {}), ...(e.params ? { params: e.params } : {}), ...(e.query ? { query: e.query } : {}) },
    responses: { 200: { description: '성공', content: { 'application/json': { schema: C.envelope(e.output) } } },
      ...Object.fromEntries([401, 403, 404, 409, 413, 422, 429, 502, 503].map(status => [status, { description: 'ApiError — code와 retryable 참조', content: { 'application/json': { schema: C.ErrorBody } } }])) } });
  app.openapi(route, async c => {
    const p = protectedRoute ? await Auth.authenticate(c.req.header('Authorization')) : null;
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    limit(`${p?.id || ip}:requests`, protectedRoute ? 180 : 60);
    if (e.path === '/auth/guest') limit(`${ip}:guest`, 10);
    const body = (e.input ? e.input.parse(await c.req.json()) : {}) as C.z.infer<I>;
    const data = e.output.parse(await e.run(c, body, p));
    return c.json({ data, meta: { requestId: c.get('requestId'), apiVersion: 'v1' as const } }, 200) as never;
  });
}
const idParam = z.object({ id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }) });
const empty = z.object({});
const mode = z.enum(['mock', 'live']).default('mock');
const text = z.string().trim().min(1).max(1200);
const clientTurnId = z.string().min(1).max(100);
const feature = z.object({ id: z.string(), name: z.string(), description: z.string() });
const preview = z.object({ previewOnly: z.literal(true), realBilling: z.literal(false), items: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), priceCoins: z.number().nullable(), assetKey: z.string().nullable() })) });

endpoint({ method: 'get', path: '/health', tag: 'System', summary: '서버 상태와 실제/모의 기능 구분', auth: false,
  output: z.object({ status: z.literal('ok'), service: z.literal('malo-backend'), version: z.string(), storage: z.string(), defaultAiMode: z.string(), googleEnabled: z.boolean(), demoAuthEnabled: z.boolean(), aiConfigured: z.boolean() }),
  run: () => ({ status: 'ok', service: 'malo-backend', version: '0.1.0', storage: dataMode(), defaultAiMode: 'mock', googleEnabled: process.env.MALO_GOOGLE_ENABLED === 'true', demoAuthEnabled: process.env.MALO_ALLOW_DEMO_AUTH === 'true', aiConfigured: !!process.env.MALO_AI_URL }) });
endpoint({ method: 'get', path: '/auth/config', tag: 'Auth', summary: 'Google OAuth 준비 상태와 앱용 공개 설정', auth: false,
  output: z.object({ guestEnabled: z.boolean(), google: z.object({ enabled: z.boolean(), supabaseUrl: z.string().nullable(), publishableKey: z.string().nullable(), flow: z.string() }), demoUpgradeEnabled: z.boolean() }), run: () => Auth.authConfig() });
endpoint({ method: 'post', path: '/auth/guest', tag: 'Auth', summary: '기록이 저장되는 게스트 계정 생성', auth: false,
  input: z.object({ displayName: z.string().trim().min(1).max(40).default('게스트') }), output: C.Auth, run: (_, body) => Auth.createGuest(body.displayName) });
endpoint({ method: 'post', path: '/auth/refresh', tag: 'Auth', summary: 'Refresh token 1회 사용 후 회전', auth: false,
  input: z.object({ refreshToken: z.string().min(1).max(4096) }), output: C.Auth, run: (_, body) => Auth.refresh(body.refreshToken) });
endpoint({ method: 'post', path: '/auth/logout', tag: 'Auth', summary: '현재 계정의 토큰 폐기', input: empty,
  output: z.object({ loggedOut: z.boolean() }), run: (_, __, p) => Auth.logout(p!.id) });
endpoint({ method: 'post', path: '/auth/demo-upgrade', tag: 'Auth', summary: '[Mock] 게스트 → 모의 회원, 기록 유지',
  description: '실제 Google 인증이 아닙니다. 현재 게스트 소유자만 가능하며 isMock=true가 유지됩니다. Google 이메일/ID 사칭 입력을 받지 않습니다.',
  input: z.object({ displayName: z.string().trim().min(1).max(40) }), output: C.Auth, run: (_, body, p) => Auth.demoUpgrade(p!.id, body.displayName) });
endpoint({ method: 'post', path: '/auth/google/exchange', tag: 'Auth', summary: '실제 Supabase Google 로그인 → 앱 토큰 및 게스트 기록 이관', auth: false,
  description: 'Supabase OAuth PKCE 로그인 후 accessToken 전달. 기존 게스트 Authorization 헤더가 있으면 그 게스트 기록만 실제 회원에게 원자적으로 이관합니다. 이메일만으로 로그인할 수 없습니다.',
  input: z.object({ supabaseAccessToken: z.string().min(1).max(8192) }), output: C.Auth,
  run: async (c, body) => Auth.googleExchange(body.supabaseAccessToken, c.req.header('Authorization') ? await Auth.authenticate(c.req.header('Authorization')) : undefined) });
endpoint({ method: 'get', path: '/me', tag: 'Home', summary: '내 계정', output: C.User, run: (_, __, p) => Auth.publicUser(p!) });
endpoint({ method: 'get', path: '/home', tag: 'Home', summary: '이어하기·오늘의 장면·재화·출석 팝업', output: C.Home, run: (_, __, p) => Game.home(p!) });
endpoint({ method: 'get', path: '/packs', tag: 'Catalog', summary: '한국어/영어팩', auth: false, output: z.array(feature), run: () => packs });
endpoint({ method: 'get', path: '/characters', tag: 'Catalog', summary: '4명 캐릭터와 각 3가지 성격', auth: false, output: z.array(C.Character), run: () => characters });
endpoint({ method: 'get', path: '/scenes', tag: 'Catalog', summary: '팩·캐릭터·성격별 장면 목록', auth: false,
  query: z.object({ pack: C.Pack.optional(), characterId: z.string().optional(), personalityId: z.string().optional() }), output: z.array(C.Scene),
  run: c => listScenes((c.req.query('pack') || 'ko') as 'ko' | 'en', c.req.query('characterId'), c.req.query('personalityId')) });
endpoint({ method: 'get', path: '/scenes/{sceneId}', tag: 'Catalog', summary: '장면 브리핑', auth: false,
  params: z.object({ sceneId: z.string() }), output: C.Scene, run: c => { const s = findScenario(c.req.param('sceneId')!); if (!s) throw new ApiError('SCENE_NOT_FOUND', '장면을 찾지 못했어요.', 404); return { ...s, id: c.req.param('sceneId')!, nodeCount: s.nodes.length, estimatedMinutes: 3 }; } });
endpoint({ method: 'get', path: '/settings', tag: 'Settings', summary: '설정 조회', output: C.Settings, run: (_, __, p) => p!.state.settings });
endpoint({ method: 'patch', path: '/settings', tag: 'Settings', summary: '팩·음성 속도·자막·알림 설정 저장', input: C.Settings.partial(), output: C.Settings,
  run: async (_, body, p) => (await mutate(p!.id, user => { user.state.settings = { ...user.state.settings, ...body }; return user.state.settings; })).value });
endpoint({ method: 'post', path: '/sessions', tag: 'Play', summary: '장면 시작 — 기본 mock, live 선택 가능', input: z.object({ sceneId: z.string(), aiMode: mode }), output: C.Session,
  run: (_, body, p) => Game.createPlay(p!.id, body.sceneId, body.aiMode) });
endpoint({ method: 'get', path: '/sessions/{id}', tag: 'Play', summary: '장면 현재 상태/이어하기', params: idParam, output: C.Session, run: (c, _, p) => Game.publicPlay(Game.getPlay(p!, c.req.param('id')!)) });
endpoint({ method: 'get', path: '/sessions/{id}/history', tag: 'Play', summary: '대화 내역', params: idParam, output: z.array(C.Turn), run: (c, _, p) => Game.getPlay(p!, c.req.param('id')!).history });
endpoint({ method: 'post', path: '/sessions/{id}/turns', tag: 'Play', summary: '텍스트·선택지·확인한 STT 답변 제출', params: idParam,
  description: 'clientTurnId를 재시도 시 그대로 사용. 동일 ID/내용은 같은 응답. 다른 내용은 409. 명확한 실수만 체력 -1; 애매한 답/AI 오류는 차감 없음. 텍스트·선택지는 속도/망설임 null.',
  input: z.object({ clientTurnId, inputType: z.enum(['text', 'choice', 'voice']), text: text.optional(), choiceId: z.string().optional(), transcriptId: z.string().uuid().optional() }), output: C.TurnResult,
  run: (c, body, p) => { limit(`${p!.id}:turns`, 20); return Game.submitTurn(p!.id, c.req.param('id')!, body); } });
endpoint({ method: 'post', path: '/sessions/{id}/hint', tag: 'Play', summary: '가상 캐릭터의 속마음·학습 힌트', params: idParam, input: empty,
  output: z.object({ hiddenThought: z.string(), tip: z.string(), isFictional: z.literal(true), session: C.Session }),
  run: async (c, _, p) => (await mutate(p!.id, user => { const play = Game.getPlay(user, c.req.param('id')!); if (play.status !== 'active') throw new ApiError('SESSION_NOT_ACTIVE', '진행 중인 장면에서 사용할 수 있어요.', 409);
    play.hintsUsed++; const node = play.scenario.nodes[play.nodeIndex]; return { hiddenThought: node.hiddenThought, tip: node.tip, isFictional: true as const, session: Game.publicPlay(play) }; })).value });
for (const action of ['pause', 'resume', 'abandon'] as const) endpoint({ method: 'post', path: `/sessions/{id}/${action}`, tag: 'Play', summary: `${action} — 일시정지/재개/나가기`, params: idParam, input: empty, output: C.Session, run: (c, _, p) => Game.transition(p!.id, c.req.param('id')!, action) });
endpoint({ method: 'post', path: '/sessions/{id}/retry', tag: 'Play', summary: '같은 장면을 새 세션으로 다시 하기', params: idParam, input: empty, output: C.Session,
  run: (c, _, p) => { const old = Game.getPlay(p!, c.req.param('id')!); return Game.createPlay(p!.id, old.sceneId, old.aiMode, old.scenario); } });
endpoint({ method: 'get', path: '/sessions/{id}/result', tag: 'Play', summary: '결과·잘한 말·아쉬운 말·지급된 재화', params: idParam, output: C.Result,
  run: (c, _, p) => { const result = Game.getPlay(p!, c.req.param('id')!).result; if (!result) throw new ApiError('RESULT_NOT_READY', '장면을 마친 후 확인할 수 있어요.', 409); return result; } });
endpoint({ method: 'post', path: '/sessions/{id}/speech', tag: 'Speech', summary: '현재 NPC 대사 TTS — 서명 URL 반환', params: idParam, input: empty, output: C.AudioAsset,
  run: async (c, _, p) => { limit(`${p!.id}:tts`, 20); const play = Game.getPlay(p!, c.req.param('id')!), s = Game.publicPlay(play);
    const result = await aiRequest('/v1/speech/synthesize', { text: s.npc.text, pack: s.pack, characterId: s.characterId, emotion: s.npc.emotion, speed: p!.state.settings.voiceSpeed });
    const token = await Auth.signAudio(p!.id, result.assetId); const base = process.env.MALO_PUBLIC_BASE_URL || new URL(c.req.url).origin;
    return { ...result, mimeType: 'audio/mpeg' as const, expiresIn: 600, audioUrl: `${base}/api/v1/audio/${result.assetId}?token=${encodeURIComponent(token)}` }; } });

const uploadRoute = createRoute({ method: 'post', path: '/speech/transcriptions', tags: ['Speech'], summary: '녹음 → 수정 가능한 인식 결과 (제출/채점 전)', security: [{ BearerAuth: [] }],
  request: { body: { required: true, content: { 'multipart/form-data': { schema: z.object({ file: z.custom<File>(value => value instanceof File, '음성 파일이 필요해요.').openapi({ type: 'string', format: 'binary' }), pack: C.Pack.default('ko') }) } } } },
  responses: { 200: { description: '음성 인식 완료, text 수정 후 turns에 제출', content: { 'application/json': { schema: C.envelope(C.SpeechDraft) } } }, 422: { description: '인식 실패 — 체력 차감 없음', content: { 'application/json': { schema: C.ErrorBody } } } } });
app.openapi(uploadRoute, async c => { const p = await Auth.authenticate(c.req.header('Authorization')); limit(`${p.id}:stt`, 10); const form = await c.req.formData(); const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError('AUDIO_REQUIRED', '음성 파일이 필요해요.', 422);
  const pack = C.Pack.parse(form.get('pack') || p.state.settings.pack);
  const data = C.SpeechDraft.parse(await Game.transcribe(p.id, file, pack)); return c.json({ data, meta: { requestId: c.get('requestId'), apiVersion: 'v1' as const } }, 200); });
app.get('/audio/:assetId', async c => { const assetId = c.req.param('assetId'); if (!/^a_[a-f0-9]{40}$/.test(assetId)) throw new ApiError('AUDIO_NOT_FOUND', '음성 파일을 찾지 못했어요.', 404);
  await Auth.verifyAudio(c.req.query('token') || '', assetId); c.header('Content-Type', 'audio/mpeg'); c.header('Referrer-Policy', 'no-referrer'); return c.body(await audioBytes(assetId)); });
app.openAPIRegistry.registerPath({ method: 'get', path: '/api/v1/audio/{assetId}', tags: ['Speech'], summary: '10분 유효 서명 링크로 음성 재생', request: { params: z.object({ assetId: z.string() }), query: z.object({ token: z.string() }) }, responses: { 200: { description: 'MP3', content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } } } } });
endpoint({ method: 'get', path: '/mistakes', tag: 'Mistakes', summary: '자동 저장된 오답 도감', output: z.array(C.Mistake), run: (_, __, p) => [...p!.state.mistakes].reverse().map(Game.publicMistake) });
endpoint({ method: 'get', path: '/mistakes/{id}', tag: 'Mistakes', summary: '내가 한 말·더 나은 말·이유', params: idParam, output: C.Mistake,
  run: (c, _, p) => { const m = p!.state.mistakes.find(m => m.id === c.req.param('id')); if (!m) throw new ApiError('MISTAKE_NOT_FOUND', '오답을 찾지 못했어요.', 404); return Game.publicMistake(m); } });
endpoint({ method: 'post', path: '/mistakes/{id}/practice', tag: 'Mistakes', summary: '실수한 부분만 다시 연습 — 체력·재화 변화 없음', params: idParam,
  input: z.object({ clientTurnId, text, aiMode: mode }), output: z.object({ mistake: C.Mistake, evaluation: Grade, lifeDelta: z.number(), rewardCoins: z.number() }),
  run: (c, body, p) => { limit(`${p!.id}:practice`, 20); return Game.practice(p!.id, c.req.param('id')!, body); } });
endpoint({ method: 'get', path: '/records', tag: 'Records', summary: '톤 추이·자주 하는 실수·출석', output: C.Records, run: (_, __, p) => Game.records(p!) });
endpoint({ method: 'post', path: '/records/celebrations/{id}/ack', tag: 'Records', summary: '출석 축하 팝업 확인', params: z.object({ id: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), input: empty,
  output: z.object({ acknowledged: z.boolean() }), run: async (c, _, p) => { await mutate(p!.id, user => { const id = c.req.param('id')!; if (!user.state.attendance.acknowledged.includes(id)) user.state.attendance.acknowledged.push(id); }); return { acknowledged: true }; } });
endpoint({ method: 'get', path: '/wallet', tag: 'Preview', summary: '가상 재화 잔액', output: C.Wallet, run: (_, __, p) => Game.wallet(p!) });
endpoint({ method: 'get', path: '/wallet/transactions', tag: 'Preview', summary: '가상 재화 지급 내역', output: z.array(C.LedgerEntry), run: (_, __, p) => [...p!.state.ledger].reverse() });
endpoint({ method: 'get', path: '/shop', tag: 'Preview', summary: '[화면용] 외모 상점 — 결제 없음', output: preview,
  run: () => ({ previewOnly: true, realBilling: false, items: [{ id: 'outfit-casual', name: '편안한 주말 옷', description: '외모 변경 화면용 아이템', priceCoins: 150, assetKey: 'shop/outfit-casual' }, { id: 'hair-short', name: '산뜻한 헤어', description: '외모 변경 화면용 아이템', priceCoins: 100, assetKey: 'shop/hair-short' }] }) });
endpoint({ method: 'get', path: '/personality-customizations', tag: 'Preview', summary: '[화면용] 성격 커스텀', output: preview,
  run: () => ({ previewOnly: true, realBilling: false, items: characters[0].personalities.map(p => ({ id: p.id, name: p.name, description: p.description, priceCoins: 100, assetKey: p.assetKey })) }) });
endpoint({ method: 'get', path: '/plans', tag: 'Preview', summary: '[화면용] 구독 혜택 — 실제 가격·결제 없음', output: preview,
  run: () => ({ previewOnly: true, realBilling: false, items: [{ id: 'free', name: '기본 연습', description: '준비된 캐릭터와 장면으로 연습', priceCoins: null, assetKey: null }, { id: 'plus-preview', name: 'Malo Plus 미리보기', description: '나만의 에피소드 만들기 — 해커톤에서는 기능 시연만 제공', priceCoins: null, assetKey: null }] }) });
endpoint({ method: 'get', path: '/assets/personas', tag: 'Catalog', summary: '사전 생성 이미지 연결용 assetKey — 현재 미등록', auth: false,
  output: z.array(z.object({ assetKey: z.string(), characterId: z.string(), emotion: C.Emotion, imageUrl: z.string().nullable(), source: z.literal('pre_generated') })),
  run: () => characters.flatMap(c => C.Emotion.options.map(emotion => ({ assetKey: `characters/${c.id}/${emotion}`, characterId: c.id, emotion, imageUrl: null, source: 'pre_generated' as const }))) });

export const documentConfig = { openapi: '3.1.0' as const, info: { title: 'Malo Backend API', version: '0.1.0', description: 'React Native + Expo FE용 API. 기본 Mock 채점, 선택 시 Live AI. Guest 영속 저장 및 Google 회원 이관. 상점/구독은 화면용 데이터만 제공합니다.' }, servers: [{ url: '/', description: '현재 서버' }], security: [] };
app.doc31('/openapi.json', documentConfig);
app.get('/docs', swaggerUI({ url: '/api/v1/openapi.json', persistAuthorization: false }));
