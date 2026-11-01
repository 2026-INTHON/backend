import * as Endings from './endings';
import { localizedChapters, requireKorean, translations } from './translations';
import * as Reports from './reports';
import * as Exports from './exports';
import {ReportResource} from './report-contracts';
import * as CharacterImages from './character-images';
import * as Content from './content';
import * as Generation from './generation';
import * as Push from './push';
import { ChapterInput, JobView } from './generation-contracts';
import { timingSafeEqual } from 'node:crypto';
import {readFile} from 'node:fs/promises';
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
import { aiRequest, audioBytes, Grade, personaAssets, imageBytes } from './ai';
import { mutate, dataMode } from './store';
import { ApiError } from './errors';
import type { Profile } from './models';

const { z } = C;
type Env = { Variables: { requestId: string } };
export const app = new OpenAPIHono<Env>({ defaultHook(result) { if (!result.success) throw new ApiError('VALIDATION_ERROR', '요청 형식을 확인해 주세요.', 422, false, result.error.issues.map(i => ({ path: i.path, message: i.message }))); } }).basePath('/api/v1');
app.use('*', async (c, next) => { c.set('requestId', randomUUID()); c.header('X-Request-Id', c.get('requestId')); c.header('Cache-Control', 'no-store'); await next(); });
app.use('*', cors({ origin: process.env.MALO_CORS_ORIGINS?.split(',') || '*', allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'], exposeHeaders: ['X-Request-Id', 'Retry-After'] }));
app.use('*', bodyLimit({ maxSize: 6 * 1024 * 1024, onError: () => { throw new ApiError('REQUEST_TOO_LARGE', '요청 크기가 너무 커요.', 413); } }));
// ponytail: In-memory, per-instance request limits for one VM. Persistent AI usage ceilings live in the AI service.
const limits = new Map<string, { count: number; until: number }>();
function limit(key: string, cap: number) {
  if (limits.size > 10000) for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
  const state = limits.get(key); if (!state || state.until < Date.now()) { limits.set(key, { count: 1, until: Date.now() + 60000 }); return; }
  if (++state.count > cap) {const retryAfter=Math.max(1,Math.ceil((state.until-Date.now())/1000));throw new ApiError('RATE_LIMITED', `${retryAfter}초 뒤 다시 시도해 주세요.`, 429, true,{retryAfter});}
}
app.onError((error, c) => {
  const e = error instanceof ApiError ? error : error instanceof C.z.ZodError ? new ApiError('VALIDATION_ERROR', '요청 형식을 확인해 주세요.', 422) : error instanceof HTTPException && error.status < 500 ? new ApiError('INVALID_REQUEST', '요청 형식을 확인해 주세요.', error.status) : new ApiError('INTERNAL_ERROR', '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.', 500, true);
  // Never log tokens, user dialogue, raw provider errors or request bodies.
  if (!(error instanceof ApiError)) console.error('request_failed', c.get('requestId'), error.name);
  if(e.code==='RATE_LIMITED')c.header('Retry-After',String((e.details as {retryAfter:number}).retryAfter));
  return c.json({ error: { code: e.code, message: e.message, retryable: e.retryable, requestId: c.get('requestId'), ...(e.details ? { details: e.details } : {}) } }, e.status as 400);
});
app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: 'API 경로를 확인해 주세요.', retryable: false, requestId: c.get('requestId') } }, 404));
app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
app.openAPIRegistry.register('PlaySession', C.Session);
app.openAPIRegistry.register('SessionResult', C.Result);

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
    // Navigation/polling must not consume the budget for starting or answering a scene.
    if(e.path!=='/health')limit(`${p?.id || ip}:${e.method==='get'?'reads':'writes'}`, protectedRoute ? 180 : 60);
    if (e.path === '/auth/guest') limit(`${ip}:guest`, 10);
    const body = (e.input ? e.input.parse(await c.req.json()) : {}) as C.z.infer<I>;
    let value=await e.run(c,body,p);
    const base=(process.env.MALO_PUBLIC_BASE_URL||new URL(c.req.url).origin).replace(/\/$/,'');
    const outputSchema:unknown=e.output;
    if(outputSchema===C.Session){const session=value as C.SessionValue;session.npc.render=await CharacterImages.render(base,session.characterId,session.npc.emotion,session.npc.gesture||'idle',session.npc.assetKey);session.npc.assetKey=session.npc.render.assetKey;}
    if(outputSchema===C.TurnResult){const result=value as C.z.infer<typeof C.TurnResult>;result.session.npc.render=await CharacterImages.render(base,result.session.characterId,result.session.npc.emotion,result.session.npc.gesture||'idle',result.session.npc.assetKey);result.session.npc.assetKey=result.session.npc.render.assetKey;result.turn.render=await CharacterImages.render(base,result.session.characterId,result.turn.emotion,result.turn.gesture||'idle',result.turn.render?.assetKey,result.session.status==='failed'||result.result?.ending?.id==='breakdown');result.oopsMoment.assetKey=result.turn.render.assetKey;}
    const data=e.output.parse(value);
    return c.json({ data, meta: { requestId: c.get('requestId'), apiVersion: 'v1' as const } }, 200) as never;
  });
}
function speechInput(p:Profile,session:C.SessionValue,text:string,turn?:C.TurnValue){return {recoveryStage:turn?turn.affect?.stage||null:session.affect?.stage||null,text,pack:session.pack,characterId:session.characterId,personalityId:session.personalityId,emotion:turn?.emotion||session.npc.emotion,reaction:turn?.render?.reaction||session.npc.render?.reaction,speed:p.state.settings.voiceSpeed};}
async function speechAsset(c:Context<Env>,p:Profile,input:ReturnType<typeof speechInput>){const audio=await aiRequest('/v1/speech/synthesize',input);const token=await Auth.signAudio(p.id,audio.assetId);const base=(process.env.MALO_PUBLIC_BASE_URL||new URL(c.req.url).origin).replace(/\/$/,'');return {...audio,mimeType:'audio/mpeg' as const,expiresIn:600,audioUrl:`${base}/api/v1/audio/${audio.assetId}?token=${encodeURIComponent(token)}`};}
async function voiceUrl(c:Context<Env>,p:Profile,text:string,session:C.SessionValue,turn?:C.TurnValue){try{return (await speechAsset(c,p,speechInput(p,session,text,turn))).audioUrl;}catch{return null;}}
const idParam = z.object({ id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }) });
const empty = z.object({});
const mode = z.enum(['mock', 'live']).default('live');
const text = z.string().trim().min(1).max(1200);
const clientTurnId = z.string().min(1).max(100);
const feature = z.object({ id: z.string(), name: z.string(), description: z.string() });
const preview = z.object({ previewOnly: z.literal(true), realBilling: z.literal(false), items: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), priceCoins: z.number().nullable(), assetKey: z.string().nullable() })) });

