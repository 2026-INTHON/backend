import {createHash,randomUUID} from 'node:crypto';
import {rows,put,patchJob,retryJob} from './content-db';
import {mutate,readProfile} from './store';
import {getPlay,activeNode} from './game';
import type {Play,Profile} from './models';
import type {Job} from './generation-contracts';
import {DetailedReport,ReportDraft,ReportRequest,ReportResource} from './report-contracts';
import {aiRequest} from './ai';
import {ApiError} from './errors';
import {notifyCompleted} from './push';
import type {z} from './contracts';

type ReportJob=Omit<Job,'kind'|'request'|'checkpoint'>&{kind:'report';request:z.infer<typeof ReportRequest>;checkpoint:{reportDraft?:z.infer<typeof ReportDraft>}};
const version='report-v2-concise' as const;
type Language=NonNullable<z.infer<typeof ReportRequest>['language']>;
const key=(sessionId:string,language:Language)=>`report:${sessionId}:${version}:${language}`;
async function owner(id:string):Promise<Profile>{for(let i=0;i<3;i++){const p=await readProfile(id);if(!p)break;if(!p.mergedInto)return p;id=p.mergedInto;}throw new ApiError('USER_NOT_AVAILABLE','다시 로그인해 주세요.',401);}
function completed(p:Profile,id:string){const play=getPlay(p,id);if(!play.result)throw new ApiError('REPORT_NOT_READY','학습을 마친 후 보고서를 확인할 수 있어요.',409);return play;}
export async function ensure(ownerId:string,sessionId:string,create=true,language?:Language){
 const p=await owner(ownerId),play=completed(p,sessionId);
 const lang=language||play.subtitleLanguage||'en',saved=play.detailedReports?.[lang];
 let j=(await rows<ReportJob>('malo_generation_jobs',{request_key:key(sessionId,lang),owner_id:p.id}))[0];
 if(!j){if(!create)throw new ApiError('REPORT_NOT_FOUND','상세 보고서를 먼저 생성해 주세요.',404);const id=randomUUID(),time=new Date().toISOString(),request={sessionId,policyVersion:version,language:lang};
  try{await put('malo_generation_jobs',{id,owner_id:p.id,request_key:key(sessionId,lang),client_request_id:id,request_hash:createHash('sha256').update(key(sessionId,lang)).digest('hex'),kind:'report',status:'queued',stage:'report',request,checkpoint:{},chapter_id:null,error:null,attempts:0,worker_token:null,lease_until:null,notified_at:null,created_at:time,updated_at:time});}
  catch(error){const raced=(await rows<ReportJob>('malo_generation_jobs',{request_key:key(sessionId,lang),owner_id:p.id}))[0];if(!raced)throw error;}
  j=(await rows<ReportJob>('malo_generation_jobs',{request_key:key(sessionId,lang),owner_id:p.id}))[0];
 }
 return ReportResource.parse({reportId:j.id,status:saved?'ready':j.status,error:saved?null:j.error,report:saved||null});
}
export const read=(ownerId:string,sessionId:string,language?:Language)=>ensure(ownerId,sessionId,false,language);
export async function retry(ownerId:string,sessionId:string,language?:Language){const resource=await ensure(ownerId,sessionId,true,language);if(resource.status==='failed'){const p=await owner(ownerId);await retryJob(resource.reportId,p.id);}return ensure(ownerId,sessionId,true,language);}

function transcript(play:Play){
 let index=0;
 return play.history.map(turn=>{
  const saved=play.scenario.nodes.findIndex(node=>node.id===turn.nodeId);
  const base=activeNode({...play,nodeIndex:saved>=0?saved:index,dialogue:undefined});
  const node=turn.prompt?{...base,npcText:turn.prompt.text,action:turn.prompt.action,cues:turn.prompt.cues}:base;
  if(turn.outcome==='correct')index++;return {turn,node};
 });
}
function coachInput(play:Play,language:Language){
 return {language,context:{title:play.scenario.title,situation:play.scenario.situation,goal:play.scenario.goal,pack:play.scenario.pack,characterId:play.scenario.characterId,personalityId:play.scenario.personalityId},recordedResult:{score:play.result!.score,passed:play.result!.passed,achievement:play.result!.achievement},nodes:transcript(play).map(({turn:t,node})=>({
  nodeId:t.id,npcText:node.npcText,goal:node.goal,cues:node.cues||[],totalAttempts:1,
  attempts:[{learnerText:t.text,recordedMark:t.evaluation?.mark||null,native:t.native,feedback:t.feedback.reason,betterExpression:t.feedback.betterExpression}],
 }))};
}

