import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function request(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}
test('Selected subtitle language and persona reach AI; each audio asset matches its displayed line',async()=>{
 const token=(await request('/auth/guest',{})).data.accessToken,real=globalThis.fetch;
 const spoken:{text:string,personalityId:string,emotion:string,reaction?:string}[]=[];
 globalThis.fetch=async(url,init)=>{const input=JSON.parse(init!.body as string);if(String(url).endsWith('/subtitles')){assert.equal(input.language,'en');return Response.json({texts:input.texts.map((_:string,i:number)=>'Subtitle '+i)});}
  if(String(url).endsWith('/synthesize')){spoken.push(input);assert.equal(input.personalityId,'strict');return Response.json({assetId:'a_'+'a'.repeat(40),cached:true,voice:'test'});}
  if(String(url).endsWith('/evaluate')){assert.equal(input.personalityId,'strict');assert.equal(input.subtitleLanguage,'en');return Response.json({outcome:'correct',confidence:.99,toneScore:94,toneLabel:'정중해요',native:true,feedback:'좋아요.',betterExpression:'감사합니다.',reason:'의도를 전했어요.',npcReply:'내일 오후까지 제출해 주세요.',npcReplySubtitle:'Please submit it by tomorrow afternoon.',evaluationMark:'O',emotion:'sad',action:'고개를 끄덕인다.',cues:[{k:'표정',v:'차분하다.'}],views:[{who:'교수님',meaning:'감사합니다.',cue:'정중히'},{who:'친구',meaning:'고마워.',cue:'편하게'}],provider:'test-live',isMock:false});}
  throw new Error('Unexpected request');
 };
 try{
  const started=await request('/sessions',{sceneId:'ko-professor-calm',aiMode:'live',personalityId:'strict',subtitleLanguage:'en'},token);
  assert.equal(started.status,200);assert.equal(started.data.personalityId,'strict');assert.equal(started.data.npc.subtitle.text,'Subtitle 0');assert.equal(started.data.briefing.translation.language,'en');assert.ok(started.data.briefing.translation.situation.startsWith('Subtitle '));assert.ok(started.data.briefing.translation.goal);assert.equal(started.data.briefing.partner,'윤 교수');assert.equal('hiddenThought' in started.data.briefing,false);assert.equal(spoken[0].text,started.data.npc.text);assert.ok(started.data.npc.audioUrl.includes('/api/v1/audio/'));
  const result=await request('/sessions/'+started.data.id+'/turns',{clientTurnId:'subtitle-turn',inputType:'text',text:'교수님, 내일 제출해도 될까요?'},token);
  assert.equal(result.status,200);assert.equal(result.data.turn.mark,'O');assert.equal(result.data.turn.evaluation.mark,'O');assert.equal(result.data.turn.emotion,'sad');assert.equal(result.data.turn.npcReplySubtitle.text,'Please submit it by tomorrow afternoon.');assert.equal(spoken.at(-1)!.text,result.data.turn.npcReply);assert.equal(spoken.at(-1)!.emotion,result.data.turn.emotion);assert.equal(spoken.at(-1)!.reaction,result.data.turn.render.reaction);assert.equal(result.data.turn.npcReply,result.data.session.npc.text);
  const replay=await request('/sessions/'+started.data.id+'/speech',{turnId:result.data.turn.id},token);assert.equal(replay.status,200);assert.equal(spoken.at(-1)!.text,result.data.turn.npcReply);assert.equal(spoken.at(-1)!.emotion,result.data.turn.emotion);assert.equal(spoken.at(-1)!.reaction,result.data.turn.render.reaction);
  const badLang=await request('/sessions',{sceneId:'ko-professor-calm',subtitleLanguage:'not-a-language'},token);assert.equal(badLang.status,422);
 }finally{globalThis.fetch=real;}
});