endpoint({ method: 'get', path: '/health', tag: 'System', summary: '서버 상태와 실제/모의 기능 구분', auth: false,
  output: z.object({ status: z.literal('ok'), service: z.literal('malo-backend'), version: z.string(), storage: z.string(), defaultAiMode: z.string(), googleEnabled: z.boolean(), demoAuthEnabled: z.boolean(), aiConfigured: z.boolean() }),
  run: () => ({ status: 'ok', service: 'malo-backend', version: '0.1.0', storage: dataMode(), defaultAiMode: 'live', googleEnabled: process.env.MALO_GOOGLE_ENABLED === 'true', demoAuthEnabled: process.env.MALO_ALLOW_DEMO_AUTH === 'true', aiConfigured: !!process.env.MALO_AI_URL }) });
endpoint({ method: 'get', path: '/auth/config', tag: 'Auth', summary: 'Google OAuth 준비 상태와 앱용 공개 설정', auth: false,
  output: z.object({ guestEnabled: z.boolean(), google: z.object({ enabled: z.boolean(), supabaseUrl: z.string().nullable(), publishableKey: z.string().nullable(), flow: z.string() }), demoUpgradeEnabled: z.boolean(),supabaseUrl:z.string().nullable(),publishableKey:z.string().nullable() }), run: () => {const cfg=Auth.authConfig();return {...cfg,supabaseUrl:cfg.google.supabaseUrl,publishableKey:cfg.google.publishableKey};} });
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
endpoint({ method: 'get', path: '/packs', tag: 'Catalog', summary: '현재 이용 가능한 학습 팩', auth: false, output: z.array(feature), run: () => packs.filter(pack => pack.id === 'ko') });
endpoint({ method: 'get', path: '/characters', tag: 'Catalog', summary: '4명 캐릭터와 각 3가지 성격', auth: false, output: z.array(C.Character), run: () => Content.characters() });
endpoint({method:'get',path:'/characters/{characterId}/personalities/{personalityId}/profile',tag:'Catalog',summary:'성격별 짧은 프로필 항목 — 선택 언어 번역',auth:false,
  params:z.object({characterId:z.string(),personalityId:z.string()}),query:z.object({language:C.SubtitleLanguage.optional()}),
  output:z.object({characterId:z.string(),personalityId:z.string(),personalityName:z.string(),language:C.SubtitleLanguage,revision:z.string(),profile:C.CharacterCardProfile}),
  run:async c=>{const characterId=c.req.param('characterId')!,personalityId=c.req.param('personalityId')!,language=C.SubtitleLanguage.parse(c.req.query('language')||'ko');
    const selected=await Content.persona(characterId,personalityId),profile=selected.personality.cardProfile;
    if(!profile)throw new ApiError('PROFILE_NOT_FOUND','등록된 프로필이 없어요.',404);
    const tr=language==='ko'?{}:await translations([selected.personality.name,profile.occupation,profile.age,...profile.hobbies,...profile.favoriteFoods,...profile.dislikes,...profile.currentInterests],language);
    const text=(value:string)=>language==='ko'?value:tr[value];
    return {characterId,personalityId,personalityName:text(selected.personality.name),language,revision:selected.revision||'',profile:{...profile,occupation:text(profile.occupation),age:text(profile.age),hobbies:profile.hobbies.map(text),favoriteFoods:profile.favoriteFoods.map(text),dislikes:profile.dislikes.map(text),currentInterests:profile.currentInterests.map(text)}};
  }});
