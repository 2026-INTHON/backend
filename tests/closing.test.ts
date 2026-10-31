import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
import {put} from '../src/content-db';
import {findScenario} from '../src/catalog';
before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function api(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}
test('A late farewell closes once; early closure, inappropriate and native answers cannot skip learning',async()=>{
 const token=(await api('/auth/guest',{})).data.accessToken;
 const seed=findScenario('ko-girlfriend-calm')!,scene={...seed,nodes:Array.from({length:8},(_,i)=>({...seed.nodes[0],id:'n'+i,npcText:i>=6?'오늘 즐거웠어요. 다음에 호칭을 정해 봐요.':'어디에서 오셨어요?',nextNodeId:i<7?'n'+(i+1):null})),endings:[{id:'happy',kind:'happy',title:'인사',text:'대화를 마쳤어요.'}]};
 await put('malo_catalog',{id:'closing-eight',kind:'scene',document:scene,updated_at:new Date().toISOString()},true);
 const real=globalThis.fetch,requests:any[]=[];let mark='O',native=false;
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/character-variants'))return Response.json({items:[]});
  if(!String(url).endsWith('/evaluate'))throw new Error('No extra AI calls in closing test');
  const input=JSON.parse(init!.body as string);requests.push(input);
  return Response.json({conversationComplete:true,evaluationMark:mark,goalAchieved:mark==='O',outcome:mark==='O'?'correct':mark==='X'?'misunderstanding':'clarify',confidence:.99,toneScore:80,native,toneLabel:'정중함',feedback:'자연스러운 인사예요.',betterExpression:'네, 다음에 봬요.',reason:'작별 인사에 응답했어요.',npcReply:'네, 다음에 봐요!',action:'손을 흔든다.',cues:[{k:'표정',v:'미소'}],views:[{who:'교수',meaning:'인사',cue:'존댓말'},{who:'친구',meaning:'인사',cue:'반말'}],emotion:'happy',endingId:'happy',provider:'test',isMock:false});
 };
 try{
  for(const inappropriate of [false,true]){
   const session=(await api('/sessions',{sceneId:'closing-eight',aiMode:'live'},token)).data,path=`/sessions/${session.id}/turns`;
   for(let i=0;i<6;i++){
    const r=(await api(path,{clientTurnId:`answer-${i}`,inputType:'text',text:'캐나다에서 왔어요.'},token)).data;
    assert.equal(requests.at(-1).closingAllowed,false);assert.equal(r.session.status,'active');assert.equal(r.session.nodeIndex,i+1);
   }
   if(inappropriate){
    mark='X';const bad=(await api(path,{clientTurnId:'bad',inputType:'text',text:'귀찮으니까 꺼져.'},token)).data;
    assert.equal(bad.session.status,'active');assert.equal(bad.session.nodeIndex,6);
    mark='△';native=true;const help=(await api(path,{clientTurnId:'native',inputType:'text',text:'See you next time.'},token)).data;
    assert.equal(help.session.status,'active');assert.equal(help.session.nodeIndex,6);
    mark='O';native=false;
   }
   const body={clientTurnId:'farewell',inputType:'text',text:'네! 조심히 들어가세요!'};
   const result=(await api(path,body,token)).data;
   assert.equal(requests.at(-1).closingAllowed,true);assert.equal(result.session.status,'succeeded');assert.equal(result.session.nodeIndex,8);assert.ok(result.result);
   assert.equal(result.result.achievement.reach,100);assert.equal(result.result.score,inappropriate?92:100);
   const again=(await api(path,body,token)).data;
   assert.equal(again.turn.id,result.turn.id);assert.deepEqual(again.result,result.result);
  }
 }finally{globalThis.fetch=real;}
});
