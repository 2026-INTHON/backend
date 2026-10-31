import {assess} from './reaction';
import { z, Cue, Perspective, Gesture, RepairAction, type DialogueRepairValue } from './contracts';
import { characters, learningSupport, type Scenario, type SceneNode } from './catalog';
import type { MetricsValue } from './contracts';
import { ApiError } from './errors';
import { personaPrompt } from './personas';
import {initialSpeechLevel,mentionsSpeechLevel,type SpeechLevel} from './dialogue';

export const Grade = z.object({ repairAction:RepairAction.default('none'),repairIssue:z.string().max(400).default(''),npcSpeechLevel:z.enum(['polite','casual']).nullable().default(null),conversationComplete:z.boolean().default(false), outcome: z.enum(['correct', 'misunderstanding', 'clarify']), confidence: z.number().min(0).max(1), toneScore: z.number().min(0).max(100),
  imageAssetKey:z.string().nullable().default(null),evaluationMark:z.enum(['O','△','X','?']).nullable().default(null),reaction:z.enum(['happy','neutral','angry','sad','confused']).nullable().default(null),goalAchieved:z.boolean().nullable().default(null),reasonSubtitle:z.string().default(''),gesture:Gesture.default('idle'),npcReplySubtitle:z.string().default(''),routeId:z.string().nullable().optional(),endingId:z.string().nullable().optional(),
  native: z.boolean(),
  toneLabel: z.string(), feedback: z.string(), betterExpression: z.string(), reason: z.string(), npcReply: z.string(),
  action: z.string().trim().min(1).max(400), cues: z.array(Cue).min(1).max(5), views: z.array(Perspective).min(2).max(3),
  emotion: z.enum(['neutral', 'happy', 'confused', 'sad', 'angry']), provider: z.string(), isMock: z.boolean() });