endpoint({ method: 'get', path: '/chapters', tag: 'Catalog', summary: '캐릭터별 챕터·성격별 서브 챕터와 내 진행 상태',
  query: z.object({ pack: C.Pack.optional(), characterId: z.string().optional(), language:C.SubtitleLanguage.optional() }), output: z.array(C.Chapter),
  run: async (c, _, p) => {const pack=c.req.query('pack')||'ko';requireKorean(pack);return localizedChapters(await Game.chapters(p!, 'ko', c.req.query('characterId')), C.SubtitleLanguage.optional().parse(c.req.query('language')));} });
endpoint({ method: 'get', path: '/scenes', tag: 'Catalog', summary: '팩·캐릭터·성격별 장면 목록', auth: false,
  query: z.object({ pack: C.Pack.optional(), characterId: z.string().optional(), personalityId: z.string().optional() }), output: z.array(C.Scene),
  run: c => {requireKorean(c.req.query('pack')||'ko');return Content.scenes('ko', c.req.query('characterId'), c.req.query('personalityId'));} });
endpoint({ method: 'get', path: '/scenes/{sceneId}', tag: 'Catalog', summary: '장면 브리핑', auth: false,
  params: z.object({ sceneId: z.string() }), output: C.Scene, run: async c => { const s = await Content.scene(c.req.param('sceneId')!); if (!s) throw new ApiError('SCENE_NOT_FOUND', '장면을 찾지 못했어요.', 404); return { ...s, id: c.req.param('sceneId')!, nodeCount: s.nodes.length, estimatedMinutes: s.estimatedMinutes||3 }; } });
endpoint({ method: 'get', path: '/settings', tag: 'Settings', summary: '설정 조회', output: C.Settings, run: (_, __, p) => ({...p!.state.settings,pack:'ko' as const}) });
endpoint({ method: 'patch', path: '/settings', tag: 'Settings', summary: '팩·음성 속도·자막·알림 설정 저장', input: C.Settings.partial(), output: C.Settings,
  run: async (_, body, p) => {requireKorean(body.pack||'ko');return (await mutate(p!.id, user => { user.state.settings = { ...user.state.settings, ...body,pack:'ko' }; return user.state.settings; })).value;} });
