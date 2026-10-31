import { createHash, randomUUID } from 'node:crypto';
import { aiRequest } from './ai';
import { rows, put, claimJob, patchJob, publishChapter, retryJob } from './content-db';
import { persona, curriculum, type CatalogChapter } from './content';
import { ChapterInput, Outline, Lesson, type ChapterRequest, type Job } from './generation-contracts';
import type { Scenario } from './catalog';
import { ApiError } from './errors';
import { notifyCompleted } from './push';

const now=()=>new Date().toISOString();
const fingerprint=(request:ChapterRequest)=>{const {persona:_,...input}=request;return createHash('sha256').update(JSON.stringify(input)).digest('hex');};
export const jobView=(j:Job)=>({id:j.id,label:j.checkpoint.outline?.title||j.request.prompt.slice(0,60),characterId:j.request.characterId,personalityId:j.request.personalityId,status:j.status,stage:j.stage,chapterId:j.chapter_id,error:j.error,createdAt:j.created_at,updatedAt:j.updated_at});
export async function jobs(owner:string){return (await rows<Job>('malo_generation_jobs',{owner_id:owner},'created_at.desc')).map(jobView);}
export async function job(owner:string,id:string){const j=(await rows<Job>('malo_generation_jobs',{id,owner_id:owner}))[0];if(!j)throw new ApiError('JOB_NOT_FOUND','생성 작업을 찾지 못했어요.',404);return jobView(j);}
export async function retry(owner:string,id:string){const j=(await rows<Job>('malo_generation_jobs',{id,owner_id:owner}))[0];if(!j)throw new ApiError('JOB_NOT_FOUND','생성 작업을 찾지 못했어요.',404);if(j.error?.code==='CONTENT_NOT_ALLOWED')throw new ApiError('CONTENT_NOT_ALLOWED','내용을 수정해 새로 생성해 주세요.',422);if(j.status==='failed')await retryJob(id,owner);return job(owner,id);}
async function enqueue(owner:string|null,request:ChapterRequest) {
  const hash=fingerprint(request);
  const filters:Record<string,string>=owner?{owner_id:owner,client_request_id:request.clientRequestId}:{request_key:'catalog:'+request.catalogId};
  const existing=(await rows<Job>('malo_generation_jobs',filters))[0];
  if(existing){if(fingerprint(existing.request)!==hash)throw new ApiError('IDEMPOTENCY_CONFLICT','같은 요청 ID에는 같은 내용만 보낼 수 있어요.',409);return jobView(existing);}
  if(owner){const mine=await rows<Job>('malo_generation_jobs',{owner_id:owner});if(mine.filter(j=>['running','queued'].includes(j.status)).length>=3||mine.filter(j=>j.created_at.slice(0,10)===now().slice(0,10)).length>=5)throw new ApiError('GENERATION_LIMIT','시연용 생성 한도에 도달했어요. 진행 중인 작업을 확인해 주세요.',429);}
  const id=randomUUID(),time=now();
  try {await put('malo_generation_jobs',{id,owner_id:owner,request_key:owner?`${owner}:${request.clientRequestId}`:'catalog:'+request.catalogId,client_request_id:request.clientRequestId,request_hash:hash,kind:owner?'personal':'catalog',status:'queued',stage:'queued',request,checkpoint:{},chapter_id:null,error:null,attempts:0,worker_token:null,lease_until:null,notified_at:null,created_at:time,updated_at:time});}
  catch(error){const raced=(await rows<Job>('malo_generation_jobs',filters))[0];if(raced&&fingerprint(raced.request)===hash)return jobView(raced);throw error;}
  return job(owner||'',id).catch(async()=>jobView((await rows<Job>('malo_generation_jobs',{id}))[0]));
}
export async function create(owner:string,input:unknown){const body=ChapterInput.parse(input);return enqueue(owner,{...body,persona:await persona(body.characterId,body.personalityId)});}
export async function enqueueCurriculum(){const out=[];for(const c of curriculum){
  const request:ChapterRequest={clientRequestId:'00000000-0000-4000-8000-'+createHash('sha256').update(c.id).digest('hex').slice(0,12),catalogId:c.id,characterId:c.characterId,personalityId:'calm',pack:'ko',lessonCount:4,
    prompt:`${c.title}. 제시한 교육과정과 순서를 유지. 한국어 학습 시뮬레이션이며 카카오톡·이메일을 실제 전송하지 않음.`,persona:await persona(c.characterId,'calm'),topics:c.topics.map(([title,goal])=>({title,goal,situation:`${c.title}: ${goal}`}))};
  out.push(await enqueue(null,request));
}return out;}

