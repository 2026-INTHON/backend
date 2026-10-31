import * as Endings from './endings';
import {initialSpeechLevel} from './dialogue';
import { translations } from './translations';
import { conciseBrief } from './briefings';
import * as CharacterImages from './character-images';
import {assess} from './reaction';
import * as Content from './content';
import { createHash, randomUUID } from 'node:crypto';
import { characters, findScenario, learningSupport, listScenes, sceneSummary, type Scenario } from './catalog';
import { aiRequest, evaluate } from './ai';
import type { MetricsValue, SessionValue, TurnValue } from './contracts';
import type { Play, Profile, SavedMistake, TurnResponse } from './models';
import { ApiError } from './errors';
import { mutate, readProfile } from './store';
import { publicUser } from './auth';

export const now = () => new Date().toISOString();
export const day = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export function getPlay(p: Profile, id: string) {
  const play = p.state.plays.find(s => s.id === id);
  if (!play) throw new ApiError('SESSION_NOT_FOUND', '장면을 찾지 못했어요.', 404);
  return play;
}
export function activeNode(play:Play){
  const node=play.scenario.nodes[Math.min(play.nodeIndex,play.scenario.nodes.length-1)];
  const override=play.scenario.routes?.find(r=>r.id===play.branchId)?.overrides.find(o=>o.nodeId===node.id);
  const base=override?{...node,npcText:override.npcText,goodExample:override.goodExample,hiddenThought:override.hiddenThought}:node;
  const spoken=play.dialogue?.nodeIndex===play.nodeIndex?play.dialogue:null;
  return spoken?{...base,npcText:spoken.npcText,action:spoken.action,cues:spoken.cues}:base;
}