endpoint({ method: 'post', path: '/sessions', tag: 'Play', summary: '장면 시작 — FE는 live 명시, 기본 교육과정 성격 선택 가능', input: z.object({ sceneId: z.string(), aiMode: mode,personalityId:z.enum(['strict','playful','calm']).optional(),subtitleLanguage:C.SubtitleLanguage.optional() }), output: C.Session,
  run: async(c,body,p)=>{if(process.env.NODE_ENV==='production'&&body.aiMode==='mock')throw new ApiError('LIVE_AI_REQUIRED','실제 학습은 실시간 AI 모드로 시작해 주세요.',422);const session=await Game.createPlay(p!.id,body.sceneId,body.aiMode,undefined,body.personalityId,body.subtitleLanguage);if(body.subtitleLanguage&&session.aiMode==='live')session.npc.audioUrl=await voiceUrl(c,p!,session.npc.text,session);return session;} });
endpoint({ method: 'get', path: '/sessions/{id}', tag: 'Play', summary: '장면 현재 상태/이어하기', params: idParam, output: C.Session, run: (c, _, p) => Game.publicPlay(Game.getPlay(p!, c.req.param('id')!)) });
endpoint({ method: 'get', path: '/sessions/{id}/history', tag: 'Play', summary: '대화 내역', params: idParam, output: z.array(C.Turn), run: (c, _, p) => Game.getPlay(p!, c.req.param('id')!).history });
endpoint({method:'post',path:'/sessions/{id}/correction',tag:'Play',summary:'사용자가 요청한 직전 답변 다시 말하기 — 기록·체력 유지',params:idParam,input:z.object({turnId:z.string().uuid()}),output:C.Session,run:(c,body,p)=>Game.correctLastTurn(p!.id,c.req.param('id')!,body.turnId)});
endpoint({ method: 'post', path: '/sessions/{id}/turns', tag: 'Play', summary: '텍스트·선택지·확인한 STT 답변 제출', params: idParam,
  description: 'clientTurnId를 재시도 시 그대로 사용. 동일 ID/내용은 같은 응답. 다른 내용은 409. 명확한 실수만 체력 -1; 애매한 답/AI 오류는 차감 없음. 텍스트·선택지는 속도/망설임 null.',
  input: z.object({ clientTurnId, inputType: z.enum(['text', 'choice', 'voice']), text: text.optional(), choiceId: z.string().optional(), transcriptId: z.string().uuid().optional(), realtime:z.boolean().default(false) }), output: C.TurnResult,
  run: async(c,body,p)=>{limit(`${p!.id}:turns`,20);let result=await Game.submitTurn(p!.id,c.req.param('id')!,body);if(result.result&&result.session.aiMode==='live'){const report=await Reports.ensure(p!.id,c.req.param('id')!).catch(()=>null);if(report)result={...result,result:{...result.result,report:{reportId:report.reportId,status:report.status}}};}if(Game.getPlay(p!,c.req.param('id')!).subtitleLanguage&&result.session.aiMode==='live'){const audioUrl=await voiceUrl(c,p!,result.turn.npcReply,result.session,result.turn);if(result.result?.ending?.dialogue)result.result.ending.dialogue.audioUrl=audioUrl;return {...result,turn:{...result.turn,audioUrl}};}return result;} });
endpoint({ method: 'post', path: '/sessions/{id}/hint', tag: 'Play', summary: '2단계 힌트 — 관찰 단서 → 가상 캐릭터의 속마음·표현 팁', params: idParam,
  description: 'step=1은 주목 표현·행동·상황 단서만 반환하며 hiddenThought/tip은 null. step=2는 속마음과 표현 팁을 추가 공개. 같은 노드·단계의 재조회는 hintsUsed를 중복 증가시키지 않음. 기존 클라이언트의 {} 요청은 step=2로 처리.',
  input: z.object({ step: z.union([z.literal(1), z.literal(2)]).default(2) }),
  output: z.object({ nodeId: z.string(), step: z.union([z.literal(1), z.literal(2)]), clue: z.array(C.Clue), hiddenThought: z.string().nullable(), tip: z.string().nullable(), isFictional: z.literal(true), session: C.Session }),
  run: async (c, body, p) => {
    const hint=await Game.revealHint(p!.id,c.req.param('id')!,body.step),lang=Game.getPlay(p!,c.req.param('id')!).subtitleLanguage;
    if(!lang||lang==='ko')return hint;
    const tr=await translations([...hint.clue.flatMap(cue=>[cue.k,cue.v]),hint.hiddenThought||'',hint.tip||''],lang);
    return {...hint,clue:hint.clue.map(cue=>({k:tr[cue.k],v:tr[cue.v]})),hiddenThought:hint.hiddenThought?tr[hint.hiddenThought]:null,tip:hint.tip?tr[hint.tip]:null};
  } });