// One provider step per claim: persisted checkpoints survive page closure and process restart.
export async function workOne(){
  const worker=randomUUID(),j=await claimJob(worker);if(!j)return {worked:false};
  const cp=j.checkpoint;
  const {clientRequestId:_,catalogId:__,...request}=j.request;
  try{
    if(!cp.outline){const r=await aiRequest('/v1/chapters/outline',request);cp.outline=Outline.parse(r.outline);if(cp.outline.lessons.length!==j.request.lessonCount)throw new ApiError('OUTLINE_INVALID','챕터 구성을 확인하지 못했어요.',502,true);}
    else if((cp.lessons?.length||0)<j.request.lessonCount){const r=await aiRequest('/v1/chapters/lesson',{request,outline:cp.outline,index:cp.lessons?.length||0});(cp.lessons??=[]).push(Lesson.parse(r.lesson));}
    else if(!cp.backgroundUrl){const curated:Record<string,string>={'gf-1':'commonroom','gf-2':'study','prof-2':'office','prof-3':'office'};const existing=curated[j.request.catalogId||'']||cp.outline.existingBackground;cp.backgroundUrl=existing==='new'?`/api/v1/images/${(await aiRequest('/v1/chapters/background',{description:cp.outline.background})).assetId}`:`/api/v1/catalog-assets/bg-${existing}.png`;}
    else {
      const chapterId=j.request.catalogId||j.id;
      const scenarios:Record<string,Scenario>={};
      cp.lessons!.forEach((lesson,i)=>{const id=`${chapterId}-${i+1}`;scenarios[id]={...lesson,pack:j.request.pack,characterId:j.request.characterId,personalityId:j.request.personalityId,chapterId,backgroundUrl:cp.backgroundUrl,estimatedMinutes:5,source:j.kind==='catalog'?'curriculum':'personal',branchAt:2,nextSceneId:i<cp.lessons!.length-1?`${chapterId}-${i+2}`:null};});
      const source=curriculum.find(c=>c.id===j.request.catalogId);
      const chapter:CatalogChapter={id:chapterId,no:source?.no||1,displayLabel:source?.id.endsWith('-n')?'CH N':source?`CH ${source.no}`:'나만의 챕터',characterId:j.request.characterId,title:source?.title||cp.outline.title,desc:cp.outline.summary,pack:j.request.pack,source:j.kind==='catalog'?'curriculum':'personal',generationStatus:'ready',locked:false,
        subs:cp.lessons!.map((lesson,i)=>({id:`${chapterId}-${i+1}`,title:source?.topics[i]?.[0]||lesson.title,sceneId:`${chapterId}-${i+1}`,personalityId:j.request.personalityId,state:'open',score:null,availability:'ready'}))};
      await publishChapter(j.id,worker,chapterId,{chapter,scenarios});
      await notifyCompleted(j.id).catch(()=>{});
      return {worked:true,id:j.id,status:'ready'};
    }
    await patchJob(j.id,worker,{checkpoint:cp,status:'queued',stage:!cp.outline?'outline':(cp.lessons?.length||0)<j.request.lessonCount?`lessons:${cp.lessons?.length||0}/${j.request.lessonCount}`:!cp.backgroundUrl?'background':'publishing',attempts:0,worker_token:null,lease_until:null,updated_at:now()});
    return {worked:true,id:j.id,status:'queued'};
  }catch(error){const e=error instanceof ApiError?error:new ApiError('GENERATION_INVALID','생성 결과를 확인하지 못했어요.',502,true);const retry=e.retryable&&j.attempts<2;
    await patchJob(j.id,worker,{status:retry?'queued':'failed',stage:retry?'retrying':'failed',error:{code:e.code,message:e.message,retryable:e.retryable},worker_token:null,lease_until:null,updated_at:now()});
    if(!retry&&j.request.catalogId){const row=(await rows<{document:CatalogChapter}>('malo_catalog',{id:j.request.catalogId}))[0];if(row)await put('malo_catalog',{id:j.request.catalogId,kind:'chapter',document:{...row.document,generationStatus:'failed'},updated_at:now()},true);}
    return {worked:true,id:j.id,status:retry?'queued':'failed',code:e.code};
  }
}