export async function aiRequest(path: string, body?: unknown, form?: FormData) {
  if (!process.env.MALO_AI_URL) throw new ApiError('AI_NOT_CONFIGURED', 'AI 서버 연결 설정이 필요합니다.', 503, true);
  try {
    const response = await fetch(process.env.MALO_AI_URL.replace(/\/$/, '') + path, {
      method: 'POST', headers: { 'X-AI-Service-Token': process.env.MALO_AI_SERVICE_TOKEN || '', ...(form ? {} : { 'Content-Type': 'application/json' }) },
      body: form || JSON.stringify(body), signal: AbortSignal.timeout((path.startsWith('/v1/chapters/')||path.startsWith('/v1/reports/'))?240000:95000),
    });
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.error?.code || 'AI_UNAVAILABLE', data.error?.message || 'AI 연결에 실패했어요. 다시 시도해 주세요.', response.status, data.error?.retryable ?? true);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('AI_UNAVAILABLE', 'AI 연결에 실패했어요. 체력 차감 없이 다시 시도해 주세요.', 502, true);
  }
}
export async function evaluate(scenario: Scenario, node: SceneNode, text: string, mode: 'mock' | 'live', metrics: MetricsValue | null = null, history: { user: string; npc: string }[] = [], allowedRoutes:string[]=[], allowedEndings:string[]=[],subtitleLanguage:string='en',imageOptions:unknown[]=[],livesRemaining=3,nextCheckpoint:{goal:string;draftLine:string;routeLines:Record<string,string>}|null=null,closingAllowed=false,npcSpeechLevel:SpeechLevel=initialSpeechLevel(scenario.nodes[0].npcText),repair:DialogueRepairValue|null=null ) {
  const support = learningSupport(scenario, node);
  const allowSpeechLevelChange=mentionsSpeechLevel(text)||mentionsSpeechLevel(node.npcText);
  if (mode === 'mock') {
    const bad = text === node.choices[2]?.text || /닥쳐|멍청|꺼져|니가 알아서|몰라요|싫어요|shut up|whatever/i.test(text);
    const unclear = text === node.choices[0].text || text.length < 4 || /^(yes|no|ok|네|응|아니)[.!]?$/i.test(text);
    const native = isOtherLanguage(text, scenario.pack);
    const outcome = native ? 'clarify' : bad ? 'misunderstanding' : unclear ? 'clarify' : 'correct';
    return Grade.parse({ outcome, confidence: bad ? 0.98 : unclear ? 0.4 : 0.85, toneScore: bad ? 32 : unclear ? 55 : 92,
      toneLabel: bad ? '배려하는 표현으로 바꿔보세요' : unclear ? '조금 더 구체적으로' : '의도가 잘 전달됐어요',
      native, feedback: native ? '모국어로 먼저 답해도 괜찮아요. 아래 표현을 참고해 학습 언어로 다시 말해 보세요.' : bad ? '상대의 입장을 고려한 표현을 연습해보세요.' : unclear ? '이번 목표에 맞는 행동이나 시간을 덧붙여보세요.' : '좋아요. 의사를 구체적으로 전했어요.',
      betterExpression: node.goodExample, reason: node.tip, npcReply: scenario.pack === 'ko' ? (outcome === 'correct' ? '좋아요. 계속 이야기해 볼까요?' : '어떤 뜻인지 조금 더 설명해 줄래요?') : (outcome === 'correct' ? 'That makes sense.' : 'Could you explain a little more?'),
      action: outcome === 'correct' ? '고개를 끄덕이며 답한다.' : '고개를 살짝 기울이고 다시 묻는다.',
      cues: [{ k: '표정', v: outcome === 'correct' ? '미소를 짓는다.' : '눈썹을 살짝 올리고 상대를 바라본다.' }], views: support.views,
      emotion: bad ? 'confused' : unclear ? 'neutral' : 'happy', provider: 'mock', isMock: true });
  }
  const result = Grade.safeParse(await aiRequest('/v1/turns/evaluate', { mode, pack: scenario.pack, characterId: scenario.characterId, personalityId: scenario.personalityId,
    persona:personaPrompt(scenario.characterId,scenario.personalityId),
    situation: scenario.situation, node: { ...node, ...support }, text, history: history.slice(-12), audioMetrics: metrics,allowedRoutes:repair?[]:allowedRoutes,allowedEndings:repair?[]:allowedEndings,subtitleLanguage,imageOptions,livesRemaining,nextCheckpoint:repair?null:nextCheckpoint,closingAllowed:closingAllowed&&!repair,npcSpeechLevel,allowSpeechLevelChange,repair }));
  if (!result.success) throw new ApiError('AI_RESPONSE_INVALID', 'AI 응답을 확인하지 못했어요. 체력 차감 없이 다시 시도해 주세요.', 502, true);
  const grade = result.data;
  grade.npcSpeechLevel=allowSpeechLevelChange?(grade.npcSpeechLevel||npcSpeechLevel):npcSpeechLevel;
  // Language help is a retry, even if a provider incorrectly graded it as a clear mistake.
  grade.native=needsLanguageHelp(text,scenario.pack,grade.native);
  let assessment=assess({...grade,subtitleLanguage});
  if(repair){
    const escalated=repair.kind==='clarification'&&grade.repairAction==='request_apology'&&assessment.mark==='X';
    if(!escalated&&(grade.repairAction!=='resolved'||!['O','△'].includes(assessment.mark)||grade.confidence<.75))grade.repairAction='continue';
  }else if(['continue','resolved'].includes(grade.repairAction))grade.repairAction='none';
  if(grade.repairAction==='request_apology'&&assessment.mark!=='X')grade.repairAction='request_clarification';
  if(grade.repairAction==='none'&&assessment.mark==='?')grade.repairAction='request_clarification';
  const repairing=grade.repairAction!=='none';
  if(repairing){
    grade.goalAchieved=false;grade.routeId=null;grade.endingId=null;
    if(grade.repairAction!=='resolved'&&assessment.mark==='O'){grade.evaluationMark='△';assessment=assess({...grade,subtitleLanguage});}
  }
  grade.conversationComplete=!repairing&&grade.conversationComplete&&closingAllowed&&assessment.progression==='advance'&&!grade.native;
  if(!repairing&&assessment.progression==='advance'&&((allowedRoutes.length&&!allowedRoutes.includes(grade.routeId||''))||(allowedEndings.length&&(grade.conversationComplete||!nextCheckpoint)&&!allowedEndings.includes(grade.endingId||''))))throw new ApiError('STORY_ROUTE_INVALID','이야기 반응을 확인하지 못했어요. 체력 차감 없이 다시 시도해 주세요.',502,true);
  return {...grade,evaluationMark:assessment.mark,outcome:assessment.outcome,reason:assessment.reason,reasonSubtitle:assessment.reasonSubtitle};
}
export function needsLanguageHelp(text:string,pack:'ko'|'en',suggested:boolean){
  const letters=[...text].filter(c=>/\p{L}/u.test(c));
  const hangul=letters.filter(c=>/[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/u.test(c)).length;
  if(pack==='ko'&&letters.length&&hangul/letters.length>=.6)return false;
  return suggested||isOtherLanguage(text,pack);
}
export function isOtherLanguage(text: string, pack: 'ko' | 'en') {
  if (!/\p{L}/u.test(text)) return false;
  return pack === 'ko' ? !/[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/u.test(text) : !/[a-z]/i.test(text);
}
export async function audioBytes(assetId: string) {
  try {
    const response = await fetch(`${process.env.MALO_AI_URL}/v1/audio/${encodeURIComponent(assetId)}`, { headers: { 'X-AI-Service-Token': process.env.MALO_AI_SERVICE_TOKEN || '' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('audio');
    return new Uint8Array(await response.arrayBuffer());
  } catch { throw new ApiError('AUDIO_UNAVAILABLE', '음성을 불러오지 못했어요. 다시 재생해 주세요.', 502, true); }
}

export async function personaAssets(baseUrl: string) {
  const fallback = characters.flatMap(c => ['neutral', 'happy', 'confused', 'sad', 'angry'].map(emotion => ({
    assetKey: `characters/${c.id}/${emotion}`, characterId: c.id, emotion, imageUrl: null as string | null, source: 'pre_generated' as const,
  })));
  if (!process.env.MALO_AI_URL) return fallback;
  try {
    // Read-only catalog: never generate or charge on an app's GET request.
    const r = await fetch(`${process.env.MALO_AI_URL}/v1/persona-assets`, { headers: { 'X-AI-Service-Token': process.env.MALO_AI_SERVICE_TOKEN || '' }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return fallback;
    const data = z.object({ items: z.array(z.object({ assetKey: z.string(), assetId: z.string().regex(/^i_[a-f0-9]{40}$/).nullable() })) }).parse(await r.json());
    return fallback.map(item => { const asset = data.items.find(a => a.assetKey === item.assetKey); return { ...item, imageUrl: asset?.assetId ? `${baseUrl}/api/v1/images/${asset.assetId}` : null }; });
  } catch { return fallback; }
}

export async function imageBytes(assetId: string) {
  try {
    const r = await fetch(`${process.env.MALO_AI_URL}/v1/images/${assetId}`, { headers: { 'X-AI-Service-Token': process.env.MALO_AI_SERVICE_TOKEN || '' }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) throw new ApiError('IMAGE_NOT_FOUND', '이미지를 찾지 못했어요.', 404);
    if (!r.ok) throw new Error('image');
    return new Uint8Array(await r.arrayBuffer());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('IMAGE_UNAVAILABLE', '이미지를 불러오지 못했어요.', 502, true);
  }
}