for (const action of ['pause', 'resume', 'abandon'] as const) endpoint({ method: 'post', path: `/sessions/{id}/${action}`, tag: 'Play', summary: `${action} — 일시정지/재개/나가기`, params: idParam, input: empty, output: C.Session, run: (c, _, p) => Game.transition(p!.id, c.req.param('id')!, action) });
endpoint({ method: 'post', path: '/sessions/{id}/retry', tag: 'Play', summary: '같은 장면을 현재 선택 언어로 다시 하기', params: idParam, input: z.object({subtitleLanguage:C.SubtitleLanguage.optional()}), output: C.Session,
  run: async (c, body, p) => { const old = Game.getPlay(p!, c.req.param('id')!); const latest = await Content.scene(old.sceneId,p!.id); return Game.createPlay(p!.id, old.sceneId, old.aiMode, latest||old.scenario,old.scenario.personalityId,body.subtitleLanguage||old.subtitleLanguage); } });
endpoint({ method: 'get', path: '/sessions/{id}/result', tag: 'Play', summary: '결과·잘한 말·아쉬운 말·지급된 재화', params: idParam, output: C.Result,
  run: async(c, _, p) => { const play=Game.getPlay(p!,c.req.param('id')!);let result=play.result?{...play.result,ending:Endings.presentation(play)}:null; if (!result) throw new ApiError('RESULT_NOT_READY', '장면을 마친 후 확인할 수 있어요.', 409); if(play.aiMode==='live'){const report=await Reports.read(p!.id,play.id).catch(()=>null);if(report)result={...result,report:{reportId:report.reportId,status:report.status}};}return result; } });
endpoint({method:'get',path:'/sessions/{id}/ending',tag:'Play',summary:'완료한 대화의 엔딩 대사·이미지·정리 코멘트·선택 언어 번역',params:idParam,output:C.Ending,run:(c,_,p)=>{const play=Game.getPlay(p!,c.req.param('id')!);if(!play.result)throw new ApiError('ENDING_NOT_READY','대화를 마친 후 엔딩을 확인할 수 있어요.',409);return Endings.presentation(play);}});
endpoint({ method: 'post', path: '/sessions/{id}/speech', tag: 'Speech', summary: '현재 NPC 또는 지정한 반응 대사 TTS — 서명 URL 반환', params: idParam, input: z.object({turnId:z.string().uuid().optional()}), output: C.AudioAsset,
  run: async (c, body, p) => { limit(`${p!.id}:tts`, 20); const play = Game.getPlay(p!, c.req.param('id')!), s = Game.publicPlay(play);
    const turn=body.turnId?play.history.find(t=>t.id===body.turnId):null;if(body.turnId&&!turn)throw new ApiError('TURN_NOT_FOUND','대사를 찾지 못했어요.',404);
    return speechAsset(c,p!,speechInput(p!,s,turn?.npcReply||s.npc.text,turn||undefined)); } });

endpoint({method:'post',path:'/speech/preview',tag:'Speech',summary:'기존 데모 대사·표현 연습의 캐릭터 음성 — 학습 세션을 만들지 않음',
  input:z.object({text:z.string().trim().min(1).max(500),pack:C.Pack.default('ko'),characterId:z.enum(['girlfriend','friend','manager','professor']),personalityId:z.enum(['playful','strict','calm']).default('calm'),emotion:C.Emotion.default('neutral'),reaction:z.string().max(60).optional(),speed:z.number().min(.5).max(1.5).optional()}),output:C.AudioAsset,
  run:async(c,b,p)=>{limit(`${p!.id}:tts`,20);await Content.persona(b.characterId,b.personalityId);return speechAsset(c,p!,{...b,recoveryStage:null,reaction:b.reaction,speed:b.speed??p!.state.settings.voiceSpeed});}});

endpoint({method:'post',path:'/speech/realtime-session',tag:'Speech',summary:'녹음 중 실시간 전사용 60초 임시 자격증명',input:z.object({pack:C.Pack.default('ko')}),output:z.object({value:z.string(),expiresAt:z.number(),model:z.string(),sampleRate:z.number(),session:z.unknown(),websocketUrl:z.string()}),run:(c,b,p)=>{limit(p!.id+':realtime',2);return aiRequest('/v1/speech/realtime-session',{pack:b.pack,userId:p!.id});}});

