import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function api(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}

test('Repair persists, blocks checkpoints, accepts sufficient resolution once, and retains correction/idempotency/life rules',async()=>{
 const real=globalThis.fetch,requests:any[]=[];let action='request_apology',mark='X';
 globalThis.fetch=async(url,init)=>{
  if(!String(url).endsWith('/evaluate'))throw new Error('Unexpected AI call '+url);
  const input=JSON.parse(init!.body as string);requests.push(input);
  return Response.json({repairAction:action,repairIssue:'상대에게 모욕적인 말을 했어요.',conversationComplete:true,evaluationMark:mark,goalAchieved:true,outcome:'correct',confidence:.99,toneScore:80,native:false,toneLabel:'확인',feedback:'방금 말을 설명해 주세요.',betterExpression:'무례하게 말해서 죄송합니다.',reason:'방금 발언에 대한 설명이 필요해요.',npcReply:'방금 한 말은 어떤 뜻인가요?',action:'상대를 바라본다.',cues:[{k:'표정',v:'불편한 표정'}],views:[{who:'교수',meaning:'확인',cue:'높임말'},{who:'친구',meaning:'확인',cue:'반말'}],emotion:mark==='X'?'angry':'neutral',provider:'test',isMock:false});
 };
 try{
  for(const sceneId of ['ko-professor-calm','ko-girlfriend-calm']){
   const token=(await api('/auth/guest',{})).data.accessToken;
   action='request_apology';mark='X';
   const start=(await api('/sessions',{sceneId,aiMode:'live'},token)).data,path='/sessions/'+start.id;
   const body={clientTurnId:'offense',inputType:'text',text:'귀찮으니까 꺼져.'};
   const bad=(await api(path+'/turns',body,token)).data;
   assert.equal(bad.session.repair.kind,'apology');assert.equal(bad.session.repair.resumeNpcText,start.npc.text);
   assert.equal(bad.session.lives,2);assert.equal(bad.session.nodeIndex,0);assert.deepEqual(bad.session.choices,[]);
   const requestCount=requests.length;
   assert.equal((await api(path+'/turns',body,token)).data.session.lives,2);assert.equal(requests.length,requestCount);
   await api(path+'/pause',{},token);await api(path+'/resume',{},token);
   assert.deepEqual((await api(path,undefined,token)).data.repair,bad.session.repair);
   assert.equal((await api(path+'/turns',{clientTurnId:'choice',inputType:'choice',choiceId:'a'},token)).status,422);
   const hint=(await api(path+'/hint',{step:1},token)).data;assert.equal(hint.clue[0].v,bad.session.repair.issue);
   action='none';mark='O'; // Even an inconsistent AI response cannot silently erase repair.
   const evasion=(await api(path+'/turns',{clientTurnId:'evasion',inputType:'text',text:'내일 제출할게요.'},token)).data;
   assert.equal(evasion.session.nodeIndex,0);assert.equal(evasion.session.lives,2);assert.equal(evasion.turn.evaluation.progression,'retry');
   assert.equal(requests.at(-1).nextCheckpoint,null);assert.equal(requests.at(-1).closingAllowed,false);assert.deepEqual(requests.at(-1).allowedRoutes,[]);
   action='resolved';mark='O';
   const resolved=(await api(path+'/turns',{clientTurnId:'apology',inputType:'text',text:'무례하게 말해 죄송합니다. 제 잘못인데 화풀이했어요.'},token)).data;
   assert.equal(resolved.turn.mark,'O');assert.equal(resolved.turn.evaluation.goalAchieved,false);
   assert.equal(resolved.session.repair,null);assert.equal(resolved.session.nodeIndex,0);assert.equal(resolved.session.status,'active');
   const corrected=(await api(path+'/correction',{turnId:resolved.turn.id},token)).data;
   assert.equal(corrected.repair.kind,'apology');assert.equal(corrected.lives,2);
   await api(path+'/turns',{clientTurnId:'apology-again',inputType:'text',text:'무례하게 말해 죄송합니다.'},token);
   action='none';
   const proper=(await api(path+'/turns',{clientTurnId:'proper',inputType:'text',text:'내일 오후까지 제출하겠습니다.'},token)).data;
   assert.equal(proper.session.nodeIndex,1);assert.equal(proper.session.repair,null);
   action='request_clarification';mark='?';
   const unclear=(await api(path+'/turns',{clientTurnId:'unclear',inputType:'text',text:'그게 그때...'},token)).data;
   assert.equal(unclear.session.repair.kind,'clarification');assert.equal(unclear.session.lives,2);
   action='resolved';mark='O';
   const clarified=(await api(path+'/turns',{clientTurnId:'clear',inputType:'text',text:'내일이 아니라 모레를 말한 거예요.'},token)).data;
   assert.equal(clarified.session.repair,null);assert.equal(clarified.session.nodeIndex,1);
   action='request_apology';mark='X';
   await api(path+'/turns',{clientTurnId:'again',inputType:'text',text:'시끄러워 꺼져.'},token);
   action='continue';
   const failed=(await api(path+'/turns',{clientTurnId:'again2',inputType:'text',text:'꺼지라고 했잖아.'},token)).data;
   assert.equal(failed.session.lives,0);assert.equal(failed.session.status,'failed');assert.ok(failed.result);
  }
 }finally{globalThis.fetch=real;}
});
