import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
import {buildScenario} from '../src/catalog';
import * as Content from '../src/content';
import {put} from '../src/content-db';

before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function api(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result.data;}

test('Failed endings use negative uploaded images while respectful deferral and happy completion retain their learning grades',async()=>{
 await Content.seedCatalog();const character=(await Content.characters()).find(c=>c.id==='girlfriend')!;
 const image=(assetKey:string,emotion:string,reaction:string,endingPreferred=false)=>({assetKey,characterId:'girlfriend',emotion,gesture:'idle',reaction,endingPreferred,defaultForEmotion:!endingPreferred,imageUrl:'https://storage.test/'+assetKey+'.webp'});
 const images=[image('neutral','neutral','relaxed'),image('happy','happy','delighted'),image('soft-sad','sad','hurt'),image('contempt','angry','contempt',true),image('sobbing','sad','sobbing',true)];
 await put('malo_catalog',{id:'girlfriend',kind:'character',document:{...character,imageVariants:images},updated_at:new Date().toISOString()},true);
 const scenario={...buildScenario('girlfriend','calm','ko'),source:'curriculum',endings:['happy','deferred','breakdown'].map(id=>({id,kind:id==='happy'?'happy':'bad',title:id,text:'대화가 마무리됐어요.'}))};
 await put('malo_catalog',{id:'ending-images',kind:'scene',document:scenario,updated_at:new Date().toISOString()},true);
 const real=globalThis.fetch;let ending='breakdown',remaining=3;
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/character-variants'))return Response.json({items:[]});
  assert.ok(String(url).endsWith('/evaluate'));const input=JSON.parse(init!.body as string);assert.equal(input.livesRemaining,remaining);assert.ok(input.imageOptions.some((v:{endingPreferred:boolean})=>v.endingPreferred));
  const bad=ending==='breakdown';return Response.json({evaluationMark:bad?'X':'O',goalAchieved:!bad,outcome:bad?'misunderstanding':'correct',confidence:.99,native:false,toneScore:bad?20:95,toneLabel:'상황 평가',feedback:'상황에 맞는 표현을 연습해요.',betterExpression:input.node.goodExample,reason:'현재 요청에 대한 응답을 확인했어요.',npcReply:'이야기를 마무리할게요.',emotion:'happy',gesture:'idle',imageAssetKey:bad?'contempt':'happy',action:'상대를 바라본다.',cues:[{k:'표정',v:'상대를 바라본다.'}],views:[{who:'친구',meaning:'고마워.',cue:'편한 말투'},{who:'교수님',meaning:'감사합니다.',cue:'높임말'}],endingId:ending,provider:'test-live',isMock:false});
 };
 try{
  for(ending of ['breakdown','deferred','happy']){
   const token=(await api('/auth/guest',{})).accessToken,session=await api('/sessions',{sceneId:'ending-images',aiMode:'live'},token);let last;
   const active=await app.request('/api/v1/sessions/'+session.id+'/ending',{headers:{Authorization:'Bearer '+token}});assert.equal(active.status,409);
   for(let i=0;i<3;i++){remaining=ending==='breakdown'?3-i:3;last=await api('/sessions/'+session.id+'/turns',{clientTurnId:'ending-'+i,inputType:'text',text:'상황을 확인하고 답변합니다.'},token);}
   assert.equal(last.result.ending.id,ending);assert.equal(last.result.ending.render.assetKey,last.turn.render.assetKey);
   if(ending==='breakdown'){assert.equal(last.session.status,'failed');assert.equal(last.turn.mark,'X');assert.equal(last.turn.emotion,'angry');assert.equal(last.turn.render.reaction,'contempt');assert.ok(last.turn.npcReply.includes('이상한 사람'));assert.ok(last.result.ending.recap.story.includes('차갑게'));}
   else {assert.equal(last.result.passed,true);assert.equal(last.turn.mark,'O');assert.equal(last.result.score,100);assert.equal(last.turn.render.assetKey,ending==='deferred'?'soft-sad':'happy');}
   const saved=await api('/sessions/'+session.id+'/result',undefined,token);assert.equal(saved.ending.render.assetKey,last.turn.render.assetKey);
   const card=await api('/sessions/'+session.id+'/ending',undefined,token);assert.equal(card.render.assetKey,last.turn.render.assetKey);assert.equal(card.dialogue.text,last.turn.npcReply);assert.equal(card.dialogue.turnId,last.turn.id);assert.ok(card.recap.story);assert.ok(card.recap.prompt);
   if(ending==='happy')assert.ok(card.recap.comment.includes('좋은 인상'));else assert.ok(!card.recap.comment.includes('답변만 쏙쏙'));
   const other=(await api('/auth/guest',{})).accessToken;const denied=await app.request('/api/v1/sessions/'+session.id+'/ending',{headers:{Authorization:'Bearer '+other}});assert.equal(denied.status,404);
  }
 }finally{globalThis.fetch=real;}
});