endpoint({method:'post',path:'/sessions/{id}/report',tag:'Reports',summary:'완료한 서브챕터의 상세 보고서 생성 예약·재조회',params:idParam,query:z.object({language:C.SubtitleLanguage.optional()}),input:empty,output:ReportResource,run:(c,_,p)=>Reports.ensure(p!.id,c.req.param('id')!,true,c.req.query('language') as any)});
endpoint({method:'get',path:'/sessions/{id}/report',tag:'Reports',summary:'종합 평가와 대화별 문화 피드백 조회 — 조회 자체는 생성하지 않음',params:idParam,query:z.object({language:C.SubtitleLanguage.optional()}),output:ReportResource,run:(c,_,p)=>Reports.read(p!.id,c.req.param('id')!,c.req.query('language') as any)});
endpoint({method:'post',path:'/sessions/{id}/report/retry',tag:'Reports',summary:'실패한 상세 보고서만 다시 생성',params:idParam,query:z.object({language:C.SubtitleLanguage.optional()}),input:empty,output:ReportResource,run:(c,_,p)=>{limit(p!.id+':report-retry',3);return Reports.retry(p!.id,c.req.param('id')!,c.req.query('language') as any);}});
endpoint({method:'get',path:'/sessions/{id}/exports',tag:'Reports',summary:'내 완료 대화의 영상·PDF 준비 상태',params:idParam,query:z.object({language:C.SubtitleLanguage.default('en')}),output:z.array(Exports.ExportView),run:(c,_,p)=>Exports.list(p!.id,c.req.param('id')!,c.req.query('language')||'en')});
endpoint({method:'post',path:'/sessions/{id}/exports',tag:'Reports',summary:'전체 대화 MP4 또는 상세 보고서 PDF 만들기 — 같은 요청 재사용',params:idParam,input:Exports.ExportInput,output:Exports.ExportView,run:(c,b,p)=>{limit(p!.id+':export',6);return Exports.create(p!.id,c.req.param('id')!,b);}});
endpoint({method:'post',path:'/exports/{id}/download',tag:'Reports',summary:'내보낸 파일의 10분 유효 다운로드 링크',params:idParam,input:empty,output:z.object({url:z.string(),filename:z.string(),mimeType:z.string(),expiresIn:z.literal(600)}),run:async(c,_,p)=>{const id=c.req.param('id')!,{file}=await Exports.file(p!.id,id),token=await Auth.signExport(p!.id,id);const base=(process.env.MALO_PUBLIC_BASE_URL||new URL(c.req.url).origin).replace(/\/$/,'');return {url:`${base}/api/v1/exports/${id}/file?token=${encodeURIComponent(token)}`,filename:`malo-${id}.${file.mimeType==='video/mp4'?'mp4':'pdf'}`,mimeType:file.mimeType,expiresIn:600 as const};}});
app.get('/exports/:id/file',async c=>{
 const id=z.string().uuid().parse(c.req.param('id')),owner=await Auth.verifyExport(c.req.query('token')||'',id),{file}=await Exports.file(owner,id);
 if(!/^e_[a-f0-9]{40}\.(mp4|pdf)$/.test(file.assetId))throw new ApiError('EXPORT_NOT_FOUND','파일을 찾지 못했어요.',404);
 const headers:Record<string,string>={'X-AI-Service-Token':process.env.MALO_AI_SERVICE_TOKEN||''};if(c.req.header('Range'))headers.Range=c.req.header('Range')!;
 const response=await fetch(`${process.env.MALO_AI_URL?.replace(/\/$/,'')}/v1/exports/files/${file.assetId}`,{headers,signal:AbortSignal.timeout(180000)});
 if(![200,206,416].includes(response.status))throw new ApiError('EXPORT_UNAVAILABLE','파일을 불러오지 못했어요. 다시 시도해 주세요.',502,true);
 const out=new Headers({'Content-Type':file.mimeType,'Content-Disposition':`attachment; filename="malo-${id}.${file.mimeType==='video/mp4'?'mp4':'pdf'}"`,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
 for(const key of ['Content-Length','Content-Range','Accept-Ranges'])if(response.headers.has(key))out.set(key,response.headers.get(key)!);
 return new Response(response.body,{status:response.status,headers:out});
});
const uploadRoute = createRoute({ method: 'post', path: '/speech/transcriptions', tags: ['Speech'], summary: '녹음 → 수정 가능한 인식 결과 (제출/채점 전)', security: [{ BearerAuth: [] }],
  request: { body: { required: true, content: { 'multipart/form-data': { schema: z.object({ file: z.custom<File>(value => value instanceof File, '음성 파일이 필요해요.').openapi({ type: 'string', format: 'binary' }), pack: C.Pack.default('ko') }) } } } },
  responses: { 200: { description: '음성 인식 완료, text 수정 후 turns에 제출', content: { 'application/json': { schema: C.envelope(C.SpeechDraft) } } }, 422: { description: '인식 실패 — 체력 차감 없음', content: { 'application/json': { schema: C.ErrorBody } } } } });
app.openapi(uploadRoute, async c => { const p = await Auth.authenticate(c.req.header('Authorization')); limit(`${p.id}:stt`, 10); const form = await c.req.formData(); const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError('AUDIO_REQUIRED', '음성 파일이 필요해요.', 422);
  const pack = C.Pack.parse(form.get('pack') || p.state.settings.pack);
  const data = C.SpeechDraft.parse(await Game.transcribe(p.id, file, pack)); return c.json({ data, meta: { requestId: c.get('requestId'), apiVersion: 'v1' as const } }, 200); });
app.get('/audio/:assetId', async c => { const assetId = c.req.param('assetId'); if (!/^a_[a-f0-9]{40}$/.test(assetId)) throw new ApiError('AUDIO_NOT_FOUND', '음성 파일을 찾지 못했어요.', 404);
  await Auth.verifyAudio(c.req.query('token') || '', assetId); c.header('Content-Type', 'audio/mpeg'); c.header('Referrer-Policy', 'no-referrer'); return c.body(await audioBytes(assetId)); });
app.openAPIRegistry.registerPath({ method: 'get', path: '/audio/{assetId}', tags: ['Speech'], summary: '10분 유효 서명 링크로 음성 재생', request: { params: z.object({ assetId: z.string() }), query: z.object({ token: z.string() }) }, responses: { 200: { description: 'MP3', content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } } } } });
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
  run: async () => ({ previewOnly: true, realBilling: false, items: (await Content.characters())[0].personalities.map(p => ({ id: p.id, name: p.name, description: p.description, priceCoins: 100, assetKey: p.assetKey })) }) });