function nextCheckpoint(play:Play){
  if(play.nodeIndex+1>=play.scenario.nodes.length)return null;
  const next=activeNode({...play,nodeIndex:play.nodeIndex+1,dialogue:undefined});
  return {goal:next.goal,draftLine:next.npcText,routeLines:Object.fromEntries((play.scenario.routes||[]).flatMap(route=>{const override=route.overrides.find(o=>o.nodeId===next.id);return override?[[route.id,override.npcText]]:[];}))};
}
export function briefingFor(s:Scenario,id=''){return {title:s.title,partner:s.partnerName||characters.find(c=>c.id===s.characterId)?.role||s.characterId,...conciseBrief(s,id)};}
export function publicPlay(play: Play): SessionValue {
  const s = play.scenario, node = activeNode(play);
  const { action, cues } = learningSupport(s, node);
  const brief=briefingFor(s,play.sceneId);const translated=Object.values(brief).every(text=>!!play.subtitles?.[text]);
  return { id: play.id, sceneId: play.sceneId, characterId: s.characterId, personalityId: s.personalityId, pack: s.pack, aiMode: play.aiMode,
    repair:play.repair||null,
    status: play.status, lives: play.lives, initialLives: 3, nodeIndex: play.nodeIndex, nodeCount: s.nodes.length,
    briefing:{...brief,translation:translated?{language:play.subtitleLanguage||'en',title:play.subtitles![brief.title],partner:play.subtitles![brief.partner],situation:play.subtitles![brief.situation],goal:play.subtitles![brief.goal]}:null},
    npc: {speechLevel:play.speechLevel||initialSpeechLevel(s.nodes[0].npcText),gesture:play.gesture||'idle',render:null, subtitle:play.subtitles?.[node.npcText]?{language:play.subtitleLanguage||'en',text:play.subtitles[node.npcText]}:null,audioUrl:null,text: node.npcText, emotion: play.emotion, assetKey: play.imageAssetKey||`characters/${s.characterId}/${play.emotion}`, action, cues },
    chapterId:s.chapterId||null, backgroundUrl:s.backgroundUrl||null, branchId:play.branchId||null, choices: play.status === 'active'&&!play.repair ? node.choices : [], hintsUsed: play.hintsUsed, createdAt: play.createdAt, updatedAt: play.updatedAt };
}
function streak(days: string[]) {
  const dates = [...new Set(days)].sort();
  let longest = 0, run = 0, previous = 0;
  for (const date of dates) { const t = Date.parse(date); run = t - previous === 86400000 ? run + 1 : 1; longest = Math.max(longest, run); previous = t; }
  const last = dates.at(-1) || null;
  const today = Date.parse(day());
  const current = last && today - Date.parse(last) <= 86400000 ? (() => { let count = 1; for (let i = dates.length - 1; i > 0 && Date.parse(dates[i]) - Date.parse(dates[i - 1]) === 86400000; i--) count++; return count; })() : 0;
  return { current, longest, lastCheckIn: last };
}
export function wallet(p: Profile) { return { coins: p.state.coins, currency: 'MALO_COIN' as const, realMoney: false as const }; }
export async function home(p: Profile) {
  const scenes = await Content.scenes('ko');
  const resume = [...p.state.plays].reverse().find(s => s.status === 'active' || s.status === 'paused');
  const attendance = streak(p.state.attendance.days);
  const celebration = attendance.current > 0 && !p.state.attendance.acknowledged.includes(day()) ? { id: day(), days: attendance.current, message: `${attendance.current}일째 말하기 연습 중!` } : null;
  return { user: publicUser(p), wallet: wallet(p), settings: {...p.state.settings,pack:'ko' as const}, resumeSession: resume ? publicPlay(resume) : null,
    todayScene: resume ? sceneSummary(resume.scenario, resume.sceneId) : scenes[0], otherScenes: scenes, celebration };
}
export const chapters = Content.chapters;
export function records(p: Profile) {
  const turns = p.state.plays.flatMap(s => s.history);
  const byDay = new Map<string, number[]>();
  for (const turn of turns) { const d = new Date(Date.parse(turn.createdAt) + 9 * 3600000).toISOString().slice(0, 10); byDay.set(d, [...(byDay.get(d) || []), turn.feedback.tone.score]); }
  const average = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { completedScenes: p.state.plays.filter(s => s.status === 'succeeded').length, failedScenes: p.state.plays.filter(s => s.status === 'failed').length,
    totalTurns: turns.length, averageToneScore: turns.length ? average(turns.map(t => t.feedback.tone.score)) : null, toneSource: 'text_politeness' as const,
    toneTrend: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, score: average(values) })),
    frequentMistakes: ['politeness', 'clarity'].map(category => ({ category, count: p.state.mistakes.filter(m => m.category === category).length })).filter(c => c.count),
    streak: streak(p.state.attendance.days), recentSessions: [...p.state.plays].reverse().slice(0, 20).map(s => ({ sessionId: s.id, title: s.scenario.title, status: s.status, score: s.result?.score ?? null, createdAt: s.createdAt })) };
}
export async function createPlay(id: string, sceneId: string, aiMode: 'mock' | 'live', customScenario?: Scenario, personalityId?:string,subtitleLanguage?:'en'|'ja'|'zh'|'vi'|'es'|'id'|'ko') {
  let scenario = customScenario || await Content.scene(sceneId,id);
  if (!scenario) throw new ApiError('SCENE_NOT_FOUND', '장면을 찾지 못했어요.', 404);
  if(scenario.pack!=='ko')throw new ApiError('PACK_DISABLED','현재 한국어팩만 이용할 수 있어요.',422);
  if(personalityId&&scenario.source!=='personal'){
    await Content.persona(scenario.characterId,personalityId);
    // The legacy chapter represents one story; use the selected personality's script.
    if(findScenario(sceneId)){
      const variantId=`${scenario.pack}-${scenario.characterId}-${personalityId}`;
      const variant=await Content.scene(variantId,id);
      if(variant){scenario=variant;sceneId=variantId;}
    }
    scenario={...scenario,personalityId};
  }
  const actor=(await Content.characters()).find(c=>c.id===scenario!.characterId);scenario={...scenario,partnerName:actor?.name||scenario.partnerName};
  if(scenario.source==='personal'||scenario.source==='curriculum')aiMode='live';
  let subtitles:Record<string,string>={};
  if(aiMode==='live'&&subtitleLanguage){const texts=[...scenario.nodes.map(n=>n.npcText),...(scenario.routes||[]).flatMap(r=>r.overrides.map(n=>n.npcText)),...Object.values(briefingFor(scenario,sceneId)),...Endings.endingTexts(scenario)];subtitles=await translations(texts,subtitleLanguage);}
  const play: Play = { id: randomUUID(), sceneId, scenario, aiMode,subtitleLanguage,subtitles,speechLevel:initialSpeechLevel(scenario.nodes[0].npcText), status: 'active', lives: 3, nodeIndex: 0, hintsUsed: 0, emotion: 'neutral', turns: [], history: [], result: null, createdAt: now(), updatedAt: now() };
  await mutate(id, p => {
    if (p.state.plays.length >= 500) throw new ApiError('DEMO_STORAGE_LIMIT', '시연용 장면 저장 한도에 도달했어요.', 409);
    p.state.plays.push(play); p.state.settings.pack = scenario.pack;
  });
  return publicPlay(play);
}
function assertNoPending(play: Play) {
  if (play.turns.some(t => t.status === 'pending')) throw new ApiError('TURN_IN_PROGRESS', '이전 답변을 처리 중이에요.', 409, true);
}
export async function revealHint(id: string, sessionId: string, step: 1 | 2) {
  return (await mutate(id, p => {
    const play = getPlay(p, sessionId); assertNoPending(play);
    if (play.status !== 'active') throw new ApiError('SESSION_NOT_ACTIVE', '진행 중인 장면에서 사용할 수 있어요.', 409);
    const node = activeNode(play);
    const key = `${node.id}:${step}`;
    play.hintKeys ||= [];
    if (!play.hintKeys.includes(key)) { play.hintKeys.push(key); play.hintsUsed++; play.updatedAt = now(); }
    if(play.repair)return {nodeId:node.id,step,clue:[{k:'상황',v:play.repair.issue}],hiddenThought:step===2?(play.repair.kind==='apology'?'방금 말로 불편했던 부분을 먼저 풀고 싶어요.':'어떤 뜻으로 말했는지 이해하고 싶어요.'):null,tip:step===2?(play.repair.kind==='apology'?'상처 준 부분을 인정하고 사과하거나, 오해가 있었다면 차분히 설명해 보세요.':'방금 말의 뜻을 구체적으로 설명해 보세요.'):null,isFictional:true as const,session:publicPlay(play)};
    return { nodeId: node.id, step, clue: learningSupport(play.scenario, node).clue,
      hiddenThought: step === 2 ? node.hiddenThought : null, tip: step === 2 ? node.tip : null,
      isFictional: true as const, session: publicPlay(play) };
  })).value;
}
export async function transition(id: string, sessionId: string, action: 'pause' | 'resume' | 'abandon') {
  const { value } = await mutate(id, p => {
    const play = getPlay(p, sessionId); assertNoPending(play);
    if (!['active', 'paused'].includes(play.status)) throw new ApiError('SESSION_FINISHED', '이미 종료된 장면이에요.', 409);
    play.status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'abandoned'; play.updatedAt = now();
    return publicPlay(play);
  }); return value;
}
export async function correctLastTurn(id:string,sessionId:string,turnId:string){
  return (await mutate(id,p=>{
    const play=getPlay(p,sessionId);assertNoPending(play);
    if(play.status!=='active')throw new ApiError('SESSION_NOT_ACTIVE','진행 중인 대화에서 다시 말할 수 있어요.',409);
    const turn=play.history.at(-1);
    if(!turn||turn.id!==turnId)throw new ApiError('CORRECTION_STALE','가장 최근 답변만 다시 말할 수 있어요.',409);
    const index=play.scenario.nodes.findIndex(node=>node.id===turn.nodeId);
    if(index<0)throw new ApiError('CORRECTION_UNAVAILABLE','이전 버전 대화는 장면 전체를 다시 시작해 주세요.',409);
    play.nodeIndex=index;
    const prompt=turn.prompt;
    play.repair=prompt?.repair||null;
    play.dialogue=prompt?{nodeIndex:index,npcText:prompt.text,action:prompt.action,cues:prompt.cues}:undefined;
    const previous=play.history.at(-2);
    play.speechLevel=prompt?.speechLevel||previous?.npcSpeechLevel||initialSpeechLevel(play.scenario.nodes[0].npcText);
    play.emotion=previous?.emotion||'neutral';play.gesture=previous?.gesture||'idle';
    play.imageAssetKey=previous?.render?.assetKey;
    // Keep history, spent lives and mistakes; correction cannot farm rewards or erase an answer.
    play.updatedAt=now();return publicPlay(play);
  })).value;
}
function finish(p: Profile, play: Play) {
  if (play.result) return;
  const latest=[...new Map(play.history.filter(turn=>!turn.repairAction||turn.repairAction==='none').map((turn,i)=>[turn.nodeId||`legacy-${i}`,turn])).values()];
  const good = latest.filter(t => t.outcome === 'correct'), bad = play.history.filter(t => t.outcome === 'misunderstanding' && !t.native);
  const passed = play.status === 'succeeded';
  // A completed farewell can omit one redundant closing beat; it is not a missed goal.
  const goalCount=Math.max(1,passed?latest.length:play.scenario.nodes.length);
  const quality=good.reduce((sum,t)=>sum+(t.evaluation?.mark==='△'?.65:1),0);
  const rewardCoins = passed ? 30 : 5;
  play.result = { sessionId: play.id,report:null, passed, score: Math.max(0, Math.min(100, Math.round((quality / goalCount) * 100 - bad.length * 8 - play.hintsUsed * 2))),
    goodUtterances: good.filter(t=>t.evaluation?.mark!=='△').map(t => ({ text: t.text, reason: t.feedback.reason })),
    improvableUtterances: play.history.filter(t => t.outcome !== 'correct'||t.evaluation?.mark==='△').map(t => ({ text: t.text, betterExpression: t.feedback.betterExpression, reason: t.feedback.reason, mistakeId: p.state.mistakes.find(m => m.turnId === t.id)?.id || null })),
    rewardCoins, durationMs: Date.now() - Date.parse(play.createdAt), nextSceneId: play.scenario.nextSceneId ?? null, ending: Endings.presentation(play),
    achievement: {
      reach: Math.round(good.length / goalCount * 100),
      infer: Math.max(30, 100 - (play.hintKeys || []).filter(k => k.endsWith(':1')).length * 15 - ((play.hintKeys || []).filter(k => k.endsWith(':2')).length + Math.max(0, play.hintsUsed - (play.hintKeys || []).length)) * 25),
      self: Math.max(30, 100 - play.history.filter(t => t.native).length * 25 - bad.length * 15),
    } };
  p.state.coins += rewardCoins; p.state.ledger.push({ id: `result:${play.id}`, amount: rewardCoins, reason: passed ? '장면 완료' : '다시 도전 응원', createdAt: now() });
  p.state.attendance.days = [...new Set([...p.state.attendance.days, day()])].sort();
  p.state.attendance.longest = streak(p.state.attendance.days).longest;
}
export type TurnInput = { clientTurnId: string; inputType: 'text' | 'voice' | 'choice'; text?: string; choiceId?: string; transcriptId?: string; realtime?:boolean };
export async function submitTurn(id: string, sessionId: string, input: TurnInput): Promise<TurnResponse> {
  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const turnId = randomUUID();
  const reservation = await mutate(id, p => {
    const play = getPlay(p, sessionId);
    const existing = play.turns.find(t => t.clientTurnId === input.clientTurnId);
    if (existing && existing.inputHash !== inputHash) throw new ApiError('IDEMPOTENCY_CONFLICT', '같은 clientTurnId에는 같은 답변만 보낼 수 있어요.', 409);
    if (existing?.response) return { response: existing.response };
    // ponytail: A two-minute lease permits retry after a process crash; a single VM handles the demo.
    for (const t of play.turns) if (t.status === 'pending' && Date.now() - Date.parse(play.updatedAt) > 120000) t.status = 'retryable_error';
    assertNoPending(play);
    if (play.status !== 'active') throw new ApiError('SESSION_NOT_ACTIVE', '진행 중인 장면에서 답해 주세요.', 409);
    if (play.turns.length >= 100) throw new ApiError('TURN_LIMIT', '이 장면의 연습 한도에 도달했어요. 새 장면으로 시작해 주세요.', 409);
    const node = activeNode(play);
    const speech = p.state.speechDrafts.find(d => d.id === input.transcriptId && Date.parse(d.expiresAt) > Date.now());
    let text = input.text?.trim() || '';
    let metrics: MetricsValue | null = null;
    if (input.inputType === 'choice') {
      if(play.repair)throw new ApiError('CHOICE_INVALID','방금 대화에 대해 직접 설명하거나 사과해 주세요.',422);
      const choice = node.choices.find(c => c.id === input.choiceId);
      if (!choice) throw new ApiError('CHOICE_INVALID', '현재 장면의 선택지를 골라주세요.', 422);
      text = choice.text;
    } else if (input.inputType === 'voice' && !input.realtime) {
      if (!speech) throw new ApiError('TRANSCRIPT_EXPIRED', '음성 인식 결과가 만료됐어요. 다시 녹음해 주세요.', 422, true);
      text ||= speech.text; metrics = speech.metrics;
    }
    if (!text || text.length > 1200) throw new ApiError('TEXT_REQUIRED', '1~1200자의 답변을 입력해 주세요.', 422);
    if (existing) { existing.status = 'pending'; existing.id = turnId; } else play.turns.push({ id: turnId, clientTurnId: input.clientTurnId, inputHash, status: 'pending' });
    play.updatedAt = now();
    return { play: structuredClone(play), text, metrics };
  });
  if (reservation.value.response) return reservation.value.response;
  const { play, text, metrics } = reservation.value;
  try {
    const imageOptions=(await CharacterImages.variants('')).filter(i=>i.characterId===play!.scenario.characterId&&i.imageUrl).map(({assetKey,emotion,gesture,label,reaction,pose,useWhen,tags,endingPreferred})=>({assetKey,emotion,gesture,label:label||'',reaction:reaction||'',pose:pose||'',useWhen:useWhen||'',tags:tags||[],endingPreferred:endingPreferred||false}));
    const closingAllowed=play!.nodeIndex>=Math.max(1,play!.scenario.nodes.length-2);
    const grade = await evaluate(play!.scenario, activeNode(play!), text!, play!.aiMode, metrics, play!.history.map(t => ({ user: t.text, npc: t.npcReply })), play!.nodeIndex===play!.scenario.branchAt ? (play!.scenario.routes||[]).map(r=>r.id) : [], closingAllowed ? (play!.scenario.endings||[]).map(e=>e.id) : [],play!.subtitleLanguage||'en',imageOptions,play!.lives,nextCheckpoint(play!),closingAllowed,play!.speechLevel||initialSpeechLevel(play!.scenario.nodes[0].npcText),play!.repair||null);
    const assessment=assess(grade),failed=play!.lives<=1&&assessment.outcome==='misunderstanding';
    // A repaired relationship is a good response, but does not complete the paused story goal.
    if(grade.repairAction!=='none'){assessment.progression='retry';assessment.goalAchieved=false;}
    const lastSuccess=assessment.progression==='advance'&&(grade.conversationComplete||play!.nodeIndex===play!.scenario.nodes.length-1);
    const badEnding=failed||(lastSuccess&&play!.scenario.endings?.some(e=>e.id===grade.endingId&&e.kind==='bad'))||false;
    grade.emotion=CharacterImages.endingEmotion(grade.emotion,badEnding,failed);
    const selectedImage=await CharacterImages.render('',play!.scenario.characterId,grade.emotion,grade.gesture,grade.imageAssetKey,failed||(badEnding&&grade.endingId!=='deferred'));
    if(failed&&play!.scenario.pack==='ko'&&!Endings.preserveSafetyDialogue(grade.npcReply)){
      grade.npcReply=Endings.failureDialogue(play!,grade.emotion,selectedImage.reaction);
      grade.npcReplySubtitle=play!.subtitles?.[grade.npcReply]||'';
      grade.action=selectedImage.label||'감정을 드러내며 대화를 끝낸다.';
      grade.cues=[{k:'표정',v:selectedImage.label||grade.emotion},{k:'억양',v:grade.emotion==='sad'?'말끝이 떨리며 작아진다.':'짧고 날카롭게 말을 끊는다.'}];
    }
    const { value } = await mutate(id, p => {
      const current = getPlay(p, sessionId), stored = current.turns.find(t => t.id === turnId);
      if (!stored || stored.status !== 'pending' || current.nodeIndex !== play!.nodeIndex) throw new ApiError('TURN_SUPERSEDED', '장면 상태가 바뀌었어요. 다시 확인해 주세요.', 409, true);
      const outcome=assessment.outcome;
      const lifeDelta = outcome === 'misunderstanding' ? -1 : 0;
      const node = activeNode(current);
      const previous = current.history.filter(t => t.nodeId === node.id);
      const turn: TurnValue = { id: turnId, clientTurnId: input.clientTurnId, inputType: input.inputType, text: text!, outcome, confidence: grade.confidence,
        repairAction:grade.repairAction,
        npcSpeechLevel:grade.npcSpeechLevel||current.speechLevel||initialSpeechLevel(current.scenario.nodes[0].npcText),
        prompt:{repair:current.repair||null,speechLevel:current.speechLevel||initialSpeechLevel(current.scenario.nodes[0].npcText),text:node.npcText,action:node.action||'',cues:node.cues||[]},
        nodeId:node.id,mark:assessment.mark,evaluation:{...assessment,reasonSubtitle:assessment.reasonSubtitle?{language:current.subtitleLanguage||'en',text:assessment.reasonSubtitle}:null}, native: grade.native, attempt: previous.length + 1,
        comparison: previous.length ? { firstAnswer: previous[0].text, currentAnswer: text!, improved: outcome === 'correct' } : null,
        feedback: { tone: { score: grade.toneScore, label: grade.toneLabel, source: 'text_politeness' }, speed: metrics ? { value: metrics.speed, unit: metrics.speedUnit, estimated: true } : null,
          hesitation: metrics ? { pauseCount: metrics.pauseCount, fillerCount: metrics.fillerCount, estimated: true, note: '낮은 음량 구간과 추임새를 센 추정치예요. 심리 상태를 뜻하지 않아요.' } : null,
          message: grade.feedback, betterExpression: grade.betterExpression, reason: assessment.reason, views: grade.views }, gesture:grade.gesture,render:selectedImage,npcReplySubtitle:grade.npcReplySubtitle?{language:current.subtitleLanguage||'en',text:grade.npcReplySubtitle}:null,audioUrl:null,npcReply: grade.npcReply, action: grade.action, cues: grade.cues, emotion: grade.emotion,
        lifeDelta, provider: grade.provider, isMock: grade.isMock, createdAt: now() };
      current.speechLevel=turn.npcSpeechLevel;current.imageAssetKey=selectedImage.assetKey; current.history.push(turn); current.lives += lifeDelta; current.emotion = grade.emotion; current.gesture=grade.gesture; current.updatedAt = now();
      if(grade.repairAction==='resolved')current.repair=null;
      else if(grade.repairAction==='request_apology'||grade.repairAction==='request_clarification'){
        current.repair={kind:grade.repairAction==='request_apology'?'apology':'clarification',issue:(grade.repairIssue||assessment.reason).slice(0,400),triggerText:text!,resumeNpcText:current.repair?.resumeNpcText||node.npcText};
      }
      let mistakeId: string | null = null;
      if (outcome !== 'correct' && !grade.native) {
        mistakeId = randomUUID();
        p.state.mistakes.push({ id: mistakeId, sessionId, turnId, sceneTitle: current.scenario.title, original: text!, betterExpression: grade.betterExpression, reason: assessment.reason,
          category: outcome === 'misunderstanding' ? 'politeness' : 'clarity', pack: current.scenario.pack, practiceCount: 0, resolved: false, createdAt: now(), nodeIndex: current.nodeIndex, scenario: {...current.scenario,nodes:current.scenario.nodes.map((n,i)=>i===current.nodeIndex?node:n)}, practiceRequests: {} });
      }
      if (current.lives <= 0) current.status = 'failed';
      else if (assessment.progression === 'advance') { if(current.nodeIndex===current.scenario.branchAt) current.branchId=current.scenario.routes?.some(r=>r.id===grade.routeId)?grade.routeId??undefined:current.scenario.routes?.[0]?.id; if(lastSuccess)current.endingId=current.scenario.endings?.some(e=>e.id===grade.endingId)?grade.endingId??'happy':'happy'; current.nodeIndex=lastSuccess?current.scenario.nodes.length:current.nodeIndex+1; if (current.nodeIndex === current.scenario.nodes.length) current.status = 'succeeded'; }
      if(current.aiMode==='live'){
        current.dialogue={nodeIndex:current.nodeIndex,npcText:grade.npcReply,action:grade.action,cues:grade.cues};
        if(grade.npcReplySubtitle)current.subtitles={...current.subtitles,[grade.npcReply]:grade.npcReplySubtitle};
      }
      if (['succeeded', 'failed'].includes(current.status)) finish(p, current);
      const response: TurnResponse = { turn, session: publicPlay(current), result: current.result,
        oopsMoment: { triggered: lifeDelta < 0, lifeDelta, assetKey: `characters/${current.scenario.characterId}/${current.emotion}` }, mistakeId };
      stored.status = 'completed'; stored.response = response;
      return response;
    }); return value;
  } catch (error) {
    await mutate(id, p => { const t = getPlay(p, sessionId).turns.find(t => t.id === turnId); if (t?.status === 'pending') t.status = 'retryable_error'; }).catch(() => {});
    throw error;
  }
}
export function publicMistake(m: SavedMistake) { const { scenario: _, nodeIndex: __, practiceRequests: ___, ...rest } = m; return rest; }
export async function practice(id: string, mistakeId: string, input: { clientTurnId: string; text: string; aiMode: 'mock' | 'live' }) {
  const profile = await readProfile(id);
  const mistake = profile?.state.mistakes.find(m => m.id === mistakeId);
  if (!mistake) throw new ApiError('MISTAKE_NOT_FOUND', '오답을 찾지 못했어요.', 404);
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const cached = mistake.practiceRequests[input.clientTurnId] as { key: string; response: unknown } | undefined;
  if (cached) {
    if (cached.key !== key) throw new ApiError('IDEMPOTENCY_CONFLICT', '같은 ID에 다른 답변을 보낼 수 없어요.', 409);
    // Cached practice results from before this contract keep their original evaluation and state.
    const response = cached.response as { evaluation: Record<string, unknown> };
    return { ...response, evaluation: { ...learningSupport(mistake.scenario, mistake.scenario.nodes[mistake.nodeIndex]), native: false, ...response.evaluation } };
  }
  const grade = await evaluate(mistake.scenario, mistake.scenario.nodes[mistake.nodeIndex], input.text, input.aiMode);
  const { value } = await mutate(id, p => {
    const m = p.state.mistakes.find(m => m.id === mistakeId)!;
    const existing = m.practiceRequests[input.clientTurnId] as { key: string; response: unknown } | undefined;
    if (existing) { if (existing.key !== key) throw new ApiError('IDEMPOTENCY_CONFLICT', '같은 ID에 다른 답변을 보낼 수 없어요.', 409); return existing.response; }
    m.practiceCount++; m.resolved ||= grade.outcome === 'correct';
    const response = { mistake: publicMistake(m), evaluation: grade, lifeDelta: 0, rewardCoins: 0 };
    m.practiceRequests[input.clientTurnId] = { key, response }; return response;
  }); return value;
}
export async function transcribe(id: string, file: File, pack: 'ko' | 'en') {
  if (!file.size || file.size > 5 * 1024 * 1024) throw new ApiError('AUDIO_TOO_LARGE', '음성은 5MB 이하로 보내주세요.', 413);
  const form = new FormData(); form.set('file', file, file.name); form.set('pack', pack);
  const result = await aiRequest('/v1/speech/transcribe', undefined, form);
  const speech = { id: randomUUID(), text: result.text as string, metrics: result.audioMetrics as MetricsValue, expiresAt: new Date(Date.now() + 1800000).toISOString() };
  await mutate(id, p => { p.state.speechDrafts = p.state.speechDrafts.filter(d => Date.parse(d.expiresAt) > Date.now()).slice(-9); p.state.speechDrafts.push(speech); });
  return { transcriptId: speech.id, text: speech.text, audioMetrics: speech.metrics, expiresAt: speech.expiresAt, editable: true as const };
}
