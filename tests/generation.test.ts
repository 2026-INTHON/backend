import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {app} from '../src/app';
import {workOne} from '../src/generation';
import {rows,put} from '../src/content-db';
import {mergeProfiles} from '../src/store';
import {buildScenario} from '../src/catalog';

before(()=>{process.env.MALO_DB_PATH=':memory:';process.env.MALO_DATA_MODE='sqlite';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';process.env.MALO_AI_URL='http://ai.test';});
async function api(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}
const topic={title:'인사',goal:'정중한 자기소개',situation:'교수님과 첫 만남'};
const outline={title:'교수님 만나기',summary:'처음 만나는 교수님께 인사',continuity:'성인 유학생의 첫 면담',background:'대학 연구실',existingBackground:'office',lessons:[topic,topic]};
function lesson(){const seed=buildScenario('professor','calm','ko');const nodes=Array.from({length:8},(_,i)=>({...seed.nodes[i%3],id:'n'+i,nextNodeId:i<7?'n'+(i+1):null}));return {title:topic.title,situation:topic.situation,goal:topic.goal,nodes,routes:['direct','considerate'].map(id=>({id,label:id,overrides:nodes.slice(3,6).map(n=>({nodeId:n.id,npcText:'고려 경로 대사',goodExample:n.goodExample,hiddenThought:n.hiddenThought}))})),endings:['happy','deferred','breakdown'].map(id=>({id,kind:id==='happy'?'happy':'bad',title:id,text:'대화를 마쳤습니다.'}))};}

test('Durable generation resumes checkpoints, migrates ownership, publishes only ready content and routes live turns',async()=>{
 const a=(await api('/auth/guest',{})).data,b=(await api('/auth/guest',{})).data;
 const input={clientRequestId:randomUUID(),prompt:'교수님께 정중하게 과제 연장을 부탁하고 싶어요.',characterId:'professor',personalityId:'calm',lessonCount:2};
 const job=(await api('/chapter-generations',input,a.accessToken)).data;
 assert.equal(job.status,'queued');assert.equal((await api('/chapter-generations',input,a.accessToken)).data.id,job.id);
 assert.equal((await api('/chapter-generations',{...input,prompt:'다른 내용'},a.accessToken)).status,409);
 assert.equal((await api('/chapter-generations/'+job.id,undefined,b.accessToken)).status,404);
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{const path=String(url);if(path.endsWith('/outline'))return Response.json({outline});if(path.endsWith('/lesson'))return Response.json({lesson:lesson()});if(path.endsWith('/v1/reports/generate')){const input=JSON.parse(init!.body as string);return Response.json({report:{language:input.language,headline:'대화 목표를 달성했어요',overallFeedback:'필요한 의도를 전했어요.',strengths:['상대 의사를 존중했어요.'],improvements:['시간을 더 구체적으로 말해 보세요.'],culturalTakeaways:['관계에 맞는 높임 표현을 사용해요.'],nextPractice:['확인 질문을 연습해요.'],nodes:input.nodes.map((n:{nodeId:string})=>({nodeId:n.nodeId,implicitIntent:'구체적인 의도를 확인하려 해요.',culturalContext:'교수님께는 상황에 맞게 높임 표현을 사용해요. 개인마다 선호는 달라요.',practiceTip:'구체적인 시간을 덧붙여 보세요.'}))}});}if(path.endsWith('/evaluate'))return Response.json({reaction:'neutral',goalAchieved:true,outcome:'correct',confidence:.99,toneScore:95,native:false,toneLabel:'정중해요',feedback:'의도가 전달됐어요.',betterExpression:'확인해 주셔서 감사합니다.',reason:'상대 의사를 존중했어요.',npcReply:'연장은 어렵지만 다음 과제를 준비해 보세요.',action:'고개를 끄덕인다.',cues:[{k:'표정',v:'차분하다.'}],views:[{who:'교수님',meaning:'감사합니다.',cue:'정중한 말투'},{who:'친구',meaning:'고마워.',cue:'편한 말투'}],emotion:'neutral',provider:'live-test',isMock:false,routeId:'considerate',endingId:'deferred'});throw new Error('Unexpected provider call');};
 try{
  await workOne();await workOne();
  assert.equal((await rows('malo_user_chapters',{owner_id:a.user.id})).length,0);
  await mergeProfiles(a.user.id,b.user.id);
  for(let i=0;i<4;i++)await workOne();
  assert.equal((await api('/chapter-generations/'+job.id,undefined,b.accessToken)).data.status,'ready');
  assert.equal((await rows('malo_user_chapters',{owner_id:a.user.id})).length,0);
  const privateScene=job.id+'-1';
  const c=(await api('/auth/guest',{})).data;
  assert.equal((await api('/sessions',{sceneId:privateScene},c.accessToken)).status,404);
  const play=(await api('/sessions',{sceneId:privateScene,aiMode:'mock'},b.accessToken)).data;assert.equal(play.aiMode,'live');
  let last;
  for(let i=0;i<8;i++){last=await api('/sessions/'+play.id+'/turns',{clientTurnId:'t'+i,inputType:'text',text:'교수님, 정중히 부탁드립니다.'},b.accessToken);assert.equal(last.status,200);if(i===3){assert.equal(last.data.session.branchId,'considerate');assert.equal(last.data.session.npc.text,last.data.turn.npcReply);assert.notEqual(last.data.session.npc.text,'고려 경로 대사');}}
  assert.equal(last!.data.result.passed,true);assert.equal(last!.data.result.ending.id,'deferred');assert.equal(last!.data.result.nextSceneId,job.id+'-2');
  assert.equal(last!.data.turn.isMock,false);assert.equal(last!.data.turn.evaluation.mark,'△');assert.equal(last!.data.turn.mark,'△');assert.equal(last!.data.result.score,65);
  assert.equal(last!.data.result.report.status,'queued');await workOne();
  const report=(await api('/sessions/'+play.id+'/report',undefined,b.accessToken)).data;assert.equal(report.status,'ready');assert.equal(report.report.details.length,8);assert.equal(report.report.overview.score,65);assert.equal(report.report.details[0].learnerText,'교수님, 정중히 부탁드립니다.');assert.ok(report.report.details[0].alternativeExpression);
  assert.equal((await api('/sessions/'+play.id+'/report',undefined,c.accessToken)).status,404);
 }finally{globalThis.fetch=realFetch;}
});
test('DB character data is the read source and push endpoints reject private-network targets',async()=>{
 const token=(await api('/auth/guest',{})).data.accessToken;
 const row=(await rows<{id:string;kind:string;document:Record<string,unknown>}>('malo_catalog',{id:'friend'}))[0];
 await put('malo_catalog',{...row,document:{...row.document,name:'DB 변경 이름'},updated_at:new Date().toISOString()},true);
 assert.equal((await api('/characters')).data.find((c:{id:string})=>c.id==='friend').name,'DB 변경 이름');
 assert.equal((await api('/notifications/push/subscriptions',{endpoint:'https://127.0.0.1/push',keys:{p256dh:'x'.repeat(40),auth:'x'.repeat(24)}},token)).status,422);
});
test('A failed generation retries from its saved lesson and remains private',async()=>{
 const a=(await api('/auth/guest',{})).data,b=(await api('/auth/guest',{})).data;
 const j=(await api('/chapter-generations',{clientRequestId:randomUUID(),prompt:'교수님과 처음 대화하기',characterId:'professor',personalityId:'calm',lessonCount:2},a.accessToken)).data;
 const real=globalThis.fetch;let broken=true;const indexes:number[]=[];
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/outline'))return Response.json({outline});const i=JSON.parse(init!.body as string).index;indexes.push(i);if(broken&&i===1)return Response.json({error:{code:'AI_UNAVAILABLE',message:'다시 시도',retryable:true}},{status:502});return Response.json({lesson:lesson()});};
 try{for(let i=0;i<4;i++)await workOne();assert.equal((await api('/chapter-generations/'+j.id,undefined,a.accessToken)).data.status,'failed');
  assert.equal((await api('/chapter-generations/'+j.id+'/retry',{},b.accessToken)).status,404);
  broken=false;assert.equal((await api('/chapter-generations/'+j.id+'/retry',{},a.accessToken)).data.status,'queued');
  for(let i=0;i<3;i++)await workOne();assert.equal((await api('/chapter-generations/'+j.id,undefined,a.accessToken)).data.status,'ready');assert.equal(indexes.filter(i=>i===0).length,1);
 }finally{globalThis.fetch=real;}
});