endpoint({ method: 'get', path: '/plans', tag: 'Preview', summary: '[화면용] 구독 혜택 — 실제 가격·결제 없음', output: preview,
  run: () => ({ previewOnly: true, realBilling: false, items: [{ id: 'free', name: '기본 연습', description: '준비된 캐릭터와 장면으로 연습', priceCoins: null, assetKey: null }, { id: 'plus-preview', name: 'Malo Plus 미리보기', description: '나만의 에피소드 만들기 — 해커톤에서는 기능 시연만 제공', priceCoins: null, assetKey: null }] }) });
endpoint({method:'get',path:'/assets/characters',tag:'Catalog',summary:'표정·몸짓 이미지 목록 — 미리 로드하고 render.assetKey로 전환',auth:false,output:z.object({renderMode:z.literal('image_variants'),runtimeImageApiCalls:z.literal(false),items:z.array(CharacterImages.Variant)}),run:async c=>({renderMode:'image_variants',runtimeImageApiCalls:false,items:await CharacterImages.variants((process.env.MALO_PUBLIC_BASE_URL||new URL(c.req.url).origin).replace(/\/$/,''))})});
endpoint({ method: 'get', path: '/assets/personas', tag: 'Catalog', summary: 'OpenAI로 생성·저장된 캐릭터 이미지 — 조회는 과금 없음', auth: false,
  output: z.array(z.object({ assetKey: z.string(), characterId: z.string(), emotion: C.Emotion, imageUrl: z.string().nullable(), source: z.literal('pre_generated') })),
  run: c => personaAssets(process.env.MALO_PUBLIC_BASE_URL || new URL(c.req.url).origin) });
