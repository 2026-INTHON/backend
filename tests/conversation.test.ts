import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function api(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}

test('Conversation keeps actual replies, explicit correction restores the question, and scoring counts each checkpoint once',async()=>{
 const token=(await api('/auth/guest',{})).data.accessToken;
 const other=(await api('/auth/guest',{})).data.accessToken;
 const real=globalThis.fetch,requests:any[]=[];
 let mark='O';
 globalThis.fetch=async(url,init)=>{
  const input=JSON.parse(init!.body as string);
  if(String(url).endsWith('/synthesize'))return Response.json({assetId:'a_'+'a'.repeat(40),cached:true,voice:'test'});
  if(String(url).endsWith('/evaluate')){
   requests.push(input);
   return Response.json({npcSpeechLevel:'casual',evaluationMark:mark,goalAchieved:mark==='O',outcome:mark==='O'?'correct':mark==='X'?'misunderstanding':'clarify',confidence:.99,toneScore:80,native:false,toneLabel:'확인',feedback:'구체적으로 답해 보세요.',betterExpression:'알겠습니다.',reason:'대화 의도에 맞게 답했어요.',npcReply:`실제 반응 ${requests.length}: ${input.text}`,action:'상대를 바라본다.',cues:[{k:'표정',v:'차분하다.'}],views:[{who:'교수',meaning:'확인',cue:'높임말'},{who:'친구',meaning:'확인',cue:'반말'}],emotion:mark==='X'?'angry':'neutral',provider:'test',isMock:false});
  }
  throw new Error('Unexpected provider call '+url);
 };
 try{
  const start=(await api('/sessions',{sceneId:'ko-professor-calm',aiMode:'live'},token)).data;
  const path='/sessions/'+start.id;
  const first=(await api(path+'/turns',{clientTurnId:'first',inputType:'text',text:'내일 오후 세 시에 제출하겠습니다.'},token)).data;
  assert.equal(first.session.nodeIndex,1);
  assert.equal(requests[0].npcSpeechLevel,'polite');assert.equal(requests[0].allowSpeechLevelChange,false);
  assert.equal(first.session.npc.speechLevel,'polite');assert.equal(first.turn.npcSpeechLevel,'polite');
  assert.equal(first.turn.prompt.text,start.npc.text);
  assert.equal(first.session.npc.text,first.turn.npcReply);
  assert.ok(requests[0].nextCheckpoint.goal);
  assert.ok(requests[0].nextCheckpoint.draftLine);
  assert.equal((await api(path,undefined,token)).data.npc.text,first.turn.npcReply);
  assert.equal((await api(path+'/correction',{turnId:first.turn.id},other)).status,404);
  const restored=(await api(path+'/correction',{turnId:first.turn.id},token)).data;
  assert.equal(restored.nodeIndex,0);assert.equal(restored.npc.text,start.npc.text);assert.equal(restored.lives,3);
  const corrected=(await api(path+'/turns',{clientTurnId:'corrected',inputType:'text',text:'네 교수님. 내일 세 시까지 보내 드리겠습니다.'},token)).data;
  assert.equal(corrected.turn.comparison.firstAnswer,first.turn.text);
  assert.equal((await api(path+'/correction',{turnId:first.turn.id},token)).status,409);
  for(const code of ['△','X','?']){
   mark=code;
   const turn=(await api(path+'/turns',{clientTurnId:'grade-'+code,inputType:'text',text:'답변 '+code},token)).data;
   assert.equal(turn.session.nodeIndex,1);assert.equal(turn.session.npc.text,turn.turn.npcReply);
   assert.equal(turn.turn.prompt.text,requests.at(-1).node.npcText);
   assert.equal((await api(path,undefined,token)).data.npc.text,turn.turn.npcReply);
  }
  mark='O';
  const agreed=(await api(path+'/turns',{clientTurnId:'register-agreement',inputType:'text',text:'저한테는 반말로 말씀하셔도 돼요.'},token)).data;
  assert.equal(requests.at(-1).allowSpeechLevelChange,true);assert.equal(agreed.session.npc.speechLevel,'casual');
  const restoredRegister=(await api(path+'/correction',{turnId:agreed.turn.id},token)).data;
  assert.equal(restoredRegister.npc.speechLevel,'polite');
  let final;
  for(let i=1;i<start.nodeCount;i++)final=(await api(path+'/turns',{clientTurnId:'end-'+i,inputType:'text',text:'네 교수님, 확인하고 수정하겠습니다.'},token)).data;
  assert.ok(final.result);assert.equal(final.result.achievement.reach,100);assert.ok(final.result.score<=100);
  assert.equal((await api(path+'/correction',{turnId:final.turn.id},token)).status,409);
 }finally{globalThis.fetch=real;}
});
