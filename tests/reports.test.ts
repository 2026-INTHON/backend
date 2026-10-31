import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
import {workOne} from '../src/generation';
import {mergeProfiles} from '../src/store';
before(()=>{process.env.MALO_DB_PATH=':memory:';process.env.MALO_DATA_MODE='sqlite';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function api(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}
test('Report creation is idempotent, survives owner migration and praises good answers without inventing corrections',async()=>{
 const a=(await api('/auth/guest',{})).data,b=(await api('/auth/guest',{})).data,real=globalThis.fetch;
 let reports=0;
 globalThis.fetch=async(url,init)=>{const path=String(url),input=init?.body?JSON.parse(init.body as string):{};
  if(path.endsWith('/evaluate'))return Response.json({reaction:'happy',goalAchieved:true,outcome:'correct',confidence:.99,native:false,toneScore:95,toneLabel:'정중해요',feedback:'이유와 일정을 명확하게 전했어요.',betterExpression:input.node.goodExample,reason:'검토할 시간을 배려했어요.',reasonSubtitle:'You considered review time.',npcReply:'네, 확인했습니다.',npcReplySubtitle:'All right, noted.',emotion:'happy',gesture:'nod',action:'고개를 끄덕인다.',cues:[{k:'표정',v:'미소를 짓는다.'}],views:input.node.views,provider:'test',isMock:false});
  if(path.endsWith('/reports/generate')){reports++;return Response.json({report:{language:input.language,headline:'Clear and considerate',overallFeedback:'You made a clear request.',strengths:['You gave a deadline.'],improvements:[],culturalTakeaways:['Honorifics fit this relationship.'],nextPractice:['Try another polite request.'],nodes:input.nodes.map((n:{nodeId:string})=>({nodeId:n.nodeId,implicitIntent:'The professor needs a specific time.',culturalContext:'A polite question can give the other person room to answer. Preferences vary.',practiceTip:'Keep the timeline specific.'}))}});}
  throw new Error('Unexpected request');
 };
 try{
  const play=(await api('/sessions',{sceneId:'ko-professor-calm',aiMode:'live'},a.accessToken)).data;
  assert.equal((await api('/sessions/'+play.id+'/report',undefined,a.accessToken)).status,409);
  for(let i=0;i<3;i++)assert.equal((await api('/sessions/'+play.id+'/turns',{clientTurnId:'good-'+i,inputType:'choice',choiceId:'b'},a.accessToken)).status,200);
  const first=(await api('/sessions/'+play.id+'/report',{},a.accessToken)).data;
  assert.equal((await api('/sessions/'+play.id+'/report',{},a.accessToken)).data.reportId,first.reportId);
  await mergeProfiles(a.user.id,b.user.id);await workOne();
  const ready=(await api('/sessions/'+play.id+'/report',undefined,b.accessToken)).data;
  assert.equal(ready.status,'ready');assert.equal(reports,1);assert.equal(ready.report.overview.score,100);assert.equal(ready.report.details.length,3);assert.ok(ready.report.details.every((d:{praise:string|null;alternativeExpression:string|null})=>d.praise&&d.alternativeExpression===null));
  assert.equal((await api('/chapter-generations',undefined,b.accessToken)).data.length,0);
  assert.equal((await api('/sessions/'+play.id+'/report',undefined,a.accessToken)).status,401);
  await api('/sessions/'+play.id+'/report',{},b.accessToken);assert.equal(reports,1);
 }finally{globalThis.fetch=real;}
});