app.get('/images/:assetId', async c => {
  const id = c.req.param('assetId');
  if (!/^i_[a-f0-9]{40}$/.test(id)) throw new ApiError('IMAGE_NOT_FOUND', '이미지를 찾지 못했어요.', 404);
  const bytes = await imageBytes(id);
  c.header('Content-Type', 'image/webp'); c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(bytes);
});
app.get('/catalog-assets/:filename',async c=>{const name=c.req.param('filename');if(!/^(char|card|bg)-[a-z]+\.png$/.test(name))throw new ApiError('IMAGE_NOT_FOUND','이미지를 찾지 못했어요.',404);try{const content=await readFile('public/assets/catalog/'+name);c.header('Content-Type','image/png');c.header('Cache-Control','public, max-age=3600');return c.body(content);}catch{throw new ApiError('IMAGE_NOT_FOUND','이미지를 찾지 못했어요.',404);}});
app.openAPIRegistry.registerPath({ method: 'get', path: '/images/{assetId}', tags: ['Catalog'], summary: '공유 캐릭터 WebP 이미지 — 영구 캐시 가능한 콘텐츠 해시 URL', request: { params: z.object({ assetId: z.string().regex(/^i_[a-f0-9]{40}$/) }) }, responses: { 200: { description: 'WebP, no generation API call', content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } } } });

endpoint({method:'post',path:'/chapter-generations',tag:'Generation',summary:'나만의 챕터 생성 예약 — 즉시 반환, 서버에서 계속 생성',input:ChapterInput,output:JobView,run:(_,body,p)=>{requireKorean(body.pack);return Generation.create(p!.id,body);}});
endpoint({method:'get',path:'/chapter-generations',tag:'Generation',summary:'내 생성 작업 목록',output:z.array(JobView),run:(_,__,p)=>Generation.jobs(p!.id)});
endpoint({method:'get',path:'/chapter-generations/{id}',tag:'Generation',summary:'내 생성 상태 — 완료 시 chapterId',params:idParam,output:JobView,run:(c,_,p)=>Generation.job(p!.id,c.req.param('id')!)});
endpoint({method:'post',path:'/chapter-generations/{id}/retry',tag:'Generation',summary:'실패한 생성을 저장한 단계부터 재시도',params:idParam,input:empty,output:JobView,run:(c,_,p)=>{limit(p!.id+':generation-retry',3);return Generation.retry(p!.id,c.req.param('id')!);}});
endpoint({method:'get',path:'/notifications/push/config',tag:'Notifications',summary:'웹 푸시 공개 설정',output:z.object({enabled:z.boolean(),publicKey:z.string().nullable()}),run:()=>Push.pushConfig()});
endpoint({method:'post',path:'/notifications/push/subscriptions',tag:'Notifications',summary:'알림 허용 후 브라우저 구독 저장',input:z.object({endpoint:z.string().url().max(4096),keys:z.object({p256dh:z.string().min(20).max(200),auth:z.string().min(10).max(100)})}),output:z.object({id:z.string()}),run:(_,b,p)=>Push.subscribe(p!.id,b)});
endpoint({method:'delete',path:'/notifications/push/subscriptions/{subscriptionId}',tag:'Notifications',summary:'내 브라우저 알림 구독 해제',params:z.object({subscriptionId:z.string().regex(/^[a-f0-9]{64}$/)}),output:z.object({removed:z.literal(true)}),run:async(c,_,p)=>{await Push.unsubscribe(c.req.param('subscriptionId')!,p!.id);return {removed:true};}});
// Internal VM worker only; the same existing service credential is never exposed to FE.
app.post('/internal/generation-worker',async c=>{const expected=process.env.MALO_AI_SERVICE_TOKEN||'',provided=c.req.header('X-AI-Service-Token')||'';if(!expected||Buffer.byteLength(expected)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(expected),Buffer.from(provided)))throw new ApiError('UNAUTHORIZED','인증이 필요해요.',401);await Push.retryNotifications();const jobs=await Promise.all([Generation.workOne(),Generation.workOne()]);return c.json({worked:jobs.some(j=>j.worked),jobs});});
export const documentConfig = { openapi: '3.1.0' as const, info: { title: 'Malo Backend API', version: '0.1.0', description: 'React Native + Expo FE용 API. 기본 Mock 채점, 선택 시 Live AI. Guest 영속 저장 및 Google 회원 이관. 상점/구독은 화면용 데이터만 제공합니다.' }, servers: [{ url: '/', description: '현재 서버' }], security: [] };
app.doc31('/openapi.json', documentConfig);
app.get('/docs', swaggerUI({ url: '/api/v1/openapi.json', persistAuthorization: false }));