function compose(play:Play,id:string,draft:z.infer<typeof ReportDraft>){
 const entries=transcript(play),counts:Record<string,number>={'O':0,'△':0,'X':0,'?':0};
 const details=entries.map(({turn:t,node})=>{
  const insight=draft.nodes.find(n=>n.nodeId===t.id)!;
  const evaluation=t.evaluation||null;const mark=evaluation?.mark||'unavailable';counts[mark]=(counts[mark]||0)+1;
  const good=evaluation?evaluation.mark==='O':t.outcome==='correct';
  return {coaching:{strengths:insight.strengths,improvements:insight.improvements,shortcomings:insight.shortcomings},turnId:t.id,nodeId:node.id,attempt:t.attempt,comparison:t.comparison,npcText:node.npcText,learnerText:t.text,native:t.native,assessmentSource:evaluation?'recorded':'legacy',legacyOutcome:t.outcome,evaluation,originalIntent:node.hiddenThought,implicitIntent:insight.implicitIntent,cues:node.cues||[],culturalContext:insight.culturalContext,feedback:t.feedback.reason,feedbackTranslation:t.evaluation?.reasonSubtitle||null,praise:good?t.feedback.message:null,alternativeExpression:good?null:t.feedback.betterExpression,practiceTip:insight.practiceTip};
 });
 const {nodes:_,language,...summary}=draft,score=play.result!.score;
 return DetailedReport.parse({id,sessionId:play.id,sceneId:play.sceneId,title:play.scenario.title,language,policyVersion:version,provisional:true,createdAt:new Date().toISOString(),overview:{passed:play.result!.passed,score,grade:score>=95?'A+':score>=85?'A':score>=75?'A-':score>=65?'B':'C',achievement:play.result!.achievement,rewardCoins:play.result!.rewardCoins,elapsedMs:play.result!.durationMs,learnerTurns:play.history.length,judgmentCounts:counts},summary,details});
}
export async function processReport(job:Job,worker:string){
 const j=job as unknown as ReportJob;
 try{
  const request=ReportRequest.parse(j.request);let p=await owner(j.owner_id!),play=completed(p,request.sessionId);
  const language=request.language||play.subtitleLanguage||'en';
  if(!play.detailedReports?.[language]){
   let draft=request.policyVersion===version?j.checkpoint.reportDraft:undefined;
   if(!draft){const input=coachInput(play,language);draft=ReportDraft.parse((await aiRequest('/v1/reports/generate',input)).report);
    if(draft.language!==input.language||draft.nodes.map(n=>n.nodeId).join('|')!==input.nodes.map(n=>n.nodeId).join('|'))throw new ApiError('REPORT_INVALID','보고서의 대화 구성을 확인하지 못했어요.',502,true);
    await patchJob(j.id,worker,{checkpoint:{reportDraft:draft},updated_at:new Date().toISOString()});
   }
   // Ownership may change during an AI call; guest migration also moves this job.
   const current=(await rows<ReportJob>('malo_generation_jobs',{id:j.id}))[0];p=await owner(current.owner_id!);
   const reportDraft=draft;
   await mutate(p.id,profile=>{const target=completed(profile,request.sessionId);target.detailedReports ||= {};target.detailedReports[language] ||= compose(target,j.id,reportDraft);});
  }
  await patchJob(j.id,worker,{status:'ready',stage:'ready',error:null,updated_at:new Date().toISOString()});
  await notifyCompleted(j.id).catch(()=>{});
  return {worked:true,id:j.id,status:'ready',kind:'report'};
 }catch(error){const e=error instanceof ApiError?error:new ApiError('REPORT_INVALID','상세 보고서를 생성하지 못했어요.',502,true);const retry=e.retryable&&j.attempts<2;
  await patchJob(j.id,worker,{status:retry?'queued':'failed',stage:retry?'retrying':'failed',error:{code:e.code,message:e.message,retryable:e.retryable},worker_token:null,lease_until:null,updated_at:new Date().toISOString()});
  return {worked:true,id:j.id,status:retry?'queued':'failed',code:e.code,kind:'report'};
 }
}
