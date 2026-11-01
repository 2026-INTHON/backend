import {createHash,randomUUID} from 'node:crypto';
import {z,SubtitleLanguage} from './contracts';
import {aiRequest} from './ai';
import {rows,put,patchJob,retryJob} from './content-db';
import {readProfile} from './store';
import {getPlay} from './game';
import * as Reports from './reports';
import * as Images from './character-images';
import {translations} from './translations';
import {notifyCompleted} from './push';
import {ApiError} from './errors';
import type {Job} from './generation-contracts';
import type {Play} from './models';

export const ExportInput=z.object({format:z.enum(['video','pdf']),language:SubtitleLanguage.default('en'),retry:z.boolean().default(false)});
export const ExportView=z.object({id:z.string().uuid(),format:z.enum(['video','pdf']),language:SubtitleLanguage,status:z.enum(['queued','running','ready','failed']),stage:z.string(),error:z.object({code:z.string(),message:z.string(),retryable:z.boolean()}).nullable(),bytes:z.number().nullable(),durationSeconds:z.number().nullable()});
type Request={sessionId:string;exportFormat:'video'|'pdf';language:z.infer<typeof SubtitleLanguage>};
type Frame={speaker:'npc'|'learner'|'score';name:string;text:string;subtitle:string;imageUrl:string|null;mark:string;lives:number;progress:string;emotion:string;action?:string;cues?:string[];audioAssetId?:string;speech?:Record<string,unknown>};
type Payload={exportId:string;format:'video'|'pdf';title:string;subtitle:string;backgroundUrl:string|null;frames:Frame[];sections:{title:string;lines:string[]}[]};
type ExportJob=Omit<Job,'request'|'checkpoint'>&{request:Request;checkpoint:{payload?:Payload;audioIndex?:number;file?:{assetId:string;mimeType:string;bytes:number;durationSeconds?:number|null}}};
const now=()=>new Date().toISOString();
const view=(j:ExportJob)=>ExportView.parse({id:j.id,format:j.request.exportFormat,language:j.request.language,status:j.status,stage:j.stage,error:j.error,bytes:j.checkpoint.file?.bytes??null,durationSeconds:j.checkpoint.file?.durationSeconds??null});
const copy={
 ko:{me:'나',score:'점수',reach:'의도 전달',infer:'힌트 없이 답하기',self:'표현 도움 없이 답하기',strengths:'잘한 점',improvements:'개선할 점',shortcomings:'아쉬운 점',culture:'문화 팁',details:'대화',partner:'상대',intent:'상대의 의도',example:'추천 표현',review:'대화 다시 보기',empty:'추가로 짚을 내용이 없어요.'},
 en:{me:'You',score:'Score',reach:'Intent conveyed',infer:'Without hints',self:'Without expression help',strengths:'What went well',improvements:'How to improve',shortcomings:'What was missing',culture:'Culture tips',details:'Exchange',partner:'Partner',intent:'Intended meaning',example:'Suggested expression',review:'Conversation replay',empty:'Nothing to add here.'},
 ja:{me:'あなた',score:'スコア',reach:'意図の伝達',infer:'ヒントなしで返答',self:'表現の補助なしで返答',strengths:'よかった点',improvements:'改善のヒント',shortcomings:'惜しかった点',culture:'文化のヒント',details:'会話',partner:'相手',intent:'相手の意図',example:'表現例',review:'会話の振り返り',empty:'追加のコメントはありません。'},
 zh:{me:'你',score:'得分',reach:'意图传达',infer:'不使用提示回答',self:'不借助表达帮助回答',strengths:'做得好的地方',improvements:'改进建议',shortcomings:'不足之处',culture:'文化提示',details:'对话',partner:'对方',intent:'对方的意图',example:'推荐表达',review:'对话回顾',empty:'暂无其他补充。'},
};
async function owned(owner:string,sessionId:string){const profile=await readProfile(owner);if(!profile)throw new ApiError('SESSION_NOT_FOUND','대화를 찾지 못했어요.',404);const play=getPlay(profile,sessionId);if(!play.result||!['succeeded','failed'].includes(play.status))throw new ApiError('EXPORT_NOT_READY','대화가 끝난 뒤 내보낼 수 있어요.',409);return {profile,play};}
export async function list(owner:string,sessionId:string,language:string){await owned(owner,sessionId);return (await rows<ExportJob>('malo_generation_jobs',{owner_id:owner,kind:'report'})).filter(j=>j.request.sessionId===sessionId&&j.request.exportFormat&&j.request.language===language).map(view);}
export async function create(owner:string,sessionId:string,input:z.infer<typeof ExportInput>){
 await owned(owner,sessionId);
 if(input.format==='pdf')await Reports.retry(owner,sessionId,input.language);
 const requestKey=`export-v1:${sessionId}:${input.language}:${input.format}`;
 const existing=(await rows<ExportJob>('malo_generation_jobs',{owner_id:owner,request_key:requestKey}))[0];
 if(existing){if(input.retry&&existing.status==='failed'){await retryJob(existing.id,owner);return view({...existing,status:'queued',stage:'retrying',error:null});}return view(existing);}
 const mine=(await rows<ExportJob>('malo_generation_jobs',{owner_id:owner,kind:'report'})).filter(j=>!!j.request.exportFormat);
 if(mine.filter(j=>['queued','running'].includes(j.status)).length>=2)throw new ApiError('EXPORT_BUSY','진행 중인 내보내기가 끝난 뒤 다시 시도해 주세요.',429,true);
 const id=randomUUID(),time=now();
 try{await put('malo_generation_jobs',{id,owner_id:owner,kind:'report',request_key:requestKey,client_request_id:id,request_hash:createHash('sha256').update(requestKey).digest('hex'),status:'queued',stage:'preparing',request:{sessionId,exportFormat:input.format,language:input.language},checkpoint:{},chapter_id:null,error:null,attempts:0,worker_token:null,lease_until:null,notified_at:null,created_at:time,updated_at:time});}
 catch(error){const raced=(await rows<ExportJob>('malo_generation_jobs',{owner_id:owner,request_key:requestKey}))[0];if(raced)return view(raced);throw error;}
 return view((await rows<ExportJob>('malo_generation_jobs',{id,owner_id:owner}))[0]);
}
export async function file(owner:string,id:string){const j=(await rows<ExportJob>('malo_generation_jobs',{id,owner_id:owner,kind:'report'}))[0];if(!j?.request.exportFormat)throw new ApiError('EXPORT_NOT_FOUND','내보내기를 찾지 못했어요.',404);if(j.status!=='ready'||!j.checkpoint.file)throw new ApiError('EXPORT_NOT_READY','아직 파일을 만드는 중이에요.',409);return {job:j,file:j.checkpoint.file};}
async function payload(j:ExportJob,play:Play,speed:number):Promise<Payload>{
 const lang=j.request.language,c=copy[lang as keyof typeof copy]||copy.en;
 const sameLanguage=play.subtitleLanguage===lang;
 let title=lang==='ko'?play.scenario.title:sameLanguage?play.subtitles?.[play.scenario.title]||'':'';
 const result=play.result!,score=`${c.score} ${result.score}/100`,a=result.achievement;
 const summary=[score,...(a?[`${c.reach} ${a.reach}%`,`${c.infer} ${a.infer}%`,`${c.self} ${a.self}%`]:[])];
 const frames:Frame[]=[],sections:Payload['sections']=[];
 if(j.request.exportFormat==='pdf'){
  const r=play.detailedReports?.[lang];if(!r)throw new ApiError('REPORT_NOT_READY','상세 보고서를 먼저 완성해 주세요.',409,true);
  sections.push({title:r.summary.headline,lines:[...summary,r.summary.overallFeedback]});
  for(const key of ['strengths','improvements','shortcomings'] as const)sections.push({title:c[key],lines:r.summary[key]?.length?r.summary[key]:[c.empty]});
  sections.push({title:c.culture,lines:r.summary.culturalTakeaways.length?r.summary.culturalTakeaways:[c.empty]});
  r.details.forEach((d,i)=>{
   sections.push({title:`${c.details} ${i+1} · ${d.evaluation?.mark||''}`,lines:[`${c.partner}: ${d.npcText}`,`${c.me}: ${d.learnerText}`,lang==='ko'?d.feedback:d.evaluation?.reasonSubtitle?.language===lang?d.evaluation.reasonSubtitle.text:d.feedbackTranslation?.language===lang?d.feedbackTranslation.text:''].filter(Boolean)});
   sections.push({title:c.intent,lines:[d.implicitIntent]});
   for(const key of ['strengths','improvements','shortcomings'] as const)if(d.coaching?.[key]?.length)sections.push({title:c[key],lines:d.coaching[key]});
   if(d.alternativeExpression)sections.push({title:c.example,lines:[d.alternativeExpression]});
   sections.push({title:c.culture,lines:[d.culturalContext]});
  });
 }else{
  let current=await Images.render('',play.scenario.characterId,'neutral','idle'),lastNpc='',lives=3;
  const name=play.scenario.partnerName||play.scenario.characterId;
  const addNpc=(text:string,subtitle:string,emotion:string,stage:string|null,mark='',progress='')=>{
   frames.push({speaker:'npc',name,text,subtitle,imageUrl:current.imageUrl,mark,lives,progress,emotion,speech:{text,pack:play.scenario.pack,characterId:play.scenario.characterId,personalityId:play.scenario.personalityId,emotion,recoveryStage:stage,reaction:current.reaction||null,speed}});lastNpc=text;
  };
  for(const [i,t] of play.history.entries()){
   const prompt=t.prompt?.text||play.scenario.nodes.find(n=>n.id===t.nodeId)?.npcText||'';
   if(prompt&&prompt!==lastNpc){addNpc(prompt,sameLanguage?play.subtitles?.[prompt]||'':'',current.emotion,t.prompt?.affect?.stage||null,'',`${i+1}/${play.history.length}`);frames.at(-1)!.action=t.prompt?.action;frames.at(-1)!.cues=t.prompt?.cues?.map(c=>`${c.k} · ${c.v}`);}
   frames.push({speaker:'learner',name:c.me,text:t.text,subtitle:'',imageUrl:current.imageUrl,mark:t.evaluation?.mark||'',lives,progress:`${i+1}/${play.history.length}`,emotion:current.emotion});
   lives=Math.max(0,lives+t.lifeDelta);
   current=t.render?.imageUrl?t.render:await Images.render('',play.scenario.characterId,t.emotion,t.gesture||'idle');
   addNpc(t.npcReply,t.npcReplySubtitle?.language===lang?t.npcReplySubtitle.text:sameLanguage?play.subtitles?.[t.npcReply]||'':'',t.emotion,t.affect?.stage||null,t.evaluation?.mark||'',`${i+1}/${play.history.length}`);
   frames.at(-1)!.action=t.action;frames.at(-1)!.cues=t.cues?.map(c=>`${c.k} · ${c.v}`);
  }
  frames.push({speaker:'score',name:'Malo',text:summary.join('\n\n'),subtitle:result.ending?.recap?.translation?.language===lang?result.ending.recap.translation.comment:lang==='ko'?result.ending?.recap?.comment||'':'',imageUrl:current.imageUrl,mark:'',lives,progress:'',emotion:current.emotion});
 }
 const missing=frames.filter(f=>f.speaker==='npc'&&!f.subtitle);
 if(lang!=='ko'){
  const tr=await translations([...(title?[]:[play.scenario.title]),...missing.map(f=>f.text)],lang);
  title ||= tr[play.scenario.title];for(const f of missing)f.subtitle=tr[f.text]||'';
 }else for(const f of frames)if(f.speaker==='npc')f.subtitle='';
 // Match the app's default scene background for sessions created before catalog backgrounds.
 const place=play.scenario.characterId==='girlfriend'?'cafe':play.scenario.characterId==='manager'?'office':'street';
 return {exportId:j.id,format:j.request.exportFormat,title,subtitle:c.review,backgroundUrl:play.scenario.backgroundUrl||`/api/v1/catalog-assets/bg-${place}.png`,frames,sections};
}
export async function processExport(raw:Job,worker:string){
 const j=raw as unknown as ExportJob;
 try{
  const {profile,play}=await owned(j.owner_id!,j.request.sessionId),cp=j.checkpoint;
  if(j.request.exportFormat==='pdf'&&!play.detailedReports?.[j.request.language]){
   const report=await Reports.read(j.owner_id!,j.request.sessionId,j.request.language);
   if(report.status==='failed')throw new ApiError('REPORT_FAILED','상세 보고서를 다시 만든 후 내보내 주세요.',409,false);
   await patchJob(j.id,worker,{status:'queued',stage:'waiting_report',attempts:0,worker_token:null,lease_until:null,updated_at:now()});return {worked:true,id:j.id,status:'queued',kind:'export'};
  }
  cp.payload ||= await payload(j,play,profile.state.settings.voiceSpeed);
  const speechFrames=cp.payload.frames.filter(f=>f.speech);const index=cp.audioIndex||0;
  if(index<speechFrames.length){
   // Cached speech is cheap: do not spend a worker timer interval on every sentence.
   // Bound each batch and checkpoint each asset; a slow provider still yields its slot.
   const started=Date.now();
   for(let i=index;i<Math.min(index+8,speechFrames.length);i++){
    if(i>index&&Date.now()-started>=20000)break;
    const audio=await aiRequest('/v1/speech/synthesize',speechFrames[i].speech);speechFrames[i].audioAssetId=audio.assetId;cp.audioIndex=i+1;
    if(!await patchJob(j.id,worker,{checkpoint:cp,stage:`audio:${cp.audioIndex}/${speechFrames.length}`,updated_at:now()}))throw new ApiError('EXPORT_LEASE_LOST','내보내기 작업이 다른 곳에서 이어지고 있어요.',409,false);
   }
   await patchJob(j.id,worker,{checkpoint:cp,status:'queued',stage:`audio:${cp.audioIndex}/${speechFrames.length}`,attempts:0,worker_token:null,lease_until:null,updated_at:now()});
   return {worked:true,id:j.id,status:'queued',kind:'export'};
  }
  await patchJob(j.id,worker,{stage:'rendering',checkpoint:cp});
  cp.file=await aiRequest('/v1/exports/render',{...cp.payload,frames:cp.payload.frames.map(({speech:_,...frame})=>frame)});
  await patchJob(j.id,worker,{status:'ready',stage:'ready',checkpoint:cp,error:null,updated_at:now()});await notifyCompleted(j.id).catch(()=>{});
  return {worked:true,id:j.id,status:'ready',kind:'export'};
 }catch(error){const e=error instanceof ApiError?error:new ApiError('EXPORT_FAILED','내보내기에 실패했어요. 다시 시도해 주세요.',502,true);const retry=e.retryable&&j.attempts<2;
  await patchJob(j.id,worker,{status:retry?'queued':'failed',stage:retry?'retrying':'failed',checkpoint:j.checkpoint,error:{code:e.code,message:e.message,retryable:e.retryable},worker_token:null,lease_until:null,updated_at:now()});return {worked:true,id:j.id,status:retry?'queued':'failed',kind:'export'};
 }
}
